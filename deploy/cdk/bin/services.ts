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
import maintainMetadata = require('../lib/maintain-metadata')
import multimediaAssets = require('../lib/multimedia-assets')
import manifestLambda = require('../lib/manifest-lambda')
import { getContextByNamespace } from '../lib/context-helpers'
import { ContextEnv } from '../lib/context-env'
import { Stacks } from '../lib/types'
import { ServiceLevelsStack } from '../lib/service-levels/service-levels-stack'

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

  const inquisitionsContext = getContextByNamespace('inquisitions')
  const inquisitions = new staticHost.StaticHostStack(app, `${namespace}-inquisitions`, {
    foundationStack,
    ...commonProps,
    ...inquisitionsContext,
  })

  const viewerContext = getContextByNamespace('viewer')
  const viewer = new staticHost.StaticHostStack(app, `${namespace}-viewer`, {
    foundationStack,
    ...commonProps,
    ...viewerContext,
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

  const elasticsearchContext = getContextByNamespace('elasticsearch')
  const elasticSearchStack = new elasticsearch.ElasticStack(app, `${namespace}-elastic`, {
    foundationStack,
    ...commonProps,
    ...elasticsearchContext,
  })

  const multimediaAssetsContext = getContextByNamespace('multimediaAssets')
  const multimediaAssetsStack = new multimediaAssets.MultimediaAssetsStack(app, `${namespace}-multimedia-assets`, {
    foundationStack,
    marbleContentBucketName: contextEnv.marbleContentBucketName,
    ...commonProps,
    ...multimediaAssetsContext,
  })

  const manifestPipelineContext = getContextByNamespace('manifestPipeline')
  const manifestPipelineStack = new manifestPipeline.ManifestPipelineStack(app, `${namespace}-manifest`, {
    foundationStack,
    sentryDsn: app.node.tryGetContext('sentryDsn'),
    createEventRules: app.node.tryGetContext('manifestPipeline:createEventRules') === "true" ? true : false,
    appConfigPath: app.node.tryGetContext('manifestPipeline:appConfigPath') ? app.node.tryGetContext('manifestPipeline:appConfigPath') : `/all/stacks/${namespace}-manifest`,
    rBSCS3ImageBucketName: contextEnv.rBSCS3ImageBucketName,
    marbleContentBucketName: contextEnv.marbleContentBucketName,
    multimediaBucket: multimediaAssetsStack.multimediaBucket,
    marbleContentFileShareId: contextEnv.marbleContentFileShareId,
    ...commonProps,
    ...manifestPipelineContext,
  })

  const maintainMetadataContext = getContextByNamespace('maintainMetadata')
  const maintainMetadataStack = new maintainMetadata.MaintainMetadataStack(app, `${namespace}-maintain-metadata`, {
    foundationStack,
    manifestPipelineStack,
    ...commonProps,
    ...maintainMetadataContext,
  })

  const imageProcessingContext = getContextByNamespace('imageProcessing')
  const imageProcessingStack = new imageProcessing.ImagesStack(app, `${namespace}-image-processing`, {
    foundationStack,
    rbscBucketName: contextEnv.rBSCS3ImageBucketName,
    marbleContentBucketName: contextEnv.marbleContentBucketName,
    manifestPipelineStack,
    maintainMetadataStack,
    ...commonProps,
    ...imageProcessingContext,
  })

  const manifestLambdaContext = getContextByNamespace('manifestLambda')
  const manifestLambdaStack = new manifestLambda.ManifestLambdaStack(app, `${namespace}-manifest-lambda`, {
    foundationStack,
    maintainMetadataStack,
    ...commonProps,
    ...manifestLambdaContext,
  })

  const services = {
    foundationStack,
    website,
    redbox,
    inquisitions,
    viewer,
    iiifServerlessStack,
    userContentStack,
    imageProcessingStack,
    elasticSearchStack,
    manifestPipelineStack,
    maintainMetadataStack,
    multimediaAssetsStack,
    manifestLambdaStack,
  }

  const slos = [
    {
      title: "Marble - Unified Website CDN",
      type: "CloudfrontAvailability",
      distributionId: website.cloudfront.distributionId,
      sloThreshold: 0.999,
    },
    {
      title: "Marble - Unified Website CDN",
      type: "CloudfrontLatency",
      distributionId: website.cloudfront.distributionId,
      sloThreshold: 0.95,
      latencyThreshold: 1000,
    },
    {
      title: "Marble - IIIF Image Service API",
      type: "ApiAvailability",
      apiName: iiifServerlessStack.apiStack.apiName,
      sloThreshold: 0.97,
    },
    {
      title: "Marble - IIIF Image Service API",
      type: "ApiLatency",
      apiName: iiifServerlessStack.apiStack.apiName,
      sloThreshold: 0.95,
      latencyThreshold: 3000,
      alarmsEnabled: {
        High: true,
        Low: false,
      },
    },
    {
      title: "Marble - IIIF Manifest API",
      type: "ApiAvailability",
      apiName: manifestLambdaStack.apiName,
      sloThreshold: 0.999,
    },
    {
      title: "Marble - IIIF Manifest API",
      type: "ApiLatency",
      apiName: manifestLambdaStack.apiName,
      sloThreshold: 0.95,
      latencyThreshold: 3000,
    },
    {
      title: "Marble - Maintain Metadata API",
      type: "AppSyncAvailability",
      apiId: maintainMetadataStack.apiId,
      sloThreshold: 0.9995,
    },
    {
      title: "Marble - Maintain Metadata API",
      type: "AppSyncLatency",
      apiId: maintainMetadataStack.apiId,
      sloThreshold: 0.95,
      latencyThreshold: 500,
    },
    {
      title: "Marble - Search API",
      type: "ElasticSearchAvailability",
      accountId: contextEnv.env.account,
      domainName: elasticSearchStack.domainName,
      sloThreshold: 0.99,
    },
    {
      title: "Marble - Search API",
      type: "ElasticSearchLatency",
      accountId: contextEnv.env.account,
      domainName: elasticSearchStack.domainName,
      sloThreshold: 0.95,
      latencyThreshold: 200,
    },
    {
      title: "Marble - Search API",
      type: "ElasticSearchLatency",
      accountId: contextEnv.env.account,
      domainName: elasticSearchStack.domainName,
      sloThreshold: 0.99,
      latencyThreshold: 1000,
    },
    {
      title: "Marble - IIIF Viewer CDN",
      type: "CloudfrontAvailability",
      distributionId: viewer.cloudfront.distributionId,
      sloThreshold: 0.999,
    },
    {
      title: "Marble - IIIF Viewer CDN",
      type: "CloudfrontLatency",
      distributionId: viewer.cloudfront.distributionId,
      sloThreshold: 0.95,
      latencyThreshold: 750,
    },
  ]

  const sloContext = getContextByNamespace('slos')
  new ServiceLevelsStack(app, `${namespace}-service-levels`, {
    slos,
    emailSubscriber: contextEnv.alarmsEmail,
    ...sloContext,
    ...commonProps,
  })
  return services
}
