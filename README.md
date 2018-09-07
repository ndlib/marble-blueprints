# mellon-blueprints
The "Infrastructure as Code" repo for all pieces in the Mellon Grant. Will contain Cloud Formation Templates, Ansible playbooks, deploy scripts, etc for all components of the new system.

Note: It is highly recommended you use something like https://github.com/awslabs/git-secrets to prevent pushing AWS secrets to the repo

# Deploy
TODO: Add stack diagram. Important to note the Network and App-Infrastructure stacks are intended to be shared per env. Ex: Only one of each of these exist in dev, but you can have multiple dev instances of service/webcomponent stacks for each developer.

## Deploy Shared Infrastructure
Before you can deploy any of the other stacks, you must deploy some prerequisite pieces of shared infrastructure. These are required by both the application components and the CI/CD stacks that test and deploy those application components.

### Network stack
```console
aws --region us-east-2 cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --template-file deploy/cloudformation/network.yml \
  --stack-name mellon-network \
  --parameter-overrides NameTag='testaccount-mellonnetwork-dev' ContactTag='me@myhost.com' OwnerTag='me'
```

TODO: Add example of exporting an existing network

### Infrastructure stack
```console
aws --region us-east-2 cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --template-file deploy/cloudformation/app-infrastructure.yml \
  --stack-name mellon-app-infrastructure \
  --parameter-overrides NameTag='testaccount-mellonappinfrastructure-dev' ContactTag='me@myhost.com' OwnerTag='me'
```

## Deploy Application Components

### Data Broker stack
```console
aws cloudformation deploy \
  --region us-east-2 \
  --stack-name mellon-data-broker-dev \
  --template-file deploy/cloudformation/data-broker.yml \
  --parameter-overrides NameTag='testaccount-mellondatabroker-dev' ContactTag='me@myhost.com' OwnerTag='myid'
```

### IIIF Image Service stack
```console
aws cloudformation deploy \
  --capabilities CAPABILITY_IAM \
  --region us-east-2 \
  --stack-name mellon-image-service-dev \
  --template-file deploy/cloudformation/iiif-service.yml \
  --parameter-overrides NameTag='testaccount-mellonimageservice-dev' ContactTag='me@myhost.com' OwnerTag='myid' \
    ContainerCpu='1024' ContainerMemory='2048' DesiredCount=1
```

### IIIF Image Viewer Webcomponent stack
```console
aws cloudformation deploy \
  --region us-east-2 \
  --stack-name mellon-image-webcomponent-dev \
  --template-file deploy/cloudformation/iiif-webcomponent.yml \
  --parameter-overrides NameTag='testaccount-mellonimagewebcomponent-dev' ContactTag='me@myhost.com' OwnerTag='myid'
```

## Deploy CI/CD

### IIIF Image Service Pipeline

### IIIF Image Viewer Pipeline
