@echo off
cd /d "%~dp0"
echo Deploying AI fixes to GitHub...
git add .
git commit -m "Fix AI email generation and NVIDIA API key persistence - adds /api/generate-ai endpoint"
git push origin main
echo.
echo Deployment complete!
echo Check Vercel dashboard for auto-deployment status.
pause