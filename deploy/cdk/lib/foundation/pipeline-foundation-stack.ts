import { Stack, StackProps } from "aws-cdk-lib"
import { ArtifactBucket } from '@ndlib/ndlib-cdk2'
import { BucketEncryption } from "aws-cdk-lib/aws-s3"
import { Construct } from "constructs"

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