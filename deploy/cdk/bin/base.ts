#!/usr/bin/env node
import { App } from '@aws-cdk/core';
import { StackTags } from '@ndlib/ndlib-cdk';
import 'source-map-support/register';
import { FoundationStack } from '../lib/foundation';
import IIIF = require('../lib/iiif-serverless');
import userContent = require('../lib/user-content');

const app = new App();

const createDns : boolean = app.node.tryGetContext('createDns') === 'true' ? true : false;
const domainStackName = app.node.tryGetContext('domainStackName');
const oauthTokenPath = app.node.tryGetContext('oauthTokenPath');
const namespace = app.node.tryGetContext('namespace');
const owner = app.node.tryGetContext('owner');
const contact = app.node.tryGetContext('contact');
const slackNotifyStackName = app.node.tryGetContext('slackNotifyStackName'); // Notifier for CD pipeline approvals


const baseStack = new FoundationStack(app, `${namespace}-base`, {
  domainName: 'library.nd.edu',
});

const imageServiceContext = app.node.tryGetContext('iiifImageService');
new IIIF.DeploymentPipelineStack(app, `${namespace}-image-service-deployment`, {
  baseStack,
  createDns,
  domainStackName,
  oauthTokenPath,
  namespace,
  ...imageServiceContext
});

const userContentContext = {
  allowedOrigins: app.node.tryGetContext('userContent:allowedOrigins'),
  lambdaCodePath: app.node.tryGetContext('userContent:lambdaCodePath'),
  tokenAudiencePath: app.node.tryGetContext('userContent:tokenAudiencePath'),
  tokenIssuerPath: app.node.tryGetContext('userContent:tokenIssuerPath'),
  appRepoOwner: app.node.tryGetContext('userContent:appRepoOwner'),
  appRepoName: app.node.tryGetContext('userContent:appRepoName'),
  appSourceBranch: app.node.tryGetContext('userContent:appSourceBranch'),
  infraRepoOwner: app.node.tryGetContext('userContent:infraRepoOwner'),
  infraRepoName: app.node.tryGetContext('userContent:infraRepoName'),
  infraSourceBranch: app.node.tryGetContext('userContent:infraSourceBranch'),
  notificationReceivers: app.node.tryGetContext('userContent:deployNotificationReceivers'),
  hostnamePrefix: app.node.tryGetContext('userContent:hostnamePrefix'),
  baseStack,
  domainStackName,
  createDns,
  namespace,
};
new userContent.UserContentStack(app, `${namespace}-user-content`, userContentContext);
new userContent.DeploymentPipelineStack(app, `${namespace}-user-content-deployment`, {
  oauthTokenPath,
  owner,
  contact,
  slackNotifyStackName,
  ...userContentContext,
});

app.node.applyAspect(new StackTags());
