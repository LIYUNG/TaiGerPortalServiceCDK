// import { EcsFargateStack } from "../stacks/EcsFargateStack";
import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { EcsEc2Stack } from "../stacks/ecs-ec2-stack";
// import { CognitoStack } from "../stacks/cognito-stack";
// import { AuthStack } from "./authstack";

interface DeploymentProps extends StageProps {
    stageName: string;
    isProd: boolean;
    secretArn: string;
    s3BucketArns: string[];
    ecsEc2Capacity: {
        min: number;
        max: number;
    };
    ecsTaskCapacity: {
        min: number;
        max: number;
    };
}

export class PipelineAppStage extends Stage {
    readonly ecsEc2Stack: EcsEc2Stack;
    constructor(scope: Construct, id: string, props: DeploymentProps) {
        super(scope, id, props);

        // const cognito = new CognitoStack(this, `CognitoStack-${props.stageName}`, {
        //     env: props.env,
        //     stageName: props.stageName
        // });
        this.ecsEc2Stack = new EcsEc2Stack(this, `EcsEc2Stack-${props.stageName}`, {
            ...props
        });

        // new EcsFargateStack(this, `EcsFargateStack-${props.stageName}`, {
        //     env: props.env,
        //     stageName: props.stageName,
        //     stageName: props.stageName,
        //     isProd: props.isProd,
        //     secretArn: props.secretArn
        //     // userPool: cognito.taigerUserPool,
        //     // userPoolClient: cognito.taigerUserPoolClient,
        //     // identityPool: cognito.identityPool
        // });
    }
}
