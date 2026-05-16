import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import { TimeZone } from "aws-cdk-lib/core";
import { APPLICATION_NAME, DOMAIN_NAME, ECR_REPO_NAME } from "../configuration";
import {
    ContainerImage,
    ContainerInsights,
    DeploymentControllerType,
    Ec2Service,
    LogDriver,
    PlacementStrategy,
    Secret
} from "aws-cdk-lib/aws-ecs";
import { aws_secretsmanager, Duration, Stack, StackProps } from "aws-cdk-lib";
import { EcsEc2Role } from "../constructs";
import { Repository } from "aws-cdk-lib/aws-ecr";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { ManagedPolicy, Role } from "aws-cdk-lib/aws-iam";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import {
    ApplicationLoadBalancer,
    ApplicationProtocol,
    SslPolicy
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
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
    readonly loadBalancer: ApplicationLoadBalancer;
    constructor(scope: Construct, id: string, props: EcsEc2StackProps) {
        super(scope, id, props);

        // CloudFront is now managed by frontend stack, not here

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
                maxAzs: 3,
                subnetConfiguration: [{ name: "Public", subnetType: cdk.aws_ec2.SubnetType.PUBLIC }]
            }
        );

        // // Add VPC endpoints for Systems Manager (EC2.57 compliance)
        // vpc.addInterfaceEndpoint(`${APPLICATION_NAME}-SSMEndpoint-${props.stageName}`, {
        //     service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.SSM,
        //     subnets: {
        //         subnetType: cdk.aws_ec2.SubnetType.PUBLIC
        //     }
        // });

        // vpc.addInterfaceEndpoint(`${APPLICATION_NAME}-SSMMessagesEndpoint-${props.stageName}`, {
        //     service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
        //     subnets: {
        //         subnetType: cdk.aws_ec2.SubnetType.PUBLIC
        //     }
        // });

        // vpc.addInterfaceEndpoint(`${APPLICATION_NAME}-EC2MessagesEndpoint-${props.stageName}`, {
        //     service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
        //     subnets: {
        //         subnetType: cdk.aws_ec2.SubnetType.PUBLIC
        //     }
        // });

        // // Add VPC endpoints for Docker Registry/ECR (EC2.55 and EC2.56 compliance)
        // vpc.addInterfaceEndpoint(`${APPLICATION_NAME}-ECRDockerEndpoint-${props.stageName}`, {
        //     service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
        //     subnets: {
        //         subnetType: cdk.aws_ec2.SubnetType.PUBLIC
        //     }
        // });

        // // ECR API endpoint (EC2.55 compliance)
        // vpc.addInterfaceEndpoint(`${APPLICATION_NAME}-ECRAPIEndpoint-${props.stageName}`, {
        //     service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.ECR,
        //     subnets: {
        //         subnetType: cdk.aws_ec2.SubnetType.PUBLIC
        //     }
        // });

        const albSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, `${APPLICATION_NAME}-ALB-SG`, {
            vpc,
            description: `${APPLICATION_NAME} ALB Security Group`
        });

        // Allow HTTPS from internet (frontend CloudFront will call this ALB)
        albSecurityGroup.addIngressRule(
            cdk.aws_ec2.Peer.anyIpv4(),
            cdk.aws_ec2.Port.tcp(443),
            "Allow HTTPS from internet"
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
                    ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly"),
                    // Required for AWS Systems Manager to manage EC2 instances (SSM.1 compliance)
                    ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
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
                vpc,
                containerInsightsV2: ContainerInsights.ENABLED
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
        const ORIGIN = props.isProd
            ? `https://${DOMAIN_NAME}`
            : `https://${props.stageName}.${DOMAIN_NAME}`;

        taskDefinition.addContainer("EcsEc2Container", {
            image: ContainerImage.fromEcrRepository(ecrRepoEcs, imageDigest),
            portMappings: [{ containerPort: 3000, hostPort: 3000 }],
            memoryReservationMiB: 256,
            readonlyRootFilesystem: true,
            logging: LogDriver.awsLogs({
                streamPrefix: `${APPLICATION_NAME}-ecs-ec2-${props.stageName}`,
                logGroup: logGroup
            }),
            environment: {
                ORIGIN: ORIGIN
            },
            secrets: {
                // Add SSM parameters as environment variables
                TENANT_ID: Secret.fromSecretsManager(secret, "TENANT_ID"),
                JWT_SECRET: Secret.fromSecretsManager(secret, "JWT_SECRET"),
                JWT_EXPIRE: Secret.fromSecretsManager(secret, "JWT_EXPIRE"),
                MONGODB_URI: Secret.fromSecretsManager(secret, "MONGODB_URI"),
                PORT: Secret.fromSecretsManager(secret, "PORT"),
                ESCALATION_DEADLINE_DAYS_TRIGGER: Secret.fromSecretsManager(
                    secret,
                    "ESCALATION_DEADLINE_DAYS_TRIGGER"
                ),
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
                AWS_TRANSCRIPT_ANALYSER_ROLE: Secret.fromSecretsManager(
                    secret,
                    "AWS_TRANSCRIPT_ANALYSER_ROLE"
                ),
                AWS_TRANSCRIPT_ANALYSER_APIG_URL: Secret.fromSecretsManager(
                    secret,
                    "AWS_TRANSCRIPT_ANALYSER_APIG_URL"
                ),
                OPENAI_API_KEY: Secret.fromSecretsManager(secret, "OPENAI_API_KEY"),
                POSTGRES_URI: Secret.fromSecretsManager(secret, "POSTGRES_URI"),
                GOOGLE_CLIENT_ID: Secret.fromSecretsManager(secret, "GOOGLE_CLIENT_ID"),
                GOOGLE_CLIENT_SECRET: Secret.fromSecretsManager(secret, "GOOGLE_CLIENT_SECRET"),
                GOOGLE_REDIRECT_URL: Secret.fromSecretsManager(secret, "GOOGLE_REDIRECT_URL"),
                FIREFLIES_API_URL: Secret.fromSecretsManager(secret, "FIREFLIES_API_URL"),
                FIREFLIES_API_TOKEN: Secret.fromSecretsManager(secret, "FIREFLIES_API_TOKEN"),
                FIREFLIES_GOOGLE_INVITE_N8N_URL: Secret.fromSecretsManager(
                    secret,
                    "FIREFLIES_GOOGLE_INVITE_N8N_URL"
                ),
                SLACK_BOT_TOKEN: Secret.fromSecretsManager(secret, "SLACK_BOT_TOKEN"),
                SLACK_TAIGER_WIN_CHANNEL_ID: Secret.fromSecretsManager(
                    secret,
                    "SLACK_TAIGER_WIN_CHANNEL_ID"
                )
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

        scaling.scaleOnSchedule(`ScaleDownOvernight-${props.stageName}`, {
            schedule: cdk.aws_applicationautoscaling.Schedule.cron({
                minute: "0",
                hour: "23"
            }),
            minCapacity: 1,
            maxCapacity: 1,
            timeZone: TimeZone.ETC_UTC
        });

        scaling.scaleOnSchedule(`RestoreMorningCapacity-${props.stageName}`, {
            schedule: cdk.aws_applicationautoscaling.Schedule.cron({
                minute: "0",
                hour: "6"
            }),
            minCapacity: props.ecsTaskCapacity.min,
            maxCapacity: props.ecsTaskCapacity.max,
            timeZone: TimeZone.ETC_UTC
        });

        asg.scaleOnCpuUtilization(`${APPLICATION_NAME}-EcsEc2AutoScalingGroup-${props.stageName}`, {
            targetUtilizationPercent: 60
        });

        asg.scaleOnSchedule(`ScaleDownOvernight-${props.stageName}`, {
            schedule: cdk.aws_autoscaling.Schedule.cron({
                minute: "0",
                hour: "21"
            }),
            minCapacity: 1,
            maxCapacity: 1,
            desiredCapacity: 1,
            timeZone: "UTC"
        });

        asg.scaleOnSchedule(`RestoreMorningCapacity-${props.stageName}`, {
            schedule: cdk.aws_autoscaling.Schedule.cron({
                minute: "0",
                hour: "4"
            }),
            minCapacity: props.ecsEc2Capacity.min,
            maxCapacity: props.ecsEc2Capacity.max,
            desiredCapacity: props.ecsEc2Capacity.min,
            timeZone: "UTC"
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

        const albLogsBucket = new cdk.aws_s3.Bucket(
            this,
            `${APPLICATION_NAME}-AlbLogsBucket-${props.stageName}`,
            {
                bucketName: `${APPLICATION_NAME}-alb-logs-${props.stageName}`.toLowerCase(),
                blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
                enforceSSL: true,
                encryption: cdk.aws_s3.BucketEncryption.KMS_MANAGED,
                lifecycleRules: [
                    {
                        expiration: cdk.Duration.days(90)
                    }
                ]
            }
        );
        // Create ALB
        const alb = new cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer(
            this,
            `${APPLICATION_NAME}-alb-${props.stageName}`,
            {
                vpc,
                internetFacing: true,
                dropInvalidHeaderFields: true,
                loadBalancerName: `${APPLICATION_NAME}-alb-${props.stageName}`,
                securityGroup: albSecurityGroup,
                deletionProtection: true // ELB.6 compliance - enable deletion protection for production
            }
        );
        this.loadBalancer = alb;

        // Step 6: Create Route 53 Record to point to the ALB
        new ARecord(this, `${APPLICATION_NAME}-EcsEc2ALBRecord-${props.stageName}`, {
            zone: hostedZone,
            recordName: albDomain, // Subdomain name for your custom domain
            target: RecordTarget.fromAlias(new LoadBalancerTarget(alb))
        });

        // Enable access logging for the ALB
        alb.logAccessLogs(albLogsBucket);

        const listener = alb.addListener("PublicListener", {
            protocol: ApplicationProtocol.HTTPS,
            sslPolicy: SslPolicy.RECOMMENDED_TLS,
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

        const apiDomain = `api.ecs.${props.stageName}.${DOMAIN_NAME}`;

        const apiDomainCertificate = new Certificate(
            this,
            `${APPLICATION_NAME}-EcsEc2ApiCertificate-${props.stageName}`,
            {
                domainName: apiDomain,
                validation: CertificateValidation.fromDns(hostedZone)
            }
        );

        listener.addCertificates(`${APPLICATION_NAME}-ApiDomainCertificate-${props.stageName}`, [
            apiDomainCertificate
        ]);

        // Create Route53 A record for API domain pointing directly to ALB
        new ARecord(this, `${APPLICATION_NAME}-EcsEc2ApiRecord-${props.stageName}`, {
            zone: hostedZone,
            recordName: apiDomain,
            target: RecordTarget.fromAlias(new LoadBalancerTarget(alb))
        });

        // Cost center tag
        cdk.Tags.of(service).add("Project", "Meritonai");
        cdk.Tags.of(service).add("Environment", props.stageName);
        cdk.Tags.of(alb).add("CostCenter", "EcsService");
    }
}
