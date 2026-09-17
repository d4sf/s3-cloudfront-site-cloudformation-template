#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { SiteStack } from "../lib/site-stack";

loadDotenv({ override: true });

const app = new App();
const config = loadConfig();

new SiteStack(app, config.stackName, config, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: config.region,
  },
});

app.synth();
