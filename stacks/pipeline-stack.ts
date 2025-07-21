import { CfnOutput, SecretValue, Stack, StackProps } from "aws-cdk-lib";
import {
    CodePipeline,
    CodePipelineSource,
    CodeBuildStep,
    ManualApprovalStep
} from "aws-cdk-lib/pipelines";
import { PipelineType } from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

import {
    APP_NAME_TAIGER_SERVICE,
    AWS_ACCOUNT,
    ECR_REPO_NAME,
    GITHUB_OWNER,
    GITHUB_PACKAGE_BRANCH,
    GITHUB_REPO,
    GITHUB_TAIGER_PORTAL_REPO,
    GITHUB_TOKEN
} from "../configuration/dependencies";
import { PipelineAppStage } from "../lib/app-stage";
import { Region, STAGES } from "../constants";
import { LinuxBuildImage } from "aws-cdk-lib/aws-codebuild";
import { CfnReplicationConfiguration, Repository } from "aws-cdk-lib/aws-ecr";

export class TaiGerPortalServicePipelineStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // Define the source for the pipeline
        const sourceInfra = CodePipelineSource.gitHub(
            `${GITHUB_OWNER}/${GITHUB_REPO}`,
            GITHUB_PACKAGE_BRANCH,
            {
                authentication: SecretValue.secretsManager(GITHUB_TOKEN),
                trigger: codepipeline_actions.GitHubTrigger.WEBHOOK
            }
        );

        // Define the source for the pipeline
        const sourceCode = CodePipelineSource.gitHub(
            `${GITHUB_OWNER}/${GITHUB_TAIGER_PORTAL_REPO}`,
            GITHUB_PACKAGE_BRANCH,
            {
                authentication: SecretValue.secretsManager(GITHUB_TOKEN),
                trigger: codepipeline_actions.GitHubTrigger.WEBHOOK
            }
        );

        // Step 1: Create an ECR repository
        const ecrRepo = new Repository(this, `${APP_NAME_TAIGER_SERVICE}-EcrRepo`, {
            repositoryName: ECR_REPO_NAME
        });

        new CfnReplicationConfiguration(
            this,
            `${APP_NAME_TAIGER_SERVICE}-CfnReplicationConfiguration`,
            {
                replicationConfiguration: {
                    rules: [
                        {
                            destinations: [
                                {
                                    region: "us-west-2",
                                    registryId: AWS_ACCOUNT
                                }
                            ]
                        }
                    ]
                }
            }
        );

        // Apply the lifecycle policy to the repository
        ecrRepo.addLifecycleRule({
            rulePriority: 1,
            description: "Keep the last 20 images",
            maxImageCount: 20 // Retain only the last 20 images
        });

        // Export repository URI as output
        new CfnOutput(this, `${APP_NAME_TAIGER_SERVICE}-EcrRepoUri`, {
            value: ecrRepo.repositoryName,
            exportName: `${APP_NAME_TAIGER_SERVICE}-EcrRepoUri`
        });

        // run docker comment.
        const prebuild = new CodeBuildStep("Prebuild", {
            input: sourceCode,
            primaryOutputDirectory: ".",
            commands: [
                `aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $ECR_REPO_URI`, // Log in to ECR
                `docker build --platform linux/arm64 -t ${ecrRepo.repositoryUri} .`, // Build the Docker image
                `docker push ${ecrRepo.repositoryUri}`, // Push the Docker image to ECR
                `aws ecr describe-images --repository-name ${ecrRepo.repositoryName} --image-ids imageTag=latest --query 'imageDetails[0].imageDigest' --output text > digest.txt`
            ],
            buildEnvironment: {
                buildImage: LinuxBuildImage.AMAZON_LINUX_2_ARM_3, // make sure it matches the requested image platform.
                privileged: true,
                environmentVariables: {
                    AWS_DEFAULT_REGION: {
                        value: `${Region.IAD}`
                    },
                    ECR_REPO_URI: {
                        value: `${ecrRepo.repositoryUri}`
                    }
                }
            }
        });

        const pipelineSourceBuildStep = new CodeBuildStep("Synth", {
            input: sourceInfra,
            additionalInputs: {
                "../dist": prebuild
            },
            commands: [
                "npm ci",
                "npm run build",
                "npx cdk synth -c imageDigest=$(cat ../dist/digest.txt)"
            ]
        });

        // Create the high-level CodePipeline
        const pipeline = new CodePipeline(this, `${APP_NAME_TAIGER_SERVICE}Pipeline`, {
            pipelineName: `${APP_NAME_TAIGER_SERVICE}Pipeline`,
            pipelineType: PipelineType.V2,
            synth: pipelineSourceBuildStep,
            codeBuildDefaults: {
                rolePolicy: [
                    new PolicyStatement({
                        actions: [
                            "route53:ListHostedZonesByName",
                            "route53:GetHostedZone",
                            "route53:ListHostedZones"
                        ],
                        resources: ["*"]
                    }), // Add ECR permissions for CodeBuild
                    new PolicyStatement({
                        actions: [
                            "ecr:*" // Required for EcrSourceAction and synth
                        ],
                        resources: [ecrRepo.repositoryArn]
                    })
                ]
            },
            // Turn this on because the pipeline uses Docker image assets
            dockerEnabledForSelfMutation: true
        });

        STAGES.forEach(
            ({
                stageName,
                env,
                isProd,
                secretArn,
                s3BucketArns,
                instanceType,
                ecsEc2Capacity,
                ecsTaskCapacity,
                slackWorkspaceId,
                slackChannelId
            }) => {
                const stage = new PipelineAppStage(this, `${stageName}-Stage`, {
                    env,
                    stageName,
                    isProd,
                    secretArn,
                    s3BucketArns,
                    instanceType,
                    ecsEc2Capacity,
                    ecsTaskCapacity,
                    slackWorkspaceId,
                    slackChannelId
                });
                if (isProd) {
                    pipeline.addStage(stage, {
                        pre: [
                            new ManualApprovalStep("ApproveIfStable", {
                                comment:
                                    "Approve to continue production deployment. Make sure every changes are verified in dev."
                            })
                        ]
                    });
                } else {
                    pipeline.addStage(stage);
                }
            }
        );

        pipeline.buildPipeline();
        // Grant CodeBuild permission to interact with ECR
        ecrRepo.grantPullPush(prebuild.grantPrincipal);
    }
}
