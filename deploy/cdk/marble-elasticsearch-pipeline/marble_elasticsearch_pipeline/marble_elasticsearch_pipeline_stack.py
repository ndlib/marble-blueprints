"""
This module creates an AWS pipeline for deploying
stacks of marble elasticsearch clusters.
"""

from aws_cdk import (
    aws_codepipeline as codepipeline,
    aws_codepipeline_actions as codepipeline_actions,
    aws_iam as iam,
    aws_sns as sns,
    aws_s3 as s3,
    core
)
import build_project as build
import re


class MarbleElasticsearchPipelineStack(core.Stack):
    """
    Construct AWS pipline stack resource. Responsible for generating
    AWS IAM roles/permissions, retrieving/building source code,
    and creating the pipeline with various stages.

    :param es_stack: The prefix of the elasticsearch stack
    :param repo_name: The name of the elasticsearch github repo
    :param repo_branch: The branch name to checkout from the github repo
    :param repo_owner: The owner of the elasticsearch github repo
    :param repo_oauth_path: The secrets manager path to the oauth value
    :param artifact_bucket: The S3 bucket for storing artifacts
    :param codepipeline_role: The role for executing pipeline actions
    :param codebuild_role: The role for executing build actions
    :return: returns nothing
    """
    def __init__(self, scope: core.Construct, id: str, **kwargs) -> None:
        super().__init__(scope, id, **kwargs)
        self.es_stack = 'marble-elasticsearch'
        self.repo_name = scope.node.try_get_context('repo_name')
        self.repo_branch = scope.node.try_get_context('repo_branch')
        self.repo_owner = scope.node.try_get_context('repo_owner')
        self.repo_oauth_path = scope.node.try_get_context('repo_oauth_path')
        self._setup_artifact()
        self._setup_iam()
        self.pipeline = codepipeline.Pipeline(self, 'ElasticSearchPipeline',
                                              artifact_bucket=self.artifact_bucket,
                                              role=self.codepipeline_role)

    def add_stages(self):
        # REPOSITORY STAGE
        # Need a cloudformation parameter to keep the token from being exposed in the template
        oauth_token = core.SecretValue.secrets_manager(self.repo_oauth_path, json_field='oauth')
        oauth_desc = 'Secret. OAuthToken with access to Repo. Long string of characters and digits. Go to https://github.com/settings/tokens'
        source_output = codepipeline.Artifact()
        source_action = codepipeline_actions.GitHubSourceAction(action_name='Github_App_Source',
                                                                owner=self.repo_owner,
                                                                repo=self.repo_name,
                                                                branch=self.repo_branch,
                                                                oauth_token=oauth_token,
                                                                output=source_output,
                                                                trigger=codepipeline_actions.GitHubTrigger.POLL)
        self.pipeline.add_stage(stage_name='Source', actions=[source_action])

        # TEST STAGE
        test_project = build.BuildProject(self, self.codebuild_role, 'test', {'es_stackname': self.es_stack}).pipeline_project()
        test_actions = codepipeline_actions.CodeBuildAction(action_name=f"testBuildMarbleElasticSearchStack",
                                                            project=test_project,
                                                            input=source_output,
                                                            run_order=1)

        # SNS topics
        approval_topic = sns.Topic(self, 'PipelineApprovalTopic', display_name='PipelineApprovalTopic')
        console_link = f'https://console.aws.amazon.com/es/home?region={core.Aws.REGION}#domain:resource={self.es_stack}-test;action=dashboard'
        approval_msg = f'Approve or Reject this change after testing {self.es_stack}-test elasticsearch instance: {console_link}'
        approval_actions = codepipeline_actions.ManualApprovalAction(action_name='ManualApprovalOfTestEnvironment',
                                                                     notification_topic=approval_topic,
                                                                     additional_information=approval_msg,
                                                                     run_order=2)

        self.pipeline.add_stage(stage_name='DeployToTest', actions=[test_actions, approval_actions])

        # PROD STAGE
        prod_project = build.BuildProject(self, self.codebuild_role, 'prod', {'es_stackname': self.es_stack}).pipeline_project()
        prod_actions = codepipeline_actions.CodeBuildAction(action_name=f"prodBuildMarbleElasticSearchStack",
                                                            project=prod_project,
                                                            input=source_output)

        self.pipeline.add_stage(stage_name='DeployToProd', actions=[prod_actions])

    def _setup_artifact(self):
        """
        Create/Configure S3 artifcat bucket with permissions
        """
        self.artifact_bucket = s3.Bucket(self, 'ArtifactBucket', removal_policy=core.RemovalPolicy.DESTROY)
        self.artifact_bucket.add_to_resource_policy(
            iam.PolicyStatement(
                principals=[iam.AnyPrincipal()],
                effect=iam.Effect.DENY,
                actions=['s3:*'],
                conditions={'Bool': {'aws:SecureTransport': False}},
                resources=[self.artifact_bucket.bucket_arn + '/*']
            )
        )

    def _setup_iam(self):
        """
        Create/Configure IAM roles with permissions
        """
        account_id = core.Aws.ACCOUNT_ID
        region = core.Aws.REGION
        aws_stack = core.Aws.STACK_NAME

        # IAM roles
        self.codepipeline_role = iam.Role(self, 'CodePipelineRole', assumed_by=iam.ServicePrincipal('codepipeline.amazonaws.com'))
        self.codebuild_role = iam.Role(self, 'CodeBuildTrustRole', assumed_by=iam.ServicePrincipal('codebuild.amazonaws.com'))

        # Allow checking what policies are attached to this role and any roles the application stack creates
        # When cdk makes roles, it removes all punctuation. The application stack should prefix the LogicalId
        # of any construct that needs roles with the stack name so that it matches the wildcard here.
        role_pattern = re.sub("[.,\/#!$%\^&\*;:{}=\-_`~()]", "", self.stack_name) + '*' # noqa
        self.codebuild_role.add_to_policy(
            iam.PolicyStatement(
                resources=[
                    self.codebuild_role.role_arn,
                    f"arn:aws:iam::{account_id}:role/{role_pattern}/*",
                ],
                actions=['iam:GetRolePolicy']
            )
        )

        # Allow logging
        self.codebuild_role.add_to_policy(
            iam.PolicyStatement(
                resources=[f"arn:aws:logs::{account_id}:log-group:/aws/codebuild/{aws_stack}-*"],
                actions=['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            )
        )

        # Allow storing artifacts in S3 buckets
        # Allow staging of assets in the cdk staging bucket - necessary when the application has lambda code.
        self.codebuild_role.add_to_policy(
            iam.PolicyStatement(
                resources=[
                            self.artifact_bucket.bucket_arn,
                            'arn:aws:s3:::cdktoolkit-stagingbucket-*',
                ],
                actions=['s3:ListBucket', 's3:GetObject', 's3:PutObject']
            )
        )

        # Allow fetching details about and updating the application stack
        self.codebuild_role.add_to_policy(
            iam.PolicyStatement(
                resources=[f'arn:aws:cloudformation:{region}:{account_id}:stack/{self.es_stack}*/*'],
                actions=[
                    'cloudformation:DescribeStacks',
                    'cloudformation:DescribeStackEvents',
                    'cloudformation:DescribeChangeSet',
                    'cloudformation:CreateChangeSet',
                    'cloudformation:ExecuteChangeSet',
                    'cloudformation:DeleteChangeSet',
                    'cloudformation:DeleteStack',
                    'cloudformation:GetTemplate',
                ],
            )
        )

        # Explicit permissions
        self.codebuild_role.add_to_policy(
            iam.PolicyStatement(
                resources=[f'arn:aws:es:{region}:{account_id}:domain/{self.es_stack}*'],
                actions=[
                    'es:CreateElasticsearchDomain',
                    'es:ESHttpDelete',
                    'es:ESHttpGet',
                    'es:ESHttpHead',
                    'es:ESHttpPatch',
                    'es:ESHttpPost',
                    'es:ESHttpPut',
                ],
            )
        )

        self.codebuild_role.add_to_policy(
            iam.PolicyStatement(
                resources=[f'arn:aws:es:{region}:{account_id}:domain/*'],
                actions=[
                    'es:AddTags',
                    'es:DeleteElasticsearchDomain',
                    'es:DescribeElasticsearchDomain',
                    'es:DescribeElasticsearchDomainConfig',
                    'es:DescribeElasticsearchDomains',
                    'es:GetCompatibleElasticsearchVersions',
                    'es:GetUpgradeHistory',
                    'es:GetUpgradeStatus',
                    'es:ListTags',
                    'es:RemoveTags',
                    'es:UpdateElasticsearchDomainConfig',
                    'es:UpgradeElasticsearchDomain',
                ],
            )
        )

        self.codebuild_role.add_to_policy(
            iam.PolicyStatement(
                resources=['*'],
                actions=[
                    'es:CreateElasticsearchServiceRole',
                    'es:DeleteElasticsearchServiceRole',
                    'es:DescribeElasticsearchInstanceTypeLimits',
                    'es:DescribeReservedElasticsearchInstanceOfferings',
                    'es:DescribeReservedElasticsearchInstances',
                    'es:ListDomainNames',
                    'es:ListElasticsearchInstanceTypeDetails',
                    'es:ListElasticsearchInstanceTypes',
                    'es:ListElasticsearchVersions',
                    'es:PurchaseReservedElasticsearchInstanceOffering',
                ],
            )
        )

        # Allow reading some details about CDKToolkit stack so we can use the CDK CLI successfully from CodeBuild.
        self.codebuild_role.add_to_policy(
            iam.PolicyStatement(
                resources=[f'arn:aws:cloudformation:{region}:{account_id}:stack/CDKToolkit/*'],
                actions=['cloudformation:DescribeStacks'],
            )
        )

        # Allow modifying IAM roles related to our application
        self.codebuild_role.add_to_policy(
            iam.PolicyStatement(
                resources=[f'arn:aws:iam::{account_id}:role/{self.stack_name}-*'],
                actions=['iam:GetRole', 'iam:CreateRole', 'iam:DeleteRole', 'iam:DeleteRolePolicy', 'iam:AttachRolePolicy', 'iam:DetachRolePolicy', 'iam:PutRolePolicy', 'iam:PassRole'],
            )
        )
