#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TaiGerPortalServiceStack } from "../lib/tai_ger_portal_service-stack";
import { AWS_ACCOUNT } from "../configuration";
import { Region } from "../constants";

const app = new cdk.App();
new TaiGerPortalServiceStack(app, "TaiGerPortalServiceStack", {
    env: { region: Region.IAD, account: AWS_ACCOUNT }
});
