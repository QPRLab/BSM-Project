param(
  [string]$RepoName = "BSM-Project",
  [ValidateSet('public','private')][string]$Visibility = 'private',
  [string]$RemoteUrl
)

function Check-TrackedSecrets {
  Write-Host "Checking for common secret patterns in tracked files..."
  $patterns = '\.env','PRIVATE_KEY','MNEMONIC','API_KEY','SEPOLIA_PRIVATE_KEY'
  $found = @()
  foreach ($p in $patterns) {
    $m = git ls-files | Select-String -Pattern $p -SimpleMatch -ErrorAction SilentlyContinue
    if ($m) { $found += $m }
  }
  if ($found.Count -gt 0) {
    Write-Host "WARNING: Found potentially sensitive tracked files or patterns:" -ForegroundColor Yellow
    $found | ForEach-Object { Write-Host "  $_" }
    Write-Host "\nYou must remove these from the index before pushing. Example commands:" -ForegroundColor Yellow
    Write-Host "  git rm --cached <file>\n  git commit -m 'chore: remove secret from index'" -ForegroundColor Cyan
    return $false
  }
  Write-Host "No obvious tracked secrets found."
  return $true
}

function Use-GHCreate {
  param($repoName, $visibility)
  Write-Host "Creating GitHub repo '$repoName' (visibility=$visibility) using gh..."
  $createArgs = @($repoName, "--$visibility", "--source=.", "--remote=origin", "--push")
  $res = gh repo create @createArgs
  if ($LASTEXITCODE -ne 0) {
    Write-Host "gh repo create failed. Output:" -ForegroundColor Red
    Write-Host $res
    return $false
  }
  Write-Host "Repository created and pushed via gh."
  return $true
}

function Use-RemotePush {
  param($remoteUrl)
  if (-not $remoteUrl) {
    Write-Host "No remote URL provided. Please provide a remote URL (HTTPS) or install GitHub CLI (gh) and re-run." -ForegroundColor Red
    return $false
  }
  Write-Host "Adding remote origin: $remoteUrl"
  git remote remove origin 2>$null | Out-Null
  git remote add origin $remoteUrl
  git branch -M main
  Write-Host "Pushing to origin main..."
  git push -u origin main
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Push failed. Ensure your credentials are configured (credential manager) or use gh to authenticate." -ForegroundColor Red
    return $false
  }
  Write-Host "Pushed to remote: $remoteUrl"
  return $true
}

# --- main ---
Write-Host "Create & push helper script\nRepoName: $RepoName, Visibility: $Visibility" -ForegroundColor Green

# ensure we're in a git repo
if (-not (git rev-parse --is-inside-work-tree 2>$null)) {
  Write-Host "Initializing a new git repository..."
  git init
}

# run safety checks
$ok = Check-TrackedSecrets
if (-not $ok) { Write-Host "Aborting due to tracked secrets." -ForegroundColor Red; exit 1 }

# ensure there is a commit
$hasCommits = $true
try {
  git rev-parse --verify HEAD > $null 2>&1
} catch {
  $hasCommits = $false
}
if (-not $hasCommits) {
  Write-Host "No commits found. Creating an initial commit..."
  git add .
  git commit -m "chore: initial commit (prepare for GitHub upload)" || Write-Host "Nothing to commit or commit failed." -ForegroundColor Yellow
}

# prefer gh if available
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
  # check auth
  gh auth status 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "You are not authenticated with gh. Please run: gh auth login" -ForegroundColor Yellow
    Write-Host "Attempting to create using remote URL if provided..."
    if ($RemoteUrl) { Use-RemotePush -remoteUrl $RemoteUrl } else { Write-Host "No remote URL provided. Aborting."; exit 1 }
  } else {
    $ok = Use-GHCreate -repoName $RepoName -visibility $Visibility
    if (-not $ok) { Write-Host "gh create failed; you can provide a remote URL to push instead." -ForegroundColor Yellow }
  }
} else {
  Write-Host "GitHub CLI (gh) not found on PATH." -ForegroundColor Yellow
  if ($RemoteUrl) {
    $ok = Use-RemotePush -remoteUrl $RemoteUrl
    if (-not $ok) { Write-Host "Push failed." -ForegroundColor Red; exit 1 }
  } else {
    Write-Host "Provide a remote URL via -RemoteUrl or install GitHub CLI and run this script again." -ForegroundColor Cyan
    Write-Host "To install gh on Windows: 'winget install --id GitHub.cli'" -ForegroundColor Cyan
    exit 1
  }
}

Write-Host "Done." -ForegroundColor Green
