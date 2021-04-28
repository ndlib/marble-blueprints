import { expect as expectCDK, haveResourceLike } from '@aws-cdk/assert'
import { StackSynthesizer } from '@aws-cdk/core'
import cdk = require('@aws-cdk/core')
import { FoundationStack } from '../../lib/foundation'
import { MaintainMetadataStack } from '../../lib/maintain-metadata'
import { ManifestLambdaStack } from '../../lib/manifest-lambda'
import { ManifestPipelineStack } from '../../lib/manifest-pipeline'

const domainName = 'test.edu'
const namespace = 'marble'
const sentryDsn = 'https://136d489c91484b55be18e0a28d463b43@sentry.io/1831199'
const rBSCS3ImageBucketName = 'libnd-smb-rbsc'


const manifestPipelineContext = {
  imageServerHostname: "/all/stacks/marble-image-service/hostname" as 'AWS::SSM::Parameter::Value<String>',
  marbleProcessingKeyPath: "/all/marble-data-processing/prod",
  noReplyEmailAddr: "noreply@nd.edu",
  googleKeyPath: "/all/marble/google",
  museumKeyPath: "/all/marble/museum",
  curateKeyPath: "/all/marble/curate",
  createEventRules: false,
  createDns: false,
  lambdaCodeRootPath: '../../../marble-manifest-pipeline/',
  hostnamePrefix: 'presentation-iiif',
  domainName,
  sentryDsn,
  rBSCS3ImageBucketName,
  appConfigPath: "/all/test-marble",
  metadataTimeToLiveDays: "365",
  filesTimeToLiveDays: "365",
}

const maintainMetadataContext = {
  openIdConnectProvider: "https://okta.nd.edu/oauth2/ausxosq06SDdaFNMB356",
}

const manifestLambdaContext = {
  domainName,
  sentryDsn,
  createDns: true,
  hostnamePrefix: 'test-iiif-manifest',
  lambdaCodeRootPath: "../../../marble-manifest-lambda",

}

