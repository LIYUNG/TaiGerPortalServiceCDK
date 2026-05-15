# TaiGer Portal Backend Service with AWS CDK TypeScript

This package includes TaiGer Portal infrastructure for TaiGer Portal Backend Node.js service.

The Node.js service is packaged in Docker and pushed to private AWS ECR repository.
Each stage (beta, prod) will pull the image from ECR and deploy it in ECS Fargate. Elastic Load Balancer is the endpoint to access the service. Optionally, CloudFront can be enabled in front of ALB (recommended for production) by providing a CloudFront certificate ARN in CDK context. Necessary permission and security group are also be created to protect the API service. The package creates:

- ECS Fargate cluster, task
- ECR repository
- Cloudwatch log stream group
- Application Load Balancer.
- Optional CloudFront distribution in front of ALB.
- Security Group
- VPC
- Route53 record (for custom domain name)
- certificate (HTTPS)
- necessary IAM roles, assume roles.

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests

* `npx cdk deploy` deploy this stack to your default AWS account/region
* `npx cdk diff` compare deployed stack with current state
* `npx cdk synth` emits the synthesized CloudFormation template

## CloudFront + ALB mode

To enable CloudFront in front of ALB, provide an ACM certificate ARN (must be in `us-east-1`) via CDK context:

- Single certificate for all stages:
    - `cdk deploy -c cloudFrontCertificateArn=arn:aws:acm:us-east-1:<account-id>:certificate/<id>`
- Per stage:
    - `cdk deploy -c cloudFrontCertificateArnByStage='{"beta":"arn:aws:acm:us-east-1:<account-id>:certificate/<id>","prod":"arn:aws:acm:us-east-1:<account-id>:certificate/<id>"}'`

Behavior:

- When CloudFront is enabled, ALB only allows HTTPS from CloudFront origin-facing IP ranges.
- When CloudFront is not enabled, API domain points directly to ALB and ALB allows direct HTTPS from internet.
