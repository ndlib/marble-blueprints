#!/usr/bin/env node
import { App, Environment } from '@aws-cdk/core'
import 'source-map-support/register'
import { FoundationStack } from '../lib/foundation'
import IIIF = require('../lib/iiif-serverless')
import userContent = require('../lib/user-content')
import imageProcessing = require('../lib/image-processing')
import elasticsearch = require('../lib/elasticsearch')
import staticHost = require('../lib/static-host')
import manifestPipeline = require('../lib/manifest-pipeline')
import { getContextByNamespace } from '../lib/context-helpers'

// TODO: use better typing for the env params
export const instantiateStacks = (app: App, namespace: string, env: Environment, contextEnv: any, envName: string): void => {
  
  // The environment objects defined in our context are a mixture of properties.
  // Need to decompose these into a cdk env object and other required stack props
  const { useVpcId, domainName, createDns, useExistingDnsZone, rBSCS3ImageBucketName, createEventRules } = contextEnv

  const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
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
    new staticHost.StaticHostStack(app, `${namespace}-${instanceName}`, {
      contextEnvName: envName,
      env,
      foundationStack,
      createDns,
      namespace,
      ...staticHostContext,
    })
  })

  const imageServiceContext = getContextByNamespace('iiifImageService')
  new IIIF.IiifServerlessStack(app, `${namespace}-image-service`, {
    env,
    foundationStack,
    createDns,
    ...imageServiceContext,
  })

  const userContentContext = getContextByNamespace('userContent')
  new userContent.UserContentStack(app, `${namespace}-user-content`, {
    env,
    foundationStack,
    createDns,
    namespace,
    ...userContentContext,
  })

  const imageProcessingContext = getContextByNamespace('imageProcessing')
  new imageProcessing.ImagesStack(app, `${namespace}-image-processing`, {
    env,
    foundationStack,
    ...imageProcessingContext,
  })

  const elasticsearchContext = getContextByNamespace('elasticsearch')
  new elasticsearch.ElasticStack(app, `${namespace}-elastic`, {
    env,
    contextEnvName: envName,
    namespace,
    foundationStack,
    ...elasticsearchContext,
  })


  const manifestPipelineContext = getContextByNamespace('manifestPipeline')
  new manifestPipeline.ManifestPipelineStack(app, `${namespace}-manifest`, {
    env,
    domainName,
    foundationStack,
    createDns,
    sentryDsn: app.node.tryGetContext('sentryDsn'),
    rBSCS3ImageBucketName,
    createEventRules,
    appConfigPath: `/all/${namespace}-manifest`,
    ...manifestPipelineContext,
  })
}
