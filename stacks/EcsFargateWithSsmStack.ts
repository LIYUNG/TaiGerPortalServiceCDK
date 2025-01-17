import {
  aws_elasticloadbalancingv2,
  aws_secretsmanager,
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
import { Construct } from 'constructs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as logs from 'aws-cdk-lib/aws-logs'; // For CloudWatch Log resources

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

    // // Step 0: ECR Repository
    // new ecr.Repository(this, `Ecr-${props.stageName}`, {
    //   repositoryName: `taiger-portal-service`,
    //   removalPolicy: RemovalPolicy.DESTROY, // Optional: To remove the repository when the stack is deleted
    // });

    // Step 1: VPC for ECS
    const vpc = new ec2.Vpc(this, `Vpc`, {
      maxAzs: 2,
      natGateways: 0, // Number of NAT Gateways
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
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

    // Step 2: ECS Cluster
    const cluster = new ecs.Cluster(this, 'EcsCluster', {
      vpc,
    });

    // Step 3: Create Cloud Map Namespace for ECS Service Discovery
    const namespace = new servicediscovery.PrivateDnsNamespace(
      this,
      'TaiGerPortalNamespace',
      {
        name: 'taigerconsultancy.local',
        vpc,
      }
    );

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

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      `TaskDef-${props.stageName}`,
      {
        taskRole: taskRole,
        memoryLimitMiB: 512,
        cpu: 256,
        runtimePlatform: {
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
        },
      }
    );

    const secret = aws_secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'MySecret',
      props.secretArn
    );

    // Grant ECS Task Role permissions to read Secret Manager
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue', // Required to fetch secrets
        ],
        resources: [secret.secretFullArn ?? secret.secretArn], // Allow access to the specific secret
      })
    );

    new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `taiger-portal-service-${props.domainStage}`,
      retention: logs.RetentionDays.SIX_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY, // Adjust based on your preference
    });

    taskDefinition.addToTaskRolePolicy(
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

    // Add permissions for SES
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: ['*'], // SES email sending permissions
      })
    );

    // invoke Transcript analyser api gateway lambda.
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:Invoke'],
        resources: [
          `arn:aws:execute-api:${props.env?.region}:${AWS_ACCOUNT}:fdhqz73v0f/*/*/*`, // Replace with your API Gateway ARN
        ],
      })
    );

    const ecrRepo = ecr.Repository.fromRepositoryName(
      this,
      'ImportedEcrRepo',
      Fn.importValue('EcrRepoUri')
    );

    // Step 5: Add Container to Task Definition
    const container = taskDefinition.addContainer(
      `TaiGerPortalServiceContainer-${props.stageName}`,
      {
        image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'), // Replace with your Node.js app image
        logging: new ecs.AwsLogDriver({
          streamPrefix: `taiger-portal-service-${props.domainStage}`,
        }),
        // TODO: add health check when necessary later
        // healthCheck: {
        //   command: [
        //     'CMD-SHELL',
        //     'curl --silent --fail localhost:8080 || exit 1',
        //   ],
        //   interval: cdk.Duration.seconds(30), // Check every 30 seconds
        //   timeout: cdk.Duration.seconds(5),
        //   retries: 3, // Number of retries before marking the container as unhealthy
        //   startPeriod: cdk.Duration.seconds(10), // Wait for 10 seconds before starting the health check
        // },
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
          SMTP_USERNAME: ecs.Secret.fromSecretsManager(secret, 'SMTP_USERNAME'),
          SMTP_PASSWORD: ecs.Secret.fromSecretsManager(secret, 'SMTP_PASSWORD'),
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
          AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT: ecs.Secret.fromSecretsManager(
            secret,
            'AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT'
          ),
          AWS_S3_BUCKET_NAME: ecs.Secret.fromSecretsManager(
            secret,
            'AWS_S3_BUCKET_NAME'
          ),
          AWS_REGION: ecs.Secret.fromSecretsManager(secret, 'AWS_REGION'),
          AWS_LOG_GROUP: ecs.Secret.fromSecretsManager(secret, 'AWS_LOG_GROUP'),
          OPENAI_API_KEY: ecs.Secret.fromSecretsManager(
            secret,
            'OPENAI_API_KEY'
          ),
        },
      }
    );

    container.addPortMappings({
      containerPort: 3000,
    });

    // Step 6: Fargate Service
    const ecsService = new ecs.FargateService(this, 'FargateService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      serviceName: 'taiGerPortalService',
      securityGroups: [securityGroup],
      cloudMapOptions: {
        cloudMapNamespace: namespace,
        name: 'taiGerPortalService', // The service name used for discovery
      },
      assignPublicIp: false, // Disable public IP as the task is in a private subnet
    });

    const nlb = new aws_elasticloadbalancingv2.NetworkLoadBalancer(
      this,
      'NLB',
      {
        vpc,
      }
    );

    // Step 7: Create a VPC Link for Private Service Access
    const vpcLink = new apigateway.VpcLink(this, 'VpcLink', {
      targets: [nlb], // Connect VPC Link to the ECS service via Cloud Map
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
        restApiName: `TaiGer Portal Service - ${props.domainStage}`,
        description: `API for TaiGer Portal - ${props.domainStage}`,
        deployOptions: {
          stageName: props.domainStage,
        },
      }
    );

    const apiResource = api.root.addResource('api');
    const proxyResource = apiResource.addResource('{proxy+}'); // Wildcard resource `/api/{proxy+}`
    // Check if `cloudMapService` is available before using it
    if (ecsService.cloudMapService) {
      proxyResource.addMethod(
        'ANY',
        new apigateway.Integration({
          type: apigateway.IntegrationType.HTTP,
          uri: `http://${nlb.loadBalancerDnsName}`, // use NLB instead
          integrationHttpMethod: 'ANY',
          options: {
            connectionType: apigateway.ConnectionType.VPC_LINK,
            vpcLink: vpcLink,
          },
        })
      );
    } else {
      throw new Error(
        'ECS service does not have a CloudMap service associated with it.'
      );
    }

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
