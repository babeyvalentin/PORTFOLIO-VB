#!/bin/bash
cd "$(dirname "$0")"

NODE="/Users/vbabey/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

echo "Publication du portfolio vers GitHub..."
echo ""

if [ ! -x "$NODE" ]; then
  echo "Node local introuvable."
  echo "Ouvre Codex et demande de publier le portfolio."
  read -r -p "Appuie sur entree pour fermer."
  exit 1
fi

"$NODE" publish-github.mjs
STATUS=$?

echo ""
if [ "$STATUS" -eq 0 ]; then
  echo "Termine. GitHub Pages peut prendre une minute avant d'afficher la mise a jour."
else
  echo "La publication n'a pas abouti."
  echo "Si GitHub demande une connexion, connecte-toi puis relance cette commande."
fi

echo ""
read -r -p "Appuie sur entree pour fermer."
exit "$STATUS"
