#!/usr/bin/env node
import { App } from '@aws-cdk/core'
import 'source-map-support/register'
import { FoundationStack } from '../lib/foundation'
import IIIF = require('../lib/iiif-serverless')
import userContent = require('../lib/user-content')
import imageProcessing = require('../lib/image-processing')
import elasticsearch = require('../lib/elasticsearch')
import staticHost = require('../lib/static-host')
import manifestPipeline = require('../lib/manifest-pipeline')
import { getContextByNamespace } from '../lib/context-helpers'
import { ContextEnv } from '../lib/context-env'


export const instantiateStacks = (app: App, namespace: string, contextEnv: ContextEnv): any => {
  // The environment objects defined in our context are a mixture of properties.
  // Need to decompose these into a cdk env object and other required stack props
  const { env, useVpcId, domainName, createDns, useExistingDnsZone, rBSCS3ImageBucketName } = contextEnv

  const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
    env,
    domainName,
    useExistingDnsZone,
    useVpcId,
  })

  // TODO: Change this to use unique context namespaces
  const staticHostContext = getContextByNamespace('staticHost')
  const siteInstances = [
    'website', // Main marble site
    'redbox',
  ]
  const siteStacks = siteInstances.map(instanceName => {
    new staticHost.StaticHostStack(app, `${namespace}-${instanceName}`, {
      contextEnvName: contextEnv.name,
      env,
      foundationStack,
      createDns,
      namespace,
      ...staticHostContext,
    })
  })

  const imageServiceContext = getContextByNamespace('iiifImageService')
  const iiifServerlessStack = new IIIF.IiifServerlessStack(app, `${namespace}-image-service`, {
    env,
    foundationStack,
    createDns,
    ...imageServiceContext,
  })

  const userContentContext = getContextByNamespace('userContent')
  const userContentStack = new userContent.UserContentStack(app, `${namespace}-user-content`, {
    env,
    foundationStack,
    createDns,
    namespace,
    ...userContentContext,
  })

  const imageProcessingContext = getContextByNamespace('imageProcessing')
  const imageProcessingStack = new imageProcessing.ImagesStack(app, `${namespace}-image-processing`, {
    env,
    foundationStack,
    ...imageProcessingContext,
  })

  const elasticsearchContext = getContextByNamespace('elasticsearch')
  const elasticSearchStack = new elasticsearch.ElasticStack(app, `${namespace}-elastic`, {
    env,
    contextEnvName: contextEnv.name,
    namespace,
    foundationStack,
    ...elasticsearchContext,
  })


  const manifestPipelineContext = getContextByNamespace('manifestPipeline')
  const manifestPipelineStack = new manifestPipeline.ManifestPipelineStack(app, `${namespace}-manifest`, {
    env,
    domainName,
    foundationStack,
    createDns,
    sentryDsn: app.node.tryGetContext('sentryDsn'),
    rBSCS3ImageBucketName,
    createEventRules: app.node.tryGetContext('manifestPipeline:createEventRules') === "true" ? true : false,
    appConfigPath: app.node.tryGetContext('manifestPipeline:appConfigPath') ? app.node.tryGetContext('manifestPipeline:appConfigPath') : `/all/stacks/${namespace}-manifest`,
    ...manifestPipelineContext,
  })

  return {
    foundationStack,
    siteStacks,
    iiifServerlessStack,
    userContentStack,
    imageProcessingStack,
    elasticSearchStack,
    manifestPipelineStack,
  }
}
