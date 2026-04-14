# ============================================================
#  CGRAE Signature — Script de démarrage quotidien
#  Usage : double-clic  OU  clic droit > Exécuter avec PowerShell
#          OU dans un terminal : .\start.ps1
# ============================================================

$ROOT     = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKEND  = Join-Path $ROOT "backend"
$FRONTEND = Join-Path $ROOT "frontend"
$TS_NODE  = Join-Path $BACKEND "node_modules\ts-node\dist\bin.js"
$MAIN     = Join-Path $BACKEND "src\main.ts"
$MYSQL    = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"

function Titre($texte) {
    Write-Host ""
    Write-Host "  $texte" -ForegroundColor Cyan
}
function OK($texte)      { Write-Host "  [OK]      $texte" -ForegroundColor Green  }
function INFO($texte)    { Write-Host "  [INFO]    $texte" -ForegroundColor White  }
function WARN($texte)    { Write-Host "  [ATTENTION] $texte" -ForegroundColor Yellow }
function ERREUR($texte)  { Write-Host "  [ERREUR]  $texte" -ForegroundColor Red    }

Clear-Host
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "   CGRAE Signature — Démarrage" -ForegroundColor Cyan
Write-Host "  ============================================================" -ForegroundColor Cyan

# ── 1. Libérer les ports 3000 et 4200 ───────────────────────
Titre "Etape 1/5 — Libération des ports..."
foreach ($port in @(3000, 4200)) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        OK "Port $port libéré (ancien PID $($conn.OwningProcess))"
    } else {
        INFO "Port $port déjà libre"
    }
}
Start-Sleep -Milliseconds 800

# ── 2. Vérification des prérequis ───────────────────────────
Titre "Etape 2/5 — Vérification des prérequis..."
$erreurs = 0

if (-not (Test-Path $TS_NODE)) {
    ERREUR "ts-node introuvable — exécutez d'abord :  cd backend  puis  npm install"
    $erreurs++
}
if (-not (Test-Path $MAIN)) {
    ERREUR "Fichier src\main.ts introuvable dans le dossier backend"
    $erreurs++
}
if (-not (Test-Path (Join-Path $FRONTEND "node_modules"))) {
    ERREUR "node_modules absent dans frontend — exécutez :  cd frontend  puis  npm install"
    $erreurs++
}

if ($erreurs -gt 0) {
    Write-Host ""
    ERREUR "Corrigez les erreurs ci-dessus puis relancez le script."
    Read-Host "`n  Appuyez sur Entrée pour quitter"
    exit 1
}
OK "Tous les prérequis sont présents"

# ── 3. Vérification MySQL ────────────────────────────────────
Titre "Etape 3/5 — Vérification de la base de données..."
if (Test-Path $MYSQL) {
    $test = & $MYSQL -u root doc_signature -e "SELECT 1;" 2>&1
    if ($LASTEXITCODE -eq 0) {
        OK "MySQL connecté — base doc_signature accessible"
    } else {
        WARN "MySQL inaccessible — vérifiez que le service MySQL est démarré"
        WARN "Démarrage via :  net start MySQL80"
        $rep = Read-Host "  Continuer quand même ? (O/N)"
        if ($rep -ne "O" -and $rep -ne "o") { exit 1 }
    }
} else {
    WARN "mysql.exe non trouvé — la vérification DB est ignorée"
}

# ── 4. Démarrer le Backend ───────────────────────────────────
Titre "Etape 4/5 — Démarrage du Backend (port 3000)..."
$cmdBackend = "cd '$BACKEND'; `$host.UI.RawUI.WindowTitle = 'CGRAE — Backend :3000'; " +
              "node '$TS_NODE' -T -r tsconfig-paths/register '$MAIN'"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmdBackend

# Attendre que le port 3000 réponde (max 25 secondes)
$pret = $false
Write-Host "  Attente du backend " -NoNewline -ForegroundColor White
for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 1000
    $conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($conn) { $pret = $true; break }
    Write-Host "." -NoNewline -ForegroundColor Gray
}
Write-Host ""

if ($pret) {
    OK "Backend démarré et prêt"
} else {
    WARN "Le backend n'a pas répondu dans les temps — vérifiez la fenêtre 'CGRAE — Backend :3000'"
}

# ── 5. Démarrer le Frontend ──────────────────────────────────
Titre "Etape 5/5 — Démarrage du Frontend (port 4200)..."
$cmdFrontend = "cd '$FRONTEND'; `$host.UI.RawUI.WindowTitle = 'CGRAE — Frontend :4200'; npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmdFrontend
OK "Frontend lancé — compilation en cours dans la fenêtre 'CGRAE — Frontend :4200'"

# ── Résumé final ─────────────────────────────────────────────
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host "   Application démarrée avec succès !" -ForegroundColor Green
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "   Ouvrez votre navigateur sur :" -ForegroundColor White
Write-Host ""
Write-Host "     http://localhost:4200        (application)" -ForegroundColor Yellow
Write-Host "     http://localhost:3000/docs   (API Swagger)" -ForegroundColor Gray
Write-Host ""
Write-Host "   Pour arrêter : fermez les deux fenêtres PowerShell" -ForegroundColor Gray
Write-Host "   intitulées  'CGRAE — Backend'  et  'CGRAE — Frontend'." -ForegroundColor Gray
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host ""
Read-Host "  Appuyez sur Entrée pour fermer cette fenêtre"
