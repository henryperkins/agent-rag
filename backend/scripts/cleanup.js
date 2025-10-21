import { DefaultAzureCredential } from '@azure/identity';
import { SearchIndexClient } from '@azure/search-documents';
import { config } from '../src/config/app.js';
const buildAgentUrl = (apiVersion) => {
    const encodedName = encodeURIComponent(config.AZURE_KNOWLEDGE_AGENT_NAME);
    return `${config.AZURE_SEARCH_ENDPOINT}/agents('${encodedName}')?api-version=${apiVersion}`;
};
async function deleteKnowledgeAgent() {
    const credential = new DefaultAzureCredential();
    const tokenResponse = await credential.getToken('https://search.azure.com/.default');
    if (!tokenResponse?.token) {
        console.warn('No token acquired; skipping agent deletion');
        return;
    }
    const url = buildAgentUrl(config.AZURE_SEARCH_MANAGEMENT_API_VERSION);
    let response = await fetch(url, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${tokenResponse.token}`
        }
    });
    if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        if (response.status === 400 &&
            /api-version/i.test(errorText ?? '') &&
            config.AZURE_SEARCH_DATA_PLANE_API_VERSION !== config.AZURE_SEARCH_MANAGEMENT_API_VERSION) {
            const fallbackUrl = buildAgentUrl(config.AZURE_SEARCH_DATA_PLANE_API_VERSION);
            response = await fetch(fallbackUrl, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${tokenResponse.token}`
                }
            });
        }
        else {
            console.warn(`⚠️  Failed to delete agent: ${response.status} ${response.statusText}`);
            return;
        }
    }
    if (response.ok || response.status === 404) {
        console.log(`🗑️  Knowledge agent '${config.AZURE_KNOWLEDGE_AGENT_NAME}' deleted (or not found).`);
    }
    else {
        console.warn(`⚠️  Failed to delete agent: ${response.status} ${response.statusText}`);
    }
}
async function deleteIndex() {
    const credential = new DefaultAzureCredential();
    const indexClient = new SearchIndexClient(config.AZURE_SEARCH_ENDPOINT, credential);
    try {
        await indexClient.deleteIndex(config.AZURE_SEARCH_INDEX_NAME);
        console.log(`🗑️  Search index '${config.AZURE_SEARCH_INDEX_NAME}' deleted.`);
    }
    catch (error) {
        if (error.statusCode === 404) {
            console.log(`ℹ️  Index '${config.AZURE_SEARCH_INDEX_NAME}' already deleted.`);
        }
        else {
            console.warn(`⚠️  Failed to delete index: ${error.message}`);
        }
    }
}
async function main() {
    console.log('='.repeat(40));
    console.log('Cleanup Azure resources');
    console.log('='.repeat(40));
    await deleteKnowledgeAgent();
    await deleteIndex();
    console.log('\nCleanup complete ✅');
}
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
//# sourceMappingURL=cleanup.js.map
