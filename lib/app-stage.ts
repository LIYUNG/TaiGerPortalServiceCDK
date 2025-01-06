import { EcsFargateWithSsmStack } from '../stacks/EcsFargateWithSsmStack';
import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import { AuthStack } from "./authstack";

interface DeploymentkProps extends StageProps {
  stageName: string;
  domainStage: string;
  isProd: boolean;
  secretArn: string;
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
        secretArn: props.secretArn,
      }
    );
  }
}
