import { SecretValue, Stack, StackProps } from 'aws-cdk-lib';
import {
  CodePipeline,
  CodePipelineSource,
  ShellStep,
} from 'aws-cdk-lib/pipelines';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

import {
  APP_NAME_TAIGER_SERVICE,
  GITHUB_OWNER,
  GITHUB_PACKAGE_BRANCH,
  GITHUB_REPO,
  GITHUB_TOKEN,
} from '../configuration/dependencies';
import { PipelineAppStage } from './app-stage';
import { STAGES } from '../constants';

export class TaiGerPortalServiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Define the source for the pipeline
    const source = CodePipelineSource.gitHub(
      `${GITHUB_OWNER}/${GITHUB_REPO}`,
      GITHUB_PACKAGE_BRANCH,
      {
        authentication: SecretValue.secretsManager(GITHUB_TOKEN),
        trigger: codepipeline_actions.GitHubTrigger.WEBHOOK,
      }
    );

    // Create the high-level CodePipeline
    const pipeline = new CodePipeline(
      this,
      `${APP_NAME_TAIGER_SERVICE}Pipeline`,
      {
        pipelineName: `${APP_NAME_TAIGER_SERVICE}Pipeline`,
        synth: new ShellStep('Synth', {
          input: source,
          commands: ['npm ci', 'npm run build', 'npx cdk synth'],
        }),
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
      }
    );

    STAGES.forEach(({ stageName, env, domainStage, isProd, secretName }) => {
      const stage = new PipelineAppStage(this, `${stageName}-Stage`, {
        env,
        stageName,
        domainStage,
        isProd,
        secretName,
      });
      pipeline.addStage(stage);
    });
  }
}
