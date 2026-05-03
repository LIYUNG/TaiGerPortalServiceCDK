// import { EcsFargateStack } from "../stacks/EcsFargateStack";
import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { EcsEc2Stack } from "../stacks/ecs-ec2-stack";
import { MonitorStack } from "../stacks/monitor-stack";
import { DbStack } from "../stacks/db-stack";
import { VpcStack } from "../stacks/vpc-stack";
import { APPLICATION_NAME } from "../configuration";
import { InstanceType } from "aws-cdk-lib/aws-ec2";
// import { CognitoStack } from "../stacks/cognito-stack";
// import { AuthStack } from "./authstack";

interface DeploymentProps extends StageProps {
    stageName: string;
    isProd: boolean;
    secretArn: string;
    s3BucketArns: string[];
    instanceType: InstanceType;
    ecsEc2Capacity: {
        min: number;
        max: number;
    };
    ecsTaskCapacity: {
        min: number;
        max: number;
    };
    slackWorkspaceId?: string;
    slackChannelId?: string;
}

export class PipelineAppStage extends Stage {
    readonly vpcStack: VpcStack;
    readonly ecsEc2Stack: EcsEc2Stack;
    readonly dbStack: DbStack;
    readonly monitorStack: MonitorStack;
    constructor(scope: Construct, id: string, props: DeploymentProps) {
        super(scope, id, props);

        // Create VPC Stack first
        this.vpcStack = new VpcStack(this, `VpcStack-${props.stageName}`, {
            ...props,
            terminationProtection: props.isProd
        });

        // Create Database Stack with shared VPC
        this.dbStack = new DbStack(this, `DbStack-${props.stageName}`, {
            ...props,
            vpc: this.vpcStack.vpc,
            terminationProtection: props.isProd
        });

        // Create ECS EC2 Stack with shared VPC
        this.ecsEc2Stack = new EcsEc2Stack(this, `EcsEc2Stack-${props.stageName}`, {
            ...props,
            vpc: this.vpcStack.vpc,
            terminationProtection: props.isProd
        });

        // Create Monitoring Stack
        this.monitorStack = new MonitorStack(
            this,
            `${APPLICATION_NAME}MonitorStack-${props.stageName}`,
            {
                ...props,
                api: this.ecsEc2Stack.api,
                slackWorkspaceId: props.slackWorkspaceId,
                slackChannelId: props.slackChannelId,
                terminationProtection: props.isProd
            }
        );

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
