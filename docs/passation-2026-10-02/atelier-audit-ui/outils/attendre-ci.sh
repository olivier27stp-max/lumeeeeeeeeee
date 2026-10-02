#!/usr/bin/env bash
# Attend que les contrôles OBLIGATOIRES d'une PR aient fini (le job « Automatisations » est souvent annulé
# par la file partagée : on ne l'attend pas). Usage : attendre-ci.sh <numéro de PR>
pr="$1"
cd /d/lume-uiaudit/wt || exit 1
for i in $(seq 1 80); do
  etat=$(gh pr checks "$pr" --json name,state -q '.[] | select(.name|test("Lint|RLS")) | .name + "=" + .state' 2>/dev/null | tr '\n' ' ')
  case "$etat" in
    *PENDING*|*QUEUED*|*IN_PROGRESS*|"") sleep 20 ;;
    *) break ;;
  esac
done
gh pr checks "$pr" --json name,state -q '.[] | .name + " = " + .state'
echo "fin $(date -u +%H:%M:%S) UTC"
