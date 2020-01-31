#!/usr/bin/env node
import { App } from '@aws-cdk/core';
import { StackTags } from '@ndlib/ndlib-cdk';
import 'source-map-support/register';
import IIIF = require('../lib/iiif-serverless');
import userContent = require('../lib/user-content');

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

const userContentContext = app.node.tryGetContext('userContent')
new userContent.UserContentStack(app, 'marble-user-content', {
  createDns,
  domainStackName,
  oauthTokenPath,
  ...userContentContext
});

app.node.applyAspect(new StackTags());
