import { App, IConstruct, Stack, StackProps } from '@aws-cdk/core'
import { CloudfrontDashboard, ServerlessApiDashboard, SummaryDashboard } from '@ndlib/ndlib-cdk'
import { ServiceStacks } from '../../lib/types'

export interface DashboardsStackProps extends StackProps {
  readonly root: IConstruct
  readonly namespace: string
  readonly services: ServiceStacks
}

export class DashboardsStack extends Stack {
  constructor(app: App, id: string, props: DashboardsStackProps){
    super(app, id, props)
    // The dashboard will find all of our resources for us, but without these 
    // overrides, it will label them with things like distribution ids and others
    // which are not super useful
    const serviceLabels = {
      [`${props.services.website.cloudfront.node.addr}`]: 'Unified Website CDN',
      [`${props.services.redbox.cloudfront.node.addr}`]: 'Redbox CDN',
      [`${props.services.inquisitions.cloudfront.node.addr}`]: 'Inquisitions CDN',
      [`${props.services.viewer.cloudfront.node.addr}`]: 'IIIF Viewer CDN',
      [`${props.services.maintainMetadataStack.api.node.addr}`]: 'Maintain Metadata API',
      [`${props.services.elasticSearchStack.domain.node.addr}`]: 'Search API',
      [`${props.services.manifestLambdaStack.privateApi.node.addr}`]: 'IIIF Manifest API',
      [`${props.services.manifestLambdaStack.publicApi.node.addr}`]: 'User Portfolio API',
      [`${props.services.multimediaAssetsStack.cloudfront.node.addr}`]: 'Multimedia Assets CDN',
    }
    SummaryDashboard.fromTree(this, "SummaryDashboard", {
      dashboardName: "Marble-Summary",
      start: "-PT24H",
      discoverRoot: props.root,
      // I'm going to exclude discovered lambdas for now and have it search instead by namespace. This is to avoid too many export/imports on the service stacks
      includeLambdas: false,
      // Instead, just search for all lambdas within this namespace
      lambdaNames: [props.namespace],
      hideLambdaIntegrationTimeoutAnnotation: true,
      serviceLabels,
      // IIIF image service is imported from a cloudformation template, so we'll need to manually add that one
      services: [
        {
          typeName: 'APIGateway',
          apiName: props.services.iiifServerlessStack.apiStack.apiName,
          stage: 'latest',
          label: 'IIIF Image Service API',
        },
      ],
    })

    // We don't yet have an automated way to create more detailed dashboards for each service, 
    // so we'll make each one individually here
    new CloudfrontDashboard(this, 'UnifiedWebsiteDashboard', {
      dashboardName: 'Marble-Unified-Website-CDN',
      headerName: 'Unified Website CDN',
      desc: 'Placeholder',
      distributionId: props.services.website.cloudfront.distributionId,
    })

    new CloudfrontDashboard(this, 'RedboxDashboard', {
      dashboardName: 'Marble-Redbox-CDN',
      headerName: 'Redbox CDN',
      desc: 'Placeholder',
      distributionId: props.services.redbox.cloudfront.distributionId,
    })

    new CloudfrontDashboard(this, 'InquisitionsDashboard', {
      dashboardName: 'Marble-Inquisitions-CDN',
      headerName: 'Inquisitions CDN',
      desc: 'Placeholder',
      distributionId: props.services.inquisitions.cloudfront.distributionId,
    })

    new CloudfrontDashboard(this, 'IIIFViewerDashboard', {
      dashboardName: 'Marble-IIIF-Viewer-CDN',
      headerName: 'IIIF Viewer CDN',
      desc: 'Placeholder',
      distributionId: props.services.viewer.cloudfront.distributionId,
    })

    new CloudfrontDashboard(this, 'MultimediaAssetsDashboard', {
      dashboardName: 'Marble-Multimedia-Assets-CDN',
      headerName: 'Multimedia Assets CDN',
      desc: 'Placeholder',
      distributionId: props.services.multimediaAssetsStack.cloudfront.distributionId,
    })

    // TODO: Need to enable detailed metrics on this API for per method metrics
    new ServerlessApiDashboard(this, 'ImageServiceDashboard', {
      dashboardName: 'Marble-IIIF-Image-Service-API',
      headerName: 'IIIF Image Service API',
      desc: 'Placeholder',
      apiName: props.services.iiifServerlessStack.apiStack.apiName,
      stage: 'latest',
      latencyPercentiles: [{ thresholdLabel: 'SLO', threshold: 3000, percentile: 0.95 }],
    })

    new ServerlessApiDashboard(this, 'IIIFManifestDashboard', {
      dashboardName: 'Marble-IIIF-Manifest-API',
      headerName: 'IIIF Manifest API',
      desc: 'Placeholder',
      apiName: props.services.manifestLambdaStack.privateApi.restApiName,
      stage: props.services.manifestLambdaStack.privateApi.deploymentStage.stageName,
      latencyPercentiles: [{ thresholdLabel: 'SLO', threshold: 3000, percentile: 0.95 }],
    })

    new ServerlessApiDashboard(this, 'UserPortfolioDashboard', {
      dashboardName: 'Marble-User-Portfolio-API',
      headerName: 'User Portfolio API',
      desc: 'Placeholder',
      apiName: props.services.manifestLambdaStack.publicApi.restApiName,
      stage: props.services.manifestLambdaStack.publicApi.deploymentStage.stageName,
    })

    // These don't exist yet in ndlib-cdk, so just projecting what they might look like
    // TODO: new GraphqlApiDashboard(this, 'MaintainMetadataAPI', {
    //   dashboardName: 'Marble-Maintain-Metadata-API',
    //   headerName: 'Maintain Metadata API',
    //   desc: 'Placeholder',
    //   apiId: props.services.maintainMetadataStack.api.apiId,
    //   ...
    // })

    // TODO: new ElasticSearchApiDashboard(this, 'SearchAPI', {
    //   dashboardName: 'Marble-Search-API',
    //   headerName: 'Search API',
    //   desc: 'Placeholder',
    //   accountId: props.services.elasticSearchStack.account,
    //   domainName: props.services.elasticSearchStack.domain.domainName,
    //   ...
    // })
  }
}
