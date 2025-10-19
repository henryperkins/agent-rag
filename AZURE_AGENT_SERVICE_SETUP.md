# Azure AI Agent Service Configuration Guide

**Date:** October 19, 2025
**Resource:** oaisubresource
**Status:** ⚠️ Configured (Requires MCP Server Restart)

---

## ✅ Configuration Complete

The Azure AI Agent Service has been configured with the following environment variables added to your `.env` file:

```bash
# Azure AI Agent Service Configuration
AZURE_AI_AGENT_ENDPOINT=https://oaisubresource.cognitiveservices.azure.com/
AZURE_AI_AGENT_API_KEY=<your-api-key-here>
AZURE_AI_AGENT_RESOURCE_NAME=oaisubresource
```

---

## ✅ Environment Variables Configured

The following environment variables have been added to both user and root `.bashrc` files:

```bash
export AZURE_AI_PROJECT_ENDPOINT="https://oaisubresource.services.ai.azure.com/api/projects/oaisubresource"
export AZURE_AI_PROJECT_NAME="oaisubresource"
export AZURE_RESOURCE_GROUP_NAME="rg-hperkin4-8776"
export AZURE_SUBSCRIPTION_ID="fe000daf-8df4-49e4-99d8-6e789060f760"
export AZURE_TENANT_ID="41f88ecb-ca63-404d-97dd-ab0a169fd138"
export AZURE_OPENAI_ENDPOINT="https://oaisubresource.openai.azure.com/"
export AZURE_OPENAI_API_KEY="[configured]"
export AZURE_AI_SEARCH_ENDPOINT="https://oaisearch2.search.windows.net"
export AZURE_AI_SEARCH_API_KEY="[configured]"
export AZURE_AI_AGENT_ENDPOINT="https://oaisubresource.cognitiveservices.azure.com/"
export AZURE_AI_AGENT_API_KEY="[configured]"
export AZURE_AI_AGENT_RESOURCE_NAME="oaisubresource"
```

**Files Updated:**

- `/home/azureuser/.bashrc` - For your user
- `/root/.bashrc` - For root user (MCP server)
- `/home/azureuser/agent-rag/.env` - Application config

## 🔄 Restart Required: Reload VS Code Window

The MCP server needs VS Code to restart to pick up the new environment variables.

### **Recommended: Reload VS Code Window**

