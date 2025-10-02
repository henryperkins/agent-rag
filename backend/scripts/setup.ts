import { createIndexAndIngest, createKnowledgeAgent } from '../src/azure/indexSetup.js';

async function main() {
  console.log('='.repeat(64));
  console.log('Azure AI Search setup (2025-10-01-preview contract)');
  console.log('='.repeat(64));

  try {
    console.log('\nStep 1: Creating search index & ingesting sample data...');
    await createIndexAndIngest();

    console.log('\nStep 2: Creating knowledge agent (ARM envelope)...');
    await createKnowledgeAgent();

    console.log('\nSetup complete ✅');
    console.log('Run the server with: pnpm dev');
  } catch (error: any) {
    console.error('\nSetup failed ❌');
    console.error(error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
