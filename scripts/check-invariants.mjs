#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Les sondes d'intégrité — enfin interrogeables à la demande.

   La base contient déjà `check_all_invariants()` : totaux de factures
   qui ne concordent pas, références d'une organisation vers une autre,
   tables sans protection, numérotation cassée, tâches planifiées en
   échec. Ces sondes tournent chaque nuit à 4h40 — mais leurs alertes
   partent dans `security_events`, et le courriel qui devrait les
   remonter dépend d'un réglage serveur peut-être jamais activé.

   Autrement dit : elles parlent depuis des mois, personne n'écoute.
   Ce script écoute.

   Usage :
     node --env-file=.env.local scripts/check-invariants.mjs
     node --env-file=.env.local scripts/check-invariants.mjs --prod
   ═══════════════════════════════════════════════════════════════ */

const PROD = process.argv.includes('--prod');
const JETON = process.env.SUPABASE_ACCESS_TOKEN;
const REF = PROD ? process.env.SUPABASE_PROJECT_REF_PROD : process.env.SUPABASE_PROJECT_REF;

if (!REF) {
  console.error('Variable manquante — lancer avec --env-file=.env.local');
  console.error('Requis : ' + (PROD ? 'SUPABASE_PROJECT_REF_PROD' : 'SUPABASE_PROJECT_REF'));
  process.exit(2);
}

// Deux voies vers la base, dans l'ordre de préférence :
//   1. connexion Postgres directe (SUPABASE_DB_URL) — ne dépend d'aucun jeton
//   2. Management API — pratique, mais son jeton expire
// Le repli existe parce qu'un jeton expiré rendait TOUS les scripts check:* muets.
const DB_URL = process.env.SUPABASE_DB_URL || process.env.DB_URL || process.env.DATABASE_URL || '';

// La connexion directe n'est utilisable que si elle vise bien l'environnement demandé.
function urlViseLaCible() {
  if (!DB_URL) return false;
  return DB_URL.includes(REF);
}

async function sqlDirect(requete) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const r = await client.query(requete);
    return r.rows;
  } finally {
    await client.end();
  }
}

// La Management API refuse les User-Agent non navigateurs (403 Cloudflare).
async function sqlApi(requete) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${JETON}`,
      'Content-Type': 'application/json',
      'User-Agent': 'curl/8.7.1',
    },
    body: JSON.stringify({ query: requete }),
  });
  const corps = await r.json().catch(() => null);
  if (r.status !== 201) {
    throw new Error(`HTTP ${r.status} — ${JSON.stringify(corps).slice(0, 300)}`);
  }
  return corps;
}

let voie = null;
async function sql(requete) {
  if (voie === null) {
    voie = urlViseLaCible() ? 'directe' : 'api';
    console.log(voie === 'directe'
      ? '  (connexion Postgres directe)'
      : '  (via Management API)');
  }
  return voie === 'directe' ? sqlDirect(requete) : sqlApi(requete);
}

async function main() {
  console.log(PROD ? `\n⚠️  Cible : PRODUCTION (${REF})\n` : `\nCible : test/staging (${REF})\n`);

  // La fonction peut ne pas exister sur un environnement qui a dérivé.
  const presente = await sql(`select to_regprocedure('public.check_all_invariants()') is not null as ok;`);
  if (!presente?.[0]?.ok) {
    console.error('✗ check_all_invariants() est ABSENTE de cette base.');
    console.error('  C\'est en soi une dérive : la migration 20260751101000_integrity_invariants.sql');
    console.error('  n\'a pas été appliquée ici.');
    process.exit(1);
  }

  const lignes = await sql(`select check_name, failures, detail from public.check_all_invariants() order by failures desc, check_name;`);

  if (!Array.isArray(lignes) || lignes.length === 0) {
    console.log('Aucune sonde n\'a répondu — résultat inattendu, à examiner.');
    process.exit(1);
  }

  let total = 0;
  console.log('  Sonde                                   Défaillances');
  console.log('  ' + '─'.repeat(56));
  for (const l of lignes) {
    const n = Number(l.failures) || 0;
    total += n;
    const marque = n > 0 ? '✗' : '✓';
    console.log(`  ${marque} ${String(l.check_name).padEnd(38)} ${n}`);
    if (n > 0 && l.detail) {
      console.log(`      ${String(l.detail).slice(0, 400)}`);
    }
  }

  console.log('');
  if (total === 0) {
    console.log('Toutes les sondes sont au vert.\n');
    process.exit(0);
  }
  console.log(`${total} défaillance(s) au total. Détail ci-dessus.\n`);
  process.exit(1);
}

main().catch((e) => {
  console.error('\nInterrompu :', e.message);
  process.exit(2);
});
