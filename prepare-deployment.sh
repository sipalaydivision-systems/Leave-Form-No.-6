#!/bin/bash
# Quick Deployment Setup Script
# Run this to prepare for deployment to various platforms

echo "🚀 Leave Form System - Deployment Preparation"
echo "=============================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install from https://nodejs.org/"
    exit 1
fi

echo "✓ Node.js version: $(node --version)"
echo "✓ npm version: $(npm --version)"
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Please install from https://git-scm.com/"
    exit 1
fi

echo "✓ Git version: $(git --version)"
echo ""

# Install dependencies
echo "📦 Installing Node.js dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ npm install failed. Please check the error above."
    exit 1
fi

echo "✓ Dependencies installed"
echo ""

# Check if data directory exists
if [ ! -d "data" ]; then
    echo "❌ Error: data/ directory not found!"
    exit 1
fi

echo "✓ data/ directory exists"
echo ""

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "✓ .env file created. Please edit it with your settings:"
        echo "  - PRODUCTION_DOMAIN"
        echo "  - MAILERSEND_API_KEY"
        echo "  - MAILERSEND_SENDER_EMAIL"
    fi
fi

echo ""
echo "✅ Pre-deployment setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your configuration"
echo "2. Test locally: npm start"
echo "3. Initialize git: git init"
echo "4. Create GitHub repository"
echo "5. Deploy to your chosen platform (Railway/Render/Heroku)"
echo ""
echo "For detailed instructions, see HOSTING_AND_DEPLOYMENT_GUIDE.md"
