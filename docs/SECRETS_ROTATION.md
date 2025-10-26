# Secrets Rotation & Remediation Guide

**CRITICAL SECURITY NOTICE**: Live credentials were committed to this repository and must be rotated immediately.

## Compromised Credentials

The following credentials were exposed in `.env` and `backend/.env`:

### Azure Services

- **Azure OpenAI API Key**: `8DfQaeG7oXowb...` (compromised)
- **Azure Search API Key**: `34AbnvtFCDgl37...` (compromised)
- **Azure Embedding API Key**: `2zPRpujl70hbx...` (compromised)

### Third-Party Services

- **Google Search API Key**: `AIzaSyBgMDjG...` (compromised)
- **Hyperbrowser API Key**: `hb_bc99b6bfa2...` (compromised)
- **ChatKit Key**: `domain_pk_68e5...` (compromised)
- **Context7 Key**: `ctx7sk-2fa5fbd...` (compromised)

### Azure Resource IDs (less sensitive, but exposed)

- Subscription ID: `fe000daf-8df4-49e4-99d8-6e789060f760`
- Tenant ID: `41f88ecb-ca63-404d-97dd-ab0a169fd138`
- Resource Group: `rg-hperkin4-8776`

---

## Immediate Actions Required

### 1. Rotate All Keys (Do First)

#### Azure OpenAI

```bash
# Rotate in Azure Portal
az cognitiveservices account keys regenerate \
  --name oaisubresource \
  --resource-group rg-hperkin4-8776 \
  --key-name key1
```

#### Azure Search

```bash
# Regenerate admin key
az search admin-key renew \
  --service-name oaisearch2 \
  --resource-group rg-hperkin4-8776 \
  --key-name primary
```

#### Google Custom Search

- Visit: https://console.cloud.google.com/apis/credentials
- Delete the exposed key
- Create a new API key with IP/domain restrictions

#### Third-Party Services

- **Hyperbrowser**: https://hyperbrowser.ai/dashboard → regenerate
- **ChatKit**: Contact support or regenerate via dashboard
- **Context7**: https://context7.com/dashboard → regenerate

---

### 2. Remove Secrets from Repository

```bash
# Remove .env files from git tracking
git rm --cached .env backend/.env

# Add to .gitignore (already present)
echo ".env" >> .gitignore
echo "backend/.env" >> backend/.gitignore

# Commit the removal
git add .gitignore backend/.gitignore
git commit -m "security: remove exposed secrets from repository"
```

**IMPORTANT**: This does NOT remove the secrets from git history. For complete remediation:

```bash
# Option 1: BFG Repo-Cleaner (recommended)
bfg --replace-text secrets.txt
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Option 2: git-filter-repo
git filter-repo --path .env --invert-paths
git filter-repo --path backend/.env --invert-paths
```

⚠️ **WARNING**: These commands rewrite history and force-push required. Coordinate with team.

---

### 3. Configure Azure Key Vault Integration

#### Create Key Vault

```bash
az keyvault create \
  --name agent-rag-secrets \
  --resource-group rg-hperkin4-8776 \
  --location northcentralus

# Enable managed identity for App Service
az webapp identity assign \
  --name your-app-name \
  --resource-group rg-hperkin4-8776
```

#### Store Secrets

```bash
# Azure OpenAI
az keyvault secret set \
  --vault-name agent-rag-secrets \
  --name azure-openai-key \
  --value "NEW_KEY_HERE"

# Azure Search
az keyvault secret set \
  --vault-name agent-rag-secrets \
  --name azure-search-key \
  --value "NEW_KEY_HERE"

# Repeat for all secrets
```

#### Grant Access

```bash
# Get the managed identity principal ID
PRINCIPAL_ID=$(az webapp identity show \
  --name your-app-name \
  --resource-group rg-hperkin4-8776 \
  --query principalId -o tsv)

# Grant read access
az keyvault set-policy \
  --name agent-rag-secrets \
  --object-id $PRINCIPAL_ID \
  --secret-permissions get list
```

---

### 4. Update Application Code

#### Install Azure Identity SDK

```bash
cd backend
pnpm add @azure/identity @azure/keyvault-secrets
```

#### Load Secrets at Runtime

Create `backend/src/config/secrets.ts`:

