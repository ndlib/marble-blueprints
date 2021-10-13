# CDK Deployment Application

This application uses [aws-cdk](https://aws.amazon.com/cdk/) for deployment.

Prerequisites:

* node 9+
* yarn
* aws-cdk v1.75+

## Build

Before running a deploy, make sure you install the npm modules and build the cdk application:

```sh
yarn install
yarn build
yarn test
```

## Deploying a stack to development

This is a multi-stack cdk application that can deploy services independently of one another. All services are built on top of a foundation stack that will create shared resources such as log groups and log buckets. When deploying this application, you must specify an environment and the stack name.

Example to deploy the foundation stack to the dev account:

`cdk deploy -c env=dev marble-foundation`

To see all stacks that can be deployed with this application, use `cdk list`. Example:

```sh
$ cdk list -c env=dev
marble-elastic
marble-foundation
marble-image-processing
marble-image-service
marble-manifest
marble-multimedia-assets
marble-redbox
marble-website
marble-maintain-metadata
marble-service-levels
```

## Deploying to production

We will be using continuous deployment pipelines for managing our stacks in the production account. These pipelines can be deployed with one command:

`cdk deploy -c env=prod -c stackType=pipeline  marble*deployment`

It is recommended you run this as a diff to review the changes prior to redeploying:

`cdk diff -c env=prod -c stackType=pipeline  marble*deployment`

Once all pipelines have fully deployed to production, deploy the service levels stack to monitor the production stacks:

```sh
npm run cdk deploy -- --exclusively marbleb-prod-service-levels \
  -c "namespace=marbleb-prod" \
  -c "env=prod"
```

## Context overrides

There are a number of context values that can be overridden on the cli at deploy time that will change how and where the stacks are deployed.

### AWS Environment

Use the `env` context to determine what AWS account to deploy to and what configuration to use when deploying to that account. Possible values:

* `dev` - Use when deploying to our development account (testlibnd).
* `prod` - Use when deploying to our production account (libnd).

Example deploy of all service stacks to our dev account:

`cdk deploy -c env=dev marble*`

### Stack type

Stacks are split into two different types. The type chosen will determine what stacks are available for a cdk deploy. Possible values:

* `service` (default) - These will deploy the service stacks. You will use this type most often used when deploying an individual stack in development, or within a deployment pipeline.
* `pipeline` - These are deployment pipelines that will perform continuous deployment of the service stacks

Example deploy of all deployment pipelines to our development account:

`cdk deploy -c env=dev -c stackType=pipeline  marble*deployment`

### Stack namespace

All stacks are prefixed with a stack namespace. By default, this is `marble` but can be changed so that you can separate your stacks from any others. This is useful for developers who share a development account, or when performing a side-by-side deployment to production to reduce downtime.

Example deploy of the IIIF serverless stack with a different stack namespace:

`cdk deploy -c env=dev -c namespace=foo foo-image-service`

### Application source

When deploying a service stack, you will need to point cdk at the directory where it can find the application. The overrides are specific to each service. Here are the current keys along with their defaults:

* `"iiifImageService:serverlessIiifSrcPath"`: "../../../serverless-iiif"
* `"imageProcessing:lambdaCodePath"`: "../../../marble-images/s3_event"
* `"imageProcessing:dockerfilePath"`: "../../../marble-images/"
* `"manifestPipeline:lambdaCodeRootPath"`: "../../../marble-manifest-pipeline"

Note: Cdk will not build the application source, so make sure you've run any install/build scripts for the application that need to be run prior to running the deploy.

### Watched branches in CD

All continuous deployment pipelines are by default configured to watch the master branch for changes. These can be overridden if necessary, such as when making changes or adding a new pipeline.

Example deploy of the IIIF deployment pipeline to watch a development branch on both the IIIF serverless repo and the infrastructure repo (this repo):

```sh
cdk deploy -c env=dev -c stackType=pipeline \
  -c "iiifImageService:appSourceBranch=my-iiif-feature-branch" \
  -c "infraSourceBranch=my-infra-feature-branch" \
  marble-image-service-deployment
```

### Others

To view all other context keys that can be overridden, use `cdk context`.

## Useful commands

* `yarn build`      compile typescript to js
* `yarn watch`      watch for changes and compile
* `yarn test`       perform the jest unit tests
* `yarn lint`       run eslint on all project files
* `yarn format`     run eslint on all project files and autofix all errors that can be fixed automatically
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
