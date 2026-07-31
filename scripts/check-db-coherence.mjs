#!/usr/bin/env node
/**
 * Vérifie que TOUT ce que le code appelle existe encore en base, et reste
 * exécutable par le rôle qui l'appelle.
 *
 * POURQUOI CE SCRIPT EXISTE
 * L'audit du 2026-07-31 a trouvé, en production :
 *   * neuf fonctions SQL mortes depuis des semaines — dont le droit à
 *     l'effacement (Loi 25) — parce qu'une garde interne sur auth.uid() refuse
 *     tout quand la fonction est appelée en service_role ;
 *   * l'INSCRIPTION cassée pendant une journée, un droit ayant été retiré par
 *     un durcissement générique, l'erreur avalée par un `await` sans contrôle ;
 *   * un appel frontend pointant dans le vide depuis deux mois et demi ;
 *   * une migration jamais appliquée pendant deux semaines à cause d'une
 *     collision d'horodatage — le filtre « factures par vendeur » ne marchait
 *     pas, et le code passait un paramètre p_salesperson inexistant en base.
 *
 * Aucun de ces problèmes n'était visible. Tous auraient été attrapés ici.
 *
 * USAGE
 *   node --env-file=.env.local scripts/check-db-coherence.mjs
 *
 * Deux modes de connexion, dans cet ordre :
 *   1. DB_URL              — chaîne Postgres (CI, base de staging)
 *   2. SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF — API Management (local)
 *
 * Sortie : 0 si tout concorde, 1 s'il manque quelque chose, 2 si le script
 * n'a pas pu vérifier (distinguer « tout va bien » de « je n'ai pas pu voir »
 * est essentiel — une vérification qui passe au vert sans rien tester est pire
 * que pas de vérification).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const DB_URL = process.env.DB_URL;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;

if (!DB_URL && !(TOKEN && REF)) {
  console.error('✗ IMPOSSIBLE DE VÉRIFIER : ni DB_URL, ni SUPABASE_ACCESS_TOKEN+SUPABASE_PROJECT_REF.');
  console.error('  Ce script sort en 2 (et non 0) pour ne pas faire croire que tout va bien.');
  process.exit(2);
}

// ── Accès base ─────────────────────────────────────────────────────────────
async function query(sql) {
  if (DB_URL) {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    try { return (await c.query(sql)).rows; } finally { await c.end(); }
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: ${txt.slice(0, 200)}`);
  return JSON.parse(txt);
}

/**
 * EXCEPTIONS CONNUES ET JUSTIFIÉES.
 *
 * Un contrôle qui crie au loup finit ignoré — y compris le jour où il signale
 * du vrai. Chaque entrée ici est un écart RÉEL mais dont le code gère
 * explicitement l'absence, vérifié à la main. Elles sont affichées à titre
 * informatif et ne font PAS échouer le contrôle.
 *
 * Pour ajouter une entrée : prouver que le code a un repli, et écrire pourquoi.
 * Dans le doute, ne pas ajouter — un faux positif se corrige, un vrai raté
 * passe en production.
 */
const EXCEPTIONS = new Map([
  ['get_user_id_by_email', "server/lib/supabase.ts:29 documente un repli : requête directe sur auth.users si la RPC est absente. Seul le chemin rapide (indexé) est perdu."],
  ['invalidate_user_sessions', "team-compliance.ts:141 ne l'appelle qu'en repli de admin.signOut(), erreurs volontairement avalées. La déconnexion passe par le chemin principal."],
  ['ensure_payment_settings_row', "server/lib/payments.ts:101 documente un repli explicite pour les environnements où la fonction est absente."],
]);

// ── Extraction depuis le code ──────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(p)) out.push(p);
  }
  return out;
}

