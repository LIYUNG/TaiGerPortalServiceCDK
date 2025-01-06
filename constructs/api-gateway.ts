import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as certmgr from 'aws-cdk-lib/aws-certificatemanager';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';

import { Construct } from 'constructs';

export interface ApiGatewayCustomDomainProps {
  stageName: string;
  isProd: boolean;
  region: string;
  mongodbUrisecretArn: string;
  mongoDBName: string;
  externalS3BucketName: string;
  internalMongodbS3BucketName: string;
  origin: string;
}

export class ApiGatewayCustomDomainConstruct extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: ApiGatewayCustomDomainProps
  ) {
    super(scope, id);

    // Step 1: Get your existing Route 53 Hosted Zone
    const hostedZone = route53.HostedZone.fromLookup(this, `HostedZone`, {
      domainName: 'taigerconsultancy-portal.com', // Replace with your domain name
    });

    // Step 2: Create an SSL certificate for the custom domain
    const certificate = new certmgr.Certificate(this, 'ApiCertificate', {
      domainName: `${'test'}.taigerconsultancy-portal.com`, // Replace with your subdomain
      validation: certmgr.CertificateValidation.fromDns(hostedZone),
    });

    // Step 3: Create an API Gateway REST API
    const api = new apigateway.RestApi(this, 'MyApi', {
      restApiName: 'My API',
      description: 'API for my application',
      deployOptions: {
        stageName: 'prod',
      },
    });

    // Step 4: Set up Custom Domain for API Gateway
    const domainName = new apigateway.DomainName(this, 'CustomDomain', {
      domainName: `${'test'}.taigerconsultancy-portal.com`, // Replace with your custom subdomain
      certificate,
    });

    // Step 5: Create a Base Path Mapping
    new apigateway.BasePathMapping(this, 'BasePathMapping', {
      domainName: domainName,
      restApi: api,
    });

    // Step 6: Create Route 53 Record to point to the API Gateway
    new route53.ARecord(this, 'ApiGatewayRecord', {
      zone: hostedZone,
      recordName: 'api', // Subdomain name for your custom domain
      target: route53.RecordTarget.fromAlias(
        new route53Targets.ApiGatewayDomain(domainName)
      ),
    });
  }
}
