#!/usr/bin/env node
import { App } from '@aws-cdk/core';
import { StackTags } from '@ndlib/ndlib-cdk';
import 'source-map-support/register';
import IIIF = require('../lib/iiif-serverless');

const app = new App();
const imageServiceContext = app.node.tryGetContext('iiifImageService');
new IIIF.DeploymentPipelineStack(app, 'marble-iiif-serverless-deployment', { ...imageServiceContext });

app.node.applyAspect(new StackTags());