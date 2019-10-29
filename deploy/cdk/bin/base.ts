#!/usr/bin/env node
import { App } from '@aws-cdk/core';
import { StackTags } from '@ndlib/ndlib-cdk';
import 'source-map-support/register';
import IIIF = require('../lib/iiif-serverless');

const app = new App();

const createDns : boolean = app.node.tryGetContext('createDns') === 'true' ? true : false;
const domainStackName = app.node.tryGetContext('domainStackName');
const oauthTokenPath = app.node.tryGetContext('oauthTokenPath');

const imageServiceContext = app.node.tryGetContext('iiifImageService');
new IIIF.DeploymentPipelineStack(app, 'marble-image-service-deployment', {
  createDns,
  domainStackName,
  oauthTokenPath,
  ...imageServiceContext
});

app.node.applyAspect(new StackTags());