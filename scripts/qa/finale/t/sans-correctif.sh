#!/usr/bin/env bash
# « Rouge sans le correctif » : remet un ou plusieurs fichiers du produit dans l'état d'un commit
# (HEAD par défaut), lance les tests donnés, puis REMET les fichiers tels qu'ils étaient — même si
# les tests échouent (c'est le but) ou si on interrompt.
#
#   bash scripts/qa/finale/t/sans-correctif.sh <fichier[,fichier…]> <test…> [-- options vitest]
#   REF=<commit> bash scripts/qa/finale/t/sans-correctif.sh …     (état d'un autre commit que HEAD)
#
# Aucun `git stash` (la pile est partagée entre worktrees) : copie de secours dans un dossier temporaire.
set -u
fichiers="$1"; shift
ref="${REF:-HEAD}"
secours="$(mktemp -d)"
IFS=',' read -ra liste <<< "$fichiers"
remettre() {
  for f in "${liste[@]}"; do
    if [ -f "$secours/$(echo "$f" | tr '/' '_')" ]; then cp "$secours/$(echo "$f" | tr '/' '_')" "$f"; fi
  done
  rm -rf "$secours"
}
trap remettre EXIT
for f in "${liste[@]}"; do
  cp "$f" "$secours/$(echo "$f" | tr '/' '_')"
  git show "$ref:$f" > "$f"
done
npx vitest run --maxWorkers=2 "$@"
