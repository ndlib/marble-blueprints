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
import { Stacks } from '../lib/types'

export const instantiateStacks = (app: App, namespace: string, contextEnv: ContextEnv): Stacks => {
  // Construct common props that are required by all service stacks
  const commonProps = {
    namespace,
    env: contextEnv.env,
    contextEnvName: contextEnv.name,
    createDns: contextEnv.createDns,
    domainName: contextEnv.domainName,
  }

  const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
    useVpcId: contextEnv.useVpcId,
    useExistingDnsZone: contextEnv.useExistingDnsZone,
    ...commonProps,
  })

  const websiteContext = getContextByNamespace('website')
  const website = new staticHost.StaticHostStack(app, `${namespace}-website`, {
    foundationStack,
    ...commonProps,
    ...websiteContext,
  })

  const redboxContext = getContextByNamespace('redbox')
  const redbox = new staticHost.StaticHostStack(app, `${namespace}-redbox`, {
    foundationStack,
    ...commonProps,
    ...redboxContext,
  })

  const imageServiceContext = getContextByNamespace('iiifImageService')
  const iiifServerlessStack = new IIIF.IiifServerlessStack(app, `${namespace}-image-service`, {
    foundationStack,
    ...commonProps,
    ...imageServiceContext,
  })

  const userContentContext = getContextByNamespace('userContent')
  const userContentStack = new userContent.UserContentStack(app, `${namespace}-user-content`, {
    foundationStack,
    ...commonProps,
    ...userContentContext,
  })

  const imageProcessingContext = getContextByNamespace('imageProcessing')
  const imageProcessingStack = new imageProcessing.ImagesStack(app, `${namespace}-image-processing`, {
    foundationStack,
    ...commonProps,
    ...imageProcessingContext,
  })

  const elasticsearchContext = getContextByNamespace('elasticsearch')
  const elasticSearchStack = new elasticsearch.ElasticStack(app, `${namespace}-elastic`, {
    foundationStack,
    ...commonProps,
    ...elasticsearchContext,
  })


  const manifestPipelineContext = getContextByNamespace('manifestPipeline')
  const manifestPipelineStack = new manifestPipeline.ManifestPipelineStack(app, `${namespace}-manifest`, {
    foundationStack,
    sentryDsn: app.node.tryGetContext('sentryDsn'),
    createEventRules: app.node.tryGetContext('manifestPipeline:createEventRules') === "true" ? true : false,
    appConfigPath: app.node.tryGetContext('manifestPipeline:appConfigPath') ? app.node.tryGetContext('manifestPipeline:appConfigPath') : `/all/stacks/${namespace}-manifest`,
    rBSCS3ImageBucketName: contextEnv.rBSCS3ImageBucketName,
    ...commonProps,
    ...manifestPipelineContext,
  })

  return {
    foundationStack,
    website,
    redbox,
    iiifServerlessStack,
    userContentStack,
    imageProcessingStack,
    elasticSearchStack,
    manifestPipelineStack,
  }
}
