import { SecretValue } from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';

import { Construct } from 'constructs';

export interface SsmProps {
  //   stageName: string;
  //   isProd: boolean;
  //   region: string;
  //   mongodbUriSecretName: string;
  //   mongoDBName: string;
  //   externalS3BucketName: string;
  //   internalMongodbS3BucketName: string;
  //   origin: string;
}

export class SsmConstruct extends Construct {
  public readonly API_ORIGIN: string;
  public readonly JWT_SECRET: string;

  constructor(scope: Construct, id: string, props: SsmProps) {
    super(scope, id);

    this.API_ORIGIN = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      'API_ORIGIN',
      { parameterName: '/taiger/portal/jwt-secret', version: 1 }
    ).stringValue;

    this.JWT_SECRET = ssm.StringParameter.valueFromLookup(
      this,
      '/taiger/portal/api-origin'
    );
  }
}
