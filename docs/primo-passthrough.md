# Primo Passthrough

This will create an AWS CodePipeline that will deploy a [serverless Primo proxy](https://github.com/ndlib/marble-passthrough-primo). It will deploy a test and production stack using the [primo-passthrough.yml](/deploy/cloudformation/primo-passthrough.yml) template.


Before you begin see https://developer.github.com/v3/auth/#via-oauth-tokens for how to generate an OAuth token for use with these pipelines. Make sure your token provides the `public_repo` scope.

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_NAMED_IAM \
  --stack-name marble-primo-passthrough-deployment \
  --template-file deploy/cloudformation/primo-passthrough-pipeline.yml \
  --parameter-overrides GitHubToken=my_oauth_key PassthroughVersion='dev'
```

Below is the list of parameters that can be overridden in this template. Parameters with no default are required.

| Parameter | Description | Default |
|-----------|-------------|---------|
| ProdStackName | The name of the CloudFormation stack to use when creating the production resources | marble-passthroughprimo-pipeline-prod |
| TestStackName | The name of the CloudFormation stack to use when creating the test resources | marble-passthroughprimo-pipeline-test |
| ConfigurationRepoName | The GitHub repo for the cloudfromation blueprints | marble-blueprints |
| ConfigurationRepoBranchName | The GitHub repo branch the codepipeline should checkout to run blueprints from | master |
| PassthroughPrimoPipelineRepoName | The GitHub repo name | marble-passthrough-primo |
| PassthroughPrimoPipelineRepoBranch | The GitHub repo branch code pipelines should watch for changes on | master |
| GitHubUser | GitHub UserName. This username must have access to the GitHubToken. | ndlib |
| GitHubToken | Secret. OAuthToken with access to Repo. Long string of characters and digits. Go to https://github.com/settings/tokens |  |
| AppConfigPathProd | The path the keys for parameter store should be read and written to for config | /all/marble-passthroughprimo-pipeline-prod |
| AppConfigPathTest | The path the keys for parameter store should be read and written to for config | /all/marble-passthroughprimo-pipeline-test |
| PassthroughVersion | Passthrough Git versioning information | dev |
| ContactTag | The Contact tag to add to the deployed stacks |  |
| OwnerTag | The Owner tag to add to the deployed stacks |||
