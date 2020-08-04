#!/usr/bin/env node
import { App } from '@aws-cdk/core';
import { StackTags } from '@ndlib/ndlib-cdk';
import 'source-map-support/register';
import { FoundationStack } from '../lib/foundation';
import IIIF = require('../lib/iiif-serverless');
import userContent = require('../lib/user-content');
import imageProcessing = require('../lib/image-processing');

const app = new App();

const createDns : boolean = app.node.tryGetContext('createDns') === 'true' ? true : false;
const domainName = app.node.tryGetContext('domainName');
const oauthTokenPath = app.node.tryGetContext('oauthTokenPath');
const namespace = app.node.tryGetContext('namespace');
const owner = app.node.tryGetContext('owner');
const contact = app.node.tryGetContext('contact');
const slackNotifyStackName = app.node.tryGetContext('slackNotifyStackName'); // Notifier for CD pipeline approvals

const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
  domainName,
  doCreateZone: createDns,
});

const imageServiceContext = app.node.tryGetContext('iiifImageService');
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
  foundationStack,
  createDns,
  namespace,
};
const imageProcessingContext = {
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
}
new IIIF.DeploymentPipelineStack(app, `${namespace}-image-service-deployment`, {
  createDns,
  domainStackName: `${namespace}-domain`,
  oauthTokenPath,
  namespace,
  foundationStack,
  ...imageServiceContext
});
new userContent.UserContentStack(app, `${namespace}-user-content`, userContentContext);
new userContent.DeploymentPipelineStack(app, `${namespace}-user-content-deployment`, {
    oauthTokenPath,
    owner,
    contact,
    slackNotifyStackName,
    ...userContentContext,
});
new imageProcessing.ImagesStack(app, `${namespace}-image`, {...imageProcessingContext });
new imageProcessing.DeploymentPipelineStack(app, `${namespace}-image-deployment`, {
  oauthTokenPath,
  owner,
  contact,
  namespace,
  ...imageProcessingContext,
});
app.node.applyAspect(new StackTags());