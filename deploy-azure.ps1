[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$AppName,
    [string]$ResourceGroup = 'hockey-soundboard-rg',
    [string]$Location = 'westus2',
    [string]$Sku = 'B1',
    [string]$InviteCode = '',
    [string]$GraphClientId = ''
)

# Deploys this folder to Azure App Service (Linux, Python). Requires: az login
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Invoke-Az {
    param([Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & az @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed with exit code $LASTEXITCODE."
    }
}

Invoke-Az group create --name $ResourceGroup --location $Location
Invoke-Az appservice plan create --name "$AppName-plan" --resource-group $ResourceGroup --sku $Sku --is-linux

# SQLite and the delegated Graph token cache live on /home/data.
$alwaysOn = if ($Sku -eq 'F1') { 'false' } else { 'true' }
Invoke-Az webapp create --name $AppName --resource-group $ResourceGroup --plan "$AppName-plan" --runtime 'PYTHON:3.12'
Invoke-Az webapp config set --name $AppName --resource-group $ResourceGroup --startup-file 'python server.py' --always-on $alwaysOn --http20-enabled true
Invoke-Az webapp update --name $AppName --resource-group $ResourceGroup --https-only true
$settings = @(
    'WEBSITES_PORT=8000',
    'SCM_DO_BUILD_DURING_DEPLOYMENT=true',
    'ENABLE_ORYX_BUILD=true',
    'SOUNDBOARD_EMAIL_PROVIDER=graph',
    "SOUNDBOARD_PUBLIC_URL=https://$AppName.azurewebsites.net"
)
if ($GraphClientId) {
    $settings += "SOUNDBOARD_GRAPH_CLIENT_ID=$GraphClientId"
}
if ($settings.Count -gt 0) {
    $settingsArguments = @(
        'webapp', 'config', 'appsettings', 'set',
        '--name', $AppName,
        '--resource-group', $ResourceGroup,
        '--settings'
    ) + $settings
    Invoke-Az @settingsArguments
}
if ($InviteCode) {
    Invoke-Az webapp config appsettings set --name $AppName --resource-group $ResourceGroup --settings "SOUNDBOARD_INVITE=$InviteCode"
}

$zip = Join-Path $env:TEMP "$AppName.zip"
if (Test-Path $zip) { Remove-Item $zip }
try {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $files = Get-ChildItem -Path $PSScriptRoot -File -Recurse -Force | Where-Object {
        $relativePath = $_.FullName.Substring($PSScriptRoot.Length).TrimStart('\', '/')
        $_.Name -notin 'deploy-azure.ps1', 'soundboard-users.db', 'soundboard-users.db-journal',
        'graph-token-cache.json', 'graph-token-cache.json.tmp' -and
        $relativePath -notmatch '(^|[\\/])(__pycache__|\.git|\.vscode|tests)([\\/]|$)'
    }
    $archive = [System.IO.Compression.ZipFile]::Open(
        $zip, [System.IO.Compression.ZipArchiveMode]::Create
    )
    try {
        foreach ($file in $files) {
            $relativePath = $file.FullName.Substring($PSScriptRoot.Length).TrimStart('\', '/').Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $file.FullName, $relativePath, [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
        $deploymentEntry = $archive.CreateEntry('.deployment')
        $deploymentWriter = [System.IO.StreamWriter]::new($deploymentEntry.Open())
        try {
            $deploymentWriter.Write("[config]`nSCM_DO_BUILD_DURING_DEPLOYMENT = true`n")
        }
        finally {
            $deploymentWriter.Dispose()
        }
    }
    finally {
        $archive.Dispose()
    }
    Invoke-Az webapp deployment source config-zip --name $AppName --resource-group $ResourceGroup --src $zip --timeout 600
}
finally {
    if (Test-Path $zip) { Remove-Item $zip }
}

Write-Host "Deployed: https://$AppName.azurewebsites.net/"
