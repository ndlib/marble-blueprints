#!/bin/bash

magenta=`tput setaf 5`
reset=`tput sgr0`

if [[ $# -ne 2 ]]; then
    echo "${magenta}----- INVALID ARGUMENTS -----${reset}"
    echo "./deploy.sh BUCKET_NAME STACK_NAME"
    exit 2
fi

ARTIFACT_BUCKET=${1}
STACK_NAME=${2}
REGION="us-east-1"

rm -rf layer
mkdir -p layer/python

echo "${magenta}----- GENERATING DEPENDENCIES -----${reset}"
pushd layer/python
pip install -r ../../requirements.txt -t .
rm -rf *dist-info
popd

echo "${magenta}----- SENDING ARTIFACT TO S3 -----${reset}"
OUTPUT_TEMPLATE="sentry.yml"
aws cloudformation package \
    --region ${REGION} \
    --template-file ./template.yml \
    --s3-bucket ${ARTIFACT_BUCKET} \
    --output-template-file ${OUTPUT_TEMPLATE}

echo "${magenta}----- CREATING LAYER -----${reset}"
aws cloudformation deploy \
    --region ${REGION} \
    --capabilities CAPABILITY_IAM \
    --stack-name ${STACK_NAME} \
    --template-file ${OUTPUT_TEMPLATE}

echo "${magenta}----- CLEAN-UP -----${reset}"
rm -rf layer
rm ${OUTPUT_TEMPLATE}
