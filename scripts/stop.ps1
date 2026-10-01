# Stops only the hydrostatics API process previously started by this project,
# identified via .project/server.pid. Never touches unrelated processes.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".project\server.pid"
if (-not (Test-Path $pidFile)) {
  Write-Host "no server.pid found; nothing to stop"
  exit 0
}
$serverPid = [int](Get-Content $pidFile)
$proc = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if ($null -eq $proc) {
  Write-Host "process $serverPid not running; removing stale pid file"
  Remove-Item $pidFile
  exit 0
}
$cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid").CommandLine
if ($cmdLine -notmatch "api[/\\]server\.(ts|js)") {
  Write-Error "pid $serverPid does not look like this project's API server; refusing to stop"
  exit 1
}
Stop-Process -Id $serverPid
Remove-Item $pidFile -ErrorAction SilentlyContinue
Write-Host "stopped hydrostatics API pid=$serverPid"
