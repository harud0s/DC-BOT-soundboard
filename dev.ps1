param([ValidateSet('install','audit','test','check','demo','register','start')][string]$Action = 'test')
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
$originalPath = $env:PATH
try {
    $nodePath = Join-Path $PSScriptRoot '.tools\node\node.exe'
    if (-not (Test-Path -LiteralPath $nodePath)) {
        $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
        if (-not $nodeCommand) { throw 'Please install Node.js 24.17 or newer (24.x).' }
        $nodePath = $nodeCommand.Source
    }
    $nodeVersion = [version](& $nodePath -p 'process.versions.node')
    if ($LASTEXITCODE -ne 0 -or $nodeVersion.Major -ne 24 -or $nodeVersion -lt [version]'24.17.0') {
        throw 'This project requires Node.js 24.17 or newer within 24.x.'
    }
    # Child processes use this runtime too; restore PATH when the task ends.
    $env:PATH = (Split-Path $nodePath -Parent) + [IO.Path]::PathSeparator + $originalPath
    if ($Action -in @('install','audit')) {
        $pnpmPath = Join-Path $PSScriptRoot '.tools\pnpm\bin\pnpm.cjs'
        if (Test-Path -LiteralPath $pnpmPath) {
            $pnpmExecutable = $nodePath
            $pnpmPrefix = @($pnpmPath)
        } else {
            $pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
            if (-not $pnpmCommand) { throw 'Install pnpm 11.25.0 or restore the project-local .tools\pnpm folder.' }
            $pnpmExecutable = $pnpmCommand.Source
            $pnpmPrefix = @()
        }
        $pnpmVersion = & $pnpmExecutable @pnpmPrefix --version
        if ($LASTEXITCODE -ne 0 -or $pnpmVersion -ne '11.25.0') { throw 'This project requires pnpm 11.25.0.' }
        if ($Action -eq 'install') {
            & $pnpmExecutable @pnpmPrefix install --frozen-lockfile --ignore-scripts --store-dir .pnpm-store --registry=https://registry.npmjs.org
        } else {
            & $pnpmExecutable @pnpmPrefix audit --prod --registry=https://registry.npmjs.org
        }
    } else {
        $nodeArguments = @(switch ($Action) {
            'test' { @('--test') }
            'check' { @('scripts/check.js') }
            'demo' { @('scripts/demo.js') }
            'register' { @('--env-file-if-exists=.env','src/register.js') }
            'start' { @('--env-file-if-exists=.env','src/main.js') }
        })
        & $nodePath @nodeArguments
    }
    if ($LASTEXITCODE -ne 0) { throw "Task failed (exit $LASTEXITCODE)." }
} finally {
    $env:PATH = $originalPath
    Pop-Location
}
