#!/bin/bash

# =============================================================================
# Agentic RAG - Quick Start Script
# =============================================================================
# This script helps you quickly set up and start the application
# Run: bash quick-start.sh

set -e  # Exit on error

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          Agentic RAG - Quick Start Setup                      ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check if we're in the right directory
if [ ! -f "CLAUDE.md" ]; then
    echo "❌ Error: Please run this script from the /root/agent-rag directory"
    exit 1
fi

echo "✓ Running from correct directory"
echo ""

# Check if .env exists
if [ ! -f "backend/.env" ]; then
    echo "❌ Error: backend/.env not found!"
    echo "   The Azure CLI setup should have created this file."
    echo "   Please check AZURE_SETUP_SUMMARY.md for details."
    exit 1
fi

echo "✓ Configuration file found"
echo ""

# Step 1: Install dependencies
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1: Installing dependencies..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm not found. Installing..."
    npm install -g pnpm
fi

echo ""
echo "Installing backend dependencies..."
cd backend
pnpm install
cd ..

echo ""
echo "Installing frontend dependencies..."
cd frontend
pnpm install
cd ..

echo ""
echo "✓ Dependencies installed"
echo ""

# Step 2: Check if index exists
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2: Checking Azure AI Search index..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd backend
source .env

INDEX_CHECK=$(curl -s "${AZURE_SEARCH_ENDPOINT}/indexes/${AZURE_SEARCH_INDEX_NAME}?api-version=2025-08-01-preview" \
  -H "api-key: ${AZURE_SEARCH_API_KEY}" 2>&1)

if echo "$INDEX_CHECK" | grep -q "\"name\":\"${AZURE_SEARCH_INDEX_NAME}\""; then
    echo "✓ Index '${AZURE_SEARCH_INDEX_NAME}' already exists"
    echo ""
else
    echo "⚠️  Index '${AZURE_SEARCH_INDEX_NAME}' not found"
    echo ""
    echo "Creating index..."
    pnpm setup
    echo ""
    echo "✓ Index created"
    echo ""
fi

cd ..

# Step 3: Display summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Setup Complete! 🎉"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Configuration Summary:"
echo "   Azure Search: ${AZURE_SEARCH_ENDPOINT}"
echo "   Azure OpenAI: ${AZURE_OPENAI_ENDPOINT}"
echo "   GPT Model: ${AZURE_OPENAI_GPT_DEPLOYMENT}"
echo "   Embedding Model: ${AZURE_OPENAI_EMBEDDING_DEPLOYMENT}"
echo ""
echo "🚀 To start the application:"
echo ""
echo "   Terminal 1 (Backend):"
echo "   $ cd backend"
echo "   $ pnpm dev"
echo ""
echo "   Terminal 2 (Frontend):"
echo "   $ cd frontend"
echo "   $ pnpm dev"
echo ""
echo "   Then open: http://localhost:5173"
echo ""
echo "📚 Documentation:"
echo "   - Setup Summary: AZURE_SETUP_SUMMARY.md"
echo "   - Project Guide: CLAUDE.md"
echo "   - Troubleshooting: docs/TROUBLESHOOTING.md"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Ask if user wants to start the backend now
read -p "Would you like to start the backend server now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Starting backend on port 8787..."
    echo "Press Ctrl+C to stop"
    echo ""
    cd backend
    pnpm dev
fi
