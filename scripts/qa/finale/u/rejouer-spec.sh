#!/usr/bin/env bash
# Rejoue UNE spec Playwright de la session fd (lecture seule, D:/lume-uiaudit/wt-lumi) contre MES
# serveurs locaux (API 3497, Vite 5497) — recette : D:/lume-final/notes/REJOUER-UNE-SPEC-E2E.md.
#
#   bash scripts/qa/finale/u/rejouer-spec.sh actions/06-publication.spec.ts -g "PUBLIÉE"
#
# Les clés viennent du .env.local du worktree (pile LOCALE) ; la sortie complète va dans
# D:/lume-final/sorties/e2e-u/derniere-relance.txt, et seul un VERDICT court est affiché (la
# sortie brute cite les adresses de la pile, clé anonyme comprise).
#
# LE MONITEUR. La pile `lumefinal` n'a pas de service « realtime » : l'app y reçoit des 404 sur
# sa WebSocket, que le moniteur du banc relève comme des problèmes — sur CHAQUE test. Une spec
# dont le seul échec est celui-là a passé toutes SES attentes : le verdict le dit à part.
set -u
ENV_LOCAL="D:/lume-final/wt-u/.env.local"
lire() { grep -E "^$1=" "$ENV_LOCAL" | head -1 | cut -d= -f2-; }
URL="$(lire VITE_SUPABASE_URL)"
case "$URL" in
  http://localhost:*|http://127.0.0.1:*) ;;
  *) echo "REFUS : ce script ne sert que la pile LOCALE."; exit 1 ;;
esac
SORTIE="D:/lume-final/sorties/e2e-u/derniere-relance.txt"
mkdir -p "$(dirname "$SORTIE")"
cd "${U_SPECS:-D:/lume-uiaudit/wt-verif}" || exit 2
VITE_SUPABASE_URL="${URL/localhost/127.0.0.1}" \
VITE_SUPABASE_ANON_KEY="$(lire VITE_SUPABASE_ANON_KEY)" \
SUPABASE_SERVICE_ROLE_KEY="$(lire SUPABASE_SERVICE_ROLE_KEY)" \
E2E_BASE="http://127.0.0.1:5497" E2E_JEU=u E2E_WORKERS=1 \
E2E_SORTIES="D:/lume-final/sorties/e2e-u" \
PLAYWRIGHT_BROWSERS_PATH="D:/lume-uiaudit/pw-browsers" \
node node_modules/@playwright/test/cli.js test -c e2e/automations/playwright.config.ts "$@" --project=bureau > "$SORTIE" 2>&1

# ── Verdict, test par test ──
node - "$SORTIE" <<'JS'
const fs = require('node:fs');
const texte = fs.readFileSync(process.argv[2], 'utf8').replace(/\u001b\[[0-9;]*m/g, '');
const blocs = texte.split(/\n(?=\s+\d+\) \[bureau\])/).slice(1);
const titres = [...texte.matchAll(/^\s+(ok|x|✓|✘|-)\s+\d+ \[bureau\] › (.+?) \(([\d.]+(?:ms|s|m))\)\s*$/gm)];
const echecs = new Map();
for (const b of blocs) {
  const titre = (b.match(/\[bureau\] › (.+)/) || [])[1]?.trim() ?? '?';
  const moniteur = /Le moniteur \(/.test(b);
  const problemes = [...b.matchAll(/^\s+· (.+)$/gm)].map((m) => m[1]);
  const seulementWs = moniteur && problemes.length > 0 && problemes.every((p) => /WebSocket connection to 'ws:\/\/(localhost|127\.0\.0\.1):\d+\/realtime/.test(p));
  const autresErreurs = [...b.matchAll(/^\s+\w*Error: (?!Le moniteur)(.+)$/gm)].map((m) => m[1].slice(0, 200));
  echecs.set(titre, { seulementWs, autresErreurs, problemes: problemes.filter((p) => !/WebSocket connection/.test(p)).map((p) => p.slice(0, 200)) });
}
let n = 0;
for (const [, etat, titre] of titres) {
  n += 1;
  const court = titre.split(' › ').slice(1).join(' › ').slice(0, 150);
  const e = [...echecs.entries()].find(([t]) => t.includes(titre.split(' › ').at(-1).slice(0, 60)))?.[1];
  if (etat === 'ok' || etat === '✓') console.log(`VERTE — ${court}`);
  else if (e?.seulementWs && e.autresErreurs.length === 0) console.log(`VERTE AUX ATTENTES (seul le moniteur relève les WebSocket 404 de la pile locale) — ${court}`);
  else console.log(`ROUGE — ${court}\n   ${(e?.autresErreurs ?? []).concat(e?.problemes ?? []).slice(0, 3).join('\n   ') || '(voir la sortie complète)'}`);
}
if (!n) console.log(texte.split('\n').filter((l) => l.trim()).slice(-6).join('\n'));
JS
