param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,
  [Parameter(Mandatory = $true)]
  [int]$Port
)

$ErrorActionPreference = "Stop"

function Test-TcpPort {
  param(
    [string]$HostName,
    [int]$Port,
    [int]$TimeoutMs = 1500
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
      return $false
    }
    $client.EndConnect($async) | Out-Null
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Wait-ForPort {
  param(
    [string]$HostName,
    [int]$Port,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPort -HostName $HostName -Port $Port) {
      return $true
    }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Get-PostgresServices {
  $services = Get-CimInstance Win32_Service | Where-Object {
    $_.Name -like "postgresql*" -or $_.DisplayName -like "*PostgreSQL*"
  }

  if ($env:TABLE_POSTGRES_SERVICE) {
    $preferred = $services | Where-Object { $_.Name -eq $env:TABLE_POSTGRES_SERVICE }
    $others = $services | Where-Object { $_.Name -ne $env:TABLE_POSTGRES_SERVICE }
    return @($preferred + $others)
  }

  return @($services)
}

function Get-PgCtlCandidates {
  $candidates = @()

  if ($env:TABLE_POSTGRES_CTL -and $env:TABLE_POSTGRES_DATA_DIR) {
    $candidates += [pscustomobject]@{
      PgCtl = $env:TABLE_POSTGRES_CTL
      DataDir = $env:TABLE_POSTGRES_DATA_DIR
      Source = "env"
    }
  }

  foreach ($service in Get-PostgresServices) {
    if (-not $service.PathName) {
      continue
    }

    if ($service.PathName -match '"([^"]*pg_ctl(?:\.exe)?)".*?-D\s+"([^"]+)"') {
      $candidates += [pscustomobject]@{
        PgCtl = $matches[1]
        DataDir = $matches[2]
        Source = $service.Name
      }
    }
  }

  return $candidates | Group-Object PgCtl, DataDir | ForEach-Object { $_.Group[0] }
}

function Try-StartService {
  param($Service)

  if ($Service.State -eq "Running") {
    return $false
  }

  Write-Host "[backend:dev] Trying Windows service $($Service.Name)..."
  & sc.exe start $Service.Name | Out-Null
  return (Wait-ForPort -HostName $HostName -Port $Port -TimeoutSeconds 12)
}

function Try-StartPgCtl {
  param($Candidate)

  if (-not (Test-Path $Candidate.PgCtl) -or -not (Test-Path $Candidate.DataDir)) {
    return $false
  }

  Write-Host "[backend:dev] Trying pg_ctl from $($Candidate.Source)..."
  & $Candidate.PgCtl start -D $Candidate.DataDir -w -t 45 | Out-Null
  return (Wait-ForPort -HostName $HostName -Port $Port -TimeoutSeconds 12)
}

if (Test-TcpPort -HostName $HostName -Port $Port) {
  Write-Host "[backend:dev] PostgreSQL already reachable at $HostName`:$Port."
  exit 0
}

foreach ($service in Get-PostgresServices) {
  try {
    if (Try-StartService -Service $service) {
      Write-Host "[backend:dev] PostgreSQL is ready."
      exit 0
    }
  } catch {
    continue
  }
}

foreach ($candidate in Get-PgCtlCandidates) {
  try {
    if (Try-StartPgCtl -Candidate $candidate) {
      Write-Host "[backend:dev] PostgreSQL is ready."
      exit 0
    }
  } catch {
    continue
  }
}

if (Wait-ForPort -HostName $HostName -Port $Port -TimeoutSeconds 3) {
  Write-Host "[backend:dev] PostgreSQL is ready."
  exit 0
}

Write-Error "[backend:dev] Could not start local PostgreSQL at $HostName`:$Port. If auto-discovery fails, set TABLE_POSTGRES_SERVICE or TABLE_POSTGRES_CTL + TABLE_POSTGRES_DATA_DIR in .env."
