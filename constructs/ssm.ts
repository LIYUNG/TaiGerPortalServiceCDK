import * as ssm from 'aws-cdk-lib/aws-ssm';

import { Construct } from 'constructs';

export interface SsmProps {
  stageName: string;
  isProd: boolean;
  region: string;
  mongodbUriSecretName: string;
  mongoDBName: string;
  externalS3BucketName: string;
  internalMongodbS3BucketName: string;
  origin: string;
}

export class SsmConstruct extends Construct {
  public readonly API_ORIGIN: string;

  constructor(scope: Construct, id: string, props: SsmProps) {
    super(scope, id);
    this.API_ORIGIN = ssm.StringParameter.valueForStringParameter(
      this,
      '/taiger/portal/api-origin'
    );
  }
}
