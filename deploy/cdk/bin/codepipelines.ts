#!/usr/bin/env node
import { App } from '@aws-cdk/core'
import { StackTags } from '@ndlib/ndlib-cdk'
import 'source-map-support/register'
import { FoundationStack } from '../lib/foundation'
import IIIF = require('../lib/iiif-serverless')
import userContent = require('../lib/user-content')
import imageProcessing = require('../lib/image-processing')
import staticHost = require('../lib/static-host')
import { getRequiredContext, getContextByNamespace } from '../lib/context-helpers'
import { Environment } from '@aws-cdk/cx-api'

export const instantiateStacks = (app: App, namespace: string, env: Environment, contextEnv: any, envName: string): void => {

  // Get context keys that are required by all stacks
  const owner = getRequiredContext(app.node, 'owner')
  const contact = getRequiredContext(app.node, 'contact')

  // // The environment objects defined in our context are a mixture of properties.
  // // Need to decompose these into a cdk env object and other required stack props
  const { useVpcId, domainName, createDns, useExistingDnsZone, slackNotifyStackName } = contextEnv

  const oauthTokenPath = app.node.tryGetContext('oauthTokenPath')
  const projectName = getRequiredContext(app.node, 'projectName')
  const description = getRequiredContext(app.node, 'description')

  // Pipelines will expect there to be a test and prod foundation stack to build the services on
  const testFoundationStack = new FoundationStack(app, `${namespace}-test-foundation`, {
    env,
    domainName,
    useExistingDnsZone,
    useVpcId,
  })
  const prodFoundationStack = new FoundationStack(app, `${namespace}-prod-foundation`, {
    env,
    domainName,
    useExistingDnsZone,
    useVpcId,
  })

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
      contextEnvName: envName,
      env,
      createDns,
      namespace,
      foundationStack: testFoundationStack,
      ...staticHostContext,
    })
  })

  const imageServiceContext = getContextByNamespace('iiifImageService')
  new IIIF.DeploymentPipelineStack(app, `${namespace}-image-service-deployment`, {
    contextEnvName: envName,
    owner,
    contact,
    createDns,
    oauthTokenPath,
    namespace,
    testFoundationStack,
    prodFoundationStack,
    slackNotifyStackName,
    ...imageServiceContext,
  })

  const userContentContext = getContextByNamespace('userContent')
  new userContent.DeploymentPipelineStack(app, `${namespace}-user-content-deployment`, {
    contextEnvName: envName,
    oauthTokenPath,
    owner,
    contact,
    slackNotifyStackName,
    env,
    createDns,
    namespace,
    foundationStack: testFoundationStack,
    ...userContentContext,
  })

  const imageProcessingContext = getContextByNamespace('imageProcessing')
  new imageProcessing.DeploymentPipelineStack(app, `${namespace}-image-processing-deployment`, {
    contextEnvName: envName,
    oauthTokenPath,
    owner,
    contact,
    namespace,
    env,
    ...imageProcessingContext,
  })
}