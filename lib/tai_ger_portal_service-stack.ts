import { CfnOutput, SecretValue, Stack, StackProps } from 'aws-cdk-lib';
import {
  CodePipeline,
  CodePipelineSource,
  ShellStep,
  CodeBuildStep,
} from 'aws-cdk-lib/pipelines';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

import {
  APP_NAME_TAIGER_SERVICE,
  AWS_ACCOUNT,
  GITHUB_OWNER,
  GITHUB_PACKAGE_BRANCH,
  GITHUB_REPO,
  GITHUB_TAIGER_PORTAL_REPO,
  GITHUB_TOKEN,
} from '../configuration/dependencies';
import { PipelineAppStage } from './app-stage';
import { Region, STAGES } from '../constants';
import { LinuxArmBuildImage, LinuxBuildImage } from 'aws-cdk-lib/aws-codebuild';
import { Repository, TagStatus } from 'aws-cdk-lib/aws-ecr';
// import { EcrBuildStage } from './ecr-build-stage';
// import { LinuxBuildImage } from 'aws-cdk-lib/aws-codebuild';

export class TaiGerPortalServiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Define the source for the pipeline
    const sourceInfra = CodePipelineSource.gitHub(
      `${GITHUB_OWNER}/${GITHUB_REPO}`,
      GITHUB_PACKAGE_BRANCH,
      {
        authentication: SecretValue.secretsManager(GITHUB_TOKEN),
        trigger: codepipeline_actions.GitHubTrigger.WEBHOOK,
      }
    );

    // Define the source for the pipeline
    const sourceCode = CodePipelineSource.gitHub(
      `${GITHUB_OWNER}/${GITHUB_TAIGER_PORTAL_REPO}`,
      GITHUB_PACKAGE_BRANCH,
      {
        authentication: SecretValue.secretsManager(GITHUB_TOKEN),
        trigger: codepipeline_actions.GitHubTrigger.WEBHOOK,
      }
    );

    // Step 1: Create an ECR repository
    const ecrRepo = new Repository(this, 'MyEcrRepo', {
      repositoryName: 'taiger-portal-service-repo',
    });

    // Define the lifecycle policy to keep only the last 20 images
    const lifecycleRules = {
      rules: [
        {
          rulePriority: 1,
          description: 'Keep the last 20 images',
          filter: {
            tagStatus: TagStatus.ANY,
          },
          maxImageCount: 20, // Retain only the last 20 images
        },
        {
          rulePriority: 2,
          description: 'Delete images older than 20 images',
          filter: {
            tagStatus: TagStatus.ANY,
          },
          maxImageCount: 20, // Automatically deletes images beyond the last 20
        },
      ],
    };

    // Apply the lifecycle policy to the repository
    ecrRepo.addLifecycleRule({
      rulePriority: 1,
      description: 'Keep the last 20 images',
      maxImageCount: 20, // Retain only the last 20 images
    });

    // Export repository URI as output
    new CfnOutput(this, 'EcrRepoUri', {
      value: ecrRepo.repositoryName,
      exportName: 'EcrRepoUri',
    });

    // TODO run docker comment.
    const prebuild = new CodeBuildStep('Prebuild', {
      input: sourceCode,
      primaryOutputDirectory: './api',
      commands: [
        'cd api', // Navigate to the API directory
        `aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $ECR_REPO_URI`, // Log in to ECR
        `docker build --platform linux/arm64 -t ${ecrRepo.repositoryUri} .`, // Build the Docker image
        `docker push ${ecrRepo.repositoryUri}`, // Push the Docker image to ECR
      ],
      buildEnvironment: {
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_ARM_3, // make sure it matches the requested image platform.
        privileged: true,
        environmentVariables: {
          AWS_DEFAULT_REGION: {
            value: `${Region.IAD}`,
          },
          ECR_REPO_URI: {
            value: `${ecrRepo.repositoryUri}`,
          },
        },
      },
    });

    const pipelineSourceBuildStep = new CodeBuildStep('Synth', {
      input: sourceInfra,
      additionalInputs: {
        '../dist': prebuild,
      },
      commands: ['npm ci', 'npm run build', 'npx cdk synth'],
    });

    // Create the high-level CodePipeline
    const pipeline = new CodePipeline(
      this,
      `${APP_NAME_TAIGER_SERVICE}Pipeline`,
      {
        pipelineName: `${APP_NAME_TAIGER_SERVICE}Pipeline`,
        synth: pipelineSourceBuildStep,
        codeBuildDefaults: {
          rolePolicy: [
            new PolicyStatement({
              actions: [
                'route53:ListHostedZonesByName',
                'route53:GetHostedZone',
                'route53:ListHostedZones',
              ],
              resources: ['*'],
            }),
          ],
        },
        // Turn this on because the pipeline uses Docker image assets
        dockerEnabledForSelfMutation: true,
      }
    );

    // const buidlStage = new EcrBuildStage(this, `ECRBuild-Stage`, {
    //   env: { region: Region.IAD, account: AWS_ACCOUNT },
    // });
    // pipeline.addStage(buidlStage);
    STAGES.forEach(({ stageName, env, domainStage, isProd, secretArn }) => {
      const stage = new PipelineAppStage(this, `${stageName}-Stage`, {
        env,
        stageName,
        domainStage,
        isProd,
        secretArn,
      });
      pipeline.addStage(stage);
    });

    pipeline.buildPipeline();
    // Grant CodeBuild permission to interact with ECR
    ecrRepo.grantPullPush(prebuild.grantPrincipal);
  }
}
