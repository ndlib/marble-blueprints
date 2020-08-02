#!/usr/bin/env node
import { App } from '@aws-cdk/core';
import { StackTags } from '@ndlib/ndlib-cdk';
import 'source-map-support/register';
import IIIF = require('../lib/iiif-serverless');
import userContent = require('../lib/user-content');
import imageProcessing = require('../lib/image-processing');

const app = new App();

const exclusiveStack: string = app.node.tryGetContext('exclusiveStack');
const createDns : boolean = app.node.tryGetContext('createDns') === 'true' ? true : false;
const domainStackName = app.node.tryGetContext('domainStackName');
const oauthTokenPath = app.node.tryGetContext('oauthTokenPath');
const namespace = app.node.tryGetContext('namespace');
const owner = app.node.tryGetContext('owner');
const contact = app.node.tryGetContext('contact');
const slackNotifyStackName = app.node.tryGetContext('slackNotifyStackName'); // Notifier for CD pipeline approvals

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
  domainStackName,
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

/* 
This cdk bug prevents us from deploying a single stack in a multistack app.
To work around this we introduce the 'exclusiveStack' flag.
This flag allows the user to specify which stack to deploy.
See user-content readme for deployment example.
https://github.com/aws/aws-cdk/issues/6743
*/
if (exclusiveStack === undefined) {
  console.log("You must specify a stackname to deploy\n-c exclusiveStack=<stackname>")
}
else if (exclusiveStack.endsWith('image-service-deployment')) {
  new IIIF.DeploymentPipelineStack(app, `${namespace}-image-service-deployment`, {
    createDns,
    domainStackName,
    oauthTokenPath,
    namespace,
    ...imageServiceContext
  });
}
else if (exclusiveStack.endsWith('-user-content')) {
  new userContent.UserContentStack(app, `${namespace}-user-content`, userContentContext);
}
else if (exclusiveStack.endsWith('-user-content-deployment')) {
  new userContent.DeploymentPipelineStack(app, `${namespace}-user-content-deployment`, {
    oauthTokenPath,
    owner,
    contact,
    slackNotifyStackName,
    ...userContentContext,
  });
}
else if (exclusiveStack.endsWith('-image')) {
  new imageProcessing.ImagesStack(app, `${namespace}-image`, {
    ...imageProcessingContext
  });
}
else if (exclusiveStack.endsWith('-image-deployment')) {
  new imageProcessing.DeploymentPipelineStack(app, `${namespace}-image-deployment`, {
    oauthTokenPath,
    namespace,
    owner,
    contact,
    ...imageProcessingContext,
  });
}
else {
  console.log(`Unrecognized stack - ${exclusiveStack}`)
}

app.node.applyAspect(new StackTags());
