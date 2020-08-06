#!/usr/bin/env node
import { App, ConstructNode } from '@aws-cdk/core';
import { StackTags } from '@ndlib/ndlib-cdk';
import 'source-map-support/register';
import { FoundationStack } from '../lib/foundation';
import IIIF = require('../lib/iiif-serverless');
import userContent = require('../lib/user-content');
import imageProcessing = require('../lib/image-processing');

const app = new App();

const getRquiredContext = (node: ConstructNode, key: string) => {
  const value = node.tryGetContext(key);
  if(value === undefined || value === null)
    throw new Error(`Context key '${key}' is required.`);
  return value;
}

// Get context keys that are required by all stacks
const account = getRquiredContext(app.node, 'account');
const region = getRquiredContext(app.node, 'region');
const namespace = getRquiredContext(app.node, 'namespace');
const owner = getRquiredContext(app.node, 'owner');
const contact = getRquiredContext(app.node, 'contact');

const createDns : boolean = app.node.tryGetContext('createDns') === 'true' ? true : false;
const oauthTokenPath = app.node.tryGetContext('oauthTokenPath');
const slackNotifyStackName = app.node.tryGetContext('slackNotifyStackName'); // Notifier for CD pipeline approvals

const env = { account, region };

const useVpcId = app.node.tryGetContext('useVpcId');
const domainName = app.node.tryGetContext('domainName');
const useExistingDnsZone = app.node.tryGetContext('useExistingDnsZone');
const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
  env,
  domainName,
  useExistingDnsZone,
  useVpcId,
});

const imageServiceContext = app.node.tryGetContext('iiifImageService');
new IIIF.DeploymentPipelineStack(app, `${namespace}-image-service-deployment`, {
  env,
  createDns,
  domainStackName: `${namespace}-domain`,
  oauthTokenPath,
  namespace,
  foundationStack,
  ...imageServiceContext
});

const userContentContext = {
  env,
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
  foundationStack,
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

const imageProcessingContext = {
  env,
  rbscBucketName: app.node.tryGetContext('imageProcessing:rbscBucketName'),
  processBucketName: app.node.tryGetContext('imageProcessing:processBucketName'),
  imageBucketName: app.node.tryGetContext('imageProcessing:imageBucketName'),
  lambdaCodePath: app.node.tryGetContext('imageProcessing:lambdaCodePath'),
  dockerfilePath: app.node.tryGetContext('imageProcessing:dockerfilePath'),
  appRepoOwner: app.node.tryGetContext('imageProcessing:appRepoOwner'),
  appRepoName: app.node.tryGetContext('imageProcessing:appRepoName'),
  appSourceBranch: app.node.tryGetContext('imageProcessing:appSourceBranch'),
  infraRepoOwner: app.node.tryGetContext('imageProcessing:infraRepoOwner'),
  infraRepoName: app.node.tryGetContext('imageProcessing:infraRepoName'),
  infraSourceBranch: app.node.tryGetContext('imageProcessing:infraSourceBranch'),
  foundationStack,
};
new imageProcessing.ImagesStack(app, `${namespace}-image-processing`, imageProcessingContext);
new imageProcessing.DeploymentPipelineStack(app, `${namespace}-image-processing-deployment`, {
  oauthTokenPath,
  owner,
  contact,
  namespace,
  ...imageProcessingContext,
});
app.node.applyAspect(new StackTags());