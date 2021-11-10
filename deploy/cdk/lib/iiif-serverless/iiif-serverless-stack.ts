import { Stack, StackProps, Construct, Duration, Fn, CfnInclude, NestedStack, NestedStackProps } from "@aws-cdk/core"
import { DomainName, BasePathMapping, RestApi } from "@aws-cdk/aws-apigateway"
import { FoundationStack } from "../foundation"
import { CnameRecord } from "@aws-cdk/aws-route53"
import YAML = require('yaml')
import * as fs from "fs"
import { Asset } from '@aws-cdk/aws-s3-assets'

export interface IIiifServerlessStackProps extends StackProps {
  /**
   * The path to the root of the local copy of the serverless-iiif repo.
   * Assumes all dependencies in this directory have already been built following
   * https://github.com/nulib/serverless-iiif/blob/master/CONTRIBUTING.md#build-dependencies
   */
  readonly serverlessIiifSrcPath: string

  /**
   * The subdomain to use when creating a custom domain for the API
   */
  readonly hostnamePrefix: string

  /**
   * Reference to the foundation stack to get the domain and cert from
   */
  readonly foundationStack: FoundationStack

  /**
   * If true, will attempt to create a CNAME for the service in the
   * Route53 zone created in the foundation stack
   */
  readonly createDns: boolean

  /**
   * Path in SSM where parameters for this stack are stored.
   */
  readonly paramPathPrefix: string
}

export interface IIiifApiStackProps extends NestedStackProps {
  readonly serverlessIiifSrcPath: string
  readonly foundationStack: FoundationStack
  readonly paramPathPrefix: string
}

/**
 * Creates an Api stack using the template from the source repo. It does have to modify the imported
 * template to work in cdk in a few ways. This ideally will all go away if we decide to just create
 * the API entirely in this cdk app without using the template from nulib
 */
class ApiStack extends NestedStack {
  readonly apiName: string
  readonly apiId: string

  constructor(scope: Construct, id: string, props: IIiifApiStackProps) {
    super(scope, id, props)

    this.apiName = `${this.stackName}-api`
    this.apiId = Fn.importValue(`${this.stackName}:ApiId`)

    if(!fs.existsSync(`${props.serverlessIiifSrcPath}/src`)) {
      this.node.addError(`Cannot deploy this stack. Asset path not found ${props.serverlessIiifSrcPath}/src`)
      return
    }
    const lambdaAsset = new Asset(this, 'LambdaAsset', {
      path: `${props.serverlessIiifSrcPath}/src`,
    })

    if(!fs.existsSync(`${props.serverlessIiifSrcPath}/dependencies`)) {
      this.node.addError(`Cannot deploy this stack. Asset path not found ${props.serverlessIiifSrcPath}/dependencies`)
      return
    }
    const lambdaDepsAsset = new Asset(this, 'SampleSingleFileAsset', {
      path: `${props.serverlessIiifSrcPath}/dependencies`,
    })

    if (!fs.existsSync(`${props.serverlessIiifSrcPath}/template.yml`)) {
      this.node.addError(`Cannot deploy this stack. Asset path not found ${props.serverlessIiifSrcPath}/template.yml`)
      return
    }
    const iiifTemplate = new CfnInclude(this, "IiifTemplate", {
      template: YAML.parse(fs.readFileSync(`${props.serverlessIiifSrcPath}/template.yml`).toString()),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any

    // Can't just ref the public bucket name cause it will create a Fn::ImportValue which will
    // not work as a param. Instead, the foundation stack will write the bucket name to a param
    // so we need to change the param to use ssm and set the default
    iiifTemplate.template.Parameters.SourceBucket.Type = 'AWS::SSM::Parameter::Value<String>'
    iiifTemplate.template.Parameters.SourceBucket.Default = props.foundationStack.publicBucketParam

    iiifTemplate.template.Parameters.CacheEnabled.Type = 'AWS::SSM::Parameter::Value<String>'
    iiifTemplate.template.Parameters.CacheEnabled.Default = `${props.paramPathPrefix}/cacheEnabled`

    iiifTemplate.template.Parameters.CacheTtl.Type = 'AWS::SSM::Parameter::Value<String>'
    iiifTemplate.template.Parameters.CacheTtl.Default = `${props.paramPathPrefix}/cacheTtl`

    // There's currently no way to have cdk transform the codeuri's in the same way that it's done when 
    // using sam or cloudformation cli. Have to find the resources and manually change this
    iiifTemplate.template.Resources.IiifFunction.Properties.CodeUri = { Bucket: lambdaAsset.s3BucketName, Key: lambdaAsset.s3ObjectKey }
    iiifTemplate.template.Resources.Dependencies.Properties.ContentUri = { Bucket: lambdaDepsAsset.s3BucketName, Key: lambdaDepsAsset.s3ObjectKey }
    
    // Cdk makes the name too long to create the LayerName. Just remove this prop and let cloudformation do it
    delete iiifTemplate.template.Resources.Dependencies.Properties.LayerName
  }
}

export interface IIiifDomainStackProps extends NestedStackProps {
  readonly hostnamePrefix: string
  readonly foundationStack: FoundationStack
  readonly createDns: boolean
  readonly apiStack: ApiStack
}

/**
 * Adds a custom domain to the Api, with or without a dns entry
 */
class DomainStack extends NestedStack {
  constructor(scope: Construct, id: string, props: IIiifDomainStackProps) {
    super(scope, id, props)
    const restApi = Fn.importValue(`${props.apiStack.stackName}:ApiId`)
    const iiifApi = RestApi.fromRestApiId(this, 'IiifApi', restApi)
    iiifApi.deploymentStage = {
      restApi,
      stageName: 'latest',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    const fqdn = `${props.hostnamePrefix}.${props.foundationStack.hostedZone.zoneName}`
    const domainName = new DomainName(this, 'APIDomain', {
      domainName: fqdn,
      certificate: props.foundationStack.certificate,
    })
    new BasePathMapping(this, 'RootToLatestStageMapping', {
      domainName,
      restApi: iiifApi,
      stage: iiifApi.deploymentStage,
    })

    if (props.createDns) {
      new CnameRecord(this, `HostnamePrefix-Route53CnameRecord`, {
        recordName: props.hostnamePrefix,
        domainName: domainName.domainNameAliasDomainName,
        zone: props.foundationStack.hostedZone,
        ttl: Duration.minutes(15),
      })
    }
  }
}

/**
 * Creates a serverless-iiif stack with a custom domain
 */
export class IiifServerlessStack extends Stack {
  readonly apiStack: ApiStack
  readonly domainStack: DomainStack

  constructor(scope: Construct, id: string, props: IIiifServerlessStackProps) {
    super(scope, id, props)
    // Creating this as nested stacks to more easily create dependency between the resources in
    // the API stack and the Custom Domain
    this.apiStack = new ApiStack(this, 'IiifApiStack', props)
    this.domainStack = new DomainStack(this, 'IiifDomainStack', { apiStack: this.apiStack, ...props })
  }
}
