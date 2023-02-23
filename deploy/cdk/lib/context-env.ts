import { Environment } from "aws-cdk-lib/cx-api"
import { Node } from "constructs"
import { getRequiredContext } from "./context-helpers"

export class ContextEnv {
  readonly name: string
  readonly env: Environment
  readonly useVpcId: string
  readonly domainName: string
  readonly useExistingDnsZone: boolean
  readonly slackChannelId: string
  readonly slackChannelName: string
  readonly slackNotifyStackName: string
  readonly notificationReceivers: string
  readonly rBSCS3ImageBucketName: string
  readonly createGithubWebhooks: boolean
  readonly alarmsEmail: string
  readonly marbleContentBucketName: string
  readonly marbleContentFileShareId: string
  readonly hostedZoneTypes: string[]
  readonly hostedZoneTypesTest: string[]

  static fromContext = (node: Node, name: string): ContextEnv => {
    const contextEnv = getRequiredContext(node, 'environments')[name]
    if(contextEnv === undefined || contextEnv === null) {
      throw new Error(`Context key 'environments.${name}' is required.`)
    }
    contextEnv.name = name
    contextEnv.env = { account: contextEnv.account, region: contextEnv.region, name: contextEnv.name }
    return contextEnv
  }
}