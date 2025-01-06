import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ecr from 'aws-cdk-lib/aws-ecr';

import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { GITHUB_OWNER, GITHUB_TAIGER_PORTAL_REPO } from '../configuration';

export class EcrBuildStage extends Stage {
  readonly buildProject: codebuild.Project;
  constructor(scope: Construct, id: string, props: StageProps) {
    super(scope, id, props);

    // Step 2: Create an ECR Repository
    const ecrRepository = new ecr.Repository(this, 'TaiGerPortalRepository', {
      repositoryName: 'taiger-portal-repo',
    });

    // Enable replication to another region (destination region)
    ecrRepository.addLifecycleRule({
      tagPrefixList: ['prod'],
      maxImageCount: 10,
    });
    const source = codebuild.Source.gitHub({
      owner: GITHUB_OWNER,
      repo: GITHUB_TAIGER_PORTAL_REPO,
      webhook: true, // Optional: Trigger on GitHub push
      webhookFilters: [
        codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH),
      ],
    });
    this.buildProject = new codebuild.Project(this, 'BuildDockerImage', {
      source: source,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3, // Select your build image
        environmentVariables: {
          ECR_REPOSITORY_URI: { value: ecrRepository.repositoryUri }, // ECR URI for push
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'echo Installing dependencies...',
              'cd api',
              'npm install -g aws-cdk', // Install CDK if needed
              'npm install',
            ],
          },
          pre_build: {
            commands: [
              'echo Logging into Amazon ECR...',
              'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPOSITORY_URI',
            ],
          },
          build: {
            commands: [
              'echo Building the Docker image...',
              'docker build -t taiger-portal .',
              `docker tag taiger-portal:latest $ECR_REPOSITORY_URI:latest`,
            ],
          },
          post_build: {
            commands: [
              'echo Pushing Docker image to ECR...',
              `docker push $ECR_REPOSITORY_URI:latest`,
            ],
          },
        },
      }),
    });
    // Step 4: Grant the CodeBuild project permissions to interact with ECR
    ecrRepository.grantPullPush(this.buildProject);
  }
}
