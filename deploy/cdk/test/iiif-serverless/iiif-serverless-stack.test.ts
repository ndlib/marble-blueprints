import { expect as expectCDK, haveResource, haveResourceLike, matchTemplate, MatchStyle } from '@aws-cdk/assert'
import cdk = require('@aws-cdk/core')
import { FoundationStack } from '../../lib/foundation'
import { IiifServerlessStack } from '../../lib/iiif-serverless'
import helpers = require('../helpers')
import * as path from 'path'

describe('IiifServerlessStack', () => {
  beforeEach(() => {
    helpers.mockFoundationStack()
  })

  describe('DomainStack', () => {
    const stack = (createDns?: boolean) => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, 'FoundationStack', {
        domainName: 'test.com',
      })
      const parentStack = new IiifServerlessStack(app, 'MyTestStack', {
        serverlessIiifSrcPath: path.join(__dirname, 'fixtures'),
        hostnamePrefix: 'test-iiif',
        foundationStack,
        createDns: createDns ?? true,
        paramPathPrefix: '/all/marble/image-service',
      })
      return parentStack.domainStack
    }
    
    test('creates a domain name with the fqdn', () => {
      const subject = stack()
      expectCDK(subject).to(haveResourceLike('AWS::ApiGateway::DomainName', {
        DomainName: 'test-iiif.test.com',
      }))
    })

    test('creates the domain with the cert from the foundation stack', () => {
      const subject = stack()
      expectCDK(subject).to(haveResourceLike('AWS::ApiGateway::DomainName', {
        RegionalCertificateArn: {
          'Fn::ImportValue': 'FoundationStack:ExportsOutputRefCertificate4E7ABB08F7C8AF50',
        },
      }))
    })

    test('creates the domain with the cert from the foundation stack', () => {
      const subject = stack()
      expectCDK(subject).to(haveResourceLike('AWS::ApiGateway::DomainName', {
        RegionalCertificateArn: {
          'Fn::ImportValue': 'FoundationStack:ExportsOutputRefCertificate4E7ABB08F7C8AF50',
        },
      }))
    })

    test('creates a base path mapping to the latest stage in the Api', () => {
      const subject = stack()
      expectCDK(subject).to(haveResourceLike('AWS::ApiGateway::BasePathMapping', {
        'DomainName': {
          'Ref': 'APIDomain02CC2FA9',
        },
        'RestApiId': {
          'Fn::ImportValue': {
            'Fn::Join': [
              '',
              [
                {
                  'Fn::Select': [
                    1,
                    {
                      'Fn::Split': [
                        '/',
                        {
                          'Ref': 'referencetoMyTestStackIiifApiStackNestedStackIiifApiStackNestedStackResource8BC291AERef',
                        },
                      ],
                    },
                  ],
                },
                ':ApiId',
              ],
            ],
          },
        },
        'Stage': 'latest',
      }))
    })

    test('creates a dns recordset in the foundation stack\'s hosted zone when createDns is true', () => {
      const subject = stack(true)
      expectCDK(subject).to(haveResourceLike('AWS::Route53::RecordSet', {
        'Name': 'test-iiif.test.com.',
        'Type': 'CNAME',
        'HostedZoneId': {
          'Fn::ImportValue': 'FoundationStack:ExportsOutputRefHostedZoneDB99F8662BBAE844',
        },
        'ResourceRecords': [
          {
            'Fn::GetAtt': [
              'APIDomain02CC2FA9',
              'RegionalDomainName',
            ],
          },
        ],
        'TTL': '900',
      }))
    })

    test('does not create a dns recordset when createDns is false', () => {
      const subject = stack(false)
      expectCDK(subject).notTo(haveResource('AWS::Route53::RecordSet'))
    })
  })

  describe('ApiStack', () => {
    const stack = () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, 'FoundationStack', {
        domainName: 'test.com',
      })
      const parentStack = new IiifServerlessStack(app, 'MyTestStack', {
        serverlessIiifSrcPath: path.join(__dirname, 'fixtures'),
        hostnamePrefix: 'test-iiif',
        foundationStack,
        createDns: true,
        paramPathPrefix: '/all/marble/image-service',
      })
      return parentStack.apiStack
    }

    // These are things that we're doing specifically to integrate nulib's template into cdk. If/when we rewrite
    // the entire Api, lambda, and lambda layer to be defined in cdk, this can probably go away
    describe('template monkey patches', () => {
      test('changes Cfn params to read from SSM', () => {
        const subject = stack()
        const expected = {
          Parameters: {
            SourceBucket: {
              Type: "AWS::SSM::Parameter::Value<String>",
              Description: "Name of bucket containing source images",
              Default: "/all/stacks/FoundationStack/publicBucket",
            },
            CacheEnabled: {
              Type: "AWS::SSM::Parameter::Value<String>",
              Description: "Enables API response caching.",
              Default: "/all/marble/image-service/cacheEnabled",
            },
            CacheTtl: {
              Type: "AWS::SSM::Parameter::Value<String>",
              Description: "API cache time in seconds.",
              Default: "/all/marble/image-service/cacheTtl",
            },
          },
        }
        expectCDK(subject).to(matchTemplate(expected, MatchStyle.NO_REPLACES))
      })

      test('changes the dependency layer ContentUri to point to the assets pushed to cdk staging', () => {
        const subject = stack()
        expectCDK(subject).to(haveResourceLike('AWS::Serverless::LayerVersion', {
          "ContentUri": {
            "Bucket": {
              "Ref": "referencetoMyTestStackAssetParametersb7826d21185e020066e56b133136e1082372d08cf21209a8823ac39710782f68S3Bucket113E00E2Ref",
            },
            "Key": {
              "Fn::Join": [
                "",
                [
                  {
                    "Fn::Select": [
                      0,
                      {
                        "Fn::Split": [
                          "||",
                          {
                            "Ref": "referencetoMyTestStackAssetParametersb7826d21185e020066e56b133136e1082372d08cf21209a8823ac39710782f68S3VersionKey9782B0FCRef",
                          },
                        ],
                      },
                    ],
                  },
                  {
                    "Fn::Select": [
                      1,
                      {
                        "Fn::Split": [
                          "||",
                          {
                            "Ref": "referencetoMyTestStackAssetParametersb7826d21185e020066e56b133136e1082372d08cf21209a8823ac39710782f68S3VersionKey9782B0FCRef",
                          },
                        ],
                      },
                    ],
                  },
                ],
              ],
            },
          },
        }))
      })

      test('changes the lambda CodeUri to point to the assets pushed to cdk staging', () => {
        const subject = stack()
        expectCDK(subject).to(haveResourceLike('AWS::Serverless::Function', {
          "CodeUri": {
            "Bucket": {
              "Ref": "referencetoMyTestStackAssetParametersb7826d21185e020066e56b133136e1082372d08cf21209a8823ac39710782f68S3Bucket113E00E2Ref",
            },
            "Key": {
              "Fn::Join": [
                "",
                [
                  {
                    "Fn::Select": [
                      0,
                      {
                        "Fn::Split": [
                          "||",
                          {
                            "Ref": "referencetoMyTestStackAssetParametersb7826d21185e020066e56b133136e1082372d08cf21209a8823ac39710782f68S3VersionKey9782B0FCRef",
                          },
                        ],
                      },
                    ],
                  },
                  {
                    "Fn::Select": [
                      1,
                      {
                        "Fn::Split": [
                          "||",
                          {
                            "Ref": "referencetoMyTestStackAssetParametersb7826d21185e020066e56b133136e1082372d08cf21209a8823ac39710782f68S3VersionKey9782B0FCRef",
                          },
                        ],
                      },
                    ],
                  },
                ],
              ],
            },
          },
        }))
      })
    })

    test('creates a lambda with the dependencies layer', () => {
      const subject = stack()
      expectCDK(subject).to(haveResourceLike('AWS::Serverless::Function', {
        "Layers": [
          {
            "Ref": "Dependencies",
          },
        ],
      }))
    })

    test('creates a lambda with the events mapped to the api', () => {
      const subject = stack()
      expectCDK(subject).to(haveResourceLike('AWS::Serverless::Function', {
        "Events": {
          "GetId": {
            "Type": "Api",
            "Properties": {
              "Path": "/iiif/2/{id}",
              "Method": "GET",
              "RestApiId": {
                "Ref": "IiifApi",
              },
            },
          },
          "OptionsId": {
            "Type": "Api",
            "Properties": {
              "Path": "/iiif/2/{id}",
              "Method": "OPTIONS",
              "RestApiId": {
                "Ref": "IiifApi",
              },
            },
          },
          "GetInfoJson": {
            "Type": "Api",
            "Properties": {
              "Path": "/iiif/2/{id}/info.json",
              "Method": "GET",
              "RestApiId": {
                "Ref": "IiifApi",
              },
            },
          },
          "OptionsInfoJson": {
            "Type": "Api",
            "Properties": {
              "Path": "/iiif/2/{id}/info.json",
              "Method": "OPTIONS",
              "RestApiId": {
                "Ref": "IiifApi",
              },
            },
          },
          "GetImage": {
            "Type": "Api",
            "Properties": {
              "Path": "/iiif/2/{id}/{proxy+}",
              "Method": "GET",
              "RestApiId": {
                "Ref": "IiifApi",
              },
            },
          },
          "OptionsImage": {
            "Type": "Api",
            "Properties": {
              "Path": "/iiif/2/{id}/{proxy+}",
              "Method": "OPTIONS",
              "RestApiId": {
                "Ref": "IiifApi",
              },
            },
          },
        },
      }))
    })

    test('creates the api', () => {
      const subject = stack()
      expectCDK(subject).to(haveResourceLike('AWS::Serverless::Api', {
        "Name": {
          "Fn::Sub": "${AWS::StackName}-api",
        },
        "StageName": {
          "Fn::Sub": "${StageName}",
        },
        "EndpointConfiguration": "REGIONAL",
        "CacheClusterEnabled": {
          "Fn::Sub": "${CacheEnabled}",
        },
        "CacheClusterSize": "0.5",
        "MethodSettings": [
          {
            "ResourcePath": "/*",
            "HttpMethod": "*",
            "CachingEnabled": {
              "Fn::Sub": "${CacheEnabled}",
            },
            "CacheTtlInSeconds": {
              "Fn::Sub": "${CacheTtl}",
            },
          },
        ],
        "Cors": {
          "AllowMethods": "'GET'",
          "AllowOrigin": "'*'",
        },
        "DefinitionBody": {
          "swagger": "2.0",
          "info": {
            "version": "2018-12-14T18:28:00Z",
          },
          "schemes": [
            "http",
            "https",
          ],
          "paths": {
            "/iiif/2/{id}": {
              "get": {
                "produces": [
                  "application/json",
                ],
                "parameters": [
                  {
                    "name": "Cookie",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "Origin",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "Authorization",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "id",
                    "in": "path",
                    "required": true,
                    "type": "string",
                  },
                ],
                "responses": {
                  "200": {
                    "description": "200 response",
                    "schema": {
                      "$ref": "#/definitions/Empty",
                    },
                  },
                },
                "x-amazon-apigateway-integration": {
                  "uri": {
                    "Fn::Sub": "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${IiifFunction.Arn}/invocations",
                  },
                  "responses": {
                    "default": {
                      "statusCode": "200",
                    },
                  },
                  "passthroughBehavior": "when_no_match",
                  "httpMethod": "POST",
                  "cacheKeyParameters": [
                    "method.request.path.id",
                  ],
                  "contentHandling": "CONVERT_TO_TEXT",
                  "type": "aws_proxy",
                },
              },
              "options": {
                "produces": [
                  "application/json",
                ],
                "parameters": [
                  {
                    "name": "Origin",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "Authorization",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "id",
                    "in": "path",
                    "required": true,
                    "type": "string",
                  },
                ],
                "responses": {
                  "200": {
                    "description": "200 response",
                    "schema": {
                      "$ref": "#/definitions/Empty",
                    },
                  },
                },
                "x-amazon-apigateway-integration": {
                  "uri": {
                    "Fn::Sub": "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${IiifFunction.Arn}/invocations",
                  },
                  "responses": {
                    "default": {
                      "statusCode": "200",
                    },
                  },
                  "passthroughBehavior": "when_no_match",
                  "httpMethod": "POST",
                  "contentHandling": "CONVERT_TO_TEXT",
                  "type": "aws_proxy",
                },
              },
            },
            "/iiif/2/{id}/info.json": {
              "get": {
                "produces": [
                  "application/json",
                ],
                "parameters": [
                  {
                    "name": "Cookie",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "Origin",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "Authorization",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "id",
                    "in": "path",
                    "required": true,
                    "type": "string",
                  },
                ],
                "responses": {
                  "200": {
                    "description": "200 response",
                    "schema": {
                      "$ref": "#/definitions/Empty",
                    },
                    "headers": {
                      "Access-Control-Allow-Origin": {
                        "type": "string",
                      },
                      "Access-Control-Allow-Credentials": {
                        "type": "string",
                      },
                      "Set-Cookie": {
                        "type": "string",
                      },
                      "Access-Control-Allow-Headers": {
                        "type": "string",
                      },
                    },
                  },
                },
                "x-amazon-apigateway-integration": {
                  "uri": {
                    "Fn::Sub": "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${IiifFunction.Arn}/invocations",
                  },
                  "responses": {
                    "default": {
                      "statusCode": "200",
                      "responseParameters": {
                        "method.response.header.Access-Control-Allow-Origin": "'*'",
                      },
                    },
                  },
                  "passthroughBehavior": "when_no_match",
                  "httpMethod": "POST",
                  "cacheKeyParameters": [
                    "method.request.path.id",
                  ],
                  "contentHandling": "CONVERT_TO_TEXT",
                  "type": "aws_proxy",
                },
              },
              "options": {
                "produces": [
                  "application/json",
                ],
                "parameters": [
                  {
                    "name": "Origin",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "Authorization",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "id",
                    "in": "path",
                    "required": true,
                    "type": "string",
                  },
                ],
                "responses": {
                  "200": {
                    "description": "200 response",
                    "schema": {
                      "$ref": "#/definitions/Empty",
                    },
                    "headers": {
                      "Access-Control-Allow-Origin": {
                        "type": "string",
                      },
                      "Access-Control-Allow-Credentials": {
                        "type": "string",
                      },
                      "Access-Control-Allow-Headers": {
                        "type": "string",
                      },
                    },
                  },
                },
                "x-amazon-apigateway-integration": {
                  "uri": {
                    "Fn::Sub": "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${IiifFunction.Arn}/invocations",
                  },
                  "responses": {
                    "default": {
                      "statusCode": "200",
                    },
                  },
                  "passthroughBehavior": "when_no_match",
                  "httpMethod": "POST",
                  "contentHandling": "CONVERT_TO_TEXT",
                  "type": "aws_proxy",
                },
              },
            },
            "/iiif/2/{id}/{proxy+}": {
              "get": {
                "produces": [
                  "application/json",
                ],
                "parameters": [
                  {
                    "name": "proxy",
                    "in": "path",
                    "required": true,
                    "type": "string",
                  },
                  {
                    "name": "Cookie",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "Origin",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "Authorization",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "id",
                    "in": "path",
                    "required": true,
                    "type": "string",
                  },
                ],
                "responses": {
                  "200": {
                    "description": "200 response",
                    "schema": {
                      "$ref": "#/definitions/Empty",
                    },
                    "headers": {
                      "Access-Control-Allow-Origin": {
                        "type": "string",
                      },
                      "Access-Control-Allow-Credentials": {
                        "type": "string",
                      },
                      "Set-Cookie": {
                        "type": "string",
                      },
                      "Access-Control-Allow-Headers": {
                        "type": "string",
                      },
                    },
                  },
                },
                "x-amazon-apigateway-integration": {
                  "uri": {
                    "Fn::Sub": "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${IiifFunction.Arn}/invocations",
                  },
                  "responses": {
                    "default": {
                      "statusCode": "200",
                      "responseParameters": {
                        "method.response.header.Access-Control-Allow-Origin": "'*'",
                      },
                      "contentHandling": "CONVERT_TO_BINARY",
                    },
                  },
                  "passthroughBehavior": "when_no_match",
                  "httpMethod": "POST",
                  "cacheNamespace": "frz8df",
                  "cacheKeyParameters": [
                    "method.request.path.id",
                    "method.request.path.proxy",
                  ],
                  "contentHandling": "CONVERT_TO_TEXT",
                  "type": "aws_proxy",
                },
              },
              "options": {
                "produces": [
                  "application/json",
                ],
                "parameters": [
                  {
                    "name": "proxy",
                    "in": "path",
                    "required": true,
                    "type": "string",
                  },
                  {
                    "name": "Origin",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "Authorization",
                    "in": "header",
                    "required": false,
                    "type": "string",
                  },
                  {
                    "name": "id",
                    "in": "path",
                    "required": true,
                    "type": "string",
                  },
                ],
                "responses": {
                  "200": {
                    "description": "200 response",
                    "schema": {
                      "$ref": "#/definitions/Empty",
                    },
                    "headers": {
                      "Access-Control-Allow-Origin": {
                        "type": "string",
                      },
                      "Access-Control-Allow-Credentials": {
                        "type": "string",
                      },
                      "Access-Control-Allow-Headers": {
                        "type": "string",
                      },
                    },
                  },
                },
                "x-amazon-apigateway-integration": {
                  "uri": {
                    "Fn::Sub": "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${IiifFunction.Arn}/invocations",
                  },
                  "responses": {
                    "default": {
                      "statusCode": "200",
                    },
                  },
                  "passthroughBehavior": "when_no_match",
                  "httpMethod": "POST",
                  "contentHandling": "CONVERT_TO_TEXT",
                  "type": "aws_proxy",
                },
              },
            },
          },
          "definitions": {
            "Empty": {
              "type": "object",
              "title": "Empty Schema",
            },
          },
          "x-amazon-apigateway-binary-media-types": [
            "*/*",
          ],
        },
      }))
    })
  })
})