$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$redisDirectory = Join-Path $projectPath '.data\redis'
New-Item -ItemType Directory -Path $redisDirectory -Force | Out-Null
$resolvedDirectory = (Resolve-Path -LiteralPath $redisDirectory).Path
if (-not $resolvedDirectory.StartsWith($projectPath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Redis storage must stay inside this project.' }
$linuxDirectory = (& wsl.exe -d Ubuntu --exec wslpath -u $resolvedDirectory).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Ubuntu WSL is required. See README.md for Redis setup or use Docker Compose.' }
$existing = & wsl.exe -d Ubuntu --exec redis-cli -p 16379 ping 2>$null
if ($LASTEXITCODE -eq 0 -and $existing -eq 'PONG') { Write-Output 'Redis is already running on 16379.'; exit 0 }
& wsl.exe -d Ubuntu --exec redis-server --bind 127.0.0.1 --port 16379 --protected-mode yes --daemonize yes --appendonly yes --dir $linuxDirectory --logfile "$linuxDirectory/redis.log"
if ($LASTEXITCODE -ne 0) { throw 'Redis could not start. Install redis-server in Ubuntu or check .data/redis/redis.log.' }
& wsl.exe -d Ubuntu --exec redis-cli -p 16379 ping
if ($LASTEXITCODE -ne 0) { throw 'Redis health check failed.' }
