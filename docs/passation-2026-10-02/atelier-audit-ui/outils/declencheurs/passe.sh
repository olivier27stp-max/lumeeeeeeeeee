#!/usr/bin/env bash
# Une passe sur un fichier (ou un filtre) : passe.sh <étiquette> <cible> [options playwright…]
# Journal : sorties/declencheurs/journaux/<étiquette>.log ; rapport JSON : sorties/e2e-declencheurs/<étiquette>/resultats.json
ETIQ="$1"; shift
mkdir -p D:/lume-uiaudit/sorties/declencheurs/journaux
E2E_SORTIES=D:/lume-uiaudit/sorties/e2e-declencheurs/$ETIQ ./lancer.sh "$@" > D:/lume-uiaudit/sorties/declencheurs/journaux/$ETIQ.log 2>&1
echo "FIN $?" >> D:/lume-uiaudit/sorties/declencheurs/journaux/$ETIQ.log
grep -cE "^\s+ok\s" D:/lume-uiaudit/sorties/declencheurs/journaux/$ETIQ.log
