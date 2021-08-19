import { App, IConstruct, Stack, StackProps } from '@aws-cdk/core'
import { SummaryDashboard } from '@ndlib/ndlib-cdk'
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
  }
}
