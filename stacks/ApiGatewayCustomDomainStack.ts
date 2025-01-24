import * as cdk from "aws-cdk-lib";
import { ApiGatewayCustomDomainConstruct } from "../constructs";
import { Construct } from "constructs";

interface ApiGatewayCustomDomainProps extends cdk.StackProps {
    stageName: string;
    domainStage: string;
    isProd: boolean;
}

export class ApiGatewayCustomDomainStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: ApiGatewayCustomDomainProps) {
        super(scope, id, props);

        if (!props.env?.region) {
            throw new Error("Region is required");
        }

        new ApiGatewayCustomDomainConstruct(this, `ApiGateway-${props.stageName}`, {
            stageName: props.stageName,
            isProd: props.isProd,
            region: props.env.region
        });
    }
}
