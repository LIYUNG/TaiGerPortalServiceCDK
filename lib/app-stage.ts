import { EcsFargateStack } from "../stacks/EcsFargateStack";
import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
// import { AuthStack } from "./authstack";

interface DeploymentProps extends StageProps {
    stageName: string;
    domainStage: string;
    isProd: boolean;
    secretArn: string;
}

export class PipelineAppStage extends Stage {
    constructor(scope: Construct, id: string, props: DeploymentProps) {
        super(scope, id, props);

        new EcsFargateStack(this, `EcsFargateStack-${props.stageName}`, {
            env: props.env,
            stageName: props.stageName,
            domainStage: props.domainStage,
            isProd: props.isProd,
            secretArn: props.secretArn
        });
    }
}
