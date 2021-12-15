#!/usr/bin/env node
import { App } from '@aws-cdk/core'
import 'source-map-support/register'
import IIIF = require('../lib/iiif-serverless')
import userContent = require('../lib/user-content')
import imageProcessing = require('../lib/image-processing')
import staticHost = require('../lib/static-host')
import elasticsearch = require('../lib/elasticsearch')
import manifestPipeline = require('../lib/manifest-pipeline')
import { getRequiredContext, getContextByNamespace } from '../lib/context-helpers'
import { ContextEnv } from '../lib/context-env'
import { Stacks } from '../lib/types'
import { PipelineFoundationStack } from '../lib/foundation'
import maintainMetadata = require('../lib/maintain-metadata')
import manifestLambda = require('../lib/manifest-lambda')
import multimediaAssets = require('../lib/multimedia-assets')

export const instantiateStacks = (app: App, namespace: string, contextEnv: ContextEnv, testStacks: Stacks, prodStacks: Stacks): void => {
  const pipelineFoundationStack = new PipelineFoundationStack(app, `${namespace}-deployment-foundation`, {
    env: contextEnv.env,
  })

  // Construct common props that are required by all pipeline stacks
  const commonProps = {
    namespace,
    pipelineFoundationStack,
    testFoundationStack: testStacks.foundationStack,
    prodFoundationStack: prodStacks.foundationStack,
    env: contextEnv.env,
    contextEnvName: contextEnv.name,
    createDns: contextEnv.createDns,
    slackNotifyStackName: contextEnv.slackNotifyStackName,
    notificationReceivers: contextEnv.notificationReceivers,
    createGithubWebhooks: contextEnv.createGithubWebhooks,
    owner: getRequiredContext(app.node, 'owner'),
    contact: getRequiredContext(app.node, 'contact'),
    oauthTokenPath: getRequiredContext(app.node, 'oauthTokenPath'),
    projectName: getRequiredContext(app.node, 'projectName'),
    description: getRequiredContext(app.node, 'description'),
    infraRepoOwner: getRequiredContext(app.node, 'infraRepoOwner'),
    infraRepoName: getRequiredContext(app.node, 'infraRepoName'),
    infraSourceBranch: getRequiredContext(app.node, 'infraSourceBranch'),
  }

  const staticHostContext = getContextByNamespace('staticHost')
  const siteInstances = [
    'website', // Main marble site
    'redbox',
    'inquisitions',
    //'seaside',
    'viewer',
  ]
  siteInstances.map(instanceName => {
    const instanceContext = getContextByNamespace(instanceName)
    new staticHost.DeploymentPipelineStack(app, `${namespace}-${instanceName}-deployment`, {
      instanceName,
      testElasticStack: testStacks.elasticSearchStack,
      prodElasticStack: prodStacks.elasticSearchStack,
      testMaintainMetadataStack: testStacks.maintainMetadataStack,
      prodMaintainMetadataStack: prodStacks.maintainMetadataStack,
      testManifestLambdaStack: testStacks.manifestLambdaStack,
      prodManifestLambdaStack: prodStacks.manifestLambdaStack,
      ...commonProps,
      ...staticHostContext,
      ...instanceContext,
    })
  })

  const imageServiceContext = getContextByNamespace('iiifImageService')
  new IIIF.DeploymentPipelineStack(app, `${namespace}-image-service-deployment`, {
    ...commonProps,
    ...imageServiceContext,
  })

  const userContentContext = getContextByNamespace('userContent')
  new userContent.DeploymentPipelineStack(app, `${namespace}-user-content-deployment`, {
    ...commonProps,
    ...userContentContext,
  })

  const imageProcessingContext = getContextByNamespace('imageProcessing')
  new imageProcessing.DeploymentPipelineStack(app, `${namespace}-image-processing-deployment`, {
    ...commonProps,
    ...imageProcessingContext,
  })

  const elasticsearchContext = getContextByNamespace('elasticsearch')
  new elasticsearch.DeploymentPipelineStack(app, `${namespace}-elastic-deployment`, {
    ...commonProps,
    ...elasticsearchContext,
  })

  const manifestPipelineContext = getContextByNamespace('manifestPipeline')
  new manifestPipeline.DeploymentPipelineStack(app, `${namespace}-manifest-deployment`, {
    ...commonProps,
    ...manifestPipelineContext,
  })

  const maintainMetadataContext = getContextByNamespace('maintainMetadata')
  new maintainMetadata.DeploymentPipelineStack(app, `${namespace}-maintain-metadata-deployment`, {
    ...commonProps,
    ...maintainMetadataContext,
  })

  const manifestLambdaContext = getContextByNamespace('manifestLambda')
  new manifestLambda.DeploymentPipelineStack(app, `${namespace}-manifest-lambda-deployment`, {
    ...commonProps,
    ...manifestLambdaContext,
  })

  const multimediaAssetsContext = getContextByNamespace('multimediaAssets')
  new multimediaAssets.DeploymentPipelineStack(app, `${namespace}-multimedia-assets-deployment`, {
    ...commonProps,
    ...multimediaAssetsContext,
  })

}
