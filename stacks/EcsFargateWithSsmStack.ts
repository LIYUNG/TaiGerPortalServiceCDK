import {
  aws_ecs_patterns,
  aws_secretsmanager,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as certmgr from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as logs from 'aws-cdk-lib/aws-logs'; // For CloudWatch Log resources
import { Construct } from 'constructs';

import { AWS_ACCOUNT } from '../configuration';

interface EcsFargateWithSsmStackProps extends StackProps {
  stageName: string;
  domainStage: string;
  isProd: boolean;
  secretArn: string;
}

export class EcsFargateWithSsmStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: EcsFargateWithSsmStackProps
  ) {
    super(scope, id, props);

    // Step 1: VPC for ECS
    const vpc = new ec2.Vpc(this, `Vpc`, {
      maxAzs: 2,
      natGateways: 0, // Number of NAT Gateways
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    const securityGroup = new ec2.SecurityGroup(
      this,
      'EcsFargateSecurityGroup',
      {
        vpc,
        allowAllOutbound: true, // You can specify more specific rules if needed
        securityGroupName: 'EcsFargateSecurityGroup',
      }
    );

    // Allow inbound traffic only from CloudFront's IP ranges
    // TODO regionalize
    // const cloudfrontPrefixList = ec2.Peer.prefixList('pl-3b927c52'); // Managed prefix list for CloudFront
    const anyIp4 = ec2.Peer.anyIpv4();
    securityGroup.addIngressRule(
      anyIp4,
      ec2.Port.tcp(3000), // Adjust this if your ECS service listens on a different port
      'Allow inbound access from CloudFront IP ranges'
    );

    // Step 2: ECS Cluster
    const cluster = new ecs.Cluster(this, 'EcsCluster', {
      vpc,
    });

    const secret = aws_secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'TaiGerSecret',
      props.secretArn
    );

    new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `taiger-portal-service-${props.domainStage}`,
      retention: logs.RetentionDays.SIX_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY, // Adjust based on your preference
    });

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Grant necessary permissions for CloudWatch Logs
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:DescribeLogStreams',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [
          `arn:aws:logs:${props.env?.region}:${AWS_ACCOUNT}:log-group:taiger-portal-service-${props.domainStage}*`,
        ],
      })
    );

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: ['*'], // SES email sending permissions
      })
    );
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:Invoke'],
        resources: [
          `arn:aws:execute-api:${props.env?.region}:${AWS_ACCOUNT}:*/*/*/*`, // Replace with your API Gateway ARN
        ],
      })
    );

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue', // Required to fetch secrets
        ],
        resources: [secret.secretFullArn ?? secret.secretArn], // Allow access to the specific secret
      })
    );

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket',
          's3:DeleteObject',
        ],
        resources: [
          `arn:aws:s3:::taiger-file-storage`,
          `arn:aws:s3:::taiger-file-storage/*`,
          `arn:aws:s3:::taiger-file-storage-public`,
          `arn:aws:s3:::taiger-file-storage-public/*`,
        ],
      })
    );

    const ecrRepo = ecr.Repository.fromRepositoryName(
      this,
      'ImportedEcrRepo',
      Fn.importValue('EcrRepoUri')
    );

    // Step 6: Fargate Service
    // Instantiate a Fargate service in the public subnet
    const fargateService =
      new aws_ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        'FargateService',
        {
          cluster,
          taskImageOptions: {
            image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'), // Replace with your Node.js app image
            containerPort: 3000,
            secrets: {
              // Add SSM parameters as environment variables
              API_ORIGIN: ecs.Secret.fromSecretsManager(secret, 'API_ORIGIN'),
              JWT_SECRET: ecs.Secret.fromSecretsManager(secret, 'JWT_SECRET'),
              HTTPS_PORT: ecs.Secret.fromSecretsManager(secret, 'HTTPS_PORT'),
              JWT_EXPIRE: ecs.Secret.fromSecretsManager(secret, 'JWT_EXPIRE'),
              MONGODB_URI: ecs.Secret.fromSecretsManager(secret, 'MONGODB_URI'),
              PORT: ecs.Secret.fromSecretsManager(secret, 'PORT'),
              PROGRAMS_CACHE: ecs.Secret.fromSecretsManager(
                secret,
                'PROGRAMS_CACHE'
              ),
              ESCALATION_DEADLINE_DAYS_TRIGGER: ecs.Secret.fromSecretsManager(
                secret,
                'ESCALATION_DEADLINE_DAYS_TRIGGER'
              ),
              SMTP_HOST: ecs.Secret.fromSecretsManager(secret, 'SMTP_HOST'),
              SMTP_PORT: ecs.Secret.fromSecretsManager(secret, 'SMTP_PORT'),
              SMTP_USERNAME: ecs.Secret.fromSecretsManager(
                secret,
                'SMTP_USERNAME'
              ),
              SMTP_PASSWORD: ecs.Secret.fromSecretsManager(
                secret,
                'SMTP_PASSWORD'
              ),
              ORIGIN: ecs.Secret.fromSecretsManager(secret, 'ORIGIN'),
              CLEAN_UP_SCHEDULE: ecs.Secret.fromSecretsManager(
                secret,
                'CLEAN_UP_SCHEDULE'
              ),
              WEEKLY_TASKS_REMINDER_SCHEDULE: ecs.Secret.fromSecretsManager(
                secret,
                'WEEKLY_TASKS_REMINDER_SCHEDULE'
              ),
              DAILY_TASKS_REMINDER_SCHEDULE: ecs.Secret.fromSecretsManager(
                secret,
                'DAILY_TASKS_REMINDER_SCHEDULE'
              ),
              COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE:
                ecs.Secret.fromSecretsManager(
                  secret,
                  'COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE'
                ),
              COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE:
                ecs.Secret.fromSecretsManager(
                  secret,
                  'COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE'
                ),
              COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE:
                ecs.Secret.fromSecretsManager(
                  secret,
                  'COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE'
                ),
              COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE:
                ecs.Secret.fromSecretsManager(
                  secret,
                  'COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE'
                ),
              UPLOAD_PATH: ecs.Secret.fromSecretsManager(secret, 'UPLOAD_PATH'),
              AWS_S3_PUBLIC_BUCKET: ecs.Secret.fromSecretsManager(
                secret,
                'AWS_S3_PUBLIC_BUCKET'
              ),
              AWS_S3_PUBLIC_BUCKET_NAME: ecs.Secret.fromSecretsManager(
                secret,
                'AWS_S3_PUBLIC_BUCKET_NAME'
              ),
              AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT:
                ecs.Secret.fromSecretsManager(
                  secret,
                  'AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT'
                ),
              AWS_S3_BUCKET_NAME: ecs.Secret.fromSecretsManager(
                secret,
                'AWS_S3_BUCKET_NAME'
              ),
              AWS_REGION: ecs.Secret.fromSecretsManager(secret, 'AWS_REGION'),
              AWS_LOG_GROUP: ecs.Secret.fromSecretsManager(
                secret,
                'AWS_LOG_GROUP'
              ),
              OPENAI_API_KEY: ecs.Secret.fromSecretsManager(
                secret,
                'OPENAI_API_KEY'
              ),
            },
            taskRole,
          },
          memoryLimitMiB: 512,
          cpu: 256,
          runtimePlatform: {
            operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
            cpuArchitecture: ecs.CpuArchitecture.ARM64,
          },
          assignPublicIp: true,
          publicLoadBalancer: true, // Ensure the ALB is public
          securityGroups: [securityGroup],
        }
      );

    // Access the target group created for the ALB
    const targetGroup = fargateService.targetGroup;

    // Configure the health check for the target group
    targetGroup.configureHealthCheck({
      path: '/health', // Update this to the correct health check endpoint
      interval: Duration.seconds(30), // Health check interval
      timeout: Duration.seconds(5), // Timeout for health check
      healthyThresholdCount: 3, // Threshold for marking healthy
      unhealthyThresholdCount: 2, // Threshold for marking unhealthy
    });

    // Setup AutoScaling policy
    const scaling = fargateService.service.autoScaleTaskCount({
      maxCapacity: 2,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });

    const hostedZone = route53.HostedZone.fromLookup(this, `HostedZone`, {
      domainName: 'taigerconsultancy-portal.com', // Replace with your domain name
    });

    const certificate = new certmgr.Certificate(this, 'ApiCertificate', {
      domainName: `${props.domainStage}.api.taigerconsultancy-portal.com`, // Replace with your subdomain
      validation: certmgr.CertificateValidation.fromDns(hostedZone),
    });

    const domainName = new apigateway.DomainName(this, 'CustomDomain', {
      domainName: `${props.domainStage}.api.taigerconsultancy-portal.com`, // Replace with your custom subdomain
      certificate,
    });

    const api = new apigateway.RestApi(
      this,
      `TaiGerPortalService-${props.domainStage}`,
      {
        defaultCorsPreflightOptions: {
          allowOrigins: ['*'], // Restrict as necessary
          allowHeaders: ['Content-Type', 'Authorization', 'tenantId'],
        },
        restApiName: `TaiGer Portal Service - ${props.domainStage}`,
        description: `API for TaiGer Portal - ${props.domainStage}`,
        deployOptions: {
          stageName: props.domainStage,
        },
      }
    );

    const apiResource = api.root.addResource('api');
    const proxyResource = apiResource.addResource('{proxy+}'); // Wildcard resource `/api/{proxy+}`
    const authResource = api.root.addResource('auth');
    const authProxyResource = authResource.addResource('{proxy+}'); // Wildcard resource `/api/{proxy+}`
    const imagesResource = api.root.addResource('images');
    const imagesProxyResource = imagesResource.addResource('{proxy+}'); // Wildcard resource `/api/{proxy+}`

    // Create ALB integration
    const albIntegration = new apigateway.HttpIntegration(
      `http://${fargateService.loadBalancer.loadBalancerDnsName}/{proxy}`, // Include `{proxy}` in backend path
      {
        httpMethod: 'ANY',
        proxy: true,
        options: {
          requestParameters: {
            'integration.request.path.proxy': 'method.request.path.proxy', // Map the proxy path
          },
        },
      }
    );

    // Add methods with path parameter mapping
    proxyResource.addMethod('ANY', albIntegration, {
      requestParameters: {
        'method.request.path.proxy': true, // Enable path parameter
      },
    });

    authProxyResource.addMethod('ANY', albIntegration, {
      requestParameters: {
        'method.request.path.proxy': true,
      },
    });

    imagesProxyResource.addMethod('ANY', albIntegration, {
      requestParameters: {
        'method.request.path.proxy': true,
      },
    });

    new apigateway.BasePathMapping(this, 'BasePathMapping', {
      domainName: domainName,
      restApi: api,
    });

    // Step 6: Create Route 53 Record to point to the API Gateway
    new route53.ARecord(this, `ApiGatewayRecord-${props.domainStage}`, {
      zone: hostedZone,
      recordName: `${props.domainStage}.api.taigerconsultancy-portal.com`, // Subdomain name for your custom domain
      target: route53.RecordTarget.fromAlias(
        new route53Targets.ApiGatewayDomain(domainName)
      ),
    });
  }
}
