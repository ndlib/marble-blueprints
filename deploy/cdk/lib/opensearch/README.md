# OpenSearch

This application deploys OpenSearch.  For production, we have adhered to the best practices defined here: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp.html.  In order to change these settings, edit the constants within the opensearch-stack constructs.

Note that we are saving master and readOnly credentials into parameter store.  The master credentials are created using CDK.  The readOnly user credentials must be added manually through the console after the OpenSearch stack has been deployed.  To do this, click on the OpenSearch dashboard from within the chosen domain.  Add the master username and password found in parameter store to sign in.  Manually create the readOnly user using these instructions: https://opensearch.org/docs/latest/security-plugin/access-control/users-roles/#create-users using the readOnly username and password defined in the opensearch-stack.

In order to check cluster health, permission must be added using the following steps:
1. Login to the OpenSearch Dashboards console (login with master user credentials)
2. Navigate to "Security" tab on the left panel
3. Choose Roles
4. Select "all_access"
5. Click on "Mapped Users" , and then click on "Manage mapping"
6. Paste the ARN of the user/role  in  Backend role --> arn:aws:iam::230391840102:role/AdministratorAccess 
7. Click on "Map"
