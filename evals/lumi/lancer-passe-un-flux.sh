#!/usr/bin/env bash
# La passe d'évaluation de Lumi (221 demandes) dans UN bureau de test de la prod, UN SEUL FLUX :
# les lots se suivent, la santé de la base est relue avant chacun (arrêt au-dessus de 1 500 ms).
#   bash lancer-passe-un-flux.sh <prefixe> <org> <dossier-de-sortie>
set -u
PREFIXE="${1:?préfixe du bureau, ex. eval4}"
ORG="${2:?identifiant du bureau de test}"
NOM="${3:?nom du dossier de sortie}"
ENV=C:/Users/Rafba/lumeeeeeeeeee/.env.local
CAS=evals/lumi/cas-resolus-$PREFIXE
D=evals/lumi/resultats/$NOM
mkdir -p "$D"
sante() {
  curl -s -m 10 https://lumecrm.net/api/health | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(Number.isFinite(j.db_ms)?Math.round(j.db_ms):9999)}catch{console.log(9999)}})"
}
date -u +%Y-%m-%dT%H:%M:%SZ > "$D/debut.txt"
git ls-remote origin refs/heads/main 2>/dev/null | cut -c1-8 > "$D/main.txt"
for morceau in "proprietaire-lot1 proprio1 lot1" "proprietaire-lot2 proprio2 lot2" "proprietaire-lot3 proprio3 lot3" "proprietaire-lot4 proprio4 lot4" "technicien tech technicien"; do
  set -- $morceau
  ms=$(sante)
  if [ "$ms" -gt 1500 ]; then sleep 20; ms=$(sante); fi
  echo "$(date -u +%H:%M:%S) avant $3 : base ${ms} ms"
  if [ "$ms" -gt 1500 ]; then echo "ARRÊT : la base de prod est lente (${ms} ms) — rien n'est envoyé."; exit 3; fi
  node --env-file=$ENV --import tsx evals/lumi-tools/run.mts --prod --org $ORG --compte $PREFIXE.$2@lume-qa.test --cas $CAS/$1 --sortie $D/$3.json > "$D/$3.log" 2>&1
  echo "$(date -u +%H:%M:%S) fini $3 : $(grep -v dotenv "$D/$3.log" | grep -c -E '^(OK|RATE|PART|ERR) ') demandes, $(grep -v dotenv "$D/$3.log" | grep -c -E '^ERR ') plantée(s)"
done
date -u +%Y-%m-%dT%H:%M:%SZ > "$D/fin.txt"
npx tsx evals/lumi/corriger.mts --cas $CAS --resultats $D/lot1.json,$D/lot2.json,$D/lot3.json,$D/lot4.json,$D/technicien.json --sortie $D/bilan.json > "$D/correcteur.log" 2>&1
echo "début $(cat $D/debut.txt) — fin $(cat $D/fin.txt) — main $(cat $D/main.txt) — base $(sante) ms"
grep -v dotenv "$D/correcteur.log" | tail -70 | cut -c1-230
