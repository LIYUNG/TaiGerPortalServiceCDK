import { EcsFargateStack } from "../stacks/EcsFargateStack";
import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
// import { CognitoStack } from "../stacks/cognito-stack";
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

        // const cognito = new CognitoStack(this, `CognitoStack-${props.stageName}`, {
        //     env: props.env,
        //     stageName: props.stageName
        // });

        new EcsFargateStack(this, `EcsFargateStack-${props.stageName}`, {
            env: props.env,
            stageName: props.stageName,
            domainStage: props.domainStage,
            isProd: props.isProd,
            secretArn: props.secretArn
            // userPool: cognito.taigerUserPool,
            // userPoolClient: cognito.taigerUserPoolClient,
            // identityPool: cognito.identityPool
        });
    }
}
