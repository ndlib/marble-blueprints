# mellon-blueprints
The "Infrastructure as Code" repo for all pieces in the Mellon Grant. Will contain Cloud Formation Templates, Ansible playbooks, deploy scripts, etc for all components of the new system.

Note: It is highly recommended you use something like https://github.com/awslabs/git-secrets to prevent pushing AWS secrets to the repo

# Requirements
Before you begin, check that you have the following:
  - A role with permissions to deploy cloudformations. In most cases, will require permissions to create IAM roles/policies (see [Permissions Required to Access IAM Resources](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_permissions-required.html))
  - Ability to manage DNS for your organization to validate certificates (see [Use DNS to Validate Domain Ownership](https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-validate-dns.html)). All deployments use SSL and thus require valid certificates.
  - A policy that allows your approvers to approve pipelines (see [Grant Approval Permissions to an IAM User in AWS CodePipeline](https://docs.aws.amazon.com/codepipeline/latest/userguide/approvals-iam-permissions.html))
  - Must have awscli installed if using the example deploy commands

# Deploy
TODO:
* [ ] Add stack diagram. Important to note the Network and App-Infrastructure stacks are intended to be shared per env. Ex: Only one of each of these exist in dev, but you can have multiple dev instances of service/webcomponent stacks for each developer.
* [ ] Explain why we have the separation we do, reference [Organize Your Stacks By Lifecycle and Ownership](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/best-practices.html#organizingstacks)

## Deploy Shared Infrastructure
Before you can deploy any of the other stacks, you must deploy some prerequisite pieces of shared infrastructure. These are required by both the application components and the CI/CD stacks that test and deploy those application components.

In all cases below, deployment is done using AWS CLI commands. The examples given must be rewritten with valid values for each of the parameters. The commands assume that default parameters are chosen in each case. In most deployments, however, non-default parameters will be desired. In each case, parameters defaults can be overwritten by adding a line similar to:

  -- parameter-overrides NetworkStackName='unpeered-network' \

which include all of the parameters to be overwritten.

### Network stack

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --template-file deploy/cloudformation/network.yml \
  --stack-name mellon-network \
  --tags ProjectName=mellon Name='testaccount-mellonnetwork-dev' Contact='me@myhost.org' Owner='myid' \
    Description='brief-description-of-purpose'
```

TODO: Add example of exporting an existing network

### Infrastructure stack

__Parameters:__
+ NetworkStackName
  + Description: The name of the parent networking stack created.
  + Default: "mellon-network"
+ EnvironmentName
  + Description: Any value that describes where the service exists
  + Default: "dev"
+ DomainName
  + Description: 'The DomainName to be used for all entities to be created. All services will be built within this Domain'
  + Default: 'library.nd.edu'

Note: This will require adding a DNS entry to validate the certificate created by the stack. The stack will not complete until this is done. See https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-validate-dns.html.

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --template-file deploy/cloudformation/app-infrastructure.yml \
  --parameter-overrides NetworkStackName='unpeered-network' DomainName='libraries.nd.edu' \
  --stack-name mellon-app-infrastructure \
  --tags ProjectName=mellon Name='testaccount-mellonappinfrastructure-dev' Contact='me@myhost.com' Owner='myid'\
  Description='brief-description-of-purpose'
```

## Deploy Application Components

### Data Broker stack

__Parameters:__
+ InfrastructureStackName
  + Description: The name of the parent infrastructure/networking stack that you created. Necessary to locate and reference resources created by that stack
  + Default: "mellon-app-infrastructure"
+ EnvType
  + Description: The type of environment to create.
  + Default: "dev"
  + AllowedValues: "dev", "prod"

```console
aws cloudformation deploy \
  --stack-name mellon-data-broker-dev \
  --template-file deploy/cloudformation/data-broker.yml \
  --parameter-overrides NetworkStackName='unpeered-network' \
  --tags ProjectName=mellon Name='testaccount-mellondatabroker-dev' Contact='me@myhost.com' Owner='myid'\
  Description='brief-description-of-purpose'
```

### IIIF Image Service stack

__Parameters:__
+ NetworkStackName
  + Description: The name of the parent networking stack created.
  + Default: "mellon-network"
+ InfrastructureStackName
  + Description: The name of the parent infrastructure/networking stack that you created. Necessary to locate and reference resources created by that stack
  + Default: "mellon-app-infrastructure"
+ ImageSourceBucket
  + Description: The name of the source bucket that the IIIF service will read from for its assets.
  + Default: '/all/stacks/mellon-data-broker-dev/publicbucket'
+ ImageUrl:
  + Description: The url of a docker image that contains the application process that will handle the traffic for this service.
  + Default: ndlib/image-service
+ ContainerPort
  + Description: What port number the application inside the docker container is binding to
  + Default: 8182
+ ContainerCpu
  + Description: How much CPU to give the container. 1024 is 1 CPU
  + Default: 256
+ ContainerMemory
  + Description: How much memory in megabytes to give the container
  + Default: 512
+ Path
  + Description: A path on the public load balancer that this service should be connected to. Use * to send all load balancer traffic to this service.
  + Default: "*"
+ Priority
  + Description: The priority for the routing rule added to the load balancer. This only applies if your have multiple services which have been assigned to different paths on the load balancer.
  + Default: 1
+ DesiredCount
  + Description: How many copies of the service task to run
  + Default: 1
+ SubDomain
  + Description: The SubDomain of the service. Combined with DomainName to create the FQDN.
  + Default: image-server
+ CreateDNSRecord
  + Description: If True, will attempt to create a Route 53 DNS record for load balancer.
  + Default: "True"

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --stack-name mellon-image-service-dev \
  --template-file deploy/cloudformation/iiif-service.yml \
  --tags ProjectName=mellon NameTag='testaccount-mellonimageservice-dev' \
    ContactTag='me@myhost.com' OwnerTag='myid' \
    Description='brief-description-of-purpose' \
  --parameter-overrides \
    ContainerCpu='1024' ContainerMemory='2048' DesiredCount=1
```

### IIIF Image Viewer Webcomponent stack

__Parameters:__
+ InfrastructureStackName
  + Description: The name of the parent infrastructure/networking stack that you created. Necessary to locate and reference resources created by that stack
  + Default: "mellon-app-infrastructure"
+ CreateDNSRecord
  + Description: If True, will attempt to create a Route 53 DNS record for load balancer.
  + Default: "True"
+ SubDomain 
  + __Required parameter__
  + Description: The SubDomain of the service. Combined with DomainName to create the FQDN.
  + Default: None (because this template is used for multiple services, the SubDomain value should be passed in)
+ EnvType
  + Description: The type of environment to create.
  + Default: "dev"
  + AllowedValues: "dev", "prod"


```console
aws cloudformation deploy \
  --stack-name mellon-image-webcomponent-dev \
  --template-file deploy/cloudformation/static-host.yml \
  --parameter-overrides NetworkStackName='unpeered-network' \
  --tags ProjectName=mellon Name='testaccount-mellonimagewebcomponent-dev' \
    Contact='me@myhost.com' Owner='myid' \
    Description='brief-description-of-purpose'
```

### Main Website stack
```console
aws cloudformation deploy \
  --stack-name mellon-website-dev \
  --template-file deploy/cloudformation/static-host.yml \
  --parameter-overrides NetworkStackName='unpeered-network' \
  --tags ProjectName=mellon Name='testaccount-mellonimagewebsite-dev' \
    Contact='me@myhost.com' Owner='myid' \
    Description='brief-description-of-purpose'
```

## Deploy CI/CD
Before you begin see https://developer.github.com/v3/auth/#via-oauth-tokens for how to generate an OAuth token for use with these pipelines.

### IIIF Image Service Pipeline
This will deploy to test, then to production, so it expects two different image-service stacks to exist, ex: "mellon-image-service-test" and "mellon-image-service-prod". If custom stack names were used for the image-service stacks, you'll need to override the default parameters for IIIFProdServiceStackName and IIIFTestServiceStackName.

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --stack-name mellon-image-service-pipeline \
  --template-file deploy/cloudformation/iiif-service-pipeline.yml \
  --tags ProjectName=mellon Name='testaccount-mellonimageservicepipeline' \
    Contact='me@myhost.com' Owner='myid' \
    Description='brief-description-of-purpose' \
  --parameter-overrides OAuth=my_oauth_key Approvers=me@myhost.com \
```

### IIIF Image Viewer Pipeline
This will deploy to test, then to production, so it expects two different image-viewer stacks to exist, ex: "mellon-image-webcomponent-test" and "mellon-image-webcomponent-prod".

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --stack-name mellon-image-webcomponent-pipeline \
  --template-file deploy/cloudformation/static-host-pipeline.yml \
  --tags ProjectName=mellon Name='testaccount-mellonimagewebcomponentpipeline' \
    Contact='me@myhost.com' Owner='myid' \
    Description='brief-description-of-purpose' \
  --parameter-overrides OAuth=my_oauth_key Approvers=me@myhost.com \
    SourceRepoOwner=ndlib SourceRepoName=image-viewer BuildScriptsDir='build' BuildOutputDir='dist' \
    TestStackName=mellon-image-webcomponent-test ProdStackName=mellon-image-webcomponent-prod
```

### Website Pipeline
This will deploy to test, then to production, so it expects two different website stacks to exist, ex: "mellon-website-test" and "mellon-website-prod".

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --stack-name mellon-website-pipeline \
  --template-file deploy/cloudformation/static-host-pipeline.yml \
  --tags ProjectName=mellon Name='testaccount-mellonimagewebsitepipeline' \
    Contact='me@myhost.com' Owner='myid' \
    Description='brief-description-of-purpose' \
  --parameter-overrides OAuth=my_oauth_key Approvers=me@myhost.com \
    SourceRepoOwner=ndlib SourceRepoName=mellon-website \
    TestStackName=mellon-website-test ProdStackName=mellon-website-prod
```

#### Approval message
Once the pipeline reaches the UAT step, it will send an email to the approvers list and wait until it's either approved or rejected. Here's an example of the message.

```email
Approve or reject: https://console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/mellon-image-webcomponent-pipeline-CodePipeline-ID/Approval/ManualApprovalOfTestEnvironment/approve/approval-id
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
  --stack-name mellon-image-webcomponent-pipeline-monitoring \
  --template-file deploy/cloudformation/pipeline-monitoring.yml \
  --tags ProjectName=mellon Name='testaccount-mellonimagewebcomponentpipeline-monitoring' \
    Contact='me@myhost.com' Owner='myid' Description='brief-description-of-purpose' \
  --parameter-overrides PipelineStackName=mellon-image-webcomponent-pipeline Receivers=me@myhost.com
```

Here's an example of adding monitoring to the website-pipeline
```console
aws cloudformation deploy \
  --stack-name mellon-website-pipeline-monitoring \
  --template-file deploy/cloudformation/pipeline-monitoring.yml \
  --tags ProjectName=mellon Name='testaccount-mellonimagewebsitepipeline-monitoring' \
    Contact='me@myhost.com' Owner='myid' Description='brief-description-of-purpose' \
  --parameter-overrides PipelineStackName=mellon-website-pipeline Receivers=me@myhost.com
```

Here's an example of adding monitoring to the image-service-pipeline
```console
aws cloudformation deploy \
  --stack-name mellon-image-service-pipeline-monitoring \
  --template-file deploy/cloudformation/pipeline-monitoring.yml \
  --tags ProjectName=mellon Name='testaccount-mellonimageservicepipeline-monitoring' \
    Contact='me@myhost.com' Owner='myid' Description='brief-description-of-purpose' \
  --parameter-overrides PipelineStackName=mellon-image-service-pipeline Receivers=me@myhost.com
```

How to build the Manifest Pipeline Pipleine
```console
aws cloudformation deploy \
  --capabilities CAPABILITY_NAMED_IAM \
  --stack-name mellon-manifest-pipeline \
  --template-file deploy/cloudformation/manifest-pipeline-pipeline.yml \
  --tags Name='mellon-manifest-pipeline' Contact='me@myhost.com' Owner='myid' Description='CF for Manifest Pipeline.' \
  --parameter-overrides GitHubToken=ADDME! Receivers=email@email.com
```

#### Examples of the notifications:
##### Started
The pipeline mellon-image-webcomponent-pipeline has started. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/mellon-image-webcomponent-pipeline-CodePipeline-ID.

##### Success
The pipeline mellon-image-webcomponent-pipeline has successfully deployed to production. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/mellon-image-webcomponent-pipeline-CodePipeline-ID.

##### Source failure
Failed to pull the source code for mellon-image-webcomponent-pipeline. To view the current execution, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/mellon-image-webcomponent-pipeline-CodePipeline-ID.

##### Build failure
Failed to build mellon-image-webcomponent-pipeline. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/mellon-image-webcomponent-pipeline-CodePipeline-ID.

##### Deploy to test failure
Build for mellon-image-webcomponent-pipeline failed to deploy to test stack. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/mellon-image-webcomponent-pipeline-CodePipeline-ID.

##### Approval failure
Build for mellon-image-webcomponent-pipeline was rejected either due to a QA failure or UAT rejection. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/mellon-image-webcomponent-pipeline-CodePipeline-ID.

##### Deploy to production failure
Build for mellon-image-webcomponent-pipeline failed to deploy to production. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/mellon-image-webcomponent-pipeline-CodePipeline-ID.

##### Generic resume after a failure
The pipeline mellon-image-webcomponent-pipeline has changed state to RESUMED. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/mellon-image-webcomponent-pipeline-CodePipeline-ID.
