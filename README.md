# MARBLE-related
# Archived 2023-05-12 sm
# marble-blueprints
The [Hesburgh Libraries](https://library.nd.edu) and [Snite Museum](https://sniteartmuseum.nd.edu/) of Art at the University of Notre Dame received a grant from The Andrew W. Mellon Foundation in December 2017 to develop a unified online collections platform to encourage comparative research, innovative joint exhibitions, and deeper integration of artwork, rare books, archival resources, and cultural artifacts into University teaching. For more information about Marble visit https://innovation.library.nd.edu/marble.

This repository contains the "Infrastructure as Code" for deploying all pieces of the Marble project into AWS. It will contain AWS Cloud Formation Templates, Ansible playbooks, deploy scripts, etc for all components of the new system.

The project was designed as a set of independent components, ex: IIIF Image Service, IIIF Image Viewer Webcomponent, etc. This separation is also reflected in this repository, giving each component it's own independent set of infrastructure and deployment pipelines. To do this we use a combination of multi-layered and service-oriented architectures. There are a set of lower level stacks, such as the app-infrastructure and network stacks in the diagram below, that must be created before you can create a component:
![Stack Structure](/docs/stack-structure.png)

For more information on this type of organization see [Organize Your Stacks By Lifecycle and Ownership](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/best-practices.html#organizingstacks)

# Requirements
Before you begin, check that you have the following:
  - A role with permissions to deploy CDK Templates. In most cases, this will also require permissions to create IAM roles/policies (see [Permissions Required to Access IAM Resources](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_permissions-required.html))
  - If you can use Route53, we provide a template for managing the certificate and DNS record sets for you. If not, make sure you have the ability to manage DNS for your organization to validate certificates (see [Use DNS to Validate Domain Ownership](https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-validate-dns.html))
  - Must have the [awscli](https://aws.amazon.com/cli/) installed if using the example deploy commands
  - Must have the [awscdk](https://aws.amazon.com/cdk/) installed for deploying components that require it
  - If you are contributing to this project, **it is highly recommended you use https://github.com/awslabs/git-secrets to prevent pushing AWS secrets to the repo**
  - You will need to adjust your AWS service limits as follows:
    - Policies per Role: 20

# Components
- [Shared Infrastructure](/docs/shared-infrastructure.md) - All components will require creating a set of shared infrastructure, so begin here.
- [IIIF Image Service](/docs/iiif-image-service.md) - A scalable IIIF image service using AWS Lambda. See [nulib/serverless-iiif](https://github.com/nulib/serverless-iiif)
- [IIIF Image Viewer](/docs/iiif-image-viewer.md) - A IIIF Viewer WebComponent based on UniversalViewer. See [ndlib/marble-image-viewer](https://github.com/ndlib/marble-image-viewer)
- [IIIF Manifest Pipeline](/docs/iiif-manifest-pipeline.md) - A IIIF Manifest and Image processing pipeline. See [ndlib/marble-manifest-pipeline](https://github.com/ndlib/marble-manifest-pipeline)
- [Website](/docs/website.md) - The main front end for the project. See [ndlib/marble-website](https://github.com/ndlib/marble-website)
- [Primo Passthrough](/docs/primo-passthrough.md) - Proxies queries for the Website to a Primo server. See [ndlib/marble-passthrough-primo](https://github.com/ndlib/marble-passthrough-primo)
