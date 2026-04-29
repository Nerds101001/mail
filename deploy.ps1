Write-Host "🚀 Deploying fixes to GitHub and Vercel..." -ForegroundColor Green

# Add all changes
Write-Host "📁 Adding files to git..." -ForegroundColor Yellow
git add .

# Commit changes
Write-Host "💾 Committing changes..." -ForegroundColor Yellow
git commit -m "Fix SPA routing and add demo seeder - resolves 404 refresh issues"

# Push to GitHub
Write-Host "📤 Pushing to GitHub..." -ForegroundColor Yellow
git push origin main

Write-Host "✅ Deployment complete!" -ForegroundColor Green
Write-Host "🔄 Vercel will auto-deploy from GitHub in a few moments." -ForegroundColor Cyan
Write-Host "🌐 Check your site: https://enginerdsmail.vercel.app" -ForegroundColor Cyan

Read-Host "Press Enter to continue..."