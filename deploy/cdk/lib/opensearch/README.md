# OpenSearch

This application deploys OpenSearch.  For production, we have adhered to the best practices defined here: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp.html.  In order to change these settings, edit the constants within the opensearch-stack constructs.

Note that we are saving master and readOnly credentials into parameter store.  The master credentials are created using CDK.  The readOnly user credentials must be added manually through the console after the OpenSearch stack has been deployed.  To do this, click on the OpenSearch dashboard from within the chosen domain.  Add the master username and password found in parameter store to sign in.  Manually create the readOnly user using these instructions: https://opensearch.org/docs/latest/security-plugin/access-control/users-roles/#create-users using the readOnly username and password defined in the opensearch-stack.
