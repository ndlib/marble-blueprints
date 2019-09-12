#!/bin/bash
# This script exists because there isn't a way to pass values for CloudFormation parameters when deploying with the cdk.
# Once there is, we should ideally use that instead.

magenta=`tput setaf 5`
reset=`tput sgr0`

STACK_NAME='marble-elasticsearch-pipeline'
OUTPUT_DIR='cdk.out'

# SYNTHESIZE CLOUDFORMATION
echo "${magenta}----- SYNTHESIZE -----${reset}"
cdk synth -o $OUTPUT_DIR "$@"

# PROMPT FOR OAUTH TOKEN
unset oAuthToken
charCount=0

echo "${magenta}----- DEPLOY-TIME SECRETS -----${reset}"

prompt="What is the value of the OAuth token for the GitHub user? "

# This is all just a fancy way to mask the input you type with asterisks, instead of hiding it completely.
# In case the user exits in the middle, fix the silenced echo
cleanup() {
  stty echo
  echo # newline
  exit # exit the script
}

trap cleanup EXIT ERR INT TERM
stty -echo
while IFS= read -p "$prompt" -r -s -n 1 char
do
  # Enter - accept password
  if [[ $char == $'\0' ]] ; then
      break
  fi
  # Backspace
  if [[ $char == $'\177' ]] ; then
    if [ $charCount -gt 0 ] ; then
      charCount=$((charCount-1))
      prompt=$'\b \b'
      oAuthToken="${oAuthToken%?}"
    else
      prompt=''
    fi
  else
    charCount=$((charCount+1))
    prompt='*'
    oAuthToken+="$char"
  fi
done
stty echo
echo

echo "${magenta}----- DEPLOY -----${reset}"

# DEPLOY CLOUDFORMATION USING OAUTH TOKEN
aws cloudformation deploy \
  --stack-name "${STACK_NAME}" \
  --template-file "${OUTPUT_DIR}/${STACK_NAME}.template.json" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides GitHubToken="${oAuthToken}"