1. **Press:** `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. **Type:** `Developer: Reload Window`
3. **Press:** Enter

This will:

- ✅ Reload all extensions
- ✅ Restart all MCP servers with new environment
- ✅ Maintain your open files and terminal sessions
- ✅ Apply the agent service configuration

### Alternative: Restart VS Code Completely

Close and reopen VS Code to ensure all environment variables are loaded.

---

## 🧪 Test the Configuration

After restarting, test the agent service with:

```bash
# In GitHub Copilot Chat, try:
# @azure-ai-foundry list agents
```

Or using the MCP tool directly:

- `mcp_azure-ai-foun_list_agents`
- `mcp_azure-ai-foun_query_default_agent`
- `mcp_azure-ai-foun_connect_agent`

---

## 📋 Resource Details

### Azure AI Services Account: oaisubresource

- **Endpoint:** https://oaisubresource.cognitiveservices.azure.com/
- **Location:** eastus2
- **Resource Group:** rg-hperkin4-8776
- **Subscription:** fe000daf-8df4-49e4-99d8-6e789060f760

### Capabilities Enabled:

✅ VirtualNetworks
✅ TrustedServices
✅ CustomerManagedKey
✅ Fine-tuning support (MaxFineTuneCount, MaxRunningFineTuneCount)
✅ User file management
✅ Evaluation runs
✅ Container support
✅ Cloud deployment

---

## 🎯 What Azure AI Agent Service Enables

Once the MCP server is restarted, you'll have access to:

### 1. Agent Management

- **List Agents:** View all deployed agents
- **Query Agents:** Send queries to specific agents
- **Agent Evaluation:** Evaluate agent performance

### 2. Agent Evaluators (3 Available)

- `intent_resolution` - Evaluates how well the agent understands user intent
- `tool_call_accuracy` - Measures correctness of tool/function calls
- `task_adherence` - Assesses whether the agent stays on task

### 3. Agent Orchestration

- Connect to specific agents by ID
- Query default agent with automatic routing
- Run agent queries and evaluate results in one call

---

## 📖 Usage Examples

### After Restart, You Can:

#### 1. List Available Agents

```python
# Via MCP tool
agents = list_agents()
print(agents)
```

#### 2. Query an Agent

```python
# Connect to a specific agent
response = connect_agent(
    agent_id="your-agent-id",
    query="What is the capital of France?"
)
```

#### 3. Query and Evaluate

```python
# Query and automatically evaluate the response
result = agent_query_and_evaluate(
    agent_id="your-agent-id",
    query="Explain quantum computing",
    evaluator_names=["intent_resolution", "task_adherence"]
)
```

#### 4. Get Evaluator Requirements

```python
# See what inputs each evaluator needs
requirements = get_agent_evaluator_requirements(
    evaluator_name="intent_resolution"
)
```

---

## 🔍 Verification Steps

### Step 1: Check Environment Variables

```bash
cat .env | grep AZURE_AI_AGENT
```

Expected output:

```
AZURE_AI_AGENT_ENDPOINT=https://oaisubresource.cognitiveservices.azure.com/
AZURE_AI_AGENT_API_KEY=<your-api-key-here>
AZURE_AI_AGENT_RESOURCE_NAME=oaisubresource
```

### Step 2: Verify MCP Server is Running

```bash
ps aux | grep -i "azure-ai-foundry" | grep -v grep
```

Should show the MCP server processes.

### Step 3: Test Agent Service

After restart, the `list_agents` tool should work without errors.

---

## 🔧 Troubleshooting

### Issue: "Azure AI Agent service is not initialized"

**Cause:** MCP server hasn't reloaded the new environment variables
**Solution:** Restart the MCP server using one of the methods above

### Issue: "Permission denied" when trying to kill process

**Cause:** MCP server is running as root
**Solution:** Use `sudo pkill -f "run-azure-ai-foundry-mcp"`

### Issue: Agent service still not working after restart

**Check:**

1. Environment variables are correctly set: `cat .env | grep AZURE_AI_AGENT`
2. API key is valid: Check Azure Portal
3. Endpoint is correct: Should end with `.cognitiveservices.azure.com/`
4. MCP server logs for errors

### Issue: No agents found

**Note:** This is normal if you haven't created any agents yet. The agent service will be initialized and ready to create/manage agents.

---

## 📚 Next Steps

### 1. Create Your First Agent (Optional)

If you want to create an agent, you can use the Azure AI Foundry portal:

- Visit: https://ai.azure.com
- Navigate to your project: oaisubresource
- Create an agent with knowledge sources

### 2. Integrate with Your Application

The agent-rag application already has agent support in:

- `backend/src/azure/indexSetup.ts` - Agent creation logic
- Configuration for knowledge agents using Azure Search indexes

### 3. Deploy Agents

You can deploy agents that use:

- Your existing `earth_at_night` search index
- Azure OpenAI models (gpt-5, gpt-4.1, etc.)
- Custom knowledge sources

---

## 🎉 Summary

### What Was Configured:

✅ Azure AI Agent Service endpoint
✅ API authentication key
✅ Resource name reference
✅ Environment variables added to `.env`

### What's Required:

⚠️ Restart MCP server to load new configuration

### What You'll Get:

🎯 Access to 3 agent evaluators
🎯 Agent management tools
🎯 Agent query and orchestration
🎯 Agent evaluation framework

---

## 📞 Support

If you continue to have issues:

1. Check MCP server logs
2. Verify Azure Portal shows the resource is active
3. Confirm API key is valid: `az cognitiveservices account keys list --name oaisubresource --resource-group rg-hperkin4-8776`
4. Review the Azure AI Foundry MCP documentation: https://github.com/azure-ai-foundry/mcp-foundry

---

**Status:** Configuration complete, awaiting MCP server restart ✅

**Last Updated:** October 19, 2025
