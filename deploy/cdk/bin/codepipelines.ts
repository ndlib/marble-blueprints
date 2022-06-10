#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import 'source-map-support/register'
import IIIF = require('../lib/iiif-serverless')
import imageProcessing = require('../lib/image-processing')
import staticHost = require('../lib/static-host')
import opensearch = require('../lib/opensearch')
import manifestPipeline = require('../lib/manifest-pipeline')
import { getRequiredContext, getContextByNamespace } from '../lib/context-helpers'
import { ContextEnv } from '../lib/context-env'
import { ServiceStacks } from '../lib/types'
import { PipelineFoundationStack } from '../lib/foundation'
import maintainMetadata = require('../lib/maintain-metadata')
import manifestLambda = require('../lib/manifest-lambda')
import multimediaAssets = require('../lib/multimedia-assets')

export const instantiateStacks = (app: App, namespace: string, contextEnv: ContextEnv, testStacks: ServiceStacks, prodStacks: ServiceStacks): void => {
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
    dockerhubCredentialsPath: getRequiredContext(app.node, 'dockerhubCredentialsPath'),
    hostedZoneTypes: contextEnv.hostedZoneTypes,
    domainName: contextEnv.domainName,
  }

  const staticHostContext = getContextByNamespace('staticHost')
  const commonSitePipelineProps = {
    prodOpenSearchStack: prodStacks.openSearchStack,
    testMaintainMetadataStack: testStacks.maintainMetadataStack,
    prodMaintainMetadataStack: prodStacks.maintainMetadataStack,
    testManifestLambdaStack: testStacks.manifestLambdaStack,
    prodManifestLambdaStack: prodStacks.manifestLambdaStack,
    ...commonProps,
    ...staticHostContext,
  }
  type siteInstance = { name: string, props: staticHost.IDeploymentPipelineStackProps }
  const siteInstances : siteInstance[] = [
    { name: 'website', props: { ...commonSitePipelineProps, prodAdditionalAliases: 'marble.library.nd.edu' } },
    { name: 'redbox', props: commonSitePipelineProps },
    { name: 'seaside', props: commonSitePipelineProps },
    { name: 'inquisitions', props: commonSitePipelineProps },
    { name: 'viewer', props: commonSitePipelineProps },
  ]
  siteInstances.map(instance => {
    const instanceContext = getContextByNamespace(instance.name)
    new staticHost.DeploymentPipelineStack(app, `${namespace}-${instance.name}-deployment`, {
      ...instance.props,
      ...instanceContext,
      instanceName: instance.name,
    })
  })

  const imageServiceContext = getContextByNamespace('iiifImageService')
  new IIIF.DeploymentPipelineStack(app, `${namespace}-image-service-deployment`, {
    ...commonProps,
    ...imageServiceContext,
  })

  const imageProcessingContext = getContextByNamespace('imageProcessing')
  new imageProcessing.DeploymentPipelineStack(app, `${namespace}-image-processing-deployment`, {
    ...commonProps,
    ...imageProcessingContext,
  })

  const opensearchContext = getContextByNamespace('opensearch')
  new opensearch.DeploymentPipelineStack(app, `${namespace}-opensearch-deployment`, {
    ...commonProps,
    ...opensearchContext,
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
