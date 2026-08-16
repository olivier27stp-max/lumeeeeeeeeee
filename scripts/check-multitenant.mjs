#!/usr/bin/env node
/**
 * Garde multi-locataire : aucune table lisible par un client ne doit être
 * dépourvue de barrière entre organisations.
 *
 * POURQUOI CE SCRIPT EN PLUS DE test:rls
 * `test:rls` est le meilleur outil qu'on ait — il tente de VRAIES lectures
 * croisées. Mais il ne peut prouver l'isolation que là où il y a des données
 * de deux organisations différentes. Mesuré : sur 163 tables portant un
 * `org_id`, seules 11 sont concluantes sur staging (134 sont vides). Un « 0
 * fuite » sur une table vide ne prouve rien.
 *
 * Ce script couvre l'angle mort en raisonnant sur la STRUCTURE plutôt que sur
 * les données : il ne demande pas « a-t-on fui ? » mais « existe-t-il une
 * barrière ? ». Une table vide aujourd'hui se remplira demain.
 *
 * CE QU'IL ACCEPTE COMME BARRIÈRE — quatre formes, toutes valides :
 *   · filtre d'organisation (has_org_membership, org_id, company_group) ;
 *   · filtre d'utilisateur (auth.uid()) — plus fin qu'un filtre d'org ;
 *   · refus total (`false`) — le verrou le plus simple ;
 *   · réservé au service_role — inatteignable depuis un navigateur.
 *
 * Une table de RÉFÉRENCE (plans, promo_codes, courses) est volontairement
 * lisible par tous : elle ne contient aucune donnée de locataire. Elle doit
 * être déclarée ci-dessous, avec sa justification.
 *
 * USAGE  node --env-file=.env.local scripts/check-multitenant.mjs
 *        node --env-file=.env.local scripts/check-multitenant.mjs --prod
 */
const PROD = process.argv.includes('--prod');
const t = process.env.SUPABASE_ACCESS_TOKEN;
const r = PROD ? process.env.SUPABASE_PROJECT_REF_PROD : process.env.SUPABASE_PROJECT_REF;
if (!t || !r) {
  console.error('ERREUR : SUPABASE_ACCESS_TOKEN et SUPABASE_PROJECT_REF requis dans .env.local');
  process.exit(2);
}

/**
 * Tables de référence, partagées par conception : aucune donnée de locataire.
 * Toute entrée ajoutée ici doit porter sa justification — c'est une dérogation
 * à la règle, pas une commodité.
 */
const REFERENCE_PARTAGEE = {
  plans: 'Catalogue des forfaits — affiché sur la page de tarification publique.',
  promo_codes: 'Codes promo : un code saisi doit pouvoir être validé côté client. Aucune donnée de locataire (code, remise, dates).',
  course_lessons: 'Contenu de formation, identique pour tous les abonnés.',
  course_modules: 'Contenu de formation, identique pour tous les abonnés.',
  tax_group_items: 'Taux de taxes officiels (TPS/TVQ) — donnée publique.',
};

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${r}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(txt.slice(0, 300));
  return JSON.parse(txt);
}

// Une policy est une barrière si elle filtre par org, par utilisateur, refuse
// tout, ou réserve l'accès au service_role.
const BARRIERE = /has_org_membership|has_org_role|org_id|current_org|company_group|auth\.uid|auth\.role|service_role/i;

/**
 * Une policy qui ne contient QUE des `false` (et des espaces ou séparateurs)
 * refuse tout : c'est le verrou le plus strict qui soit.
 *
 * Le test doit porter sur la chaîne entière, pas sur un `^false$` : les règles
 * de plusieurs policies sont concaténées, donc un refus total arrive sous la
 * forme « false false » ou « false | false ».
 */
const REFUS_TOTAL = (regles) => /false/.test(regles) && !/[a-z_]{3,}/i.test(regles.replace(/false/g, ''));

const lignes = await q(`
  select c.relname as tbl,
         c.relrowsecurity as rls,
         coalesce((
           select string_agg(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''), ' | ')
             from pg_policies p
            where p.schemaname = 'public' and p.tablename = c.relname
              and (p.roles::text like '%authenticated%' or p.roles::text like '%anon%' or p.roles::text like '%public%')
              and p.cmd in ('SELECT', 'ALL')
         ), '') as regles,
         (select count(*) from pg_policies p
           where p.schemaname='public' and p.tablename=c.relname) as nb_policies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relkind = 'r'
     and has_table_privilege('authenticated', c.oid, 'SELECT')
   order by c.relname`);

console.log(`Cible : ${PROD ? 'PRODUCTION' : 'staging'} (${r}) — ${lignes.length} table(s) lisible(s) par un client.\n`);

const sansRls = [];
const sansBarriere = [];
const derogations = [];

for (const l of lignes) {
  if (REFERENCE_PARTAGEE[l.tbl]) { derogations.push(l.tbl); continue; }
  if (!l.rls) { sansRls.push(l.tbl); continue; }
  // RLS active sans AUCUNE policy = personne ne lit. C'est un verrou fermé,
  // pas un trou : Postgres refuse par défaut.
  if (Number(l.nb_policies) === 0) continue;
  const regles = (l.regles || '').trim();
  // Aucune policy de LECTURE pour les rôles clients : Postgres refuse par
  // défaut dès que la RLS est active. Verrou fermé, pas trou.
  if (!regles) continue;
  if (REFUS_TOTAL(regles)) continue;
  if (!BARRIERE.test(regles)) sansBarriere.push(`${l.tbl} — ${regles.slice(0, 80)}`);
}

let ko = 0;

console.log('── Tables sans RLS ──');
if (sansRls.length) {
  ko += sansRls.length;
  for (const t2 of sansRls) console.log(`  ✗ ${t2} — lisible par tout client connecté, TOUTES organisations confondues`);
} else console.log('  aucune');

console.log('\n── Tables dont la policy ne filtre rien ──');
if (sansBarriere.length) {
  ko += sansBarriere.length;
  for (const s of sansBarriere) console.log(`  ✗ ${s}`);
} else console.log('  aucune');

console.log(`\n── Références partagées (dérogations déclarées) ──\n  ${derogations.join(', ') || 'aucune'}`);

if (ko) {
  console.error(`\n✗ ${ko} table(s) sans barrière entre organisations.`);
  console.error('  Ajouter une policy filtrant sur org_id / auth.uid(), ou — si la table');
  console.error('  est une référence partagée sans donnée de locataire — la déclarer dans');
  console.error('  REFERENCE_PARTAGEE avec sa justification.');
  process.exit(1);
}
console.log('\n✅ Toute table lisible par un client porte une barrière entre organisations.');
