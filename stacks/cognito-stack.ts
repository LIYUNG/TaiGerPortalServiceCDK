import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { FederatedPrincipal, Role } from "aws-cdk-lib/aws-iam";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import path = require("path");
import * as fs from "fs";

interface CognitoStackProps extends cdk.StackProps {
    stageName: string;
}

export class CognitoStack extends cdk.Stack {
    public readonly taigerUserPool: cognito.UserPool;
    public readonly identityPool: cognito.CfnIdentityPool;
    public readonly taigerUserPoolClient: cognito.UserPoolClient;

    constructor(scope: Construct, id: string, props: CognitoStackProps) {
        super(scope, id, props);

        // Create Cognito User Pool
        this.taigerUserPool = new cognito.UserPool(this, `UserPool-${props.stageName}`, {
            selfSignUpEnabled: false,
            autoVerify: { email: true },
            signInAliases: { email: true }
            // userVerification: { emailStyle: cognito.VerificationEmailStyle.LINK },
            // removalPolicy: cdk.RemovalPolicy.DESTROY // Prod: retain
        });

        // Create App Client for authentication
        this.taigerUserPoolClient = new cognito.UserPoolClient(
            this,
            `UserPoolClient-${props.stageName}`,
            {
                userPool: this.taigerUserPool,
                generateSecret: false // Don't need to generate secret for webapp running on browers
            }
        );

        // Step 3: Read CSS file
        const cssFilePath = path.join(__dirname, "cognito-custom.css");
        const customCss = fs.readFileSync(cssFilePath, "utf8");

        // Step 4: Apply UI Customization
        new cognito.CfnUserPoolUICustomizationAttachment(this, "UICustomization", {
            userPoolId: this.taigerUserPool.userPoolId,
            clientId: this.taigerUserPoolClient.userPoolClientId, // Apply to a specific client
            css: customCss // Custom CSS content
        });

        this.identityPool = new cognito.CfnIdentityPool(this, `IdentityPool-${props.stageName}`, {
            allowUnauthenticatedIdentities: true,
            cognitoIdentityProviders: [
                {
                    clientId: this.taigerUserPoolClient.userPoolClientId,
                    providerName: this.taigerUserPool.userPoolProviderName
                }
            ]
        });

        const isUserCognitoGroupRole = new Role(this, `UserCognitoGroupRole-${props.stageName}`, {
            description: "Default role for authenticated users",
            assumedBy: new FederatedPrincipal(
                "cognito-identity.amazonaws.com",
                {
                    StringEquals: {
                        "cognito-identity.amazonaws.com:aud": this.identityPool.ref
                    },
                    "ForAnyValue:StringLike": {
                        "cognito-identity.amazonaws.com:amr": "authenticated"
                    }
                },
                "sts:AssumeRoleWithWebIdentity"
            )
        });

        new cognito.CfnIdentityPoolRoleAttachment(
            this,
            `IdentityPoolRoleAttachment-${props.stageName}`,
            {
                identityPoolId: this.identityPool.ref,
                roles: {
                    authenticated: isUserCognitoGroupRole.roleArn,
                    unauthenticated: isUserCognitoGroupRole.roleArn
                }
            }
        );

        // Create Cognito Domain (Hosted UI)
        this.taigerUserPool.addDomain(`CognitoDomain-${props.stageName}`, {
            cognitoDomain: { domainPrefix: `${props.stageName}-taiger`.toLowerCase() }
        });

        new StringParameter(this, "UserPoolIdParameter", {
            parameterName: `/auth/taigerUserPoolId`,
            stringValue: this.taigerUserPool.userPoolId
        });

        new StringParameter(this, "UserPoolClientIdParameter", {
            parameterName: `/auth/taigerUserPoolClientId`,
            stringValue: this.taigerUserPoolClient.userPoolClientId
        });

        // Output User Pool details
        new cdk.CfnOutput(this, `UserPoolId-${props.stageName}`, {
            value: this.taigerUserPool.userPoolId
        });
        new cdk.CfnOutput(this, `UserPoolClientId-${props.stageName}`, {
            value: this.taigerUserPoolClient.userPoolClientId
        });
        new cdk.CfnOutput(this, `CognitoHostedUI-${props.stageName}`, {
            value: `https://${props.stageName}-taiger.auth.${this.region}.amazoncognito.com/login`
        });
    }
}
