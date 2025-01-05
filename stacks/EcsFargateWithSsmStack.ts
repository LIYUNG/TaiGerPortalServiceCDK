import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
// import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { SsmConstruct } from '../constructs';

interface EcsFargateWithSsmStackProps extends StackProps {
  stageName: string;
  domainStage: string;
  isProd: boolean;
  mongodbUriSecretName: string;
  mongoDBName: string;
  externalS3BucketName: string;
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

    const ssmParams = new SsmConstruct(
      this,
      `SsmConstruct-${props.stageName}`,
      {}
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
          API_ORIGIN: ssmParams.API_ORIGIN,
          JWT_SECRET: ssmParams.JWT_SECRET,
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
