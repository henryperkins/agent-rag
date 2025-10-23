---
title: 'Knowledge Agents - Create Or Update - REST API (Azure Search Service)'
source: 'https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/create-or-update?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP'
author:
  - '[[kexugit]]'
published:
created: 2025-10-22
description: 'Learn more about Search Service service - Creates a new agent or updates an agent if it already exists.'
tags:
  - 'clippings'
---

## Knowledge Agents - Create Or Update

Creates a new agent or updates an agent if it already exists.

```
PUT {endpoint}/agents('{agentName}')?api-version=2025-08-01-preview
```

## URI Parameters

| Name        | In    | Required | Type   | Description                                |
| ----------- | ----- | -------- | ------ | ------------------------------------------ |
| agent Name  | path  | True     | string | The name of the agent to create or update. |
| endpoint    | path  | True     | string | The endpoint URL of the search service.    |
| api-version | query | True     | string | Client Api Version.                        |

## Request Header

| Name                   | Required | Type          | Description                                                                                                                    |
| ---------------------- | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| x-ms-client-request-id |          | string (uuid) | The tracking ID sent with the request to help with debugging.                                                                  |
| If-Match               |          | string        | Defines the If-Match condition. The operation will be performed only if the ETag on the server matches this value.             |
| If-None-Match          |          | string        | Defines the If-None-Match condition. The operation will be performed only if the ETag on the server does not match this value. |
| Prefer                 | True     | string        | For HTTP PUT requests, instructs the service to return the created/updated resource on success.                                |

## Request Body

