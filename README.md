# marble-blueprints
The "Infrastructure as Code" repo for all pieces in the Marble project. Will contain Cloud Formation Templates, Ansible playbooks, deploy scripts, etc for all components of the new system.

Note: It is highly recommended you use something like https://github.com/awslabs/git-secrets to prevent pushing AWS secrets to the repo

# Requirements
Before you begin, check that you have the following:
  - A role with permissions to deploy cloudformations. In most cases, will require permissions to create IAM roles/policies (see [Permissions Required to Access IAM Resources](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_permissions-required.html))
  - Ability to manage DNS for your organization to validate certificates (see [Use DNS to Validate Domain Ownership](https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-validate-dns.html))
  - A policy that allows your approvers to approve pipelines (see [Grant Approval Permissions to an IAM User in AWS CodePipeline](https://docs.aws.amazon.com/codepipeline/latest/userguide/approvals-iam-permissions.html))
  - Must have awscli installed if using the example deploy commands

# Deploy
TODO:
* [ ] Add stack diagram. Important to note the Network and App-Infrastructure stacks are intended to be shared per env. Ex: Only one of each of these exist in dev, but you can have multiple dev instances of service/webcomponent stacks for each developer.
* [ ] Explain why we have the separation we do, reference [Organize Your Stacks By Lifecycle and Ownership](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/best-practices.html#organizingstacks)

## Deploy Shared Infrastructure
Before you can deploy any of the other stacks, you must deploy some prerequisite pieces of shared infrastructure. These are required by both the application components and the CI/CD stacks that test and deploy those application components.

### Network stack

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --template-file deploy/cloudformation/network.yml \
  --stack-name marble-network \
  --tags ProjectName=marble Name='testaccount-marblenetwork-dev' Contact='me@myhost.org' Owner='myid' \
    Description='brief-description-of-purpose'
```

TODO: Add example of exporting an existing network

### Infrastructure stack

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --template-file deploy/cloudformation/app-infrastructure.yml \
  --stack-name marble-app-infrastructure \
  --tags ProjectName=marble Name='testaccount-marbleappinfrastructure-dev' Contact='me@myhost.com' Owner='myid'\
  Description='brief-description-of-purpose'
```


### Domain stack
Defines a domain and creates a wildcard certificate that can be used for services built in this domain. By default, it will create a zone in Route53 for you, but this can be skipped if you're using your own DNS by overriding the CreateDNSZone parameter.

A few things to note:
1. You will likely need to do this in us-east-1 so that your ACM certificate can be used by Cloudfront (see https://aws.amazon.com/premiumsupport/knowledge-center/custom-ssl-certificate-cloudfront/).
1. This will require adding a DNS entry to validate the certificate created by the stack. The stack will not complete until this is done. See https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-validate-dns.html. If you are creating a Route53 zone in this stack, you can add a record to the new zone as soon as both the zone and cert are created by the stack.

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --region us-east-1 \
  --template-file deploy/cloudformation/domain.yml \
  --stack-name marble-domain \
  --parameter-overrides DomainName='mydomain.edu' CreateDNSZone='True' UseDNSZone='' \
  --tags ProjectName=marble Name='marble-domain' Contact='me@myhost.com' Owner='myid'\
  Description='brief-description-of-purpose'
```

## Deploy Application Components

### Data Broker stack
```console
aws cloudformation deploy \
  --stack-name marble-data-broker-dev \
  --template-file deploy/cloudformation/data-broker.yml \
  --tags ProjectName=marble Name='testaccount-marbledatabroker-dev' Contact='me@myhost.com' Owner='myid'\
  Description='brief-description-of-purpose'
```

### IIIF Image Service stack
```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --stack-name marble-image-service-dev \
  --template-file deploy/cloudformation/iiif-service.yml \
  --tags ProjectName=marble NameTag='testaccount-marbleimageservice-dev' \
    ContactTag='me@myhost.com' OwnerTag='myid' \
    Description='brief-description-of-purpose' \
  --parameter-overrides
    ContainerCpu='1024' ContainerMemory='2048' DesiredCount=1
```

### IIIF Image Viewer Webcomponent stack
```console
aws cloudformation deploy \
  --stack-name marble-image-webcomponent-dev \
  --template-file deploy/cloudformation/static-host.yml \
  --tags ProjectName=marble Name='testaccount-marbleimagewebcomponent-dev' \
    Contact='me@myhost.com' Owner='myid' \
    Description='brief-description-of-purpose'
```

### Main Website stack
```console

aws cloudformation package \
  --template-file deploy/cloudformation/unified-static-host.yml \
  --s3-bucket $DEPLOY_BUCKET_TESTLIBND \
  --output-template-file output.yml

aws cloudformation deploy \
  --stack-name marble-website-jon \
  --template-file output.yml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides HostnamePrefix='marble-website-dev' \
  --tags ProjectName=marble Name='testaccount-marbleimagewebsite-dev' \
    Contact='me@myhost.com' Owner='myid' \
    Description='brief-description-of-purpose'
```

### Test the edge lambda for the main website.

1. Install node 8.10
2. Install Yarn

```console

cd src/unifiedEdgeLambda
yarn install
yarn run jest
````

## Deploy CI/CD
Before you begin see https://developer.github.com/v3/auth/#via-oauth-tokens for how to generate an OAuth token for use with these pipelines.

### IIIF Image Service Pipeline
This will deploy to test, then to production, so it expects two different image-service stacks to exist, ex: "marble-image-service-test" and "marble-image-service-prod". If custom stack names were used for the image-service stacks, you'll need to override the default parameters for IIIFProdServiceStackName and IIIFTestServiceStackName.

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --stack-name marble-image-service-pipeline \
  --template-file deploy/cloudformation/iiif-service-pipeline.yml \
  --tags ProjectName=marble Name='testaccount-marbleimageservicepipeline' \
    Contact='me@myhost.com' Owner='myid' \
    Description='brief-description-of-purpose' \
  --parameter-overrides OAuth=my_oauth_key Approvers=me@myhost.com \
```

### IIIF Image Viewer Pipeline
This will deploy to test, then to production, so it expects two different image-viewer stacks to exist, ex: "marble-image-webcomponent-test" and "marble-image-webcomponent-prod".

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --stack-name marble-image-webcomponent-pipeline \
  --template-file deploy/cloudformation/static-host-pipeline.yml \
  --tags ProjectName=marble Name='testaccount-marbleimagewebcomponentpipeline' \
    Contact='me@myhost.com' Owner='myid' \
    Description='brief-description-of-purpose' \
  --parameter-overrides OAuth=my_oauth_key Approvers=me@myhost.com \
    SourceRepoOwner=ndlib SourceRepoName=image-viewer BuildScriptsDir='build' BuildOutputDir='dist' \
    TestStackName=marble-image-webcomponent-test ProdStackName=marble-image-webcomponent-prod
```

# IIIF Manifest Pipeline
This will create an AWS CodePipeline that will deploy the [manifest data pipeline](https://github.com/ndlib/marble-manifest-pipeline).

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_NAMED_IAM \
  --stack-name marble-manifest-deploy-pipeline \
  --template-file deploy/cloudformation/manifest-pipeline-pipeline.yml \
  --tags Name='marble-manifest-pipeline' Contact='me@myhost.com' Owner='myid' Description='Deploys the IIIF Manifest Data Pipeline.' \
  --parameter-overrides GitHubToken=my_oauth_key Receivers=me@myhost.com \
    TestHostnamePrefix='marble-manifest-test' ProdHostnamePrefix='marble-manifest' \
    AppConfigPathTest='/all/marble-manifest-test' AppConfigPathProd='/all/marble-manifest-prod' \
    NoReplyEmailAddr='me@myhost.com' TroubleshooterEmailAddr='me@myhost.com'
```

### Website Pipeline
This will deploy to test, then to production, so it expects two different website stacks to exist, ex: "marble-website-test" and "marble-website-prod".

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --stack-name marble-website-pipeline \
  --template-file deploy/cloudformation/static-host-pipeline.yml \
  --tags ProjectName=marble Name='testaccount-marbleimagewebsitepipeline' \
    Contact='me@myhost.com' Owner='myid' \
    Description='brief-description-of-purpose' \
  --parameter-overrides OAuth=my_oauth_key Approvers=me@myhost.com \
    SourceRepoOwner=ndlib SourceRepoName=marble-website \
    TestStackName=marble-website-test ProdStackName=marble-website-prod
```

#### Approval message
Once the pipeline reaches the UAT step, it will send an email to the approvers list and wait until it's either approved or rejected. Here's an example of the message.

```email
Approve or reject: https://console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/marble-image-webcomponent-pipeline-CodePipeline-ID/Approval/ManualApprovalOfTestEnvironment/approve/approval-id
Additional information: You can review these changes at https://testurl. Once approved, this will be deployed to https://produrl.
Deadline: This review request will expire on 2018-10-15T20:36Z
```

The link given in the email will take the user directly to the approval modal:

* [ ] Add screenshot of approval here

Note: The user must be logged in and have the appropriate permissions to approve pipelines.

### Pipeline Monitoring
Use this stack if you want to notify an email address of pipeline events. It is currently written to only accept a single email address, so it's recommended you use a mailing list for the Receivers parameter.

Here's an example of adding monitoring to the image-webcomponent-pipeline
```console
aws cloudformation deploy \
  --stack-name marble-image-webcomponent-pipeline-monitoring \
  --template-file deploy/cloudformation/pipeline-monitoring.yml \
  --tags ProjectName=marble Name='testaccount-marbleimagewebcomponentpipeline-monitoring' \
    Contact='me@myhost.com' Owner='myid' Description='brief-description-of-purpose' \
  --parameter-overrides PipelineStackName=marble-image-webcomponent-pipeline Receivers=me@myhost.com
```

Here's an example of adding monitoring to the website-pipeline
```console
aws cloudformation deploy \
  --stack-name marble-website-pipeline-monitoring \
  --template-file deploy/cloudformation/pipeline-monitoring.yml \
  --tags ProjectName=marble Name='testaccount-marbleimagewebsitepipeline-monitoring' \
    Contact='me@myhost.com' Owner='myid' Description='brief-description-of-purpose' \
  --parameter-overrides PipelineStackName=marble-website-pipeline Receivers=me@myhost.com
```

Here's an example of adding monitoring to the image-service-pipeline
```console
aws cloudformation deploy \
  --stack-name marble-image-service-pipeline-monitoring \
  --template-file deploy/cloudformation/pipeline-monitoring.yml \
  --tags ProjectName=marble Name='testaccount-marbleimageservicepipeline-monitoring' \
    Contact='me@myhost.com' Owner='myid' Description='brief-description-of-purpose' \
  --parameter-overrides PipelineStackName=marble-image-service-pipeline Receivers=me@myhost.com
```

How to build the Primo Passthrough Pipeline
```console
aws cloudformation deploy \
  --capabilities CAPABILITY_NAMED_IAM \
  --stack-name mellon-passthrough-pipeline \
  --template-file deploy/cloudformation/manifest-passthrough-pipeline.yml \
  --tags Name='mellon-passthrough-pipeline' Contact='me@myhost.com' Owner='myid' Description='CF for Passthrough Pipeline.' \ 
  --parameter-overrides Receivers=email@email.com GitHubToken=ADDME! PassthroughVersion='setMe'
```

#### Examples of the notifications:
##### Started
The pipeline marble-image-webcomponent-pipeline has started. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/marble-image-webcomponent-pipeline-CodePipeline-ID.

##### Success
The pipeline marble-image-webcomponent-pipeline has successfully deployed to production. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/marble-image-webcomponent-pipeline-CodePipeline-ID.

##### Source failure
Failed to pull the source code for marble-image-webcomponent-pipeline. To view the current execution, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/marble-image-webcomponent-pipeline-CodePipeline-ID.

##### Build failure
Failed to build marble-image-webcomponent-pipeline. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/marble-image-webcomponent-pipeline-CodePipeline-ID.

##### Deploy to test failure
Build for marble-image-webcomponent-pipeline failed to deploy to test stack. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/marble-image-webcomponent-pipeline-CodePipeline-ID.

##### Approval failure
Build for marble-image-webcomponent-pipeline was rejected either due to a QA failure or UAT rejection. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/marble-image-webcomponent-pipeline-CodePipeline-ID.

##### Deploy to production failure
Build for marble-image-webcomponent-pipeline failed to deploy to production. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/marble-image-webcomponent-pipeline-CodePipeline-ID.

##### Generic resume after a failure
The pipeline marble-image-webcomponent-pipeline has changed state to RESUMED. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/marble-image-webcomponent-pipeline-CodePipeline-ID.
