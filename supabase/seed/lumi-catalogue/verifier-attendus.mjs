#!/usr/bin/env node
/**
 * Exécute, sur staging fraîchement seedé, TOUS les contrôles SQL du catalogue qui
 * doivent être vrais AVANT que Lumi agisse : réponses (attendu.sql), états avant
 * confirmation, bases inchangées (refus, clarifications). Les contrôles « après »
 * ne sont exécutés que pour vérifier qu'ils sont syntaxiquement valides.
 *
 *   npm run seed:lumi-catalogue && node --env-file=.env.local supabase/seed/lumi-catalogue/verifier-attendus.mjs
 *
 * Lecture seule (SELECT) ; refuse la prod.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ref = process.env.SUPABASE_PROJECT_REF;
const refProd = process.env.SUPABASE_PROJECT_REF_PROD;
if (!ref || !refProd || ref === refProd) { console.error('REFUS : staging seulement (SUPABASE_PROJECT_REF_PROD requis).'); process.exit(2); }
const ici = dirname(fileURLToPath(import.meta.url));
// Argument facultatif : un catalogue régénéré ailleurs (--sortie) pour l'ancre du jour.
const chemin = process.argv[2] ? resolve(process.argv[2]) : resolve(ici, '../../../docs/audits/catalogue_taches_lumi.json');
const cat = JSON.parse(readFileSync(chemin, 'utf8'));

async function lot(requetes) {
  // Une seule requête HTTP par lot : l'API de gestion limite le débit.
  const sql = requetes.map((r, i) => `select ${i} as i, (${r.replace(/;\s*$/, '')})::text as v`).join('\nunion all\n');
  for (let essai = 1; ; essai++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
    const txt = await res.text();
    if (res.ok) { const m = new Map(JSON.parse(txt).map((x) => [x.i, x.v])); return requetes.map((_, i) => m.get(i)); }
    if ((res.status === 429 || res.status >= 500) && essai < 6) { await new Promise((ok) => setTimeout(ok, 2000 * essai)); continue; }
    throw new Error(txt.slice(0, 500));
  }
}
async function executer(requetes) {
  try { return await lot(requetes); } catch {
    // Une requête fautive fait échouer le lot : on isole.
    const out = [];
    for (const r of requetes) { try { out.push((await lot([r]))[0]); } catch (e) { out.push({ erreur: e.message }); } }
    return out;
  }
}

const avant = [], apres = [];
for (const t of cat.taches) {
  const a = t.attendu;
  const push = (liste, s, genre) => liste.push({ id: t.id, genre, ...s });
  for (const s of a.sql ?? []) push(avant, s, 'réponse');
  for (const s of a.avant_confirmation ?? []) push(avant, s, 'avant confirmation');
  for (const s of a.base_inchangee ?? []) push(avant, s, 'base inchangée');
  for (const s of a.apres_precision?.sql ?? []) push(avant, s, 'réponse après précision');
  for (const s of a.apres_confirmation ?? []) push(apres, s, 'après');
}
let ko = 0, erreurs = 0;
for (let i = 0; i < avant.length; i += 40) {
  const paquet = avant.slice(i, i + 40);
  const v = await executer(paquet.map((x) => x.requete));
  paquet.forEach((x, j) => {
    if (v[j]?.erreur) { erreurs++; console.log(`ERREUR ${x.id} (${x.genre}) : ${v[j].erreur.slice(0, 200)}`); return; }
    if (String(v[j]) !== String(x.attendu)) { ko++; console.log(`ÉCART  ${x.id} (${x.genre}) : attendu ${x.attendu}, base ${v[j]}\n        ${x.requete.slice(0, 220)}`); }
  });
}
for (let i = 0; i < apres.length; i += 40) {
  const paquet = apres.slice(i, i + 40);
  const v = await executer(paquet.map((x) => x.requete));
  paquet.forEach((x, j) => { if (v[j]?.erreur) { erreurs++; console.log(`ERREUR ${x.id} (après, SQL invalide) : ${v[j].erreur.slice(0, 200)}`); } });
}
console.log(`\n${avant.length} contrôles « avant » : ${avant.length - ko - erreurs} OK, ${ko} écart(s) ; ${apres.length} contrôles « après » compilés ; ${erreurs} erreur(s) SQL.`);
process.exit(ko || erreurs ? 1 : 0);
