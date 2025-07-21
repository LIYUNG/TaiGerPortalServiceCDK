import { InstanceType } from "aws-cdk-lib/aws-ec2";
import { AWS_ACCOUNT } from "../configuration";
import { Region } from "./regions";
import { aws_ec2 } from "aws-cdk-lib";

export enum Stage {
    Beta = "beta",
    Prod = "prod"
}

export enum DomainStage {
    Beta = "beta",
    Prod = "prod"
}

interface StageConfig {
    stageName: Stage;
    env: { region: Region; account: string };
    isProd: boolean;
    secretArn: string;
    s3BucketArns: string[];
    slackWorkspaceId: string;
    slackChannelId: string;
    instanceType: InstanceType;
    ecsEc2Capacity: {
        min: number;
        max: number;
    };
    ecsTaskCapacity: {
        min: number;
        max: number;
    };
}

export const STAGES: StageConfig[] = [
    {
        stageName: Stage.Beta,
        env: { region: Region.IAD, account: AWS_ACCOUNT },
        isProd: false,
        secretArn: `arn:aws:secretsmanager:${Region.IAD}:${AWS_ACCOUNT}:secret:beta/taiger/portal/service/env-486S9W`,
        s3BucketArns: [
            `arn:aws:s3:::taiger-file-storage`,
            `arn:aws:s3:::taiger-file-storage-development-public`
        ],
        slackWorkspaceId: "T074TTD76BG",
        slackChannelId: "C07CR6VPT8A",
        instanceType: aws_ec2.InstanceType.of(aws_ec2.InstanceClass.T4G, aws_ec2.InstanceSize.NANO),
        ecsEc2Capacity: {
            min: 1,
            max: 2
        },
        ecsTaskCapacity: {
            min: 1,
            max: 2
        }
    },
    {
        stageName: Stage.Prod,
        env: { region: Region.NRT, account: AWS_ACCOUNT },
        isProd: true,
        secretArn: `arn:aws:secretsmanager:${Region.NRT}:${AWS_ACCOUNT}:secret:prod/taiger/portal/service/env-74nBbU`,
        s3BucketArns: [
            `arn:aws:s3:::taiger-file-storage-production-storage`,
            `arn:aws:s3:::taiger-file-storage-public-files-production`
        ],
        slackWorkspaceId: "T074TTD76BG",
        slackChannelId: "C0964M663M5",
        instanceType: aws_ec2.InstanceType.of(
            aws_ec2.InstanceClass.T4G,
            aws_ec2.InstanceSize.MICRO
        ),
        ecsEc2Capacity: {
            min: 1,
            max: 2
        },
        ecsTaskCapacity: {
            min: 1,
            max: 2
        }
    }
];
