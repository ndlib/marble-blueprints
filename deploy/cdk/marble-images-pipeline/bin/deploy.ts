#!/usr/bin/env node
import { Bucket }from '@aws-cdk/aws-s3';
import cdk = require('@aws-cdk/core')
import { StackTags } from '@ndlib/ndlib-cdk'
import { execSync } from 'child_process'
import fs = require('fs')
import 'source-map-support/register'
import MarbleImagesPipelineStack from '../src/marble-images-pipeline-stack'
import MarbleImagesStack from '../src/marble-images-stack'
import path = require('path')

// The context values here are defaults only. Passing context in cli will override these
// Normally, you want to set constant defaults in cdk.json, but these are dynamic based on the executing user.
const app = new cdk.App({
  context: {
    owner: execSync('id -un')
      .toString()
      .trim(),
    contact:
      execSync('id -un')
        .toString()
        .trim() + '@nd.edu',
  },
})
app.node.applyAspect(new StackTags())

const stage = app.node.tryGetContext('stage') || 'test'
const envSettings = app.node.tryGetContext('envSettings')
let lambdaCodePath = app.node.tryGetContext('lambdaCodePath')
if (!lambdaCodePath) {
    const relativePath = '../../marble-images/src'
    lambdaCodePath = path.join(__dirname, relativePath)
}
if(!fs.existsSync(lambdaCodePath)) {
  lambdaCodePath = undefined
  console.error("Unable to locate lambda code")
}
let dockerfilePath = app.node.tryGetContext('dockerfilePath')
if (!dockerfilePath) {
  const relativePath = '../../marble-images/docker'
  dockerfilePath = path.join(__dirname, relativePath)
}
if(!fs.existsSync(dockerfilePath)) {
  dockerfilePath = undefined
  console.error("Unable to locate Dockerfile")
}

if (lambdaCodePath && dockerfilePath) {
  console.log("Creating marble image stack")
  new MarbleImagesStack(app, 'MarbleImagesStack', {
    stackName: app.node.tryGetContext('serviceStackName') || `marbleImages-${stage}`,
    stage,
    lambdaCodePath,
    dockerfilePath,
    envSettings
  })
} else {
  console.log("Creating marble pipeline stack")
  new MarbleImagesPipelineStack(app, 'PipelineStack', {
    stackName: app.node.tryGetContext('pipelineStackName') || `marbleImages-pipeline`,
    gitOwner: app.node.tryGetContext('gitOwner'),
    gitTokenPath: app.node.tryGetContext('gitTokenPath'),
    marbleImagesRepository: app.node.tryGetContext('marbleImagesRepository'),
    marbleImagesBranch: app.node.tryGetContext('marbleImagesBranch'),
    blueprintsRepository: app.node.tryGetContext('blueprintsRepository'),
    blueprintsBranch: app.node.tryGetContext('blueprintsBranch'),
    contact: app.node.tryGetContext('contact'),
    owner: app.node.tryGetContext('owner'),
    envSettings
  })
}
