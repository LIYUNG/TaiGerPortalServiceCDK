import { Construct } from "constructs";

export interface ApiGatewayCustomDomainProps {
    stageName: string;
    isProd: boolean;
    region: string;
}

export class ApiGatewayCustomDomainConstruct extends Construct {
    constructor(scope: Construct, id: string, props: ApiGatewayCustomDomainProps) {
        super(scope, id);
    }
}
