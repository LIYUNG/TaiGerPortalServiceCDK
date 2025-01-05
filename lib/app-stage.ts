import { EcsFargateWithSsmStack } from '../stacks/EcsFargateWithSsmStack';
import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import { AuthStack } from "./authstack";

interface DeploymentkProps extends StageProps {
  stageName: string;
  domainStage: string;
  isProd: boolean;
  mongodbUriSecretName: string;
  mongoDBName: string;
  externalS3BucketName: string;
  internalMongodbS3BucketName: string;
  origin: string;
}

export class PipelineAppStage extends Stage {
  constructor(scope: Construct, id: string, props: DeploymentkProps) {
    super(scope, id, props);

    const ecsFargateWithSsmStack = new EcsFargateWithSsmStack(
      this,
      `InfraStack-${props.stageName}`,
      {
        env: props.env,
        stageName: props.stageName,
        domainStage: props.domainStage,
        isProd: props.isProd,
        mongodbUriSecretName: props.mongodbUriSecretName,
        mongoDBName: props.mongoDBName,
        externalS3BucketName: props.externalS3BucketName,
      }
    );
  }
}