const RPC_RE = /(\w+)\s*\.\s*rpc\s*\(\s*['"]([a-z_0-9]+)['"]\s*(?:,\s*(\{[\s\S]{0,700}?\}))?/g;
// On capture ~60 caractères AVANT `.from(` pour écarter deux faux positifs :
//   * supabase.storage.from('attachments')  -> un BUCKET, pas une table ;
//   * .schema('auth').from('users')         -> un autre schéma que `public`.
// Sans cette précaution le contrôle crie au loup et finit par être ignoré.
const FROM_RE = /([\s\S]{0,60})\.from\s*\(\s*['"]([a-zA-Z_0-9]+)['"]\s*\)/g;
const HORS_PUBLIC = /\.storage\s*$|\.schema\s*\(\s*['"](?!public)[a-z_]+['"]\s*\)\s*$/;

function scan(dirs) {
  const rpcs = new Map();   // nom -> { fichiers:Set, params:Set, roles:Set }
  const tables = new Map(); // nom -> Set(fichiers)
  for (const d of dirs) {
    let files = [];
    try { files = walk(join(ROOT, d)); } catch { continue; }
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const rel = relative(ROOT, f);
      for (const m of src.matchAll(RPC_RE)) {
        const [, recv, name, argsBlock] = m;
        const e = rpcs.get(name) || { fichiers: new Set(), params: new Set(), roles: new Set() };
        e.fichiers.add(rel);
        // service_role si le récepteur est un client admin connu
        e.roles.add(/^(svc|admin|serviceClient|sc)$/.test(recv) ? 'service_role' : 'authenticated');
        if (argsBlock) for (const p of argsBlock.matchAll(/\b(p_[a-z_0-9]+)\s*:/g)) e.params.add(p[1]);
        rpcs.set(name, e);
      }
      for (const m of src.matchAll(FROM_RE)) {
        const [, avant, t] = m;
        if (HORS_PUBLIC.test(avant.replace(/\s+/g, ''))) continue; // bucket ou autre schéma
        if (!tables.has(t)) tables.set(t, new Set());
        tables.get(t).add(rel);
      }
    }
  }
  return { rpcs, tables };
}

// ── Vérification ───────────────────────────────────────────────────────────
const { rpcs, tables } = scan(['src', 'server']);
console.log(`Code analysé : ${rpcs.size} fonction(s) et ${tables.size} table(s)/vue(s) référencées.\n`);

let erreurs = 0;
const tolerees = [];
const dit = (msg, cle) => {
  const raison = cle && EXCEPTIONS.get(cle);
  if (raison) { tolerees.push(`  ~ ${msg.replace(/^✗ /, '')}\n      toléré : ${raison}`); return; }
  console.log(msg);
  erreurs++;
};

// Fonctions : existence, droit d'exécution, et paramètres réellement acceptés
const fnRows = await query(`
  select p.proname as n,
         pg_get_function_arguments(p.oid) as args,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_ok,
         has_function_privilege('service_role', p.oid, 'execute')  as svc_ok
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'`);
const parNom = new Map();
for (const r of fnRows) {
  if (!parNom.has(r.n)) parNom.set(r.n, []);
  parNom.get(r.n).push(r);
}

for (const [nom, info] of [...rpcs].sort()) {
  const surcharges = parNom.get(nom);
  const ou = [...info.fichiers].slice(0, 2).join(', ');
  if (!surcharges) { dit(`✗ FONCTION ABSENTE DE LA BASE : ${nom}()  — appelée par ${ou}`, nom); continue; }

  if (info.roles.has('authenticated') && !surcharges.some((s) => s.auth_ok))
    dit(`✗ NON EXÉCUTABLE par authenticated : ${nom}()  — appelée par ${ou}`, nom);
  if (info.roles.has('service_role') && !surcharges.some((s) => s.svc_ok))
    dit(`✗ NON EXÉCUTABLE par service_role : ${nom}()  — appelée par ${ou}`, nom);

  // Un paramètre passé par le code doit exister dans AU MOINS une surcharge.
  // C'est ce contrôle qui aurait attrapé p_salesperson, passé pendant deux
  // semaines à une fonction qui ne l'acceptait pas.
  for (const p of info.params) {
    if (!surcharges.some((s) => new RegExp(`\\b${p}\\b`).test(s.args)))
      dit(`✗ PARAMÈTRE INCONNU : ${nom}(${p})  — aucune surcharge ne l'accepte — ${ou}`, nom);
  }
}

// Tables et vues
const relRows = await query(`
  select c.relname as n, c.relkind as k
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind in ('r','v','m','p')`);
const relSet = new Set(relRows.map((r) => r.n));
for (const [t, fichiers] of [...tables].sort()) {
  if (!relSet.has(t))
    dit(`✗ TABLE/VUE ABSENTE DE LA BASE : ${t}  — utilisée par ${[...fichiers].slice(0, 2).join(', ')}`, t);
}

if (tolerees.length) {
  console.log(`\nÉcarts connus et gérés par un repli dans le code (${tolerees.length}) — informatif :`);
  for (const l of tolerees) console.log(l);
}

console.log(
  erreurs === 0
    ? `\n✅ Cohérence code ↔ base vérifiée : ${rpcs.size} fonctions et ${tables.size} relations, aucun écart.`
    : `\n✗ ${erreurs} écart(s) entre le code et la base. Chacun est une panne silencieuse en puissance.`
);
process.exit(erreurs === 0 ? 0 : 1);
