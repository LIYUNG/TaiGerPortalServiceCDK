import {
  aws_secretsmanager,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
// import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
// import { SecretConstruct } from '../constructs';

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

    // Step 0: ECR Repository
    new ecr.Repository(this, `Ecr-${props.stageName}`, {
      repositoryName: `taiger-portal-service`,
      removalPolicy: RemovalPolicy.DESTROY, // Optional: To remove the repository when the stack is deleted
    });

    // Step 1: VPC for ECS
    const vpc = new ec2.Vpc(this, `Vpc-${props.stageName}`, {
      maxAzs: 2,
    });

    // Step 2: ECS Cluster
    new ecs.Cluster(this, `EcsCluster-${props.stageName}`, {
      vpc,
    });
    // const cluster = new ecs.Cluster(this, 'EcsCluster', {
    //   vpc,
    // });

    // Step 4: Task Definition with SSM Access
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      `TaskDef-${props.stageName}`,
      {
        memoryLimitMiB: 512,
        cpu: 256,
      }
    );

    // Grant ECS Task Role permissions to read SSM parameters
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'ssm:GetParameter',
          'ssm:GetParameters',
          'ssm:GetParameterHistory',
        ],
        // resources: [parameter1.parameterArn, parameter2.parameterArn],
        resources: ['*'],
      })
    );

    // const secretParams = new SecretConstruct(
    //   this,
    //   `SecretConstruct-${props.stageName}`,
    //   {
    //     secretArn: props.secretArn,
    //   }
    // );

    const secret = aws_secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'MySecret',
      props.secretArn
    );

    // Step 5: Add Container to Task Definition
    const container = taskDefinition.addContainer(
      `TaiGerPortalServiceContainer-${props.stageName}`,
      {
        image: ecs.ContainerImage.fromRegistry('node:18'), // Replace with your Node.js app image
        logging: new ecs.AwsLogDriver({
          streamPrefix: 'nodejs-app',
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
      containerPort: 3000,
    });

    // Step 6: Fargate Service
    // new ecs_patterns.ApplicationLoadBalancedFargateService(
    //   this,
    //   'FargateService',
    //   {
    //     cluster,
    //     taskDefinition,
    //     publicLoadBalancer: true,
    //   }
    // );
  }
}
