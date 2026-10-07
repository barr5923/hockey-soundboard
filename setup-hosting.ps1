#Requires -RunAsAdministrator
# Serves the Hockey Soundboard on port 80 for http://hockeymusichack.com (replaces the IIS attempt: IIS reverse proxy is unsupported on ARM64).
$ErrorActionPreference = 'Stop'
$hostName = 'hockeymusichack.com'
$appDir   = $PSScriptRoot
$python   = 'C:\Users\benja\AppData\Local\Microsoft\WindowsApps\python3.13.exe'
$appcmd   = "$env:windir\System32\inetsrv\appcmd.exe"

if (& $appcmd list site /name:HockeyMusicHack) { & $appcmd delete site HockeyMusicHack | Out-Null }
Remove-Item 'C:\inetpub\hockeymusichack' -Recurse -Force -ErrorAction SilentlyContinue
Stop-Service W3SVC -Force
Set-Service W3SVC -StartupType Manual

Get-NetFirewallRule -DisplayName 'Hockey Soundboard HTTP' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Hockey Soundboard HTTP' -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow -Profile Any | Out-Null

$action  = New-ScheduledTaskAction -Execute $python -Argument 'server.py 80' -WorkingDirectory $appDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\benja"
$set     = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'HockeySoundboardServer' -Action $action -Trigger $trigger -Settings $set -Force | Out-Null

$hosts = "$env:windir\System32\drivers\etc\hosts"
if (-not (Select-String -Path $hosts -Pattern $hostName -Quiet)) { Add-Content $hosts "127.0.0.1`t$hostName" }
