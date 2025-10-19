/**
 * Index Configuration Inspector
 *
 * This script queries the Azure AI Search index to retrieve and display:
 * - Index schema (fields, vector config, semantic config)
 * - Sample document scores from a test query
 * - Reranker score distribution
 */

import { config } from '../config/app.js';
import { getSearchAuthHeaders } from '../azure/directSearch.js';

async function inspectIndexConfiguration(): Promise<void> {
  console.log('=== Azure AI Search Index Inspector ===\n');
  console.log(`Index Name: ${config.AZURE_SEARCH_INDEX_NAME}`);
  console.log(`Endpoint: ${config.AZURE_SEARCH_ENDPOINT}\n`);

  // Get index schema
  const indexUrl = `${config.AZURE_SEARCH_ENDPOINT}/indexes/${config.AZURE_SEARCH_INDEX_NAME}?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;
  const authHeaders = await getSearchAuthHeaders();

  try {
    const indexResponse = await fetch(indexUrl, {
      method: 'GET',
      headers: authHeaders
    });

    if (!indexResponse.ok) {
      throw new Error(`Failed to fetch index: ${indexResponse.status} ${await indexResponse.text()}`);
    }

    const indexSchema = await indexResponse.json();

    console.log('=== Index Configuration ===\n');
    console.log('Fields:');
    indexSchema.fields?.forEach((field: any) => {
      console.log(`  - ${field.name} (${field.type})`);
      if (field.dimensions) {
        console.log(`    Vector dimensions: ${field.dimensions}`);
        console.log(`    Vector profile: ${field.vectorSearchProfile}`);
      }
    });

    console.log('\n=== Semantic Configuration ===');
    if (indexSchema.semantic) {
      console.log(`Default config: ${indexSchema.semantic.defaultConfiguration}`);
      indexSchema.semantic.configurations?.forEach((config: any) => {
        console.log(`\nConfiguration: ${config.name}`);
        console.log(`  Content fields: ${config.prioritizedFields?.prioritizedContentFields?.map((f: any) => f.fieldName).join(', ') || 'none'}`);
        console.log(`  Title fields: ${config.prioritizedFields?.prioritizedTitleFields?.map((f: any) => f.fieldName).join(', ') || 'none'}`);
        console.log(`  Keyword fields: ${config.prioritizedFields?.prioritizedKeywordsFields?.map((f: any) => f.fieldName).join(', ') || 'none'}`);
      });
    } else {
      console.log('⚠️  NO SEMANTIC CONFIGURATION FOUND');
    }

    console.log('\n=== Vector Search Configuration ===');
    if (indexSchema.vectorSearch) {
      console.log('Algorithms:');
      indexSchema.vectorSearch.algorithms?.forEach((algo: any) => {
        console.log(`  - ${algo.name} (${algo.kind})`);
        if (algo.hnswParameters) {
          console.log(`    Metric: ${algo.hnswParameters.metric}`);
          console.log(`    M: ${algo.hnswParameters.m}`);
          console.log(`    efConstruction: ${algo.hnswParameters.efConstruction}`);
          console.log(`    efSearch: ${algo.hnswParameters.efSearch}`);
        }
      });

      if (indexSchema.vectorSearch.compressions) {
        console.log('\nCompressions:');
        indexSchema.vectorSearch.compressions.forEach((comp: any) => {
          console.log(`  - ${comp.name} (${comp.kind})`);
          console.log(`    Rerank with originals: ${comp.rerankWithOriginalVectors}`);
        });
      }

      console.log('\nProfiles:');
      indexSchema.vectorSearch.profiles?.forEach((profile: any) => {
        console.log(`  - ${profile.name}`);
        console.log(`    Algorithm: ${profile.algorithm}`);
        console.log(`    Vectorizer: ${profile.vectorizer || 'none'}`);
        console.log(`    Compression: ${profile.compression || 'none'}`);
      });
    }

    // Get index statistics
    console.log('\n=== Index Statistics ===');
    const statsUrl = `${config.AZURE_SEARCH_ENDPOINT}/indexes/${config.AZURE_SEARCH_INDEX_NAME}/stats?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;
    const statsResponse = await fetch(statsUrl, {
      method: 'GET',
      headers: authHeaders
    });

    if (statsResponse.ok) {
      const stats = await statsResponse.json();
      console.log(`Document count: ${stats.documentCount}`);
      console.log(`Storage size: ${stats.storageSize} bytes`);
    }

    // Test query to check reranker scores
    console.log('\n=== Test Query (Reranker Score Distribution) ===');
    const testQuery = 'earth night lights NASA';
    console.log(`Query: "${testQuery}"\n`);

    const searchUrl = `${config.AZURE_SEARCH_ENDPOINT}/indexes/${config.AZURE_SEARCH_INDEX_NAME}/docs/search?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;

    const searchPayload = {
      search: testQuery,
      queryType: 'semantic',
      semanticConfiguration: 'default',
      top: 20,
      select: 'id,page_number',
      searchFields: 'page_chunk'
    };

    const searchResponse = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify(searchPayload)
    });

    if (!searchResponse.ok) {
      throw new Error(`Search failed: ${searchResponse.status} ${await searchResponse.text()}`);
    }

    const searchResult = await searchResponse.json();
    const scores = searchResult.value
      .map((doc: any) => doc['@search.rerankerScore'])
      .filter((score: any) => score !== undefined);

    if (scores.length > 0) {
      const max = Math.max(...scores);
      const min = Math.min(...scores);
      const avg = scores.reduce((sum: number, s: number) => sum + s, 0) / scores.length;

      console.log('Reranker Score Distribution:');
      console.log(`  Count: ${scores.length}`);
      console.log(`  Max: ${max.toFixed(3)}`);
      console.log(`  Avg: ${avg.toFixed(3)}`);
      console.log(`  Min: ${min.toFixed(3)}`);
      console.log(`  Median: ${scores.sort((a: number, b: number) => a - b)[Math.floor(scores.length / 2)].toFixed(3)}`);

      console.log('\nScore Breakdown:');
      console.log(`  >= 3.0: ${scores.filter((s: number) => s >= 3.0).length} (${((scores.filter((s: number) => s >= 3.0).length / scores.length) * 100).toFixed(1)}%)`);
      console.log(`  >= 2.5: ${scores.filter((s: number) => s >= 2.5).length} (${((scores.filter((s: number) => s >= 2.5).length / scores.length) * 100).toFixed(1)}%)`);
      console.log(`  >= 2.0: ${scores.filter((s: number) => s >= 2.0).length} (${((scores.filter((s: number) => s >= 2.0).length / scores.length) * 100).toFixed(1)}%)`);
      console.log(`  >= 1.5: ${scores.filter((s: number) => s >= 1.5).length} (${((scores.filter((s: number) => s >= 1.5).length / scores.length) * 100).toFixed(1)}%)`);
      console.log(`  >= 1.0: ${scores.filter((s: number) => s >= 1.0).length} (${((scores.filter((s: number) => s >= 1.0).length / scores.length) * 100).toFixed(1)}%)`);

      console.log('\n=== Recommendations ===');
      const threshold25 = scores.filter((s: number) => s >= 2.5).length;
      const threshold20 = scores.filter((s: number) => s >= 2.0).length;
      const threshold15 = scores.filter((s: number) => s >= 1.5).length;

      if (threshold25 === 0) {
        console.log('❌ Current threshold (2.5): BLOCKS ALL RESULTS');
        if (threshold20 > 0) {
          console.log(`✅ Recommended threshold: 2.0 (passes ${threshold20}/${scores.length} results, ${((threshold20/scores.length)*100).toFixed(1)}%)`);
        } else if (threshold15 > 0) {
          console.log(`✅ Recommended threshold: 1.5 (passes ${threshold15}/${scores.length} results, ${((threshold15/scores.length)*100).toFixed(1)}%)`);
        } else {
          console.log(`⚠️  All scores below 1.5 - investigate semantic ranking configuration`);
        }
      } else if (threshold25 < scores.length * 0.3) {
        console.log(`⚠️  Current threshold (2.5) only passes ${((threshold25/scores.length)*100).toFixed(1)}% of results`);
        console.log(`✅ Consider lowering to 2.0 to pass ${((threshold20/scores.length)*100).toFixed(1)}%`);
      } else {
        console.log(`✅ Current threshold (2.5) is appropriate (passes ${((threshold25/scores.length)*100).toFixed(1)}%)`);
      }
    } else {
      console.log('⚠️  No reranker scores found - semantic ranking may not be enabled');
    }

    console.log('\n=== Configuration Summary ===');
    console.log(`Current RERANKER_THRESHOLD: ${config.RERANKER_THRESHOLD}`);
    console.log(`Current RETRIEVAL_FALLBACK_RERANKER_THRESHOLD: ${config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD}`);

  } catch (error) {
    console.error('Error inspecting index:', error);
    throw error;
  }
}

inspectIndexConfiguration()
  .then(() => {
    console.log('\n✅ Inspection complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Inspection failed:', error);
    process.exit(1);
  });
