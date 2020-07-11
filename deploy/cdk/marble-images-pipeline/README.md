# marble-images-blueprints

## Description
Infrastructure-as-code for the Marble Images service

## Dependencies

  * [yarn](https://yarnpkg.com/lang/en/)
  * [AWS CLI](https://aws.amazon.com/cli/)
  * [AWS CDK CLI](https://docs.aws.amazon.com/cdk/latest/guide/tools.html)

## Installation
`./setup.sh`

## Testing
`yarn test`

## Deployment
There are two stacks that can be created.
1. [marble images stack](https://github.com/ndlib/marble-images)
2. marble images pipeline - creates marble image stack, like above, AND creates a pipeline as well!


To create the [marble images stack](https://github.com/ndlib/marble-images)
1. Assume role (or use aws-vault) and run:
```
cdk deploy marbleImages-<someid> -c owner=<netid> -c contact=<email> -c lambdaCodePath="some/path/to/src" -c dockerPath="some/path/to/docker"
```


To create the marble images pipeline
1. Assume role (or use aws-vault) and run:
```
cdk deploy marbleImages-<someid>Pipeline -c owner=<netid> -c contact=<email>
```

# Useful commands

 * `yarn build`   compile typescript to js
 * `yarn watch`   watch for changes and compile
 * `yarn test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template
