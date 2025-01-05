import { AWS_ACCOUNT } from '../configuration';
import { Region } from './regions';

export enum Stage {
  Beta_FE = 'Beta-FE',
  Prod_NA = 'Prod-NA',
}

export enum DomainStage {
  Beta = 'beta',
  Prod = 'prod',
}

export const STAGES = [
  {
    stageName: Stage.Beta_FE,
    env: { region: Region.IAD, account: AWS_ACCOUNT },
    isProd: false,
    domainStage: DomainStage.Beta,
    secretName: 'beta/taiger/portal/service/env',
  },
  // {
  //     stageName: Stage.Prod_NA,
  //     env: { region: Region.NRT, account: AWS_ACCOUNT },
  //     isProd: true,
  //     domainStage: DomainStage.Prod,
  //     stageName: "prod/taigerportal/mongodb",
  //     mongoDBName: "TaiGer_Prod",
  //     externalS3BucketName: `taiger-external-bucket-${DomainStage.Prod}`,
  //     internalMongodbS3BucketName: "taiger-file-storage-production-mongo-backup",
  //     origin: "https://taigerconsultancy-portal.com"
  // }
];
