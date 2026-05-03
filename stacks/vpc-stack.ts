import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { aws_ec2 } from "aws-cdk-lib";
import { APPLICATION_NAME } from "../configuration";

interface VpcStackProps extends cdk.StackProps {
    stageName: string;
}

export class VpcStack extends cdk.Stack {
    readonly vpc: aws_ec2.Vpc;

    constructor(scope: Construct, id: string, props: VpcStackProps) {
        super(scope, id, props);

        // Create shared VPC with public and private subnets
        // EC2 instances go in public subnets, RDS in private subnets
        this.vpc = new aws_ec2.Vpc(this, `${APPLICATION_NAME}-vpc-${props.stageName}`, {
            ipAddresses: aws_ec2.IpAddresses.cidr("10.0.0.0/16"),
            natGateways: 0, // Cheapest option - no NAT Gateway needed
            maxAzs: 2,
            subnetConfiguration: [
                {
                    name: "Public",
                    subnetType: aws_ec2.SubnetType.PUBLIC,
                    cidrMask: 24
                },
                {
                    name: "Isolated",
                    subnetType: aws_ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 24
                }
            ]
        });

        // Export VPC ID for cross-stack reference
        new cdk.CfnOutput(this, "VpcId", {
            value: this.vpc.vpcId,
            exportName: `${APPLICATION_NAME}-VpcId-${props.stageName}`,
            description: "VPC ID for shared resources"
        });

        // Export VPC object as attribute for cross-stack reference
        new cdk.CfnOutput(this, "VpcArn", {
            value: this.vpc.vpcArn,
            exportName: `${APPLICATION_NAME}-VpcArn-${props.stageName}`,
            description: "VPC ARN for cross-stack reference"
        });
    }
}
