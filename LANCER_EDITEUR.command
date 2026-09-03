#!/bin/bash
cd "$(dirname "$0")"

NODE="/Users/vbabey/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
URL="http://127.0.0.1:8787/"

if [ ! -x "$NODE" ]; then
  echo "Node local introuvable."
  echo "Ouvre Codex et demande de relancer l'editeur du portfolio."
  read -r -p "Appuie sur entree pour fermer."
  exit 1
fi

open "$URL"
"$NODE" editor-server.mjs
