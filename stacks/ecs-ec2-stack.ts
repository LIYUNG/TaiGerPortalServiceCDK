import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import {
    BasePathMapping,
    DomainName,
    EndpointType,
    HttpIntegration,
    LogGroupLogDestination,
    RestApi,
    AccessLogFormat,
    AccessLogField,
    CfnAccount
} from "aws-cdk-lib/aws-apigateway";
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { ApiGatewayDomain, LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import { APPLICATION_NAME, DOMAIN_NAME, ECR_REPO_NAME } from "../configuration";
import {
    ContainerImage,
    DeploymentControllerType,
    Ec2Service,
    LogDriver,
    PlacementStrategy,
    Secret
} from "aws-cdk-lib/aws-ecs";
import { aws_secretsmanager, Duration, Size, Stack, StackProps } from "aws-cdk-lib";
import { EcsEc2Role } from "../constructs";
import { Repository } from "aws-cdk-lib/aws-ecr";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { ManagedPolicy, Role } from "aws-cdk-lib/aws-iam";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { ApplicationProtocol } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { SpotRequestType } from "aws-cdk-lib/aws-ec2";
import { InstanceType } from "aws-cdk-lib/aws-ec2";

interface EcsEc2StackProps extends StackProps {
    stageName: string;
    secretArn: string;
    s3BucketArns: string[];
    instanceType: InstanceType;
    ecsEc2Capacity: {
        min: number;
        max: number;
    };
    ecsTaskCapacity: {
        min: number;
        max: number;
    };
    isProd: boolean;
}

export class EcsEc2Stack extends Stack {
    readonly api: RestApi;
    constructor(scope: Construct, id: string, props: EcsEc2StackProps) {
        super(scope, id, props);

        // Define multiple parameters
        const secret = aws_secretsmanager.Secret.fromSecretCompleteArn(
            this,
            `${APPLICATION_NAME}-Secret-${props.stageName}`,
            props.secretArn
        );

        // Create a custom IAM role with S3 and SQS access
        const ecsEc2Role = new EcsEc2Role(
            this,
            `${APPLICATION_NAME}-EcsEc2Role-${props.stageName}`,
            {
                region: props.env?.region,
                stageName: props.stageName,
                resoureName: `${APPLICATION_NAME}-ecs-ec2`,
                secretArn: props.secretArn,
                s3BucketArns: props.s3BucketArns
            }
        );

        // Create a cluster
        const vpc = new cdk.aws_ec2.Vpc(
            this,
            `${APPLICATION_NAME}-ecs-ec2-Vpc-${props.stageName}`,
            {
                natGateways: 0,
                subnetConfiguration: [{ name: "Public", subnetType: cdk.aws_ec2.SubnetType.PUBLIC }]
            }
        );

        const anyIp4 = cdk.aws_ec2.Peer.anyIpv4();
        const albSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, `${APPLICATION_NAME}-ALB-SG`, {
            vpc,
            description: `${APPLICATION_NAME} ALB Security Group`
        });

        albSecurityGroup.addIngressRule(
            anyIp4,
            cdk.aws_ec2.Port.tcp(443),
            "Allow HTTPS from public"
        );

        const ecsEc2SecurityGroup = new cdk.aws_ec2.SecurityGroup(this, `${APPLICATION_NAME}-SG`, {
            vpc,
            description: `${APPLICATION_NAME} ECS EC2 Security Group`,
            allowAllOutbound: true
        });

        ecsEc2SecurityGroup.addIngressRule(
            albSecurityGroup,
            cdk.aws_ec2.Port.tcp(3000),
            "Allow HTTP from ALB"
        );

        const ecsInstanceRole = new Role(
            this,
            `${APPLICATION_NAME}-InstanceRole-${props.stageName}`,
            {
                roleName: `${APPLICATION_NAME}-ECS-EC2-InstanceRole-${props.stageName}`,
                assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
                managedPolicies: [
                    ManagedPolicy.fromAwsManagedPolicyName(
                        "service-role/AmazonEC2ContainerServiceforEC2Role"
                    ),
                    ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly")
                ]
            }
        );

        const executionRole = new Role(
            this,
            `${APPLICATION_NAME}-ExecutionRole-${props.stageName}`,
            {
                assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
                description: "IAM Role for Ecs to access S3 and SQS securely"
            }
        );
        // Basic Ecs execution permissions (logs, metrics, etc.)
        executionRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")
        );

        const keyPair = new cdk.aws_ec2.KeyPair(
            this,
            `${APPLICATION_NAME}-KeyPair-${props.stageName}`,
            {
                keyPairName: `${APPLICATION_NAME}-EcsEc2KeyPair-${props.stageName}`
            }
        );

        const launchTemplate = new cdk.aws_ec2.LaunchTemplate(
            this,
            `${APPLICATION_NAME}-LaunchTemplate-${props.stageName}`,
            {
                instanceType: props.instanceType,
                machineImage: cdk.aws_ecs.EcsOptimizedImage.amazonLinux2023(
                    cdk.aws_ecs.AmiHardwareType.ARM,
                    {
                        cachedInContext: true
                    }
                ),
                blockDevices: [
                    { deviceName: "/dev/xvda", volume: cdk.aws_ec2.BlockDeviceVolume.ebs(30) }
                ],
                securityGroup: ecsEc2SecurityGroup,
                role: ecsInstanceRole,
                requireImdsv2: true,
                httpEndpoint: true,
                keyPair: keyPair,
                userData: cdk.aws_ec2.UserData.forLinux({
                    shebang: "#!/bin/bash"
                }),
                spotOptions: !props.isProd
                    ? {
                          requestType: SpotRequestType.ONE_TIME
                      }
                    : undefined
            }
        );

        const asg = new cdk.aws_autoscaling.AutoScalingGroup(
            this,
            `${APPLICATION_NAME}-AutoScalingGroup-${props.stageName}`,
            {
                vpc,
                vpcSubnets: {
                    subnetType: cdk.aws_ec2.SubnetType.PUBLIC
                },
                launchTemplate,
                minCapacity: props.ecsEc2Capacity.min,
                maxCapacity: props.ecsEc2Capacity.max
            }
        );

        const cluster = new cdk.aws_ecs.Cluster(
            this,
            `${APPLICATION_NAME}-Cluster-${props.stageName}`,
            {
                clusterName: `${APPLICATION_NAME}-ec2-cluster-${props.stageName}`,
                vpc
            }
        );

        const capacityProvider = new cdk.aws_ecs.AsgCapacityProvider(
            this,
            `${APPLICATION_NAME}-CapacityProvider-${props.stageName}`,
            {
                autoScalingGroup: asg
            }
        );

        cluster.addAsgCapacityProvider(capacityProvider);

        const logGroup = new LogGroup(
            this,
            `${APPLICATION_NAME}-EcsEc2LogGroup-${props.stageName}`,
            {
                logGroupName: `/ecs/ec2/${APPLICATION_NAME}-${props.stageName}`,
                retention: cdk.aws_logs.RetentionDays.SIX_MONTHS,
                removalPolicy: cdk.RemovalPolicy.DESTROY
            }
        );

        const ecrRepoEcs = Repository.fromRepositoryName(
            this,
            `${APPLICATION_NAME}-ecs-ec2-ImportedEcrRepoEcs-${props.stageName}`,
            ECR_REPO_NAME
        );

        const imageDigest = this.node.tryGetContext("imageDigest") || "latest";

        const taskDefinition = new cdk.aws_ecs.Ec2TaskDefinition(
            this,
            `${APPLICATION_NAME}-EcsEc2TaskDefinition-${props.stageName}`,
            {
                executionRole: executionRole,
                taskRole: ecsEc2Role.role
            }
        );

        taskDefinition.addContainer("EcsEc2Container", {
            image: ContainerImage.fromEcrRepository(ecrRepoEcs, imageDigest),
            portMappings: [{ containerPort: 3000, hostPort: 3000 }],
            memoryReservationMiB: 256,
            logging: LogDriver.awsLogs({
                streamPrefix: `${APPLICATION_NAME}-ecs-ec2-${props.stageName}`,
                logGroup: logGroup
            }),
            environment: {
                ORIGIN: props.isProd
                    ? `https://${DOMAIN_NAME}`
                    : `https://${props.stageName}.${DOMAIN_NAME}`,
                API_ORIGIN: props.isProd
                    ? `https://${DOMAIN_NAME}`
                    : `https://${props.stageName}.${DOMAIN_NAME}`
            },
            secrets: {
                // Add SSM parameters as environment variables
                TENANT_ID: Secret.fromSecretsManager(secret, "TENANT_ID"),
                JWT_SECRET: Secret.fromSecretsManager(secret, "JWT_SECRET"),
                HTTPS_PORT: Secret.fromSecretsManager(secret, "HTTPS_PORT"),
                JWT_EXPIRE: Secret.fromSecretsManager(secret, "JWT_EXPIRE"),
                MONGODB_URI: Secret.fromSecretsManager(secret, "MONGODB_URI"),
                PORT: Secret.fromSecretsManager(secret, "PORT"),
                PROGRAMS_CACHE: Secret.fromSecretsManager(secret, "PROGRAMS_CACHE"),
                ESCALATION_DEADLINE_DAYS_TRIGGER: Secret.fromSecretsManager(
                    secret,
                    "ESCALATION_DEADLINE_DAYS_TRIGGER"
                ),
                SMTP_HOST: Secret.fromSecretsManager(secret, "SMTP_HOST"),
                SMTP_PORT: Secret.fromSecretsManager(secret, "SMTP_PORT"),
                SMTP_USERNAME: Secret.fromSecretsManager(secret, "SMTP_USERNAME"),
                SMTP_PASSWORD: Secret.fromSecretsManager(secret, "SMTP_PASSWORD"),
                CLEAN_UP_SCHEDULE: Secret.fromSecretsManager(secret, "CLEAN_UP_SCHEDULE"),
                WEEKLY_TASKS_REMINDER_SCHEDULE: Secret.fromSecretsManager(
                    secret,
                    "WEEKLY_TASKS_REMINDER_SCHEDULE"
                ),
                DAILY_TASKS_REMINDER_SCHEDULE: Secret.fromSecretsManager(
                    secret,
                    "DAILY_TASKS_REMINDER_SCHEDULE"
                ),
                COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE: Secret.fromSecretsManager(
                    secret,
                    "COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE"
                ),
                COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE: Secret.fromSecretsManager(
                    secret,
                    "COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE"
                ),
                COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE: Secret.fromSecretsManager(
                    secret,
                    "COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE"
                ),
                COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE: Secret.fromSecretsManager(
                    secret,
                    "COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE"
                ),
                UPLOAD_PATH: Secret.fromSecretsManager(secret, "UPLOAD_PATH"),
                AWS_S3_PUBLIC_BUCKET: Secret.fromSecretsManager(secret, "AWS_S3_PUBLIC_BUCKET"),
                AWS_S3_PUBLIC_BUCKET_NAME: Secret.fromSecretsManager(
                    secret,
                    "AWS_S3_PUBLIC_BUCKET_NAME"
                ),
                AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT: Secret.fromSecretsManager(
                    secret,
                    "AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT"
                ),
                AWS_S3_BUCKET_NAME: Secret.fromSecretsManager(secret, "AWS_S3_BUCKET_NAME"),
                AWS_REGION: Secret.fromSecretsManager(secret, "AWS_REGION"),
                AWS_LOG_GROUP: Secret.fromSecretsManager(secret, "AWS_LOG_GROUP"),
                AWS_TRANSCRIPT_ANALYSER_ROLE: Secret.fromSecretsManager(
                    secret,
                    "AWS_TRANSCRIPT_ANALYSER_ROLE"
                ),
                AWS_TRANSCRIPT_ANALYSER_APIG_URL: Secret.fromSecretsManager(
                    secret,
                    "AWS_TRANSCRIPT_ANALYSER_APIG_URL"
                ),
                OPENAI_API_KEY: Secret.fromSecretsManager(secret, "OPENAI_API_KEY"),
                POSTGRES_URI: Secret.fromSecretsManager(secret, "POSTGRES_URI")
            }
        });

        const service = new Ec2Service(this, `${APPLICATION_NAME}-Service-${props.stageName}`, {
            cluster,
            taskDefinition,
            capacityProviderStrategies: [
                {
                    capacityProvider: capacityProvider.capacityProviderName,
                    weight: 1
                }
            ],
            circuitBreaker: {
                rollback: true
            },
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
            serviceName: `${APPLICATION_NAME}-ecs-ec2-${props.stageName}`,
            placementStrategies: [PlacementStrategy.spreadAcrossInstances()],
            deploymentController: {
                type: DeploymentControllerType.ECS
            }
        });

        const scaling = service.autoScaleTaskCount({
            minCapacity: props.ecsTaskCapacity.min,
            maxCapacity: props.ecsTaskCapacity.max
        });

        scaling.scaleOnCpuUtilization(`${APPLICATION_NAME}-EcsEc2CpuScaling-${props.stageName}`, {
            targetUtilizationPercent: 60,
            scaleInCooldown: Duration.seconds(300),
            scaleOutCooldown: Duration.seconds(60)
        });

        asg.scaleOnCpuUtilization(`${APPLICATION_NAME}-EcsEc2AutoScalingGroup-${props.stageName}`, {
            targetUtilizationPercent: 60
        });

        const hostedZone = HostedZone.fromLookup(
            this,
            `${APPLICATION_NAME}-HostedZone-${props.stageName}`,
            {
                domainName: DOMAIN_NAME // Replace with your domain name
            }
        );

        const albDomain = `api.ecs.alb.${props.stageName}.${DOMAIN_NAME}`;

        const albCertificate = new Certificate(
            this,
            `${APPLICATION_NAME}-ALBCertificate-${props.stageName}`,
            {
                domainName: albDomain,
                validation: CertificateValidation.fromDns(hostedZone)
            }
        );

        // Create ALB
        const alb = new cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer(
            this,
            `${APPLICATION_NAME}-alb-${props.stageName}`,
            {
                vpc,
                internetFacing: true,
                loadBalancerName: `${APPLICATION_NAME}-alb-${props.stageName}`,
                securityGroup: albSecurityGroup
            }
        );

        // Step 6: Create Route 53 Record to point to the ALB
        new ARecord(this, `${APPLICATION_NAME}-EcsEc2ALBRecord-${props.stageName}`, {
            zone: hostedZone,
            recordName: albDomain, // Subdomain name for your custom domain
            target: RecordTarget.fromAlias(new LoadBalancerTarget(alb))
        });

        const listener = alb.addListener("PublicListener", {
            protocol: ApplicationProtocol.HTTPS,
            open: true,
            certificates: [albCertificate]
        });

        // Attach ALB to ECS Service
        listener.addTargets("ECS", {
            protocol: ApplicationProtocol.HTTP,
            targets: [
                service.loadBalancerTarget({
                    containerName: "EcsEc2Container",
                    containerPort: 3000
                })
            ],
            // include health check (default is none)
            healthCheck: {
                interval: cdk.Duration.seconds(60),
                path: "/health",
                timeout: cdk.Duration.seconds(5),
                healthyThresholdCount: 3,
                unhealthyThresholdCount: 2
            }
        });

        // Step 2: Create API Gateway
        const logGroupApi = new LogGroup(
            this,
            `${APPLICATION_NAME}-APIGWLogGroup-${props.stageName}`,
            {
                logGroupName: `/ecs/apigw/${APPLICATION_NAME}-${props.stageName}`,
                retention: cdk.aws_logs.RetentionDays.SIX_MONTHS,
                removalPolicy: cdk.RemovalPolicy.DESTROY
            }
        );

        // Create a role for API Gateway to use for CloudWatch Logs
        const apiGatewayCloudWatchRole = new Role(
            this,
            `ApiGatewayCloudWatchRole-${props.stageName}`,
            {
                roleName: `ApiGatewayCloudWatchRole-${props.stageName}`,
                assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
                managedPolicies: [
                    ManagedPolicy.fromAwsManagedPolicyName(
                        "service-role/AmazonAPIGatewayPushToCloudWatchLogs"
                    )
                ]
            }
        );

        // Set the role at account level for API Gateway
        new CfnAccount(this, `${APPLICATION_NAME}-ApiGatewayAccount-${props.stageName}`, {
            cloudWatchRoleArn: apiGatewayCloudWatchRole.roleArn
        });

        this.api = new RestApi(this, `${APPLICATION_NAME}-EcsEc2APIG-${props.stageName}`, {
            restApiName: `${APPLICATION_NAME}-api-${props.stageName}`,
            defaultCorsPreflightOptions: {
                allowOrigins: ["*"], // Restrict as necessary
                allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], // ✅ Keep OPTIONS
                allowHeaders: [
                    "Authorization",
                    "Content-Type",
                    "X-auth",
                    "tenantId",
                    "Accept-Encoding"
                ],
                allowCredentials: true // ✅ Required when using credentials
            },
            description: "This service handles requests with Ecs from TaiGer portal.",
            deployOptions: {
                accessLogDestination: new LogGroupLogDestination(logGroupApi),
                accessLogFormat: AccessLogFormat.custom(
                    JSON.stringify({
                        accountId: AccessLogField.contextIdentityAccountId(),
                        apiId: AccessLogField.contextApiId(),
                        authorizeError: AccessLogField.contextAuthorizeError(),
                        callerAccountId: AccessLogField.contextCallerAccountId(),
                        domainName: AccessLogField.contextDomainName(),
                        errorMessage: AccessLogField.contextErrorMessageString(),
                        errorValidationError: AccessLogField.contextErrorValidationErrorString(),
                        errorType: AccessLogField.contextErrorResponseType(),
                        extendedRequestId: AccessLogField.contextExtendedRequestId(),
                        httpMethod: AccessLogField.contextHttpMethod(),
                        ownerAccountId: AccessLogField.contextOwnerAccountId(),
                        path: AccessLogField.contextPath(),
                        protocol: AccessLogField.contextProtocol(),
                        requestTime: AccessLogField.contextRequestTime(),
                        responseLength: AccessLogField.contextResponseLength(),
                        responseLatency: AccessLogField.contextResponseLatency(),
                        requestId: AccessLogField.contextRequestId(),
                        resourcePath: AccessLogField.contextResourcePath(),
                        sourceIp: AccessLogField.contextIdentitySourceIp(),
                        stage: AccessLogField.contextStage(),
                        status: AccessLogField.contextStatus(),
                        user: AccessLogField.contextIdentityUserArn()
                    })
                ),
                stageName: props.stageName // Your API stage
            },
            minCompressionSize: Size.kibibytes(0),
            binaryMediaTypes: ["*/*"],
            endpointConfiguration: { types: [EndpointType.REGIONAL] },
            cloudWatchRole: true
        });

        // Define IAM authorization for the API Gateway method
        // const methodOptions: MethodOptions = {
        //     authorizationType: AuthorizationType.IAM // Require SigV4 signed requests
        // };

        // Create a resource and method in API Gateway
        const ecsProxy = this.api.root.addResource("{proxy+}");

        // Create ALB integration
        const albIntegration = new HttpIntegration(
            `https://${albDomain}/{proxy}`, // Include `{proxy}` in backend path
            {
                httpMethod: "ANY",
                proxy: true,
                options: {
                    requestParameters: {
                        "integration.request.path.proxy": "method.request.path.proxy" // Map the proxy path
                    }
                }
            }
        );

        ecsProxy.addMethod("ANY", albIntegration, {
            requestParameters: {
                "method.request.path.proxy": true // Enable path parameter
            }
        });

        const apiDomain = `api.ecs.${props.stageName}.${DOMAIN_NAME}`;

        const certificate = new Certificate(
            this,
            `${APPLICATION_NAME}-EcsEc2ApiCertificate-${props.stageName}`,
            {
                domainName: apiDomain,
                validation: CertificateValidation.fromDns(hostedZone)
            }
        );

        const domainName = new DomainName(
            this,
            `${APPLICATION_NAME}-EcsEc2CustomDomain-${props.stageName}`,
            {
                domainName: apiDomain,
                certificate
            }
        );

        new BasePathMapping(this, `${APPLICATION_NAME}-EcsEc2BasePathMapping-${props.stageName}`, {
            domainName: domainName,
            restApi: this.api,
            stage: this.api.deploymentStage
        });

        // Step 6: Create Route 53 Record to point to the API Gateway
        new ARecord(this, `${APPLICATION_NAME}-EcsEc2ApiGatewayRecord-${props.stageName}`, {
            zone: hostedZone,
            recordName: apiDomain, // Subdomain name for your custom domain
            target: RecordTarget.fromAlias(new ApiGatewayDomain(domainName))
        });

        // Cost center tag
        cdk.Tags.of(service).add("Project", "Meritonai");
        cdk.Tags.of(service).add("Environment", props.stageName);
        cdk.Tags.of(this.api).add("CostCenter", "EcsService");
    }
}
