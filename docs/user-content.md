# User Content Service

This will create the infrastructure to host the [User Content](https://github.com/ndlib/marble-user-content) service. It creates 3 dynamo tables, 1 lambda, and an API gateway.

## Service Stack

In order to use this in it's current state, it makes the assumption that you have both this repository and Marble User Content within the same parent directory. Lambda code path is: `../../../marble-user-content/src`

Deploy a development service stack:

```console
cd deploy/cdk
yarn
cdk deploy my-marble-user-content -c namespace=my-marble \
  -c projectName=marble -c description=[DESCRIPTION] -c contact=[NAME] -c owner=[NAME]
```

## Continuous Delivery Pipeline

```console
cd deploy/cdk
yarn
cdk deploy [NAMESPACE]-user-content-deployment \
  -c namespace=[NAMESPACE] \
  -c projectName=marble -c description=[DESCRIPTION] -c contact=[NAME] -c owner=[NAME] \
  -c "userContent:infraSourceBranch"="master" \
  -c "userContent:appSourceBranch"="master"
```
