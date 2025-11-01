import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { RestApi } from "aws-cdk-lib/aws-apigateway";
import { Alarm, ComparisonOperator, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Duration } from "aws-cdk-lib";
import * as chatbot from "aws-cdk-lib/aws-chatbot";

import { APPLICATION_NAME } from "../configuration";
import { Topic } from "aws-cdk-lib/aws-sns";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { ManagedPolicy, Role } from "aws-cdk-lib/aws-iam";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Effect } from "aws-cdk-lib/aws-iam";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

interface MonitorStackProps extends cdk.StackProps {
    slackWorkspaceId?: string;
    slackChannelId?: string;
    api: RestApi;
    stageName: string;
}

export class MonitorStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: MonitorStackProps) {
        super(scope, id, props);

        // Create an SNS Topic for notifications
        const alarmTopic = new Topic(
            this,
            `${APPLICATION_NAME}-ApiGatewayAlarmTopic-${props.stageName}`,
            {
                displayName: `${APPLICATION_NAME} API Gateway 5XX Error Alarms for ${props.stageName} stage`,
                topicName: `${APPLICATION_NAME}-5XX-AlarmsTopic-${props.stageName}`
            }
        );

        // Create Amazon Q Slack channel configuration
        if (props.slackWorkspaceId && props.slackChannelId) {
            // Create IAM role for Slack to access CloudWatch
            const slackRole = new Role(
                this,
                `${APPLICATION_NAME}-SlackCloudWatchRole-${props.stageName}`,
                {
                    roleName: `${APPLICATION_NAME}-SlackCloudWatchRole-${props.stageName}`,
                    assumedBy: new ServicePrincipal("chatbot.amazonaws.com"),
                    description: "Role for Slack to access CloudWatch logs and metrics",
                    managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("ReadOnlyAccess")]
                }
            );
            // Add CloudWatch permissions to the role
            slackRole.addToPolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["cloudwatch:Describe*", "cloudwatch:Get*", "cloudwatch:List*"],
                    resources: ["*"] // You can restrict this to specific log groups or metrics if needed
                })
            );
            new chatbot.SlackChannelConfiguration(
                this,
                `${APPLICATION_NAME}-SlackChannel-${props.stageName}`,
                {
                    slackChannelConfigurationName: `${APPLICATION_NAME}-${props.stageName}-alerts`,
                    slackWorkspaceId: props.slackWorkspaceId,
                    slackChannelId: props.slackChannelId,
                    notificationTopics: [alarmTopic],
                    role: slackRole
                }
            );
        }

        // Add CloudWatch Alarm for 5XX errors
        const fiveXXErrorAlarm = new Alarm(
            this,
            `${APPLICATION_NAME}-ApiGateway5XXErrorAlarm-${props.stageName}`,
            {
                alarmName: `${APPLICATION_NAME}-ApiGateway5XXErrorAlarm-${props.stageName}`,
                metric: props.api.metricServerError({
                    period: Duration.minutes(5),
                    statistic: "Sum"
                }),
                threshold: 2,
                evaluationPeriods: 1,
                datapointsToAlarm: 2,
                alarmDescription: `${APPLICATION_NAME} API Gateway 5XX errors alarm for ${props.stageName} stage`,
                comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
                treatMissingData: TreatMissingData.NOT_BREACHING,
                actionsEnabled: true
            }
        );

        fiveXXErrorAlarm.addAlarmAction(new SnsAction(alarmTopic));
        fiveXXErrorAlarm.addOkAction(new SnsAction(alarmTopic));
        // Cost center tag
        cdk.Tags.of(fiveXXErrorAlarm).add("Project", "CustomerPortal");
        cdk.Tags.of(fiveXXErrorAlarm).add("Environment", "Production");
        cdk.Tags.of(fiveXXErrorAlarm).add("CostCenter", "CustomerPortalService");
    }
}
