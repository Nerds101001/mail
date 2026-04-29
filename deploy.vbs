Set objShell = CreateObject("WScript.Shell")
objShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

WScript.Echo "Deploying to Git..."
objShell.Run "git add .", 1, True
objShell.Run "git commit -m ""Fix AI email generation and NVIDIA API key persistence""", 1, True  
objShell.Run "git push origin main", 1, True
WScript.Echo "Deployment complete!"