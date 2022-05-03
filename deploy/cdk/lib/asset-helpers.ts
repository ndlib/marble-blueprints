import { ContainerImage } from 'aws-cdk-lib/aws-ecs'
import { DockerImageAsset, DockerImageAssetProps } from 'aws-cdk-lib/aws-ecr-assets'
import * as fs from 'fs'
import * as path from 'path'
import { Annotations } from 'aws-cdk-lib'
import { Code } from 'aws-cdk-lib/aws-lambda'
import { Construct } from "constructs"

export class AssetHelpers {
  /**
   * Tries to get a ContainerImage from a path. If not found, it will add a stack error. Use this
   * as a replacement for ContainerImage.fromDockerImageAsset
   * 
   * @param scope The scope to add the error to when the asset is not found
   * @param id The path to test
   * @returns The lambda code if found, a dummy function when not found
   */
  static containerFromDockerfile (scope: Construct, id: string, props: DockerImageAssetProps): ContainerImage {
    const dockerFilePath = path.join(props.directory, props.file ?? '')
    if (!fs.existsSync(dockerFilePath)) {
      Annotations.of(scope).addError(`Cannot deploy this stack. Dockerfile not found at ${dockerFilePath}`)
      // The returned image shouldn't matter, since adding the error will prevent the stack from deploying
      return ContainerImage.fromRegistry('scratch')
    } else {
      const dockerImageAsset = new DockerImageAsset(scope, id, props)
      return ContainerImage.fromDockerImageAsset(dockerImageAsset)
    }
  }

  /**
   * Tries to get a Lambda Code instance from a path. If not found, it will add a stack error. Use this
   * as a replacement for Code.fromAsset
   * 
   * @param scope The scope to add the error to when the asset is not found
   * @param lambdaFilePath The path to test
   * @returns The lambda code if found, a dummy function when not found
   */
  static codeFromAsset = (scope: Construct, lambdaFilePath: string): Code => {
    if (!fs.existsSync(lambdaFilePath)) {
      Annotations.of(scope).addError(`Cannot deploy this stack. Lambda code not found ${lambdaFilePath}`)
      return Code.fromInline('exports.handler = async (event) => { return { statusCode: 500 }}')
    }
    return Code.fromAsset(lambdaFilePath)
  }
}
