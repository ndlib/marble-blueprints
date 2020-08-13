#!/usr/bin/env node
import { App, ConstructNode } from '@aws-cdk/core';
import { StackTags } from '@ndlib/ndlib-cdk';
import 'source-map-support/register';
import { FoundationStack } from '../lib/foundation';
import IIIF = require('../lib/iiif-serverless');
import userContent = require('../lib/user-content');
import imageProcessing = require('../lib/image-processing');

const app = new App();

const getRequiredContext = (key: string) => {
  const value = app.node.tryGetContext(key);
  if(value === undefined || value === null)
    throw new Error(`Context key '${key}' is required.`);
  return value;
}

// Get context keys that are required by all stacks
const owner = getRequiredContext('owner');
const contact = getRequiredContext('contact');
const namespace = getRequiredContext('namespace');
const envName = getRequiredContext('env');
const contextEnv = getRequiredContext('environments')[envName];
if(contextEnv === undefined || contextEnv === null)
  throw new Error(`Context key 'environments.${envName}' is required.`);

// The environment objects defined in our context are a mixture of properties.
// Need to decompose these into a cdk env object and other required stack props
const env = { account: contextEnv.account, region: contextEnv.region, name: envName };
const { useVpcId, domainName, createDns, useExistingDnsZone, slackNotifyStackName } = contextEnv;

const oauthTokenPath = app.node.tryGetContext('oauthTokenPath');

const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
  env,
  domainName,
  useExistingDnsZone,
  useVpcId,
});

const imageServiceContext = getRequiredContext('iiifImageService');
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
  contextEnvName: envName,
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
  contextEnvName: envName,
  oauthTokenPath,
  owner,
  contact,
  namespace,
  ...imageProcessingContext,
});
app.node.applyAspect(new StackTags());