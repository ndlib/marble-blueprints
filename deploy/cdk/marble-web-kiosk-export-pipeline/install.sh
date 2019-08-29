#!/bin/bash
magenta=`tput setaf 5`
reset=`tput sgr0`

echo "\n\n ${magenta}----- INSTALL.SH -----${reset}"

npm install aws-cdk  || { echo "CDK install failed"; exit 1; }

# install dev pkgs
dev_req="dev-requirements.txt"
if test -f "${dev_req}"; then
    pip install -r ${dev_req} || { echo "dev-requirements install failed"; exit 1; }
fi

# run npm install to install everything listed in package.json
npm install || { echo "Npm install failed to install everything listed in package.json"; exit 1; }
# check for updates to any cdk packages, and install those updates
# npx npm-check-updates -u
# npm install || { echo "Npm install failed to install updates"; exit 1; }
