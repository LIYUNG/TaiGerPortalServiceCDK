# TaiGer Portal Backend Service with AWS CDK TypeScript

This package includes TaiGer Portal infrastructure for TaiGer Portal Backend Node.js service.

The Node.js service is packaged in Docker and pushed to private AWS ECR repository.
Each stage (beta, prod) will pull the image from ECR and deploy it in ECS Fargate. API Gateway and Elastic Load Balancer will be the end point to access the service. Necessary permission and security group are also be created to protect the API service. The package creates:

- ECS Fargate cluster, task
- ECR repository
- Cloudwatch log stream group
- API Gateway
- Application Load Balancer.
- Security Group
- VPC
- Route53 record (for custom domain name)
- certificate (HTTPS)
- necessary IAM roles, assume roles.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk synth` emits the synthesized CloudFormation template

