import {
  aws_elasticloadbalancingv2,
  aws_secretsmanager,
  Duration,
  Fn,
  RemovalPolicy,
  SecretValue,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as certmgr from 'aws-cdk-lib/aws-certificatemanager';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';

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

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      `TaskDef-${props.stageName}`,
      {
        memoryLimitMiB: 512,
        cpu: 256,
      }
    );

    const secret = aws_secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'MySecret',
      props.secretArn
    );
    console.log(secret.secretFullArn);
    // Grant ECS Task Role permissions to read Secret Manager
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue', // Required to fetch secrets
        ],
        resources: [secret.secretFullArn ?? secret.secretArn], // Allow access to the specific secret
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
          streamPrefix: 'taiger-portal-service',
        }),
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
          OPENAI_API_KEY: ecs.Secret.fromSecretsManager(
            secret,
            'OPENAI_API_KEY'
          ),
        },
      }
    );

    container.addPortMappings({
      containerPort: 80,
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
    // Check if `cloudMapService` is available before using it
    if (ecsService.cloudMapService) {
      apiResource.addMethod(
        'ANY',
        new apigateway.Integration({
          type: apigateway.IntegrationType.HTTP,
          uri: `http://${nlb.loadBalancerDnsName}`, // use NLB instead
          integrationHttpMethod: 'GET',
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