```typescript
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

const vaultUrl = process.env.AZURE_KEY_VAULT_URL || 'https://agent-rag-secrets.vault.azure.net';
const credential = new DefaultAzureCredential();
const secretClient = new SecretClient(vaultUrl, credential);

export async function loadSecrets() {
  const [azureOpenAIKey, azureSearchKey, googleSearchKey] = await Promise.all([
    secretClient.getSecret('azure-openai-key'),
    secretClient.getSecret('azure-search-key'),
    secretClient.getSecret('google-search-key'),
  ]);

  return {
    AZURE_OPENAI_API_KEY: azureOpenAIKey.value!,
    AZURE_SEARCH_API_KEY: azureSearchKey.value!,
    GOOGLE_SEARCH_API_KEY: googleSearchKey.value!,
  };
}
```

Update `backend/src/server.ts`:

```typescript
import { loadSecrets } from './config/secrets.js';

const secrets = await loadSecrets();

// Override environment variables with vault values
process.env.AZURE_OPENAI_API_KEY = secrets.AZURE_OPENAI_API_KEY;
process.env.AZURE_SEARCH_API_KEY = secrets.AZURE_SEARCH_API_KEY;
process.env.GOOGLE_SEARCH_API_KEY = secrets.GOOGLE_SEARCH_API_KEY;

// Then start the server
await app.listen({ port: config.PORT, host: '0.0.0.0' });
```

---

### 5. Local Development Setup

For local development, create `.env` from `.env.example`:

```bash
cp .env.example .env
cp backend/.env.example backend/.env

# Edit with your LOCAL development keys (not production)
# Use separate dev/test Azure resources
```

**Never commit `.env` files to git.**

---

### 6. CI/CD Configuration

#### GitHub Actions Secrets

Add to repository secrets:

- `AZURE_OPENAI_API_KEY`
- `AZURE_SEARCH_API_KEY`
- `GOOGLE_SEARCH_API_KEY`

#### Azure App Service Configuration

```bash
az webapp config appsettings set \
  --name your-app-name \
  --resource-group rg-hperkin4-8776 \
  --settings \
    AZURE_KEY_VAULT_URL=https://agent-rag-secrets.vault.azure.net \
    NODE_ENV=production
```

---

## Verification Checklist

- [ ] All Azure keys rotated via Azure Portal/CLI
- [ ] Google API key regenerated with restrictions
- [ ] Third-party service keys regenerated
- [ ] `.env` files removed from git tracking
- [ ] Git history cleaned (optional but recommended)
- [ ] Azure Key Vault created and populated
- [ ] Managed identity configured and granted access
- [ ] Application code updated to load from Key Vault
- [ ] `.env.example` files committed for reference
- [ ] CI/CD secrets configured
- [ ] Team notified of rotation
- [ ] Old keys confirmed revoked

---

## Post-Remediation Monitoring

### Enable Azure Monitor Alerts

```bash
# Alert on Key Vault access
az monitor metrics alert create \
  --name keyvault-access-alert \
  --resource-group rg-hperkin4-8776 \
  --scopes /subscriptions/.../keyvault/agent-rag-secrets \
  --condition "count ServiceApiHit > 100" \
  --window-size 5m
```

### Review Access Logs

```bash
# Check who accessed secrets
az monitor activity-log list \
  --resource-id /subscriptions/.../keyvault/agent-rag-secrets \
  --start-time 2025-10-19 \
  --max-events 50
```

---

## Prevention Measures

1. **Pre-commit Hooks**: Use `detect-secrets` or `git-secrets`

   ```bash
   pip install detect-secrets
   detect-secrets scan --baseline .secrets.baseline
   ```

2. **GitHub Secret Scanning**: Enabled automatically for public repos

3. **Azure Policy**: Enforce Key Vault for all secrets

4. **Rotation Schedule**: Rotate keys every 90 days

5. **Principle of Least Privilege**: Use separate keys per environment

---

## Support Contacts

- **Azure Support**: https://portal.azure.com/#blade/Microsoft_Azure_Support/HelpAndSupportBlade
- **Google Cloud Support**: https://cloud.google.com/support
- **Security Team**: security@your-org.com (if applicable)

---

**Date Prepared**: 2025-10-20
**Next Rotation Due**: 2026-01-18 (90 days)
