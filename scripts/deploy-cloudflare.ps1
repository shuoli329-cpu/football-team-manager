param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$worker = 'site-creator-vinext-starter'
$database = 'kickoff-teammates-db'
$databaseId = '06e554fe-b3ca-4db3-9cb9-1758cd5010a5'
$origin = 'https://k77.ccwu.cc'
$config = 'dist/server/wrangler.json'
$wrangler = './node_modules/wrangler/bin/wrangler.js'

function Invoke-Wrangler {
    & node $wrangler @args
    if ($LASTEXITCODE -ne 0) { throw "Wrangler failed: $($args[0]) $($args[1])." }
}

Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    if (!$CheckOnly -and !(Test-Path -LiteralPath 'public/team-crest.png' -PathType Leaf)) {
        throw 'Save the team crest to public/team-crest.png before deploying.'
    }

    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }

    $settings = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
    $binding = @($settings.d1_databases | Where-Object { $_.binding -eq 'DB' })
    if ($settings.name -ne $worker -or $binding.Count -ne 1 -or
        $binding[0].database_name -ne $database -or $binding[0].database_id -ne $databaseId -or
        $settings.PSObject.Properties['routes'] -or $settings.PSObject.Properties['route']) {
        throw 'Unexpected Worker, D1 or route settings. Deployment stopped.'
    }

    if ($CheckOnly) {
        Invoke-Wrangler deploy --config $config --keep-vars --dry-run
        return
    }

    if (!(Test-Path -LiteralPath 'dist/client/team-crest.png' -PathType Leaf)) {
        throw 'The build is missing the team crest.'
    }
    $password = Read-Host 'Enter the new organizer password' -AsSecureString
    if ($password.Length -eq 0) { throw 'Password cannot be empty.' }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            $digest = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($plain))).Replace('-', '').ToLowerInvariant()
        } finally {
            $sha.Dispose()
        }

        Invoke-Wrangler deploy --config $config --keep-vars
        $digest | & node $wrangler secret put ADMIN_PASSWORD_HASH --config $config
        if ($LASTEXITCODE -ne 0) { throw 'Worker deployed, but password update failed.' }

        $null = Invoke-WebRequest -Uri "$origin/" -UseBasicParsing -TimeoutSec 30 -MaximumRedirection 0
        $manifest = Get-Content -LiteralPath 'dist/client/vinext-client-entry-manifest.json' -Raw | ConvertFrom-Json
        $bundlePath = $manifest.appBrowserEntry
        $localHash = (Get-FileHash -LiteralPath "dist/client/$bundlePath").Hash
        $bundle = Invoke-WebRequest -Uri "$origin/$bundlePath" -UseBasicParsing -TimeoutSec 30 -MaximumRedirection 0
        if ((Get-FileHash -InputStream $bundle.RawContentStream).Hash -ne $localHash) {
            throw 'Custom domain did not serve the new build.'
        }
        $crest = Invoke-WebRequest -Uri "$origin/team-crest.png" -UseBasicParsing -TimeoutSec 30
        if ($crest.Headers['Content-Type'] -notmatch 'image/png') { throw 'The team crest is not served as PNG.' }
        $games = Invoke-RestMethod -Uri "$origin/api/games" -TimeoutSec 30
        if (!$games.PSObject.Properties['games']) { throw 'Games API returned an unexpected response.' }
        $admin = Invoke-RestMethod -Method POST -Uri "$origin/api/admin/data" -ContentType 'application/json' `
            -Headers @{ Origin = $origin; 'X-Organizer-Password' = $plain } -Body '{}' -TimeoutSec 30 -MaximumRedirection 0
        if (!$admin.PSObject.Properties['attendance']) { throw 'Organizer API returned an unexpected response.' }

        Write-Host "Verified: $origin serves the new build, crest, games API and organizer login." -ForegroundColor Green
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $password.Dispose()
        Remove-Variable plain,digest -ErrorAction SilentlyContinue
    }
} finally {
    Pop-Location
}
