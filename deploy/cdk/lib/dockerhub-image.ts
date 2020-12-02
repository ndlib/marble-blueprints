import { IBuildImage, LinuxBuildImage } from '@aws-cdk/aws-codebuild'
import { Secret } from '@aws-cdk/aws-secretsmanager'
import { Construct } from '@aws-cdk/core'
import { getRequiredContext } from './context-helpers'

/**
 * Provides factory methods for more easily creating images 
 * that pull from Dockerhub using our credentials
 */
export class DockerhubImage {
  /**
   * Returns a LinuxBuildImage using the newman image from Dockerhub.
   * 
   * @param scope The scope that this image is being created within
   * @param id A unique identifier for this image
   * @param credentialsContextKeyName Optional override of what context key to look for for the credentials secret. Default: dockerhubCredentialsPath
   */
  static fromNewman(scope: Construct, id: string, credentialsContextKeyName?: string): IBuildImage {
    const contextKeyName = credentialsContextKeyName ?? 'dockerhubCredentialsPath'
    const secretName = getRequiredContext(scope.node, contextKeyName)
    return LinuxBuildImage.fromDockerRegistry('postman/newman', {
      secretsManagerCredentials: Secret.fromSecretNameV2(scope, `${id}Credentials`, secretName),
    })
  }
}