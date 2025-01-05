#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TaiGerPortalServiceStack } from '../lib/tai_ger_portal_service-stack';

const app = new cdk.App();
new TaiGerPortalServiceStack(app, 'TaiGerPortalServiceStack');
