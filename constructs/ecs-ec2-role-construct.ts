import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { APP_NAME, AWS_ACCOUNT } from "../configuration";

export interface EcsEc2RoleProps {
    region?: string;
    stageName: string;
    s3BucketArns?: string[]; // List of S3 bucket ARNs
    resoureName: string;
    secretArn: string;
    // sqsQueueArns?: string[]; // List of SQS queue ARNs
}

export class EcsEc2Role extends Construct {
    public readonly role: iam.Role;

    constructor(scope: Construct, id: string, props?: EcsEc2RoleProps) {
        super(scope, id);

        // Create a Ecs Task Role
        this.role = new iam.Role(this, "EcsEc2TaskRole", {
            roleName: `${props?.resoureName}-EcsEc2-${props?.stageName}-TaskRole`,
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            description: "IAM Role for Ecs to access S3 and SQS securely"
        });

        // Basic Ecs task permissions (logs, metrics, etc.)
        this.role.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchFullAccess")
        );

        // Grant necessary permissions for CloudWatch Logs
        this.role.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                    "logs:CreateLogGroup",
                    "logs:DescribeLogGroups",
                    "logs:DescribeLogStreams",
                    "logs:GetLogEvents"
                ],
                resources: [
                    `arn:aws:logs:${props?.region}:${AWS_ACCOUNT}:log-group:${APP_NAME}-${props?.stageName}*`
                ]
            })
        );

        this.role.addToPolicy(
            new iam.PolicyStatement({
                actions: ["ses:SendEmail"],
                resources: ["*"] // SES email sending permissions
            })
        );
        this.role.addToPolicy(
            new iam.PolicyStatement({
                actions: ["execute-api:Invoke"],
                resources: [
                    `arn:aws:execute-api:${props?.region}:${AWS_ACCOUNT}:*/*/*/*` // Replace with your API Gateway ARN
                ]
            })
        );

        this.role.addToPolicy(
            new iam.PolicyStatement({
                actions: ["sts:AssumeRole"],
                resources: [
                    `arn:aws:execute-api:${props?.region}:${AWS_ACCOUNT}:*/*/*/*` // Replace with your API Gateway ARN
                ]
            })
        );

        this.role.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "secretsmanager:GetSecretValue" // Required to fetch secrets
                ],
                resources: [props?.secretArn ?? ""] // Allow access to the specific secret
            })
        );

        // Grant S3 permissions (if bucket ARNs are provided)
        if (props?.s3BucketArns) {
            this.role.addToPolicy(
                new iam.PolicyStatement({
                    actions: [
                        "s3:Abort*",
                        "s3:PutObject",
                        "s3:PutObjectLegalHold",
                        "s3:PutObjectRetention",
                        "s3:PutObjectTagging",
                        "s3:PutObjectVersionTagging",
                        "s3:GetObject",
                        "s3:DeleteObject",
                        "s3:ListBucket"
                    ],
                    resources: props.s3BucketArns.flatMap((arn) => [arn, `${arn}/*`]) // Bucket and object access
                })
            );
        }

        this.role.addToPolicy(
            new iam.PolicyStatement({
                actions: ["ses:SendEmail"],
                resources: [
                    `arn:aws:ses:${props?.region}:${AWS_ACCOUNT}:identity/taigerconsultancy-portal.com`,
                    // `arn:aws:ses:${props?.region}:${AWS_ACCOUNT}:identity/beta.taigerconsultancy-portal.com`,
                    `arn:aws:ses:${props?.region}:${AWS_ACCOUNT}:identity/noreply.taigerconsultancy@gmail.com`
                ]
            })
        );
    }
}
