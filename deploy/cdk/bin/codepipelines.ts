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

export const instantiateStacks = (app: App, namespace: string, contextEnv: ContextEnv, testStacks: any, prodStacks: any): void => {

  // Get context keys that are required by all stacks
  const owner = getRequiredContext(app.node, 'owner')
  const contact = getRequiredContext(app.node, 'contact')
  const oauthTokenPath = app.node.tryGetContext('oauthTokenPath')
  const projectName = getRequiredContext(app.node, 'projectName')
  const description = getRequiredContext(app.node, 'description')

  // // The environment objects defined in our context are a mixture of properties.
  // // Need to decompose these into a cdk env object and other required stack props
  const { env, createDns, slackNotifyStackName } = contextEnv

  const staticHostContext = getContextByNamespace('staticHost')
  const siteInstances = [
    'website', // Main marble site
    'redbox',
  ]
  siteInstances.map(instanceName => {
    new staticHost.DeploymentPipelineStack(app, `${namespace}-${instanceName}-deployment`, {
      oauthTokenPath,
      owner,
      contact,
      projectName,
      description,
      slackNotifyStackName,
      instanceName,
      contextEnvName: contextEnv.name,
      env,
      createDns,
      namespace,
      testFoundationStack: testStacks.foundationStack,
      prodFoundationStack: prodStacks.foundationStack,
      ...staticHostContext,
    })
  })

  const imageServiceContext = getContextByNamespace('iiifImageService')
  const imageServicePipeline = new IIIF.DeploymentPipelineStack(app, `${namespace}-image-service-deployment`, {
    env,
    contextEnvName: contextEnv.name,
    owner,
    contact,
    createDns,
    oauthTokenPath,
    namespace,
    testFoundationStack: testStacks.foundationStack,
    prodFoundationStack: prodStacks.foundationStack,
    slackNotifyStackName,
    ...imageServiceContext,
  })

  const userContentContext = getContextByNamespace('userContent')
  new userContent.DeploymentPipelineStack(app, `${namespace}-user-content-deployment`, {
    contextEnvName: contextEnv.name,
    oauthTokenPath,
    owner,
    contact,
    slackNotifyStackName,
    env,
    createDns,
    namespace,
    testFoundationStack: testStacks.foundationStack,
    prodFoundationStack: prodStacks.foundationStack,
    ...userContentContext,
  })

  const imageProcessingContext = getContextByNamespace('imageProcessing')
  new imageProcessing.DeploymentPipelineStack(app, `${namespace}-image-processing-deployment`, {
    contextEnvName: contextEnv.name,
    oauthTokenPath,
    owner,
    contact,
    namespace,
    env,
    ...imageProcessingContext,
  })

  const elasticsearchContext = getContextByNamespace('elasticsearch')
  new elasticsearch.DeploymentPipelineStack(app, `${namespace}-elastic-deployment`, {
    env,
    contextEnvName: contextEnv.name,
    namespace,
    oauthTokenPath,
    owner,
    contact,
    ...elasticsearchContext,
  })

  const manifestPipelineContext = getContextByNamespace('manifestPipeline')
  new manifestPipeline.DeploymentPipelineStack(app, `${namespace}-manifest-deployment`, {
    contextEnvName: contextEnv.name,
    oauthTokenPath,
    owner,
    contact,
    namespace,
    slackNotifyStackName,
    ...manifestPipelineContext,
  })
}