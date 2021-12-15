import { FoundationStack } from "./foundation"
import { StaticHostStack } from "./static-host"
import { IiifServerlessStack } from "./iiif-serverless"
import { ImagesStack } from "./image-processing"
import { ElasticStack } from "./elasticsearch"
import { OpenSearchStack } from "./opensearch"
import { ManifestPipelineStack } from "./manifest-pipeline"
import { MaintainMetadataStack } from "./maintain-metadata"
import { MultimediaAssetsStack } from "./multimedia-assets"
import { ManifestLambdaStack } from "./manifest-lambda"

export type ServiceStacks = {
  foundationStack: FoundationStack,
  website: StaticHostStack,
  redbox: StaticHostStack,
  inquisitions: StaticHostStack,
  viewer: StaticHostStack,
  iiifServerlessStack: IiifServerlessStack,
  imageProcessingStack: ImagesStack,
  elasticSearchStack: ElasticStack,
  openSearchStack: OpenSearchStack,
  manifestPipelineStack: ManifestPipelineStack,
  maintainMetadataStack: MaintainMetadataStack,
  multimediaAssetsStack: MultimediaAssetsStack,
  manifestLambdaStack: ManifestLambdaStack,
}
