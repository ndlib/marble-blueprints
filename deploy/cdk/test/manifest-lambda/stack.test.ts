import { Template } from 'aws-cdk-lib/assertions'
import { Bucket } from 'aws-cdk-lib/aws-s3'
import { App, Stack } from 'aws-cdk-lib'
import { FoundationStack } from '../../lib/foundation'
import { MaintainMetadataStack } from '../../lib/maintain-metadata'
import { ManifestLambdaStack } from '../../lib/manifest-lambda'
import { ManifestPipelineStack } from '../../lib/manifest-pipeline'

const domainName = 'test.edu'
const namespace = 'marble'
const sentryDsn = 'https://136d489c91484b55be18e0a28d463b43@sentry.io/1831199'
const rBSCS3ImageBucketName = 'libnd-smb-rbsc'
const marbleContentBucketName = 'libnd-smb-marble'


const manifestPipelineContext = {
  imageServerHostname: "/all/stacks/marble-image-service/hostname" as 'AWS::SSM::Parameter::Value<String>',
  marbleProcessingKeyPath: "/all/marble-data-processing/prod",
  noReplyEmailAddr: "noreply@nd.edu",
  googleKeyPath: "/all/marble/google",
  museumKeyPath: "/all/marble/museum",
  curateKeyPath: "/all/marble/curate",
  createEventRules: false,
  lambdaCodeRootPath: '../../../marble-manifest-pipeline/',
  hostnamePrefix: 'presentation-iiif',
  domainName,
  sentryDsn,
  rBSCS3ImageBucketName,
  marbleContentBucketName,
  appConfigPath: "/all/test-marble",
  metadataTimeToLiveDays: "365",
  filesTimeToLiveDays: "365",
  marbleContentFileShareId: "some fake arn",
  hostedZoneTypes: ['public'],
  hostedZoneTypesTest: ['public'],
  stage: 'prod',
}

const maintainMetadataContext = {
  openIdConnectProvider: "https://okta.nd.edu/oauth2/ausxosq06SDdaFNMB356",
}

const manifestLambdaContext = {
  domainName,
  sentryDsn,
  hostnamePrefix: 'test-iiif-manifest',
  lambdaCodeRootPath: "../../../marble-manifest-lambda",
  publicGraphqlHostnamePrefix: "sample-public-graphql",
  hostedZoneTypes: ['public'],
  hostedZoneTypesTest: ['public'],
  stage: 'prod',
}

const setup = (props: { manifestPipelineContext: any, maintainMetadataContext: any, manifestLambdaContext: any }) => {
  const app = new App()

  const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
    domainName,
  })
  const multimediaStack = new Stack(app, 'MultimediaStack')
  const multimediaBucket = new Bucket(multimediaStack, 'MultimediaBucket')

  const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
    foundationStack,
    multimediaBucket,
    ...props.manifestPipelineContext,
  })
  const maintainMetadataStack = new MaintainMetadataStack(app, `${namespace}-maintain-metadata`, {
    foundationStack,
    manifestPipelineStack,
    ...props.maintainMetadataContext,
  })
  const stack = new ManifestLambdaStack(app, 'MyTestStack', {
    foundationStack,
    maintainMetadataStack,
    ...props.manifestLambdaContext,
  })
  return stack
}

describe('ManifestLambdaStack', () => {
  // Only synthesize once since we are only using one set of props
  const stack = setup({
    manifestPipelineContext,
    maintainMetadataContext,
    manifestLambdaContext,
  })

  test('creates iiifManifestLambda', () => {
    const template = Template.fromStack(stack)
    template.hasResourceProperties('AWS::Lambda::Function', {
      "Description": "Create iiif manifests real-time",
    })
  })

  test('creates an API Gateways for iiifManifestLambda and publicGraphqlLambda', () => {
    const template = Template.fromStack(stack)
    template.resourceCountIs('AWS::ApiGateway::Deployment', 2)
  })

  test('creates an API Gateway Resource (manifest)', () => {
    const template = Template.fromStack(stack)
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      "PathPart": "manifest",
    })
  })


  test('creates an API Gateway Resource (canvas)', () => {
    const template = Template.fromStack(stack)
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      "PathPart": "canvas",
    })
  })

  test('creates an API Gateway Resource (annotation_page)', () => {
    const template = Template.fromStack(stack)
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      "PathPart": "annotation_page",
    })
  })

  test('creates an API Gateway Resource (annotation)', () => {
    const template = Template.fromStack(stack)
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      "PathPart": "annotation",
    })
  })

  test('creates an Route53 Recordset', () => {
    const template = Template.fromStack(stack)
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      "Name": "test-iiif-manifest.test.edu.",
    })
  })


  test('creates a Lambda', () => {
    const template = Template.fromStack(stack)
    template.hasResourceProperties('AWS::Lambda::Function', {
      "Description": "Appends API keys and queries named AppSync resolvers",
    })
  })


  test('creates an API Gateway Resource (query)', () => {
    const template = Template.fromStack(stack)
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      "PathPart": "query",
    })
  })

}) /* end of describe ManifestPipelineStack */