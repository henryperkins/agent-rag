#!/bin/bash

# Agentic RAG Application Startup Script
# Starts both backend and frontend servers

set -e

echo "🚀 Starting Agentic RAG Application..."

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Please install it first:"
    echo "   npm install -g pnpm"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "backend/node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    cd backend && pnpm install && cd ..
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    cd frontend && pnpm install && cd ..
fi

# Check for .env file
if [ ! -f "backend/.env" ]; then
    echo "⚠️  Warning: backend/.env not found. Please configure environment variables."
    echo "   See backend/src/config/app.ts for required variables."
fi

echo ""
echo "✅ Starting servers..."
echo "   Backend:  http://localhost:8787"
echo "   Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Function to kill background processes on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down servers..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start backend in background
cd backend && pnpm dev &
BACKEND_PID=$!

# Start frontend in background
cd frontend && pnpm dev &
FRONTEND_PID=$!

# Wait for both processes
wait
