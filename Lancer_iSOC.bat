@echo off
REM ============================================================
REM  iSOC - Plateforme de signalement d'incident
REM  Lance un serveur local puis ouvre la page d'accueil.
REM
REM  Le serveur est indispensable depuis le passage a Firebase :
REM  les modules ES et Firestore sont bloques en file://
REM  (ouverture par double-clic sur le fichier HTML).
REM ============================================================

title iSOC - Serveur local
cd /d "%~dp0"

if not exist "accueil.html" (
  echo.
  echo   ERREUR : accueil.html est introuvable.
  echo   Ce lanceur doit rester dans le meme dossier que accueil.html.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js est introuvable : le serveur local ne peut pas demarrer.
  echo   Ouverture directe de la page d'accueil - les bases Firebase
  echo   ne fonctionneront pas dans ce mode.
  echo.
  pause
  start "" "%~dp0accueil.html"
  exit /b 0
)

echo.
echo   iSOC - demarrage du serveur local...
echo   Laissez cette fenetre ouverte pendant l'utilisation.
echo.

node "%~dp0tools\serve.js"

echo.
echo   Serveur arrete.
pause
exit /b 0
