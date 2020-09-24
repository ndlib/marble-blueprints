import { Environment } from "@aws-cdk/cx-api"
import { ConstructNode } from "@aws-cdk/core"
import { getRequiredContext } from "./context-helpers"

export class ContextEnv {
  readonly name: string
  readonly env: Environment
  readonly useVpcId: string
  readonly createDns: boolean
  readonly domainName: string
  readonly useExistingDnsZone: boolean
  readonly slackNotifyStackName: string
  readonly notificationReceivers: string
  readonly rBSCS3ImageBucketName: string
  readonly createGithubWebhooks: boolean

  static fromContext = (node: ConstructNode, name: string): ContextEnv => {
    const contextEnv = getRequiredContext(node, 'environments')[name]
    if(contextEnv === undefined || contextEnv === null) {
      throw new Error(`Context key 'environments.${name}' is required.`)
    }
    contextEnv.name = name
    contextEnv.env = { account: contextEnv.account, region: contextEnv.region, name: contextEnv.name }
    return contextEnv
  }
}