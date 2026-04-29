@echo off
echo 🤖 Deploying AI Email Generation Fix...
echo.
echo ✅ Created /api/generate-ai endpoint
echo ✅ Fixed NVIDIA API key persistence 
echo ✅ Added proper server sync for settings
echo.
git add .
git commit -m "Fix AI email generation and NVIDIA API key persistence"
git push origin main
echo.
echo 🚀 Deployment complete! 
echo 🔄 Vercel will auto-deploy in a few moments.
echo.
echo 🧪 After deployment, test:
echo   1. Set NVIDIA API key in Settings
echo   2. Go to Campaign page
echo   3. Click "Generate Preview" - should work now!
echo   4. API key should persist between sessions
echo.
pause