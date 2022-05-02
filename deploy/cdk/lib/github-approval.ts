import { GitHubSourceAction, ManualApprovalAction, ManualApprovalActionProps } from "aws-cdk-lib/aws-codepipeline-actions"

export interface GithubSourceProps {
  /**
   * Repo owner. Because we can't get this from the source action
   */
  readonly owner: string

  /**
   * A GitHubSourceAction that is used when deploying a change
   */
  readonly sourceAction: GitHubSourceAction
}

export interface GithubApprovalProps extends Omit<ManualApprovalActionProps, 'actionName'> {
  /**
   * List of Github sources from which to add commit details for the approval message
   */
  readonly githubSources: GithubSourceProps[]

  /**
   * Where to direct a reviewer to see the changes before they're pushed to production
   */
  readonly testTarget: string

  /**
   * The target that will be changed if the reviewer approves the change
   */
  readonly prodTarget: string

  /**
   * Alternate name to use for the action in the pipeline stage. Default: "Approval"
   */
  readonly actionName?: string
}

export class GithubApproval extends ManualApprovalAction {
    /**
     * Constructs an approval that contains links to the target hosts, the repos that were sourced, and a summary of the changes that are being pushed
     * @param props
     */
    constructor(props: GithubApprovalProps){
      const header = `Deployment to ${props.testTarget} successful. If approved, will attempt to deploy to ${props.prodTarget}.\n\n*Sources*\n`
      const changeInfo = props.githubSources.reduce((prev, current) =>
        `${prev}<https://github.com/${current.owner}/${current.sourceAction.variables.repositoryName}/commit/${current.sourceAction.variables.commitId}|*\`${current.sourceAction.variables.repositoryName}\`* changed on ${current.sourceAction.variables.authorDate}> - ${current.sourceAction.variables.commitMessage}\n\n`,
        header,
      )
      const defaults: ManualApprovalActionProps = {
        actionName: props.actionName ?? 'Approval',
        additionalInformation: props.additionalInformation ?? changeInfo,
        runOrder: props.runOrder ?? 99, // This should always be the last action in the stage
      }
      super({ ...defaults, ...props })
    }
}
