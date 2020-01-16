
# IIIF Manifest Pipeline

This will create an AWS CodePipeline that will deploy the [manifest data pipeline](https://github.com/ndlib/marble-manifest-pipeline). It will deploy a test and production stack using the [manifest-pipeline.yml](/deploy/cloudformation/manifest-pipeline.yml) template.

Before you begin see https://developer.github.com/v3/auth/#via-oauth-tokens for how to generate an OAuth token for use with these pipelines. Make sure your token provides the `public_repo` scope.

## Sentry Integration Prerequisites
The manifest pipeline reports uncaught errors through [Sentry](sentry.io). For this, you'll need to create a Sentry account and create a project to report errors to(note the DSN of the project). The DSN will be passed as a parameter, SentryDsn, when standing up the pipeline.

Once this is setup we'll create a lambda layer to handle the error reporting. Follow these [steps](sentry-layer.md) before continuing.

## Manifest Pipeline Deployment
```
aws cloudformation deploy \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1 \
  --stack-name marble-manifest-deployment \
  --template-file deploy/cloudformation/manifest-pipeline-pipeline.yml \
  --parameter-overrides GitHubToken=my_oauth_key ContactTag=me@myhost.com OwnerTag=me \
    TestHostnamePrefix='marble-manifest-test' ProdHostnamePrefix='marble-manifest' \
    SentryDsn='https://123456789@sentry.io/123456789'
```

Below is the list of parameters that can be overridden in this template. Parameters with no default are required.

| Parameter | Description | Default |
|-----------|-------------|---------|
| InfrastructureStackName | The name of the parent infrastructure/networking stack that you created. Necessary to locate and reference resources created by that stack. | marble-app-infrastructure |
| DomainStackName | The name of the parent domain stack that you created. Necessary to locate and reference resources created by that stack. | marble-domain |
| ProdStackName | The name of the CloudFormation stack to use when creating the production resources | marble-manifest-prod |
| ProdHostnamePrefix | Hostname prefix for the production manifest bucket CDN |  |
| TestStackName | The name of the CloudFormation stack to use when creating the test resources | marble-manifest-test |
| TestHostnamePrefix | Hostname prefix for the test manifest bucket CDN |  |
| CreateDNSRecord | If True, will attempt to create a Route 53 DNS record for the test and prod stacks. | True |
| ConfigurationRepoName | The GitHub repo for the cloudfromation blueprints | marble-blueprints |
| ConfigurationRepoBranchName | The GitHub repo branch the codepipeline should checkout to run blueprints from | master |
| ManifestPipelineRepoName | The GitHub repo name | marble-manifest-pipeline |
| ManifestPipelineRepoBranch | The GitHub repo branch code pipelines should watch for changes on | master |
| GitHubUser | GitHub UserName. This username must have access to the GitHubToken. | ndlib |
| GitHubToken | Secret. OAuthToken with access to Repo. Long string of characters and digits. Go to https://github.com/settings/tokens |  |
| ImageServiceTestStackName | The name of the test IIIF image service stack | marble-image-service-test |
| ImageServiceProdStackName | The name of the production IIIF image service stack | marble-image-service-prod |
| DataBrokerStackName | The name of the shared data broker stack | marble-data-broker |
| AppConfigPathProd | The path the keys for parameter store should be read and written to for config | /all/marble-manifest-pipeline-prod |
| AppConfigPathTest | The path the keys for parameter store should be read and written to for config | /all/marble-manifest-pipeline-test |
| ContactTag | The Contact tag to add to the deployed stacks |  |
| OwnerTag | The Owner tag to add to the deployed stacks |  |
| ManifestUtilityLayer | SSM path manifest uility layer ARN | /all/stacks/marble/manifest-layer |
| SentryLayer | The name of the Sentry layer | /all/stacks/marble/sentry-layer |
| SentryDsn | The Sentry project DSN |  |
