import { AWS_ACCOUNT } from "../configuration";
import { Region } from "./regions";

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
