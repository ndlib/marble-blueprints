# Marble Website

This will create the infrastructure to host the [front end website](https://github.com/ndlib/marble-website) for the project.

This component uses the [unified-static-host.yml](/deploy/cloudformation/unified-static-host.yml) template. Below is the list of parameters that can be overridden in this template. Parameters with no default are required.

| Parameter | Description | Default |
|-----------|-------------|---------|
| InfrastructureStackName | The name of the parent infrastructure/networking stack that you created. Necessary to locate and reference resources created by that stack. | marble-app-infrastructure |
| DomainStackName | The name of the parent domain stack that you created. Necessary to locate and reference resources created by that stack. | marble-domain |
| CreateDNSRecord | If True, will attempt to create a Route 53 DNS record for the CloudFront. | True |
| HostnamePrefix | Hostname prefix for the website CDN |  |
| EnvType | The type of environment to create, dev or prod. Affects default TTL | dev |

To deploy this service, you will need to package an edge lambda, then create 3 stacks: a test stack, production stack, and a continuous delivery pipeline stack.

## Test the edge lambda
1. Install node 8.10
2. Install Yarn

```console
cd src/unifiedEdgeLambda
yarn install
yarn run jest
```

## Package Edge Lambda
```console
aws cloudformation package \
  --template-file deploy/cloudformation/unified-static-host.yml \
  --s3-bucket $DEPLOY_BUCKET \
  --output-template-file unified-static-host-output.yml
```

## Test
```console
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name marble-website-test \
  --template-file unified-static-host-output.yml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides HostnamePrefix='marble-test'
```

## Production
```console
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name marble-website-test \
  --template-file unified-static-host-output.yml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides HostnamePrefix='marble'
```

## Continuous Delivery Pipeline
This will create a CodePipeline that will monitor Github for changes and deploy those changes to a test stack, then to a production stack, so it expects the two different stacks above to exist.

Before you begin see https://developer.github.com/v3/auth/#via-oauth-tokens for how to generate an OAuth token for use with these pipelines.

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --region us-east-1 \
  --stack-name marble-website-deployment \
  --template-file deploy/cloudformation/static-host-pipeline.yml \
  --parameter-overrides OAuth=my_oauth_key \
    SourceRepoOwner=ndlib SourceRepoName=marble-website \
    TestStackName=marble-website-test ProdStackName=marble-website-prod
```

Below is the list of parameters that can be overridden in this template. Parameters with no default are required.

| Parameter | Description | Default |
|-----------|-------------|---------|
| SourceRepoOwner | The owner of the repository in Github to poll |  |
| SourceRepoName | The name of the repository in Github to poll |  |
| CDBranchName | The name of the branch to watch for continuous deployment | master |
| BuildScriptsDir | The location of all codebuild scripts, relative to the root of the project. Expects to find the following scripts install.sh, pre_build.sh, build.sh, and post_build.sh | scripts/codebuild |
| BuildOutputDir | The location of the final build artifacts for the project. Everything in this directory will get copied to the target bucket. | build |
| OAuth | The OAuth Token Value to connect CodePipeline to GitHub | |
| ProdStackName | The name of the CloudFormation stack that created the production static host | |
| TestStackName | The name of the CloudFormation stack that created the test static host |||
