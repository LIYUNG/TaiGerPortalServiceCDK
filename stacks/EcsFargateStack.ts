import {
    aws_ecs_patterns,
    aws_secretsmanager,
    Duration,
    Fn,
    RemovalPolicy,
    Stack,
    StackProps
} from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as certmgr from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as logs from "aws-cdk-lib/aws-logs"; // For CloudWatch Log resources
import { Construct } from "constructs";

import { APP_NAME, APP_NAME_TAIGER_SERVICE, AWS_ACCOUNT, DOMAIN_NAME } from "../configuration";
import { CfnIdentityPool, IUserPool, UserPool, UserPoolClient } from "aws-cdk-lib/aws-cognito";

interface EcsFargateStackProps extends StackProps {
    stageName: string;
    isProd: boolean;
    secretArn: string;
    // userPool: IUserPool;
    // userPoolClient: UserPoolClient;
    // identityPool: CfnIdentityPool;
}

export class EcsFargateStack extends Stack {
    constructor(scope: Construct, id: string, props: EcsFargateStackProps) {
        super(scope, id, props);

        // Step 1: VPC for ECS
        const vpc = new ec2.Vpc(this, `${APP_NAME_TAIGER_SERVICE}-Vpc`, {
            maxAzs: 2,
            vpcName: `${APP_NAME}-vpc-${props.stageName}`,
            natGateways: 0, // Number of NAT Gateways
            subnetConfiguration: [
                {
                    name: "Public",
                    subnetType: ec2.SubnetType.PUBLIC
                }
            ]
        });

        const securityGroup = new ec2.SecurityGroup(
            this,
            `${APP_NAME_TAIGER_SERVICE}-EcsFargateSecurityGroup`,
            {
                vpc,
                allowAllOutbound: true, // You can specify more specific rules if needed
                securityGroupName: `${APP_NAME_TAIGER_SERVICE}-EcsFargateSecurityGroup`
            }
        );

        // Allow inbound traffic only from CloudFront's IP ranges
        // TODO regionalize
        // const cloudfrontPrefixList = ec2.Peer.prefixList('pl-3b927c52'); // Managed prefix list for CloudFront
        const anyIp4 = ec2.Peer.anyIpv4();
        securityGroup.addIngressRule(
            anyIp4,
            ec2.Port.tcp(3000), // Adjust this if your ECS service listens on a different port
            "Allow inbound access from CloudFront IP ranges"
        );

        // Step 2: ECS Cluster
        const cluster = new ecs.Cluster(this, `${APP_NAME}-EcsCluster`, {
            clusterName: `${APP_NAME}-cluster-${props.stageName}`,
            vpc
        });

        const secret = aws_secretsmanager.Secret.fromSecretCompleteArn(
            this,
            `${APP_NAME_TAIGER_SERVICE}-Secret`,
            props.secretArn
        );

        new logs.LogGroup(this, `${APP_NAME_TAIGER_SERVICE}-LogGroup`, {
            logGroupName: `${APP_NAME}-${props.stageName}`,
            retention: logs.RetentionDays.SIX_MONTHS,
            removalPolicy: RemovalPolicy.DESTROY // Adjust based on your preference
        });

        const taskRole = new iam.Role(this, "TaskRole", {
            roleName: `${APP_NAME}-role-${props.stageName}`,
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com")
        });

        // Grant necessary permissions for CloudWatch Logs
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ["logs:DescribeLogStreams", "logs:CreateLogStream", "logs:PutLogEvents"],
                resources: [
                    `arn:aws:logs:${props.env?.region}:${AWS_ACCOUNT}:log-group:${APP_NAME}-${props.stageName}*`
                ]
            })
        );

        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ["ses:SendEmail"],
                resources: ["*"] // SES email sending permissions
            })
        );
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ["execute-api:Invoke"],
                resources: [
                    `arn:aws:execute-api:${props.env?.region}:${AWS_ACCOUNT}:*/*/*/*` // Replace with your API Gateway ARN
                ]
            })
        );

        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ["sts:AssumeRole"],
                resources: [
                    `arn:aws:execute-api:${props.env?.region}:${AWS_ACCOUNT}:*/*/*/*` // Replace with your API Gateway ARN
                ]
            })
        );

        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "secretsmanager:GetSecretValue" // Required to fetch secrets
                ],
                resources: [secret.secretFullArn ?? secret.secretArn] // Allow access to the specific secret
            })
        );

        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:DeleteObject"],
                resources: [
                    `arn:aws:s3:::taiger-file-storage`,
                    `arn:aws:s3:::taiger-file-storage/*`,
                    `arn:aws:s3:::taiger-file-storage-public`,
                    `arn:aws:s3:::taiger-file-storage-public/*`
                ]
            })
        );

        const ecrRepo = ecr.Repository.fromRepositoryName(
            this,
            "ImportedEcrRepo",
            Fn.importValue(`${APP_NAME_TAIGER_SERVICE}-EcrRepoUri`)
        );

        // Step 6: Fargate Service
        // Instantiate a Fargate service in the public subnet
        const fargateService = new aws_ecs_patterns.ApplicationLoadBalancedFargateService(
            this,
            `${APP_NAME_TAIGER_SERVICE}-FargateService`,
            {
                serviceName: `${APP_NAME}-fargate-${props.stageName}`,
                cluster,
                taskImageOptions: {
                    image: ecs.ContainerImage.fromEcrRepository(ecrRepo, "latest"), // Replace with your Node.js app image
                    containerPort: 3000,
                    secrets: {
                        // Add SSM parameters as environment variables
                        API_ORIGIN: ecs.Secret.fromSecretsManager(secret, "API_ORIGIN"),
                        TENANT_ID: ecs.Secret.fromSecretsManager(secret, "TENANT_ID"),
                        JWT_SECRET: ecs.Secret.fromSecretsManager(secret, "JWT_SECRET"),
                        JWT_EXPIRE: ecs.Secret.fromSecretsManager(secret, "JWT_EXPIRE"),
                        MONGODB_URI: ecs.Secret.fromSecretsManager(secret, "MONGODB_URI"),
                        PORT: ecs.Secret.fromSecretsManager(secret, "PORT"),
                        PROGRAMS_CACHE: ecs.Secret.fromSecretsManager(secret, "PROGRAMS_CACHE"),
                        ESCALATION_DEADLINE_DAYS_TRIGGER: ecs.Secret.fromSecretsManager(
                            secret,
                            "ESCALATION_DEADLINE_DAYS_TRIGGER"
                        ),
                        ORIGIN: ecs.Secret.fromSecretsManager(secret, "ORIGIN"),
                        CLEAN_UP_SCHEDULE: ecs.Secret.fromSecretsManager(
                            secret,
                            "CLEAN_UP_SCHEDULE"
                        ),
                        WEEKLY_TASKS_REMINDER_SCHEDULE: ecs.Secret.fromSecretsManager(
                            secret,
                            "WEEKLY_TASKS_REMINDER_SCHEDULE"
                        ),
                        DAILY_TASKS_REMINDER_SCHEDULE: ecs.Secret.fromSecretsManager(
                            secret,
                            "DAILY_TASKS_REMINDER_SCHEDULE"
                        ),
                        COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE:
                            ecs.Secret.fromSecretsManager(
                                secret,
                                "COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE"
                            ),
                        COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE:
                            ecs.Secret.fromSecretsManager(
                                secret,
                                "COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE"
                            ),
                        COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE:
                            ecs.Secret.fromSecretsManager(
                                secret,
                                "COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE"
                            ),
                        COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE:
                            ecs.Secret.fromSecretsManager(
                                secret,
                                "COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE"
                            ),
                        UPLOAD_PATH: ecs.Secret.fromSecretsManager(secret, "UPLOAD_PATH"),
                        AWS_S3_PUBLIC_BUCKET: ecs.Secret.fromSecretsManager(
                            secret,
                            "AWS_S3_PUBLIC_BUCKET"
                        ),
                        AWS_S3_PUBLIC_BUCKET_NAME: ecs.Secret.fromSecretsManager(
                            secret,
                            "AWS_S3_PUBLIC_BUCKET_NAME"
                        ),
                        AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT: ecs.Secret.fromSecretsManager(
                            secret,
                            "AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT"
                        ),
                        AWS_S3_BUCKET_NAME: ecs.Secret.fromSecretsManager(
                            secret,
                            "AWS_S3_BUCKET_NAME"
                        ),
                        AWS_REGION: ecs.Secret.fromSecretsManager(secret, "AWS_REGION"),
                        AWS_TRANSCRIPT_ANALYSER_ROLE: ecs.Secret.fromSecretsManager(
                            secret,
                            "AWS_TRANSCRIPT_ANALYSER_ROLE"
                        ),
                        AWS_TRANSCRIPT_ANALYSER_APIG_URL: ecs.Secret.fromSecretsManager(
                            secret,
                            "AWS_TRANSCRIPT_ANALYSER_APIG_URL"
                        ),
                        OPENAI_API_KEY: ecs.Secret.fromSecretsManager(secret, "OPENAI_API_KEY")
                    },
                    taskRole
                },
                memoryLimitMiB: 512,
                cpu: 256,
                runtimePlatform: {
                    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                    cpuArchitecture: ecs.CpuArchitecture.ARM64
                },
                assignPublicIp: true,
                publicLoadBalancer: true, // Ensure the ALB is public
                securityGroups: [securityGroup],
                deploymentController: {
                    type: ecs.DeploymentControllerType.CODE_DEPLOY
                }
            }
        );

        // Access the target group created for the ALB
        const targetGroup = fargateService.targetGroup;

        // Configure the health check for the target group
        targetGroup.configureHealthCheck({
            path: "/health", // Update this to the correct health check endpoint
            interval: Duration.seconds(30), // Health check interval
            timeout: Duration.seconds(5), // Timeout for health check
            healthyThresholdCount: 3, // Threshold for marking healthy
            unhealthyThresholdCount: 2 // Threshold for marking unhealthy
        });

        // Setup AutoScaling policy
        const scaling = fargateService.service.autoScaleTaskCount({
            maxCapacity: 2
        });

        scaling.scaleOnCpuUtilization("CpuScaling", {
            targetUtilizationPercent: 60,
            scaleInCooldown: Duration.seconds(60),
            scaleOutCooldown: Duration.seconds(60)
        });

        const hostedZone = route53.HostedZone.fromLookup(this, `HostedZone`, {
            domainName: DOMAIN_NAME // Replace with your domain name
        });

        const certificate = new certmgr.Certificate(
            this,
            `${APP_NAME_TAIGER_SERVICE}-ApiCertificate`,
            {
                domainName: `${props.stageName}.api.${DOMAIN_NAME}`, // Replace with your subdomain
                validation: certmgr.CertificateValidation.fromDns(hostedZone)
            }
        );

        const domainName = new apigateway.DomainName(
            this,
            `${APP_NAME_TAIGER_SERVICE}-CustomDomain`,
            {
                domainName: `${props.stageName}.api.${DOMAIN_NAME}`, // Replace with your custom subdomain
                certificate
            }
        );

        const api = new apigateway.RestApi(
            this,
            `${APP_NAME_TAIGER_SERVICE}-APIG-${props.stageName}`,
            {
                defaultCorsPreflightOptions: {
                    allowOrigins: ["*"], // Restrict as necessary
                    allowHeaders: ["Content-Type", "Authorization", "tenantId"]
                },
                restApiName: `${APP_NAME}-api-${props.stageName}`,
                description: `API for TaiGer Portal - ${props.stageName}`,
                deployOptions: {
                    stageName: props.stageName
                },
                binaryMediaTypes: ["*/*"] // Enable binary support for all media types
            }
        );

        const proxyResource = api.root.addResource("{proxy+}");

        // Create ALB integration
        const albIntegration = new apigateway.HttpIntegration(
            `http://${fargateService.loadBalancer.loadBalancerDnsName}/{proxy}`, // Include `{proxy}` in backend path
            {
                httpMethod: "ANY",
                proxy: true,
                options: {
                    requestParameters: {
                        "integration.request.path.proxy": "method.request.path.proxy" // Map the proxy path
                    }
                    // requestTemplates: {
                    //   'application/json': '{ "statusCode": 200 }',
                    // },
                }
            }
        );

        // // Add Cognito Authorizoer
        // const userPoolAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(
        //     this,
        //     "CognitoAuthorizer",
        //     {
        //         cognitoUserPools: [props.userPool]
        //     }
        // );

        // Add methods with path parameter mapping
        proxyResource.addMethod("ANY", albIntegration, {
            // authorizer: userPoolAuthorizer,
            // authorizationType: apigateway.AuthorizationType.COGNITO,
            requestParameters: {
                "method.request.path.proxy": true // Enable path parameter
            }
        });

        new apigateway.BasePathMapping(this, `${APP_NAME_TAIGER_SERVICE}-BasePathMapping`, {
            domainName: domainName,
            restApi: api,
            stage: api.deploymentStage
        });

        // Step 6: Create Route 53 Record to point to the API Gateway
        new route53.ARecord(
            this,
            `${APP_NAME_TAIGER_SERVICE}-ApiGatewayRecord-${props.stageName}`,
            {
                zone: hostedZone,
                recordName: `${props.stageName}.api.${DOMAIN_NAME}`, // Subdomain name for your custom domain
                target: route53.RecordTarget.fromAlias(
                    new route53Targets.ApiGatewayDomain(domainName)
                )
            }
        );
    }
}
