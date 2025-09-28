@echo off
REM Run the removal PowerShell script, capture output, and pause so you can read errors.
REM Place this file in c:\Users\victo\CardGame\scripts\ and double-click it or run from PowerShell/CMD.

pushd "%~dp0\.."

REM Ensure output directory exists
if not exist "%cd%\scripts" mkdir "%cd%\scripts"

REM Run the PowerShell removal script and capture output (stdout+stderr) to a file.
REM Adjust the script filename below if your removal script has a different name.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "& { try { . '%cd%\scripts\run-remove-server-zip.ps1' } catch { Write-Error $_; exit 1 } }" > "%cd%\scripts\remove-server-zip-output.txt" 2>&1

REM Print the captured output to the console so you can read the error.
type "%cd%\scripts\remove-server-zip-output.txt" || echo "(no output captured)"

echo.
echo "Log written to: %cd%\scripts\remove-server-zip-output.txt"
echo.
pause

popd
