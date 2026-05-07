@echo off
echo Deploying tracking fixes...

git add .
git commit -m "Fix tracking issues: add missing router, stats endpoint, and fix test URLs"
git push origin main

echo.
echo Tracking fixes deployed!
echo.
echo Test the fixes at:
echo - https://enginerdsmail.vercel.app/api/test-tracking?e2e=1
echo - https://enginerdsmail.vercel.app/api/test-simple-tracking
echo.
pause