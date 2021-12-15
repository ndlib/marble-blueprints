#!/usr/bin/env node
import { App } from '@aws-cdk/core'
import 'source-map-support/register'
import { FoundationStack } from '../lib/foundation'
import IIIF = require('../lib/iiif-serverless')
import imageProcessing = require('../lib/image-processing')
import elasticsearch = require('../lib/elasticsearch')
import opensearch = require('../lib/opensearch')
import staticHost = require('../lib/static-host')
import manifestPipeline = require('../lib/manifest-pipeline')
import maintainMetadata = require('../lib/maintain-metadata')
import multimediaAssets = require('../lib/multimedia-assets')
import manifestLambda = require('../lib/manifest-lambda')
import { getContextByNamespace, mapContextToProps, TypeHint } from '../lib/context-helpers'
import { ContextEnv } from '../lib/context-env'
import { ServiceStacks } from '../lib/types'
import { ServiceLevelsStack } from '../lib/monitoring/service-levels-stack'
import { IStaticHostStackProps } from '../lib/static-host'
import { BackupStack } from '../lib/backup/backup-stack'
import { Bucket } from '@aws-cdk/aws-s3'
import { DashboardsStack } from '../lib/monitoring/dashboards-stack'

export const instantiateStacks = (app: App, namespace: string, contextEnv: ContextEnv): ServiceStacks => {
  const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
    useVpcId: contextEnv.useVpcId,
    useExistingDnsZone: contextEnv.useExistingDnsZone,
    env: contextEnv.env,
    domainName: contextEnv.domainName,
  })

  // Construct common props that are required by all service stacks
  const commonProps = {
    foundationStack,
    namespace,
    env: contextEnv.env,
    contextEnvName: contextEnv.name,
    createDns: contextEnv.createDns,
    domainName: contextEnv.domainName,
  }

  const staticHostTypeHints : TypeHint = { additionalAliases: 'csv' }
  const websiteProps = mapContextToProps<IStaticHostStackProps>('website', commonProps, staticHostTypeHints)
  const website = new staticHost.StaticHostStack(app, `${namespace}-website`, websiteProps)

  const redboxProps = mapContextToProps<IStaticHostStackProps>('redbox', commonProps, staticHostTypeHints)
  const redbox = new staticHost.StaticHostStack(app, `${namespace}-redbox`, redboxProps)
  
  const seasideProps = mapContextToProps<IStaticHostStackProps>('seaside', commonProps, staticHostTypeHints)
  const seaside = new staticHost.StaticHostStack(app, `${namespace}-seaside`, seasideProps)

  const inquisitionsProps = mapContextToProps<IStaticHostStackProps>('inquisitions', commonProps, staticHostTypeHints)
  const inquisitions = new staticHost.StaticHostStack(app, `${namespace}-inquisitions`, inquisitionsProps)

  const viewerProps: IStaticHostStackProps = mapContextToProps<IStaticHostStackProps>('viewer', commonProps, staticHostTypeHints)
  const viewer = new staticHost.StaticHostStack(app, `${namespace}-viewer`, viewerProps)

  const imageServiceProps = mapContextToProps<IIIF.IIiifServerlessStackProps>('iiifImageService', commonProps)
  const iiifServerlessStack = new IIIF.IiifServerlessStack(app, `${namespace}-image-service`, imageServiceProps)

  const elasticsearchProps = mapContextToProps<elasticsearch.ElasticStackProps>('elasticsearch', commonProps)
  const elasticSearchStack = new elasticsearch.ElasticStack(app, `${namespace}-elastic`, elasticsearchProps)

  const openSearchProps = mapContextToProps<opensearch.OpenSearchStackProps>('opensearch', commonProps)
  const openSearchStack = new opensearch.OpenSearchStack(app, `${namespace}-opensearch`, openSearchProps)


  const multimediaAssetsProps = mapContextToProps<multimediaAssets.IMultimediaAssetsStackProps>('multimediaAssets', {
    ...commonProps,
    marbleContentBucketName: contextEnv.marbleContentBucketName,
  })
  const multimediaAssetsStack = new multimediaAssets.MultimediaAssetsStack(app, `${namespace}-multimedia-assets`, multimediaAssetsProps)

  const manifestPipelineProps = mapContextToProps<manifestPipeline.IBaseStackProps>('manifestPipeline', {
    ...commonProps,
    sentryDsn: app.node.tryGetContext('sentryDsn'),
    appConfigPath: `/all/stacks/${namespace}-manifest`,
    rBSCS3ImageBucketName: contextEnv.rBSCS3ImageBucketName,
    marbleContentBucketName: contextEnv.marbleContentBucketName,
    multimediaBucket: multimediaAssetsStack.multimediaBucket as Bucket,
    marbleContentFileShareId: contextEnv.marbleContentFileShareId,
  }, { createEventRules: 'boolean' , 'createBackup': 'boolean' })
  const manifestPipelineStack = new manifestPipeline.ManifestPipelineStack(app, `${namespace}-manifest`, manifestPipelineProps)

  const maintainMetadataProps = mapContextToProps<maintainMetadata.IBaseStackProps>('maintainMetadata', { ...commonProps, manifestPipelineStack })
  const maintainMetadataStack = new maintainMetadata.MaintainMetadataStack(app, `${namespace}-maintain-metadata`, maintainMetadataProps)

  const imageProcessingProps = mapContextToProps<imageProcessing.ImagesStackProps>('imageProcessing', {
    ...commonProps,
    rbscBucketName: contextEnv.rBSCS3ImageBucketName,
    marbleContentBucketName: contextEnv.marbleContentBucketName,
    manifestPipelineStack,
    maintainMetadataStack,
  })
  const imageProcessingStack = new imageProcessing.ImagesStack(app, `${namespace}-image-processing`, imageProcessingProps)

  const manifestLambdaProps = mapContextToProps<manifestLambda.IBaseStackProps>('manifestLambda', { ...commonProps, maintainMetadataStack })
  const manifestLambdaStack = new manifestLambda.ManifestLambdaStack(app, `${namespace}-manifest-lambda`, manifestLambdaProps)

  const services = {
    foundationStack,
    website,
    redbox,
    inquisitions,
    viewer,
    //seaside,
    iiifServerlessStack,
    imageProcessingStack,
    elasticSearchStack,
    openSearchStack,
    manifestPipelineStack,
    maintainMetadataStack,
    multimediaAssetsStack,
    manifestLambdaStack,
  }

  new DashboardsStack(app, `${namespace}-dashboards-stack`, { root: app, namespace, env: contextEnv.env, services })
  const slos = [
    {
      title: "Marble - Unified Website CDN",
      type: "CloudfrontAvailability",
      distributionId: website.cloudfront.distributionId,
      sloThreshold: 0.999,
      alarmsEnabled: {
        High: true,
        Low: false,
      },
    },
    {
      title: "Marble - Unified Website CDN",
      type: "CloudfrontLatency",
      distributionId: website.cloudfront.distributionId,
      sloThreshold: 0.95,
      latencyThreshold: 1000,
      alarmsEnabled: {
        High: true,
        Low: false,
      },
    },
    {
      title: "Marble - IIIF Image Service API",
      type: "ApiAvailability",
      apiName: iiifServerlessStack.apiStack.apiName,
      sloThreshold: 0.97,
      alarmsEnabled: {
        High: true,
        Low: false,
      },
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
 //     sloThreshold: 0.999,
      sloThreshold: 0.95, // Changed sloThreshold to .95 because we don't have canaries hitting this every minute to drive up usage.  The result is a single bad value raises a false alarm.
      alarmsEnabled: {
        High: true,
        Low: false,
      },
    },
    {
      title: "Marble - IIIF Manifest API",
      type: "ApiLatency",
      apiName: manifestLambdaStack.apiName,
      sloThreshold: 0.95,
      latencyThreshold: 3000 * 1.5, // Extended latencyThreshold by 50% because we don't have canaries hitting this every minute to drive up usage.  The result is a single bad value raises a false alarm.
      alarmsEnabled: {
        High: true,
        Low: false,
      },
    },
    {
      title: "Marble - Maintain Metadata API",
      type: "AppSyncAvailability",
      apiId: maintainMetadataStack.apiId,
//      sloThreshold: 0.9995,
      sloThreshold: 0.95, // Changed sloThreshold to .95 because we don't have canaries hitting this every minute to drive up usage.  The result is a single bad value raises a false alarm.
      alarmsEnabled: {
        High: true,
        Low: false,
      },
    },
    {
      title: "Marble - Maintain Metadata API",
      type: "AppSyncLatency",
      apiId: maintainMetadataStack.apiId,
      sloThreshold: 0.95,
      // latencyThreshold: 500,
      latencyThreshold: 500 * 1.5, // Extended latencyThreshold by 50% because we don't have canaries hitting this every minute to drive up usage.  The result is a single bad value raises a false alarm.
      alarmsEnabled: {
        High: true,
        Low: false,
      },
    },
    {
      title: "Marble - Search API",
      type: "ElasticSearchAvailability",
      accountId: contextEnv.env.account,
      domainName: elasticSearchStack.domainName,
      // sloThreshold: 0.99,
      sloThreshold: 0.95, // Changed sloThreshold to .95 because we don't have canaries hitting this every minute to drive up usage.  The result is a single bad value raises a false alarm.
      alarmsEnabled: {
        High: true,
        Low: false,
      },
    },
    {
      title: "Marble - Search API",
      type: "ElasticSearchLatency",
      accountId: contextEnv.env.account,
      domainName: elasticSearchStack.domainName,
      sloThreshold: 0.95,
      // latencyThreshold: 200,
      latencyThreshold: 200 * 1.5, // Extended latencyThreshold by 50% because we don't have canaries hitting this every minute to drive up usage.  The result is a single bad value raises a false alarm.
      alarmsEnabled: {
        High: true,
        Low: false,
      },
    },
    {
      title: "Marble - Search API",
      type: "ElasticSearchLatency",
      accountId: contextEnv.env.account,
      domainName: elasticSearchStack.domainName,
      sloThreshold: 0.99,
      // latencyThreshold: 1000,
      latencyThreshold: 1000 * 1.5, // Extended latencyThreshold by 50% because we don't have canaries hitting this every minute to drive up usage.  The result is a single bad value raises a false alarm.
      alarmsEnabled: {
        High: true,
        Low: false,
      },
    },
    {
      title: "Marble - IIIF Viewer CDN",
      type: "CloudfrontAvailability",
      distributionId: viewer.cloudfront.distributionId,
      sloThreshold: 0.999,
      alarmsEnabled: {
        High: true,
        Low: false,
      },
    },
    {
      title: "Marble - IIIF Viewer CDN",
      type: "CloudfrontLatency",
      distributionId: viewer.cloudfront.distributionId,
      sloThreshold: 0.95,
      latencyThreshold: 750,
      alarmsEnabled: {
        High: true,
        Low: false,
      },
    },
  ]

  const sloContext = getContextByNamespace('slos')
  new ServiceLevelsStack(app, `${namespace}-service-levels`, {
    services,
    slos,
    emailSubscriber: contextEnv.alarmsEmail,
    ...sloContext,
    ...commonProps,
  })

  const backupContext = getContextByNamespace('backup')
  new BackupStack(app, `${namespace}-backup`, {
    ...backupContext,
  })

  return services
}
