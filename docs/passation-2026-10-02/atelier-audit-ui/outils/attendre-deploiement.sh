#!/usr/bin/env bash
# Attend la fin du déploiement Railway d'un commit (statut GitHub), puis sonde /api/health pendant 3 minutes.
# Usage : attendre-deploiement.sh <sha>
sha="$1"
for i in $(seq 1 60); do
  etat=$(gh api "repos/olivier27stp-max/lumeeeeeeeeee/commits/$sha/status" -q '.statuses[0].state + " " + (.statuses[0].description // "")' 2>/dev/null)
  case "$etat" in
    success*) echo "déploiement : $etat ($(date -u +%H:%M:%S) UTC)"; break ;;
    failure*|error*) echo "déploiement : $etat ($(date -u +%H:%M:%S) UTC)"; break ;;
  esac
  sleep 15
done
ok=0; ko=0
for i in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://lumecrm.net/api/health)
  if [ "$code" = "200" ]; then ok=$((ok+1)); else ko=$((ko+1)); echo "santé : $code à $(date -u +%H:%M:%S)"; fi
  sleep 15
done
echo "santé sur 3 min : $ok OK / $ko KO ; fin $(date -u +%H:%M:%S) UTC"
