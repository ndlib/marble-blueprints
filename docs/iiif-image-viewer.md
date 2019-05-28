# IIIF Image Viewer Webcomponent

This will create the infrastructure to host a [IIIF Viewer WebComponent](https://github.com/ndlib/marble-image-viewer) based on [UniversalViewer](https://github.com/UniversalViewer/universalviewer).

This component uses the [static-host.yml](/deploy/cloudformation/static-host.yml) template. Below is the list of parameters that can be overridden in this template. Parameters with no default are required.

| Parameter | Description | Default |
|-----------|-------------|---------|
| InfrastructureStackName | The name of the parent infrastructure/networking stack that you created. Necessary to locate and reference resources created by that stack. | marble-app-infrastructure |
| DomainStackName | The name of the parent domain stack that you created. Necessary to locate and reference resources created by that stack. | marble-domain |
| CreateDNSRecord | If True, will attempt to create a Route 53 DNS record for the CloudFront. | True |
| HostnamePrefix | Hostname prefix for the website CDN |  |
| EnvType | The type of environment to create, dev or prod. Affects default TTL | dev |

To deploy this service, you will need to create 3 stacks: a test stack, production stack, and a continuous delivery pipeline stack.

## Test
```console
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name marble-image-viewer-test \
  --template-file deploy/cloudformation/static-host.yml \
  --parameter-overrides EnvType=prod HostnamePrefix=viewer-iiif-test
```

## Production
```console
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name marble-image-viewer-prod \
  --template-file deploy/cloudformation/static-host.yml \
  --parameter-overrides EnvType=prod HostnamePrefix=viewer-iiif
```

## Continuous Delivery Pipeline
This will create a CodePipeline that will monitor Github for changes and deploy those changes to a test stack, then to a production stack, so it expects the two different image-viewer stacks above to exist.

Before you begin see https://developer.github.com/v3/auth/#via-oauth-tokens for how to generate an OAuth token for use with these pipelines. Make sure your token provides the `public_repo` scope.

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --region us-east-1 \
  --stack-name marble-image-viewer-deployment \
  --template-file deploy/cloudformation/static-host-pipeline.yml \
  --parameter-overrides OAuth=my_oauth_key \
    SourceRepoOwner=ndlib SourceRepoName=marble-image-viewer BuildScriptsDir='build' BuildOutputDir='dist' \
    TestStackName=marble-image-viewer-test ProdStackName=marble-image-viewer-prod
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
