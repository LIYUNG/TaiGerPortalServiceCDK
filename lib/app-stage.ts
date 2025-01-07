import { EcsFargateWithSsmStack } from '../stacks/EcsFargateWithSsmStack';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ApiGatewayCustomDomainStack } from '../stacks/ApiGatewayCustomDomainStack';
import { Repository } from 'aws-cdk-lib/aws-ecr';
// import { AuthStack } from "./authstack";

interface DeploymentProps extends StageProps {
  stageName: string;
  domainStage: string;
  isProd: boolean;
  secretArn: string;
  ecrRepo: Repository;
}

export class PipelineAppStage extends Stage {
  constructor(scope: Construct, id: string, props: DeploymentProps) {
    super(scope, id, props);

    new EcsFargateWithSsmStack(
      this,
      `EcsFargateWithSsmStack-${props.stageName}`,
      {
        env: props.env,
        stageName: props.stageName,
        domainStage: props.domainStage,
        isProd: props.isProd,
        secretArn: props.secretArn,
        ecrRepo: props.ecrRepo,
      }
    );

    new ApiGatewayCustomDomainStack(
      this,
      `ApiGatewayCustomDomainStack-${props.stageName}`,
      {
        env: props.env,
        stageName: props.stageName,
        domainStage: props.domainStage,
        isProd: props.isProd,
      }
    );
  }
}
