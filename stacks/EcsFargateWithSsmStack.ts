import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
// import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { SecretConstruct } from '../constructs';

interface EcsFargateWithSsmStackProps extends StackProps {
  stageName: string;
  domainStage: string;
  isProd: boolean;
  secretName: string;
}

export class EcsFargateWithSsmStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: EcsFargateWithSsmStackProps
  ) {
    super(scope, id, props);

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

    const secretParams = new SecretConstruct(
      this,
      `SecretConstruct-${props.stageName}`,
      {
        secretName: props.secretName,
      }
    );

    // Step 5: Add Container to Task Definition
    const container = taskDefinition.addContainer(
      `TaiGerPortalServiceContainer-${props.stageName}`,
      {
        image: ecs.ContainerImage.fromRegistry('node:18'), // Replace with your Node.js app image
        logging: new ecs.AwsLogDriver({
          streamPrefix: 'nodejs-app',
        }),
        environment: {
          // Add SSM parameters as environment variables
          API_ORIGIN: secretParams.API_ORIGIN,
          JWT_SECRET: secretParams.JWT_SECRET,
          HTTPS_PORT: secretParams.HTTPS_PORT,
          JWT_EXPIRE: secretParams.JWT_EXPIRE,
          MONGODB_URI: secretParams.MONGODB_URI,
          PORT: secretParams.PORT,
          PROGRAMS_CACHE: secretParams.PROGRAMS_CACHE,
          ESCALATION_DEADLINE_DAYS_TRIGGER:
            secretParams.ESCALATION_DEADLINE_DAYS_TRIGGER,
          SMTP_HOST: secretParams.SMTP_HOST,
          SMTP_PORT: secretParams.SMTP_PORT,
          SMTP_USERNAME: secretParams.SMTP_USERNAME,
          SMTP_PASSWORD: secretParams.SMTP_PASSWORD,
          ORIGIN: secretParams.ORIGIN,
          CLEAN_UP_SCHEDULE: secretParams.CLEAN_UP_SCHEDULE,
          WEEKLY_TASKS_REMINDER_SCHEDULE:
            secretParams.WEEKLY_TASKS_REMINDER_SCHEDULE,
          DAILY_TASKS_REMINDER_SCHEDULE:
            secretParams.DAILY_TASKS_REMINDER_SCHEDULE,
          COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE:
            secretParams.COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE,
          COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE:
            secretParams.COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE,
          COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE:
            secretParams.COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE,
          COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE:
            secretParams.COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE,
          UPLOAD_PATH: secretParams.UPLOAD_PATH,
          AWS_S3_PUBLIC_BUCKET: secretParams.AWS_S3_PUBLIC_BUCKET,
          AWS_S3_PUBLIC_BUCKET_NAME: secretParams.AWS_S3_PUBLIC_BUCKET_NAME,
          AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT:
            secretParams.AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT,
          AWS_S3_BUCKET_NAME: secretParams.AWS_S3_BUCKET_NAME,
          AWS_REGION: secretParams.AWS_REGION,
          OPENAI_API_KEY: secretParams.OPENAI_API_KEY,
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
