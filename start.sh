#!/usr/bin/env bash
# First run: installs what the app needs and adds a sample project. Every run: starts the app.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"

PY=""
for candidate in python3 python3.14 python3.13 python3.12 python3.11; do
  if command -v "$candidate" >/dev/null && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then
    PY="$candidate"; break
  fi
done
[ -n "$PY" ] || { echo "CiteWatch needs Python 3.11 or newer: https://www.python.org/downloads/"; exit 1; }

if [ ! -f .venv/.installed ] || [ requirements.txt -nt .venv/.installed ]; then
  echo "Installing (first run only)..."
  "$PY" -m venv .venv
  .venv/bin/python -m pip install --quiet --disable-pip-version-check -r requirements.txt
  touch .venv/.installed
fi

[ -f config.toml ] || .venv/bin/python -m citewatch demo

URL="http://127.0.0.1:$PORT"
if [ -z "${NO_BROWSER:-}" ]; then
  ( sleep 1; (command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") || true ) &
fi
exec .venv/bin/python -m citewatch serve --port "$PORT"
