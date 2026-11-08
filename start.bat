@echo off
rem First run: installs what the app needs and adds a sample project. Every run: starts the app.
cd /d "%~dp0"

if not exist .venv\.installed (
  echo Installing, first run only...
  py -3 -m venv .venv || (echo CiteWatch needs Python 3.11 or newer: https://www.python.org/downloads/ & pause & exit /b 1)
  .venv\Scripts\python -m pip install --quiet --disable-pip-version-check -r requirements.txt || (pause & exit /b 1)
  type nul > .venv\.installed
)

if not exist config.toml .venv\Scripts\python -m citewatch demo

start "" http://127.0.0.1:8765
.venv\Scripts\python -m citewatch serve
