$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pythonExe = Join-Path $repoRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $pythonExe)) {
  throw "Python virtual environment not found at $pythonExe"
}

$backendWorkdir = Join-Path $repoRoot "python-backend"
$backendArgs = @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8787")

$proc = Start-Process -FilePath $pythonExe -ArgumentList $backendArgs -WorkingDirectory $backendWorkdir -PassThru -WindowStyle Hidden

try {
  $healthy = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/health" -Method Get -TimeoutSec 2
      if ($health.status -eq "healthy") {
        $healthy = $true
        break
      }
    } catch {
      if ($proc.HasExited) {
        throw "Backend exited before smoke health check succeeded."
      }
    }
  }

  if (-not $healthy) {
    throw "Backend did not become healthy within 30 seconds."
  }

  Push-Location $repoRoot
  try {
    & npm run modules:smoke
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  } finally {
    Pop-Location
  }
} finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
}
