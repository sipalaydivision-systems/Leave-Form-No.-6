@echo off
REM Quick Deployment Setup Script for Windows
REM Run this to prepare for deployment to various platforms

echo.
echo 🚀 Leave Form System - Deployment Preparation
echo =============================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js is not installed. Please install from https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i

echo ✓ Node.js version: %NODE_VERSION%
echo ✓ npm version: %NPM_VERSION%
echo.

REM Check if git is installed
where git >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Git is not installed. Please install from https://git-scm.com/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('git --version') do set GIT_VERSION=%%i
echo ✓ %GIT_VERSION%
echo.

REM Install dependencies
echo 📦 Installing Node.js dependencies...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo ❌ npm install failed. Please check the error above.
    pause
    exit /b 1
)

echo ✓ Dependencies installed
echo.

REM Check if data directory exists
if not exist "data" (
    echo ❌ Error: data\ directory not found!
    pause
    exit /b 1
)

echo ✓ data\ directory exists
echo.

REM Create .env if it doesn't exist
if not exist ".env" (
    echo 📝 Creating .env file from .env.example...
    if exist ".env.example" (
        copy ".env.example" ".env"
        echo ✓ .env file created. Please edit it with your settings:
        echo   - PRODUCTION_DOMAIN
        echo   - MAILERSEND_API_KEY
        echo   - MAILERSEND_SENDER_EMAIL
    )
)

echo.
echo ✅ Pre-deployment setup complete!
echo.
echo Next steps:
echo 1. Edit .env file with your configuration
echo 2. Test locally: npm start
echo 3. Initialize git: git init
echo 4. Create GitHub repository
echo 5. Deploy to your chosen platform (Railway/Render/Heroku)
echo.
echo For detailed instructions, see HOSTING_AND_DEPLOYMENT_GUIDE.md
echo.
pause
