# Windows quick start (PowerShell):  .\run.ps1
if (-not (Test-Path .venv)) { py -m venv .venv }
.\.venv\Scripts\python -m pip install -q -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env; Write-Host "Created .env - add your NEBIUS_API_KEY, then re-run." }
.\.venv\Scripts\python -m uvicorn backend.app.main:app --port 8000
