#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TaiGerPortalServicePipelineStack } from "../lib/tai_ger_portal_service_pipelinestack";
import { AWS_ACCOUNT } from "../configuration";
import { Region } from "../constants";

const app = new cdk.App();
new TaiGerPortalServicePipelineStack(app, "TaiGerPortalServicePipelineStack", {
    env: { region: Region.IAD, account: AWS_ACCOUNT }
});
