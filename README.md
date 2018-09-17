# mellon-blueprints
The "Infrastructure as Code" repo for all pieces in the Mellon Grant. Will contain Cloud Formation Templates, Ansible playbooks, deploy scripts, etc for all components of the new system.

Note: It is highly recommended you use something like https://github.com/awslabs/git-secrets to prevent pushing AWS secrets to the repo

# Deploy
TODO:
* [ ] Add stack diagram. Important to note the Network and App-Infrastructure stacks are intended to be shared per env. Ex: Only one of each of these exist in dev, but you can have multiple dev instances of service/webcomponent stacks for each developer.
* [ ] Explain why we have the separation we do, reference https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/best-practices.html#organizingstacks

## Deploy Shared Infrastructure
Before you can deploy any of the other stacks, you must deploy some prerequisite pieces of shared infrastructure. These are required by both the application components and the CI/CD stacks that test and deploy those application components.

### Network stack
```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --template-file deploy/cloudformation/network.yml \
  --stack-name mellon-network \
  --tags ProjectName=mellon \
  --parameter-overrides NameTag='testaccount-mellonnetwork-dev' ContactTag='me@myhost.com' OwnerTag='me'
```

TODO: Add example of exporting an existing network

### Infrastructure stack
Note: This will require adding a DNS entry to validate the certificate created by the stack. The stack will not complete until this is done. See https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-validate-dns.html.

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --template-file deploy/cloudformation/app-infrastructure.yml \
  --stack-name mellon-app-infrastructure \
  --tags ProjectName=mellon \
  --parameter-overrides NameTag='testaccount-mellonappinfrastructure-dev' ContactTag='me@myhost.com' OwnerTag='me'
```

## Deploy Application Components

### Data Broker stack
```console
aws cloudformation deploy \
  --stack-name mellon-data-broker-dev \
  --template-file deploy/cloudformation/data-broker.yml \
  --tags ProjectName=mellon \
  --parameter-overrides NameTag='testaccount-mellondatabroker-dev' ContactTag='me@myhost.com' OwnerTag='myid'
```

### IIIF Image Service stack
```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --stack-name mellon-image-service-dev \
  --template-file deploy/cloudformation/iiif-service.yml \
  --tags ProjectName=mellon \
  --parameter-overrides NameTag='testaccount-mellonimageservice-dev' ContactTag='me@myhost.com' OwnerTag='myid' \
    ContainerCpu='1024' ContainerMemory='2048' DesiredCount=1
```

### IIIF Image Viewer Webcomponent stack
```console
aws cloudformation deploy \
  --stack-name mellon-image-webcomponent-dev \
  --template-file deploy/cloudformation/iiif-webcomponent.yml \
  --tags ProjectName=mellon \
  --parameter-overrides NameTag='testaccount-mellonimagewebcomponent-dev' ContactTag='me@myhost.com' OwnerTag='myid'
```

## Deploy CI/CD
Before you begin see https://developer.github.com/v3/auth/#via-oauth-tokens for how to generate an OAuth token for use with these pipelines.

### IIIF Image Service Pipeline

### IIIF Image Viewer Pipeline
This will deploy to test, then to production, so it expects two different image-viewer stacks to exist, ex: "mellon-image-webcomponent-test" and "mellon-image-webcomponent-prod". If custom stack names were used for the image-viewer stacks, you'll need to override the default parameter store paths for TestDeployBucket, TestURL, ProdDeployBucket, and ProdURL.

```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --stack-name mellon-image-webcomponent-pipeline-prod \
  --template-file deploy/cloudformation/iiif-webcomponent-pipeline.yml \
  --tags ProjectName=mellon \
  --parameter-overrides OAuth=my_oauth_key Approvers=me@myhost.com \
    TestManifestURL='http://wellcomelibrary.org/iiif/b18035723/manifest' \
    NameTag='testaccount-mellonimagewebcomponentpipeline-prod' ContactTag='me@myhost.com' OwnerTag='myid'
```console
