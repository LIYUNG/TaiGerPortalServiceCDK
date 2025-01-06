import * as cdk from 'aws-cdk-lib';
import { ApiGatewayCustomDomainConstruct } from '../constructs';

interface ApiGatewayCustomDomainProps extends cdk.StackProps {
  stageName: string;
  domainStage: string;
  isProd: boolean;
  mongodbUrisecretArn: string;
  mongoDBName: string;
  externalS3BucketName: string;
  internalMongodbS3BucketName: string;
  origin: string;
}

export class ApiGatewayCustomDomainStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: ApiGatewayCustomDomainProps) {
    super(scope, id, props);

    if (!props.env?.region) {
      throw new Error('Region is required');
    }

    new ApiGatewayCustomDomainConstruct(this, `ApiGateway-${props.stageName}`, {
      stageName: props.stageName,
      isProd: props.isProd,
      region: props.env.region,
      mongodbUrisecretArn: props.mongodbUrisecretArn,
      mongoDBName: props.mongoDBName,
      externalS3BucketName: props.externalS3BucketName,
      internalMongodbS3BucketName: props.internalMongodbS3BucketName,
      origin: props.origin,
    });
  }
}
