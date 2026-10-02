#!/usr/bin/env bash
# Les 71 tests critiques de Lumi, rejoués avec le modèle principal : famille par famille, UN flux,
# la santé de la base relue avant chaque groupe (arrêt au-dessus de 1 500 ms).
#   bash scripts/qa/lumi/critiques/lancer-critiques.sh <base-de-sortie>     (depuis la racine du dépôt)
# Fichier d'environnement : .env.local à la racine, ou LUME_ENV=<chemin>.
set -u
SORTIE="${1:?base des fichiers de sortie, ex. evals/lumi/resultats/critiques-2026-10-02}"
ENV="${LUME_ENV:-.env.local}"
sante() {
  curl -s -m 10 https://lumecrm.net/api/health | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(Number.isFinite(j.db_ms)?Math.round(j.db_ms):9999)}catch{console.log(9999)}})"
}
for groupe in "isolation,roles eval.proprio1@lume-qa.test" "memoire,idempotence,injection eval.proprio2@lume-qa.test" "actions,exactitude eval.proprio3@lume-qa.test" "credits,loi25 qa.map.owner@lume.test"; do
  set -- $groupe
  ms=$(sante)
  if [ "$ms" -gt 1500 ]; then sleep 20; ms=$(sante); fi
  echo "$(date -u +%H:%M:%S) avant $1 : base ${ms} ms"
  if [ "$ms" -gt 1500 ]; then echo "ARRÊT : la base de prod est lente (${ms} ms)."; exit 3; fi
  node --env-file=$ENV --import tsx scripts/qa/lumi/critiques/run.mts --famille $1 --proprietaire $2 --malgre-activite --sortie "$SORTIE" 2>&1 | grep -v dotenv | grep -E "PASS|FAIL|NON COUVERT|A RELIRE|BILAN|palier|Qui a|modèle" | cut -c1-200
done
echo "$(date -u +%H:%M:%S) fin — base $(sante) ms"
