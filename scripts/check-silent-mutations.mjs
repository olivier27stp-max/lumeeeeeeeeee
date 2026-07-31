#!/usr/bin/env node
/**
 * Cliquet anti-régression : interdit d'AJOUTER des mutations dont l'erreur
 * n'est jamais lue.
 *
 * LE PROBLÈME
 * `supabase-js` NE LÈVE PAS d'exception : il renvoie `{ data, error }`. Donc
 *
 *     await client.from('audit_events').insert({ ... });
 *
 * échoue en SILENCE si la RLS refuse, si une colonne manque, si une contrainte
 * saute. Un `try/catch` autour ne protège de rien — il n'y a rien à attraper.
 *
 * C'est exactement ce qui a masqué l'inscription cassée pendant une journée
 * (audit 2026-07-31) : OnboardingFlow.tsx:248 insérait une adhésion, le droit
 * avait été retiré, l'erreur 42501 est partie au néant, et l'utilisateur
 * repartait avec une organisation dont il n'était pas membre.
 *
 * POURQUOI UN CLIQUET PLUTÔT QU'UNE CORRECTION DE MASSE
 * Il y a 213 occurrences. Les réécrire d'un coup, c'est 213 occasions de casser
 * quelque chose — pour un gain nul le jour même. Le cliquet fige l'existant et
 * empêche que ça empire ; les corrections se font ensuite au fil de l'eau, dans
 * les fichiers qu'on touche déjà.
 *
 * LA BONNE FAÇON DE CORRIGER UNE OCCURRENCE
 *     const { error } = await client.from('x').insert({ ... });
 *     if (error) console.error('[contexte] échec:', error.message);
 *
 * Journaliser, pas lever — sauf si l'appelant sait déjà gérer une exception.
 * Lever change le flot de contrôle et casse des chemins qui marchaient.
 *
 * USAGE   node scripts/check-silent-mutations.mjs
 *         node scripts/check-silent-mutations.mjs --update   (après corrections)
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const REFERENCE = join(ROOT, 'scripts', 'silent-mutations-baseline.json');

function walk(d, out = []) {
  for (const e of readdirSync(d)) {
    if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

// Une mutation « nue » : la ligne commence par `await`, contient une opération
// mutante Supabase, et ne capture aucun résultat.
// Les appels stripe.* sont EXCLUS : le SDK Stripe, lui, lève bien.
const MUTANT = /\.(insert|update|upsert|delete|rpc)\s*\(/;
const SUPABASE = /\.from\s*\(|\.rpc\s*\(/;

function compter() {
  const par = {};
  for (const dir of ['src', 'server']) {
    let fichiers = [];
    try { fichiers = walk(join(ROOT, dir)); } catch { continue; }
    for (const f of fichiers) {
      const lignes = readFileSync(f, 'utf8').split('\n');
      let n = 0;
      for (const l of lignes) {
        if (!/^\s*await\s/.test(l)) continue;      // le résultat n'est pas capturé
        if (!MUTANT.test(l)) continue;
        if (!SUPABASE.test(l)) continue;           // écarte stripe.* & co
        if (/^\s*(\/\/|\*)/.test(l)) continue;
        n++;
      }
      if (n) par[relative(ROOT, f)] = n;
    }
  }
  return par;
}

const actuel = compter();
const total = Object.values(actuel).reduce((a, b) => a + b, 0);

if (process.argv.includes('--update')) {
  writeFileSync(REFERENCE, JSON.stringify(actuel, null, 1) + '\n');
  console.log(`Référence mise à jour : ${total} occurrence(s) dans ${Object.keys(actuel).length} fichier(s).`);
  process.exit(0);
}

if (!existsSync(REFERENCE)) {
  console.error('✗ Référence absente. Créer avec : node scripts/check-silent-mutations.mjs --update');
  process.exit(2);
}
const reference = JSON.parse(readFileSync(REFERENCE, 'utf8'));
const ancienTotal = Object.values(reference).reduce((a, b) => a + b, 0);

const pires = [];
for (const [f, n] of Object.entries(actuel)) {
  const avant = reference[f] || 0;
  if (n > avant) pires.push(`  ${f} : ${avant} → ${n}  (+${n - avant})`);
}

if (pires.length) {
  console.error(`✗ Mutations dont l'erreur n'est jamais lue : ${ancienTotal} → ${total}\n`);
  console.error('Fichiers en régression :');
  pires.forEach((l) => console.error(l));
  console.error(`
supabase-js ne lève pas : sans lecture de \`error\`, l'échec est invisible.
Corriger ainsi — journaliser, pas lever :

    const { error } = await client.from('x').insert({ ... });
    if (error) console.error('[contexte] échec:', error.message);

Si la régression est volontaire et justifiée :
    node scripts/check-silent-mutations.mjs --update`);
  process.exit(1);
}

const gagne = ancienTotal - total;
console.log(
  gagne > 0
    ? `✅ ${total} occurrence(s) — ${gagne} de moins que la référence. Penser à --update pour verrouiller le gain.`
    : `✅ ${total} occurrence(s), aucune régression.`
);
process.exit(0);
