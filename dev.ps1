param([ValidateSet('install','test','check','demo','register','start')][string]$Action = 'test')
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw 'Please install Node.js 24.17 or newer (24.x).' }
    if ($Action -eq 'install') {
        $pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
        if ($pnpmCommand) { & $pnpmCommand.Source install --frozen-lockfile --store-dir .pnpm-store }
        else {
            $runtimeRoot = Split-Path (Split-Path $nodeCommand.Source -Parent) -Parent
            $bundledPnpm = Join-Path $runtimeRoot 'node_modules\pnpm\bin\pnpm.cjs'
            if (-not (Test-Path -LiteralPath $bundledPnpm)) { throw 'Install pnpm 11.25.0 first: npm install --global pnpm@11.25.0' }
            & $nodeCommand.Source $bundledPnpm install --frozen-lockfile --store-dir .pnpm-store
        }
    } else {
        $nodeArguments = @(switch ($Action) {
            'test' { @('--test') }
            'check' { @('scripts/check.js') }
            'demo' { @('scripts/demo.js') }
            'register' { @('--env-file-if-exists=.env','src/register.js') }
            'start' { @('--env-file-if-exists=.env','src/main.js') }
        })
        & $nodeCommand.Source @nodeArguments
    }
    if ($LASTEXITCODE -ne 0) { throw "Task failed (exit $LASTEXITCODE)." }
} finally { Pop-Location }
