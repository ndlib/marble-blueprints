import { Construct, Stack, StackProps } from "@aws-cdk/core"
import { ArtifactBucket } from '@ndlib/ndlib-cdk'
import { BucketEncryption } from "@aws-cdk/aws-s3"

export class PipelineFoundationStack extends Stack {
  /**
   * Shared bucket for holding pipeline artifacts
   */
  public readonly artifactBucket: ArtifactBucket

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
    this.artifactBucket = new ArtifactBucket(this, 'Bucket', {
      encryption: BucketEncryption.KMS_MANAGED,
    })
  }
}