@echo off
echo Deploying fixes to GitHub and Vercel...
git add .
git commit -m "Fix SPA routing and add demo seeder - resolves 404 refresh issues"
git push origin main
echo Deployment complete! Changes pushed to GitHub.
echo Vercel will auto-deploy from GitHub.
pause