describe('ManifestLambdaStack', () => {
  test('creates a Lambda', () => {
    const app = new cdk.App()

    const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
      domainName,
    })
    const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
      foundationStack,
      ...manifestPipelineContext,
    })
    const maintainMetadataStack = new MaintainMetadataStack(app, `${namespace}-maintain-metadata`, {
      foundationStack,
      manifestPipelineStack,
      ...maintainMetadataContext,
    })

    // WHEN
    const stack = new ManifestLambdaStack(app, 'MyTestStack', {
      foundationStack,
      maintainMetadataStack,
      ...manifestLambdaContext,
    })

    // THEN
    expectCDK(stack).to(haveResourceLike('AWS::Lambda::Function', {
    }))
  })

  test('creates an API Gateway', () => {
    const app = new cdk.App()

    const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
      domainName,
    })
    const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
      foundationStack,
      ...manifestPipelineContext,
    })
    const maintainMetadataStack = new MaintainMetadataStack(app, `${namespace}-maintain-metadata`, {
      foundationStack,
      manifestPipelineStack,
      ...maintainMetadataContext,
    })

    // WHEN
    const stack = new ManifestLambdaStack(app, 'MyTestStack', {
      foundationStack,
      maintainMetadataStack,
      ...manifestLambdaContext,
    })

    // THEN
    expectCDK(stack).to(haveResourceLike('AWS::ApiGateway::Deployment', {
    }))
  })

  test('creates an API Gateway Resource (manifest)', () => {
    const app = new cdk.App()

    const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
      domainName,
    })
    const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
      foundationStack,
      ...manifestPipelineContext,
    })
    const maintainMetadataStack = new MaintainMetadataStack(app, `${namespace}-maintain-metadata`, {
      foundationStack,
      manifestPipelineStack,
      ...maintainMetadataContext,
    })

    // WHEN
    const stack = new ManifestLambdaStack(app, 'MyTestStack', {
      foundationStack,
      maintainMetadataStack,
      ...manifestLambdaContext,
    })

    // THEN
    expectCDK(stack).to(haveResourceLike('AWS::ApiGateway::Resource', {
      "PathPart": "manifest",
    }))
  })


  test('creates an API Gateway Resource (canvas)', () => {
    const app = new cdk.App()

    const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
      domainName,
    })
    const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
      foundationStack,
      ...manifestPipelineContext,
    })
    const maintainMetadataStack = new MaintainMetadataStack(app, `${namespace}-maintain-metadata`, {
      foundationStack,
      manifestPipelineStack,
      ...maintainMetadataContext,
    })

    // WHEN
    const stack = new ManifestLambdaStack(app, 'MyTestStack', {
      foundationStack,
      maintainMetadataStack,
      ...manifestLambdaContext,
    })

    // THEN
    expectCDK(stack).to(haveResourceLike('AWS::ApiGateway::Resource', {
      "PathPart": "canvas",
    }))
  })

  test('creates an API Gateway Resource (annotation_page)', () => {
    const app = new cdk.App()

    const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
      domainName,
    })
    const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
      foundationStack,
      ...manifestPipelineContext,
    })
    const maintainMetadataStack = new MaintainMetadataStack(app, `${namespace}-maintain-metadata`, {
      foundationStack,
      manifestPipelineStack,
      ...maintainMetadataContext,
    })

    // WHEN
    const stack = new ManifestLambdaStack(app, 'MyTestStack', {
      foundationStack,
      maintainMetadataStack,
      ...manifestLambdaContext,
    })

    // THEN
    expectCDK(stack).to(haveResourceLike('AWS::ApiGateway::Resource', {
      "PathPart": "annotation_page",
    }))
  })

  test('creates an API Gateway Resource (annotation)', () => {
    const app = new cdk.App()

    const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
      domainName,
    })
    const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
      foundationStack,
      ...manifestPipelineContext,
    })
    const maintainMetadataStack = new MaintainMetadataStack(app, `${namespace}-maintain-metadata`, {
      foundationStack,
      manifestPipelineStack,
      ...maintainMetadataContext,
    })

    // WHEN
    const stack = new ManifestLambdaStack(app, 'MyTestStack', {
      foundationStack,
      maintainMetadataStack,
      ...manifestLambdaContext,
    })

    // THEN
    expectCDK(stack).to(haveResourceLike('AWS::ApiGateway::Resource', {
      "PathPart": "annotation",
    }))
  })

  test('creates an Route53 Recordset', () => {
    const app = new cdk.App()

    const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
      domainName,
    })
    const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
      foundationStack,
      ...manifestPipelineContext,
    })
    const maintainMetadataStack = new MaintainMetadataStack(app, `${namespace}-maintain-metadata`, {
      foundationStack,
      manifestPipelineStack,
      ...maintainMetadataContext,
    })

    // WHEN
    const stack = new ManifestLambdaStack(app, 'MyTestStack', {
      foundationStack,
      maintainMetadataStack,
      ...manifestLambdaContext,
    })

    // THEN
    expectCDK(stack).to(haveResourceLike('AWS::Route53::RecordSet', {
      "Name": "test-iiif-manifest.test.edu.",
    }))
  })

  test('does not create an Route53 Recordset', () => {
    const app = new cdk.App()

    const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
      domainName,
    })
    const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
      foundationStack,
      ...manifestPipelineContext,
    })
    const maintainMetadataStack = new MaintainMetadataStack(app, `${namespace}-maintain-metadata`, {
      foundationStack,
      manifestPipelineStack,
      ...maintainMetadataContext,
    })

    // WHEN
    const stack = new ManifestLambdaStack(app, 'MyTestStack', {
      foundationStack,
      maintainMetadataStack,
      ...manifestLambdaContext,
      createDns: false,
    })

    // THEN
    expectCDK(stack).notTo(haveResourceLike('AWS::Route53::RecordSet', {
      "Name": "test-iiif-manifest.test.edu.",
    }))
  })

}) /* end of describe ManifestPipelineStack */