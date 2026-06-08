import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import { TimeZone } from "aws-cdk-lib/core";
import { APPLICATION_NAME, DOMAIN_NAME, ECR_REPO_NAME } from "../configuration";
import {
    AlarmBehavior,
    AlternateTarget,
    ContainerImage,
    ContainerInsights,
    DeploymentControllerType,
    DeploymentStrategy,
    Ec2Service,
    ListenerRuleConfiguration,
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
    ApplicationListenerRule,
    ApplicationLoadBalancer,
    ApplicationProtocol,
    ApplicationTargetGroup,
    ListenerCondition,
    SslPolicy,
    TargetType
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

        // Blue/green test listener (9443): used to validate the GREEN task set
        // before cutover. Kept OFF the public internet — restricted to in-VPC
        // callers only. Replace with an admin/office CIDR if validation needs
        // to originate from outside the VPC.
        albSecurityGroup.addIngressRule(
            cdk.aws_ec2.Peer.ipv4(vpc.vpcCidrBlock),
            cdk.aws_ec2.Port.tcp(9443),
            "Allow blue/green test traffic (restricted to VPC)"
        );

        const ecsEc2SecurityGroup = new cdk.aws_ec2.SecurityGroup(this, `${APPLICATION_NAME}-SG`, {
            vpc,
            description: `${APPLICATION_NAME} ECS EC2 Security Group`,
            allowAllOutbound: true
        });

        // Bridge mode + dynamic host ports: the ALB forwards to the INSTANCE on
        // an ephemeral host port (32768-65535), not container port 3000, so the
        // instance SG must allow the whole dynamic range from the ALB. Both the
        // prod (443) and test (9443) listeners live on the same ALB SG, so this
        // one rule covers blue and green traffic.
        ecsEc2SecurityGroup.addIngressRule(
            albSecurityGroup,
            cdk.aws_ec2.Port.tcpRange(32768, 65535),
            "Allow ALB to ECS dynamic host ports (bridge mode)"
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
            `${APPLICATION_NAME}AutoScalingGroup${props.stageName}`,
            {
                vpc,
                vpcSubnets: {
                    subnetType: cdk.aws_ec2.SubnetType.PUBLIC
                },
                autoScalingGroupName: `${APPLICATION_NAME}AutoScalingGroup${props.stageName}`,
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
            `${APPLICATION_NAME}CapacityProvider${props.stageName}`,
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
                // Bridge networking (the Ec2TaskDefinition default). Tasks share
                // the instance's network namespace, so DB egress uses the
                // instance's public IP (no NAT needed). Blue/green canary works
                // via dynamic host ports + instance target groups (blue & green
                // co-locate on a host on different ephemeral ports).
            }
        );
        const ORIGIN = props.isProd
            ? `https://${DOMAIN_NAME}`
            : `https://${props.stageName}.${DOMAIN_NAME}`;

        taskDefinition.addContainer("EcsEc2Container", {
            image: ContainerImage.fromEcrRepository(ecrRepoEcs, imageDigest),
            // Bridge mode: omit hostPort (=> 0) so Docker assigns a dynamic
            // ephemeral host port (32768-65535). This lets blue & green task
            // sets co-locate on the same instance during a canary deployment.
            portMappings: [{ containerPort: 3000 }],
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

        // NOTE: the ECS service is created further below, AFTER the ALB,
        // blue/green target groups, listeners and the rollback alarm exist —
        // ECS native blue/green canary needs the alternate target group, the
        // production/test listener rules and the deploymentAlarm at service
        // creation time. Task-count autoscaling is wired there too.

        asg.scaleOnCpuUtilization(`${APPLICATION_NAME}-EcsEc2AutoScalingGroup-${props.stageName}`, {
            targetUtilizationPercent: 60
        });

        asg.scaleOnSchedule(`ScaleDownOvernight-${props.stageName}`, {
            schedule: cdk.aws_autoscaling.Schedule.cron({
                minute: "0",
                hour: "21"
            }),
            minCapacity: 1,
            maxCapacity: 2,
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

        // API domain cert — attached to both listeners as an SNI certificate.
        const apiDomain = `api.ecs.${props.stageName}.${DOMAIN_NAME}`;
        const apiDomainCertificate = new Certificate(
            this,
            `${APPLICATION_NAME}-EcsEc2ApiCertificate-${props.stageName}`,
            {
                domainName: apiDomain,
                validation: CertificateValidation.fromDns(hostedZone)
            }
        );

        // --- Blue/green target groups (bridge + dynamic ports => INSTANCE targets) ---
        const tgHealthCheck = {
            path: "/health",
            interval: cdk.Duration.seconds(60),
            timeout: cdk.Duration.seconds(5),
            healthyThresholdCount: 3,
            unhealthyThresholdCount: 2
        };

        const blueTargetGroup = new ApplicationTargetGroup(
            this,
            `${APPLICATION_NAME}-BlueTG-${props.stageName}`,
            {
                vpc,
                // Short, app-prefixed names: ALB target group names are capped
                // at 32 chars, and "${APPLICATION_NAME}-tg-green-<stage>" overflows.
                targetGroupName: `tgps-tg-blue-${props.stageName}`,
                port: 3000,
                protocol: ApplicationProtocol.HTTP,
                targetType: TargetType.INSTANCE,
                deregistrationDelay: Duration.seconds(60),
                healthCheck: tgHealthCheck
            }
        );

        const greenTargetGroup = new ApplicationTargetGroup(
            this,
            `${APPLICATION_NAME}-GreenTG-${props.stageName}`,
            {
                vpc,
                targetGroupName: `tgps-tg-green-${props.stageName}`,
                port: 3000,
                protocol: ApplicationProtocol.HTTP,
                targetType: TargetType.INSTANCE,
                deregistrationDelay: Duration.seconds(60),
                healthCheck: tgHealthCheck
            }
        );

        // --- Production listener (443): serves blue; ECS shifts traffic to
        // green during a deployment via the production listener rule. ---
        const listener = alb.addListener("PublicListener", {
            protocol: ApplicationProtocol.HTTPS,
            sslPolicy: SslPolicy.RECOMMENDED_TLS,
            open: true,
            certificates: [albCertificate, apiDomainCertificate],
            defaultTargetGroups: [blueTargetGroup]
        });

        const prodListenerRule = new ApplicationListenerRule(
            this,
            `${APPLICATION_NAME}-ProdListenerRule-${props.stageName}`,
            {
                listener,
                priority: 1,
                targetGroups: [blueTargetGroup],
                conditions: [ListenerCondition.pathPatterns(["/*"])]
            }
        );

        // --- Test listener (9443): routes to green for pre-cutover validation.
        // open:false — ingress is restricted to the VPC on albSecurityGroup. ---
        const testListener = alb.addListener("TestListener", {
            port: 9443,
            protocol: ApplicationProtocol.HTTPS,
            sslPolicy: SslPolicy.RECOMMENDED_TLS,
            open: false,
            certificates: [albCertificate, apiDomainCertificate],
            defaultTargetGroups: [greenTargetGroup]
        });

        const testListenerRule = new ApplicationListenerRule(
            this,
            `${APPLICATION_NAME}-TestListenerRule-${props.stageName}`,
            {
                listener: testListener,
                priority: 1,
                targetGroups: [greenTargetGroup],
                conditions: [ListenerCondition.pathPatterns(["/*"])]
            }
        );

        // --- Rollback alarm: target 5XX on the GREEN task set during a canary.
        // Must exist before the service so deploymentAlarms can reference it. ---
        const greenHighErrorRateAlarm = new cdk.aws_cloudwatch.Alarm(
            this,
            `${APPLICATION_NAME}-GreenHigh5XXAlarm-${props.stageName}`,
            {
                alarmName: `${APPLICATION_NAME}-ecs-green-5xx-${props.stageName}`,
                alarmDescription:
                    "High target 5XX on the green task set during a canary deployment",
                metric: new cdk.aws_cloudwatch.Metric({
                    namespace: "AWS/ApplicationELB",
                    metricName: "HTTPCode_Target_5XX_Count",
                    dimensionsMap: {
                        LoadBalancer: alb.loadBalancerFullName,
                        TargetGroup: greenTargetGroup.targetGroupFullName
                    },
                    statistic: "Sum",
                    period: cdk.Duration.minutes(1)
                }),
                threshold: 3,
                evaluationPeriods: 3,
                comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING
            }
        );

        // --- ECS service: native blue/green CANARY deployment ---
        const service = new Ec2Service(this, `${APPLICATION_NAME}-Service-${props.stageName}`, {
            cluster,
            taskDefinition,
            serviceName: `${APPLICATION_NAME}-ecs-ec2-${props.stageName}`,
            capacityProviderStrategies: [
                {
                    capacityProvider: capacityProvider.capacityProviderName,
                    weight: 1
                }
            ],
            // Keep blue at full capacity while green spins up alongside it.
            minHealthyPercent: 100,
            maxHealthyPercent: 200,
            placementStrategies: [PlacementStrategy.spreadAcrossInstances()],
            deploymentController: {
                type: DeploymentControllerType.ECS
            },
            deploymentStrategy: DeploymentStrategy.CANARY,
            canaryConfiguration: {
                stepPercent: 20,
                stepBakeTime: Duration.minutes(10)
            },
            bakeTime: Duration.minutes(2),
            deploymentAlarms: {
                alarmNames: [greenHighErrorRateAlarm.alarmName],
                behavior: AlarmBehavior.ROLLBACK_ON_ALARM
            }
        });

        // Wire the service to blue (production) and green (alternate) target
        // groups via the production + test listener rules.
        const lbTarget = service.loadBalancerTarget({
            containerName: "EcsEc2Container",
            containerPort: 3000,
            alternateTarget: new AlternateTarget(
                `${APPLICATION_NAME}-AltTarget-${props.stageName}`,
                {
                    alternateTargetGroup: greenTargetGroup,
                    productionListener:
                        ListenerRuleConfiguration.applicationListenerRule(prodListenerRule),
                    testListener:
                        ListenerRuleConfiguration.applicationListenerRule(testListenerRule)
                }
            )
        });
        lbTarget.attachToApplicationTargetGroup(blueTargetGroup);

        // --- Task-count autoscaling (depends on the service) ---
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