| Name                  | Required | Type                                                                                                                                                                                                                                                  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| knowledgeSources      | True     | [Knowledge Source Reference](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgesourcereference) \[\]                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| models                | True     | KnowledgeAgentModel\[\]: [Knowledge Agent Azure Open AIModel](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagentazureopenaimodel) \[\] | Contains configuration options on how to connect to AI models.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| name                  | True     | string                                                                                                                                                                                                                                                | The name of the knowledge agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| @odata.etag           |          | string                                                                                                                                                                                                                                                | The ETag of the agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| description           |          | string                                                                                                                                                                                                                                                | The description of the agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| encryptionKey         |          | [Search Resource Encryption Key](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#searchresourceencryptionkey)                                      | A description of an encryption key that you create in Azure Key Vault. This key is used to provide an additional level of encryption-at-rest for your agent definition when you want full assurance that no one, not even Microsoft, can decrypt them. Once you have encrypted your agent definition, it will always remain encrypted. The search service will ignore attempts to set this property to null. You can change this property as needed if you want to rotate your encryption key; Your agent definition will be unaffected. Encryption with customer-managed keys is not available for free search services, and is only available for paid services created on or after January 1, 2019. |
| outputConfiguration   |          | [Knowledge Agent Output Configuration](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagentoutputconfiguration)                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| requestLimits         |          | [Knowledge Agent Request Limits](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagentrequestlimits)                                      | Guardrails to limit how much resources are utilized for a single agent retrieval request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| retrievalInstructions |          | string                                                                                                                                                                                                                                                | Instructions considered by the knowledge agent when developing query plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Responses

| Name               | Type                                                                                                                                                                                 | Description     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| 200 OK             | [Knowledge Agent](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagent) |                 |
| 201 Created        | [Knowledge Agent](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagent) |                 |
| Other Status Codes | [Error Response](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#errorresponse)   | Error response. |

## Examples

### SearchServiceCreateOrUpdateKnowledgeAgent

#### Sample request

- [HTTP](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#tabpanel_1_HTTP)

```
PUT https://previewexampleservice.search.windows.net/agents('agent-preview-test')?api-version=2025-08-01-preview

{
  "name": "agent-preview-test",
  "models": [
    {
      "azureOpenAIParameters": {
        "resourceUri": "https://test-sample.openai.azure.com/",
        "deploymentId": "myDeployment",
        "apiKey": "api-key",
        "modelName": "gpt-4o-mini"
      },
      "kind": "azureOpenAI"
    }
  ],
  "knowledgeSources": [
    {
      "name": "ks-preview-test",
      "includeReferences": true,
      "includeReferenceSourceData": true,
      "alwaysQuerySource": true,
      "maxSubQueries": 5,
      "rerankerThreshold": 2.1
    }
  ],
  "outputConfiguration": {
    "modality": "extractiveData",
    "answerInstructions": "Provide a concise answer to the question.",
    "attemptFastPath": false,
    "includeActivity": true
  },
  "requestLimits": {
    "maxRuntimeInSeconds": 60,
    "maxOutputSize": 100000
  },
  "retrievalInstructions": "Instructions for retrieval for the agent.",
  "@odata.etag": "0x1234568AE7E58A1",
  "encryptionKey": {
    "keyVaultKeyName": "myUserManagedEncryptionKey-createdinAzureKeyVault",
    "keyVaultKeyVersion": "myKeyVersion-32charAlphaNumericString",
    "keyVaultUri": "https://myKeyVault.vault.azure.net",
    "accessCredentials": {
      "applicationId": "00000000-0000-0000-0000-000000000000",
      "applicationSecret": "<applicationSecret>"
    }
  },
  "description": "Description of the agent."
}
```

#### Sample response

```json
{
  "@odata.etag": "0x1234568AE7E58A1",
  "name": "agent-preview-test",
  "description": "Description of the agent.",
  "retrievalInstructions": "Instructions for retrieval for the agent.",
  "knowledgeSources": [
    {
      "name": "ks-preview-test",
      "alwaysQuerySource": true,
      "includeReferences": true,
      "includeReferenceSourceData": true,
      "maxSubQueries": 5,
      "rerankerThreshold": 2.1
    }
  ],
  "models": [
    {
      "kind": "azureOpenAI",
      "azureOpenAIParameters": {
        "resourceUri": "https://test-sample.openai.azure.com/",
        "deploymentId": "myDeployment",
        "apiKey": "api-key",
        "modelName": "gpt-4o-mini"
      }
    }
  ],
  "outputConfiguration": {
    "modality": "extractiveData",
    "answerInstructions": "Provide a concise answer to the question.",
    "attemptFastPath": false,
    "includeActivity": true
  },
  "requestLimits": {
    "maxRuntimeInSeconds": 60,
    "maxOutputSize": 100000
  },
  "encryptionKey": {
    "keyVaultKeyName": "myUserManagedEncryptionKey-createdinAzureKeyVault",
    "keyVaultKeyVersion": "myKeyVersion-32charAlphaNumericString",
    "keyVaultUri": "https://myKeyVault.vault.azure.net",
    "accessCredentials": {
      "applicationId": "00000000-0000-0000-0000-000000000000",
      "applicationSecret": "<applicationSecret>"
    }
  }
}
```

```json
{
  "@odata.etag": "0x1234568AE7E58A1",
  "name": "agent-preview-test",
  "description": "Description of the agent.",
  "retrievalInstructions": "Instructions for retrieval for the agent.",
  "knowledgeSources": [
    {
      "name": "ks-preview-test",
      "alwaysQuerySource": true,
      "includeReferences": true,
      "includeReferenceSourceData": true,
      "maxSubQueries": 5,
      "rerankerThreshold": 2.1
    }
  ],
  "models": [
    {
      "kind": "azureOpenAI",
      "azureOpenAIParameters": {
        "resourceUri": "https://test-sample.openai.azure.com/",
        "deploymentId": "myDeployment",
        "apiKey": "api-key",
        "modelName": "gpt-4o-mini"
      }
    }
  ],
  "outputConfiguration": {
    "modality": "extractiveData",
    "answerInstructions": "Provide a concise answer to the question.",
    "attemptFastPath": false,
    "includeActivity": true
  },
  "requestLimits": {
    "maxRuntimeInSeconds": 60,
    "maxOutputSize": 100000
  },
  "encryptionKey": {
    "keyVaultKeyName": "myUserManagedEncryptionKey-createdinAzureKeyVault",
    "keyVaultKeyVersion": "myKeyVersion-32charAlphaNumericString",
    "keyVaultUri": "https://myKeyVault.vault.azure.net",
    "accessCredentials": {
      "applicationId": "00000000-0000-0000-0000-000000000000",
      "applicationSecret": "<applicationSecret>"
    }
  }
}
```

## Definitions

| Name                                                                                                                                                                                                                                            | Description                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Azure Active Directory Application Credentials](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#azureactivedirectoryapplicationcredentials) | Credentials of a registered application created for your search service, used for authenticated access to the encryption keys stored in Azure Key Vault.                |
| [Azure Open AIEmbedding Skill](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#azureopenaiembeddingskill)                                    | Allows you to generate a vector embedding for a given text input using the Azure OpenAI resource.                                                                       |
| [Azure Open AIModel Name](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#azureopenaimodelname)                                              | The Azure Open AI model name that will be called.                                                                                                                       |
| [Azure Open AIParameters](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#azureopenaiparameters)                                             | Specifies the parameters for connecting to the Azure OpenAI resource.                                                                                                   |
| [Error Additional Info](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#erroradditionalinfo)                                                 | The resource management error additional info.                                                                                                                          |
| [Error Detail](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#errordetail)                                                                  | The error detail.                                                                                                                                                       |
| [Error Response](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#errorresponse)                                                              | Error response                                                                                                                                                          |
| [Input Field Mapping Entry](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#inputfieldmappingentry)                                          | Input field mapping for a skill.                                                                                                                                        |
| [Knowledge Agent](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagent)                                                            |                                                                                                                                                                         |
| [Knowledge Agent Azure Open AIModel](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagentazureopenaimodel)                         | Specifies the Azure OpenAI resource used to do query planning.                                                                                                          |
| [Knowledge Agent Model Kind](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagentmodelkind)                                        | The AI model to be used for query planning.                                                                                                                             |
| [Knowledge Agent Output Configuration](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagentoutputconfiguration)                    |                                                                                                                                                                         |
| [Knowledge Agent Output Configuration Modality](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagentoutputconfigurationmodality)   | The output configuration for the agent                                                                                                                                  |
| [Knowledge Agent Request Limits](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagentrequestlimits)                                | Guardrails to limit how much resources are utilized for a single agent retrieval request.                                                                               |
| [Knowledge Source Reference](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgesourcereference)                                       |                                                                                                                                                                         |
| [Output Field Mapping Entry](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#outputfieldmappingentry)                                        | Output field mapping for a skill.                                                                                                                                       |
| [Search Indexer Data None Identity](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#searchindexerdatanoneidentity)                           | Clears the identity property of a datasource.                                                                                                                           |
| [Search Indexer Data User Assigned Identity](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#searchindexerdatauserassignedidentity)          | Specifies the identity for a datasource to use.                                                                                                                         |
| [Search Resource Encryption Key](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#searchresourceencryptionkey)                                | A customer-managed encryption key in Azure Key Vault. Keys that you create and manage can be used to encrypt or decrypt data-at-rest, such as indexes and synonym maps. |

### AzureActiveDirectoryApplicationCredentials

Credentials of a registered application created for your search service, used for authenticated access to the encryption keys stored in Azure Key Vault.

| Name              | Type   | Description                                                                                                                                                                                                                                |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| applicationId     | string | An AAD Application ID that was granted the required access permissions to the Azure Key Vault that is to be used when encrypting your data at rest. The Application ID should not be confused with the Object ID for your AAD Application. |
| applicationSecret | string | The authentication key of the specified AAD application.                                                                                                                                                                                   |

### AzureOpenAIEmbeddingSkill

Allows you to generate a vector embedding for a given text input using the Azure OpenAI resource.

| Name         | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Description                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| @odata.type  | string: #Microsoft. Skills. Text. Azure Open AIEmbedding Skill                                                                                                                                                                                                                                                                                                                                                                                                                              | A URI fragment specifying the type of skill.                                                                                                                                                                 |
| apiKey       | string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | API key of the designated Azure OpenAI resource.                                                                                                                                                             |
| authIdentity | SearchIndexerDataIdentity: - [Search Indexer Data None Identity](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#searchindexerdatanoneidentity) - [Search Indexer Data User Assigned Identity](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#searchindexerdatauserassignedidentity) | The user-assigned managed identity used for outbound connections.                                                                                                                                            |
| context      | string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Represents the level at which operations take place, such as the document root or document content (for example, /document or /document/content). The default is /document.                                  |
| deploymentId | string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ID of the Azure OpenAI model deployment on the designated resource.                                                                                                                                          |
| description  | string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The description of the skill which describes the inputs, outputs, and usage of the skill.                                                                                                                    |
| dimensions   | integer (int32)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | The number of dimensions the resulting output embeddings should have. Only supported in text-embedding-3 and later models.                                                                                   |
| inputs       | [Input Field Mapping Entry](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#inputfieldmappingentry) \[\]                                                                                                                                                                                                                                                                                 | Inputs of the skills could be a column in the source data set, or the output of an upstream skill.                                                                                                           |
| modelName    | [Azure Open AIModel Name](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#azureopenaimodelname)                                                                                                                                                                                                                                                                                          | The name of the embedding model that is deployed at the provided deploymentId path.                                                                                                                          |
| name         | string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The name of the skill which uniquely identifies it within the skillset. A skill with no name defined will be given a default name of its 1-based index in the skills array, prefixed with the character '#'. |
| outputs      | [Output Field Mapping Entry](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#outputfieldmappingentry) \[\]                                                                                                                                                                                                                                                                               | The output of a skill is either a field in a search index, or a value that can be consumed as an input by another skill.                                                                                     |
| resourceUri  | string (uri)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | The resource URI of the Azure OpenAI resource.                                                                                                                                                               |

### AzureOpenAIModelName

The Azure Open AI model name that will be called.

| Value                  | Description |
| ---------------------- | ----------- |
| text-embedding-ada-002 |             |
| text-embedding-3-large |             |
| text-embedding-3-small |             |
| gpt-4o                 |             |
| gpt-4o-mini            |             |
| gpt-4.1                |             |
| gpt-4.1-mini           |             |
| gpt-4.1-nano           |             |

### AzureOpenAIParameters

Specifies the parameters for connecting to the Azure OpenAI resource.

| Name         | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Description                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| apiKey       | string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | API key of the designated Azure OpenAI resource.                                    |
| authIdentity | SearchIndexerDataIdentity: - [Search Indexer Data None Identity](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#searchindexerdatanoneidentity) - [Search Indexer Data User Assigned Identity](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#searchindexerdatauserassignedidentity) | The user-assigned managed identity used for outbound connections.                   |
| deploymentId | string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ID of the Azure OpenAI model deployment on the designated resource.                 |
| modelName    | [Azure Open AIModel Name](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#azureopenaimodelname)                                                                                                                                                                                                                                                                                          | The name of the embedding model that is deployed at the provided deploymentId path. |
| resourceUri  | string (uri)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | The resource URI of the Azure OpenAI resource.                                      |

### ErrorAdditionalInfo

The resource management error additional info.

| Name | Type   | Description               |
| ---- | ------ | ------------------------- |
| info | object | The additional info.      |
| type | string | The additional info type. |

### ErrorDetail

The error detail.

| Name           | Type                                                                                                                                                                                                 | Description                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| additionalInfo | [Error Additional Info](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#erroradditionalinfo) \[\] | The error additional info. |
| code           | string                                                                                                                                                                                               | The error code.            |
| details        | [Error Detail](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#errordetail) \[\]                  | The error details.         |
| message        | string                                                                                                                                                                                               | The error message.         |
| target         | string                                                                                                                                                                                               | The error target.          |

### ErrorResponse

Error response

| Name  | Type                                                                                                                                                                           | Description       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| error | [Error Detail](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#errordetail) | The error object. |

### InputFieldMappingEntry

Input field mapping for a skill.

| Name          | Type                                                                                                                                                                                                        | Description                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| inputs        | [Input Field Mapping Entry](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#inputfieldmappingentry) \[\] | The recursive inputs used when creating a complex type. |
| name          | string                                                                                                                                                                                                      | The name of the input.                                  |
| source        | string                                                                                                                                                                                                      | The source of the input.                                |
| sourceContext | string                                                                                                                                                                                                      | The source context used for selecting recursive inputs. |

### KnowledgeAgent

| Name                  | Type                                                                                                                                                                                                                                                  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| @odata.etag           | string                                                                                                                                                                                                                                                | The ETag of the agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| description           | string                                                                                                                                                                                                                                                | The description of the agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| encryptionKey         | [Search Resource Encryption Key](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#searchresourceencryptionkey)                                      | A description of an encryption key that you create in Azure Key Vault. This key is used to provide an additional level of encryption-at-rest for your agent definition when you want full assurance that no one, not even Microsoft, can decrypt them. Once you have encrypted your agent definition, it will always remain encrypted. The search service will ignore attempts to set this property to null. You can change this property as needed if you want to rotate your encryption key; Your agent definition will be unaffected. Encryption with customer-managed keys is not available for free search services, and is only available for paid services created on or after January 1, 2019. |
| knowledgeSources      | [Knowledge Source Reference](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgesourcereference) \[\]                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| models                | KnowledgeAgentModel\[\]: [Knowledge Agent Azure Open AIModel](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagentazureopenaimodel) \[\] | Contains configuration options on how to connect to AI models.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| name                  | string                                                                                                                                                                                                                                                | The name of the knowledge agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| outputConfiguration   | [Knowledge Agent Output Configuration](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagentoutputconfiguration)                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| requestLimits         | [Knowledge Agent Request Limits](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagentrequestlimits)                                      | Guardrails to limit how much resources are utilized for a single agent retrieval request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| retrievalInstructions | string                                                                                                                                                                                                                                                | Instructions considered by the knowledge agent when developing query plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### KnowledgeAgentAzureOpenAIModel

Specifies the Azure OpenAI resource used to do query planning.

| Name                  | Type                                                                                                                                                                                                                                | Description                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| azureOpenAIParameters | AzureOpenAIParameters: [Azure Open AIEmbedding Skill](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#azureopenaiembeddingskill) | Contains the parameters specific to Azure OpenAI model endpoint. |
| kind                  | string: azure OpenAI                                                                                                                                                                                                                | The type of AI model.                                            |

### KnowledgeAgentModelKind

The AI model to be used for query planning.

| Value       | Description                                  |
| ----------- | -------------------------------------------- |
| azureOpenAI | Use Azure Open AI models for query planning. |

### KnowledgeAgentOutputConfiguration

| Name               | Type                                                                                                                                                                                                                                          | Description                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| answerInstructions | string                                                                                                                                                                                                                                        | Instructions considered by the knowledge agent when generating answers                                                                                  |
| attemptFastPath    | boolean                                                                                                                                                                                                                                       | Indicates whether the agent should attempt to issue the most recent chat message as a direct query to the knowledge sources, bypassing the model calls. |
| includeActivity    | boolean                                                                                                                                                                                                                                       | Indicates retrieval results should include activity information.                                                                                        |
| modality           | [Knowledge Agent Output Configuration Modality](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#knowledgeagentoutputconfigurationmodality) | The output configuration for the agent                                                                                                                  |

### KnowledgeAgentOutputConfigurationModality

The output configuration for the agent

| Value           | Description                                                                    |
| --------------- | ------------------------------------------------------------------------------ |
| answerSynthesis | Synthesize an answer for the response payload.                                 |
| extractiveData  | Return data from the knowledge sources directly without generative alteration. |

### KnowledgeAgentRequestLimits

Guardrails to limit how much resources are utilized for a single agent retrieval request.

| Name                | Type            | Description                                           |
| ------------------- | --------------- | ----------------------------------------------------- |
| maxOutputSize       | integer (int32) | Limits the maximum size of the content in the output. |
| maxRuntimeInSeconds | integer (int32) | The maximum runtime in seconds.                       |

### KnowledgeSourceReference

| Name                       | Type            | Description                                                                                                  |
| -------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------ |
| alwaysQuerySource          | boolean         | Indicates that this knowledge source should bypass source selection and always be queried at retrieval time. |
| includeReferenceSourceData | boolean         | Indicates whether references should include the structured data obtained during retrieval in their payload.  |
| includeReferences          | boolean         | Indicates whether references should be included for data retrieved from this source.                         |
| maxSubQueries              | integer (int32) | The maximum number of queries that can be issued at a time when retrieving data from this source.            |
| name                       | string          | The name of the knowledge source.                                                                            |
| rerankerThreshold          | number (float)  | The reranker threshold all retrieved documents must meet to be included in the response.                     |

### OutputFieldMappingEntry

Output field mapping for a skill.

| Name       | Type   | Description                                                        |
| ---------- | ------ | ------------------------------------------------------------------ |
| name       | string | The name of the output defined by the skill.                       |
| targetName | string | The target name of the output. It is optional and default to name. |

### SearchIndexerDataNoneIdentity

Clears the identity property of a datasource.

| Name        | Type                                                  | Description                                     |
| ----------- | ----------------------------------------------------- | ----------------------------------------------- |
| @odata.type | string: #Microsoft. Azure. Search. Data None Identity | A URI fragment specifying the type of identity. |

### SearchIndexerDataUserAssignedIdentity

Specifies the identity for a datasource to use.

| Name                 | Type                                                           | Description                                                                                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @odata.type          | string: #Microsoft. Azure. Search. Data User Assigned Identity | A URI fragment specifying the type of identity.                                                                                                                                                                                                                                               |
| userAssignedIdentity | string                                                         | The fully qualified Azure resource Id of a user assigned managed identity typically in the form "/subscriptions/12345678-1234-1234-1234-1234567890ab/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/myId" that should have been assigned to the search service. |

### SearchResourceEncryptionKey

A customer-managed encryption key in Azure Key Vault. Keys that you create and manage can be used to encrypt or decrypt data-at-rest, such as indexes and synonym maps.

| Name               | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Description                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| accessCredentials  | [Azure Active Directory Application Credentials](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#azureactivedirectoryapplicationcredentials)                                                                                                                                                                                                                                             | Optional Azure Active Directory credentials used for accessing your Azure Key Vault. Not required if using managed identity instead.                                                                                                                                                                                              |
| identity           | SearchIndexerDataIdentity: - [Search Indexer Data None Identity](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#searchindexerdatanoneidentity) - [Search Indexer Data User Assigned Identity](https://learn.microsoft.com/en-us/rest/api/searchservice/knowledge-agents/?view=rest-searchservice-2025-08-01-preview&preserve-view=true&tabs=HTTP#searchindexerdatauserassignedidentity) | An explicit managed identity to use for this encryption key. If not specified and the access credentials property is null, the system-assigned managed identity is used. On update to the resource, if the explicit identity is unspecified, it remains unchanged. If "none" is specified, the value of this property is cleared. |
| keyVaultKeyName    | string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The name of your Azure Key Vault key to be used to encrypt your data at rest.                                                                                                                                                                                                                                                     |
| keyVaultKeyVersion | string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The version of your Azure Key Vault key to be used to encrypt your data at rest.                                                                                                                                                                                                                                                  |
| keyVaultUri        | string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The URI of your Azure Key Vault, also referred to as DNS name, that contains the key to be used to encrypt your data at rest. An example URI might be `https://my-keyvault-name.vault.azure.net`.                                                                                                                                 |
