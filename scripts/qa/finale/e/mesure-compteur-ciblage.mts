/**
 * Agent E — mesure du compteur « Touche X clients » sur 5 000 clients fictifs
 * (mon bureau B local, semé par charge-5000-clients.sql).
 *
 * Deux façons de compter, les deux mesurées :
 *   A. EN MÉMOIRE, par l'évaluateur de l'exécution (prototype-ciblage.ts) : le serveur lit
 *      les fiches, les étiquettes et les valeurs des champs cités, puis juge chaque client
 *      avec la MÊME fonction que le moteur. Aucune migration.
 *   B. EN SQL, une seule requête (ce que ferait une fonction `automation_ciblage_compter`) :
 *      plus rapide sur un gros carnet, mais c'est une migration et un second évaluateur
 *      à garder aligné sur le premier.
 * Les deux doivent rendre le même nombre.
 *
 *   QA_AUTO_SUFFIXE=e npx tsx --env-file=.env.local scripts/qa/finale/e/mesure-compteur-ciblage.mts
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assurerBureauTest } from '../../../../tests/automations-suite/harnais/bureau-test';
import { evaluerCiblage, type Ciblage, type FicheClient } from './prototype-ciblage';
import type { TypeChamp, ValeurChamp } from '../../../../src/lib/champs/types';

if (!/localhost|127\.0\.0\.1/.test(process.env.VITE_SUPABASE_URL ?? '')) throw new Error('REFUS : pile LOCALE seulement.');
if ((process.env.QA_AUTO_SUFFIXE ?? '') !== 'e') throw new Error('REFUS : QA_AUTO_SUFFIXE=e attendu.');

const b = await assurerBureauTest();
const org = b.orgB;
const admin: SupabaseClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: champs } = await admin.from('custom_fields').select('id, key, field_type').eq('org_id', org).eq('object_type', 'client').is('archived_at', null);
const idDe = (cle: string) => (champs ?? []).find((c) => c.key === cle)!.id as string;
const REFERE = idDe('refere_par');
const NOREVIEW = idDe('noreview');

const SCENARIOS: Array<{ nom: string; ciblage: Ciblage | null }> = [
  { nom: 'Tous les clients (défaut)', ciblage: null },
  { nom: 'Étiquette VIP', ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: 'VIP' }] } } },
  { nom: 'VIP OU Commercial, SAUF « Ne pas relancer »', ciblage: { inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }, { type: 'etiquette', valeur: 'Commercial' }] }, exclure: [{ type: 'etiquette', valeur: 'Ne pas relancer' }] } },
  { nom: 'VIP ET « Référé par » = Facebook', ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: 'VIP' }, { type: 'champ', field_id: REFERE, op: 'is', value: 'Facebook' }] } } },
  { nom: 'Type de client = entreprise, pas un prospect, SAUF « noreview » coché', ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'fiche', cle: 'genre', op: 'is', value: 'entreprise' }, { type: 'fiche', cle: 'status', op: 'is_not', value: 'lead' }] }, exclure: [{ type: 'champ', field_id: NOREVIEW, op: 'is', value: true }] } },
];

// ── A. En mémoire : lire le carnet par pages, juger avec l'évaluateur de l'exécution ──
const PAGE = 1000;
async function toutesLesPages<T>(lire: (de: number, a: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += PAGE) {
    const { data, error } = await lire(de, de + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return out;
  }
}

async function compterEnMemoire(ciblage: Ciblage | null): Promise<{ total: number; lectures: number }> {
  let lectures = 0;
  const fiches = await toutesLesPages<{ id: string; status: string | null; company: string | null; city: string | null; lead_source: string | null; source: string | null; phone: string | null; email: string | null }>(
    (de, a) => { lectures++; return admin.from('clients').select('id, status, company, city, lead_source, source, phone, email').eq('org_id', org).is('deleted_at', null).order('id').range(de, a); });
  const regles = [...(ciblage?.inclure?.regles ?? []), ...(ciblage?.exclure ?? [])];
  const veutEtiquettes = regles.some((r) => r.type === 'etiquette');
  const idsChamps = [...new Set(regles.flatMap((r) => (r.type === 'champ' ? [r.field_id] : [])))];
  const etiquettes = new Map<string, string[]>();
  if (veutEtiquettes) {
    const lignes = await toutesLesPages<{ client_id: string; tag: string }>((de, a) => {
      lectures++;
      return admin.from('client_tags').select('client_id, tag, clients!inner(org_id)').eq('clients.org_id', org).order('id').range(de, a) as never;
    });
    for (const l of lignes) etiquettes.set(l.client_id, [...(etiquettes.get(l.client_id) ?? []), l.tag]);
  }
  const valeurs = new Map<string, Record<string, { type: TypeChamp; valeur: ValeurChamp }>>();
  const types: Record<string, TypeChamp> = {};
  for (const id of idsChamps) types[id] = (champs ?? []).find((c) => c.id === id)!.field_type as TypeChamp;
  if (idsChamps.length) {
    const lignes = await toutesLesPages<{ client_id: string; field_id: string; value_text: string | null; value_boolean: boolean | null; value_number: number | null; value_option_id: string | null; value_date: string | null }>((de, a) => {
      lectures++;
      return admin.from('custom_field_values').select('client_id, field_id, value_text, value_boolean, value_number, value_option_id, value_date').eq('org_id', org).in('field_id', idsChamps).order('id').range(de, a);
    });
    for (const l of lignes) {
      const v = l.value_boolean ?? l.value_text ?? l.value_number ?? l.value_option_id ?? l.value_date ?? null;
      valeurs.set(l.client_id, { ...(valeurs.get(l.client_id) ?? {}), [l.field_id]: { type: types[l.field_id], valeur: v as ValeurChamp } });
    }
  }
  let total = 0;
  for (const f of fiches) {
    const fiche: FicheClient = { ...f, etiquettes: etiquettes.get(f.id) ?? [], champs: valeurs.get(f.id) ?? {}, typesChamps: types };
    if (evaluerCiblage(ciblage, fiche, { fuseau: 'America/Toronto' }).cible) total++;
  }
  return { total, lectures };
}

// ── B. En SQL : une seule requête ──
function sqlDe(ciblage: Ciblage | null): { sql: string; params: unknown[] } {
  const params: unknown[] = [org];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const regle = (r: NonNullable<Ciblage['exclure']>[number]): string => {
    if (r.type === 'etiquette') return `exists (select 1 from public.client_tags t where t.client_id = c.id and lower(t.tag) = lower(${p(r.valeur)}))`;
    if (r.type === 'fiche') {
      const col = r.cle === 'genre' ? `(case when coalesce(btrim(c.company), '') <> '' then 'entreprise' else 'particulier' end)` : `c.${r.cle}`;
      if (r.op === 'is') return `lower(coalesce(${col}, '')) = lower(${p(r.value)})`;
      if (r.op === 'is_not') return `lower(coalesce(${col}, '')) <> lower(${p(r.value)})`;
      if (r.op === 'is_empty') return `coalesce(btrim(${col}), '') = ''`;
      if (r.op === 'is_not_empty') return `coalesce(btrim(${col}), '') <> ''`;
      return `${r.op === 'contains' ? '' : 'not '}(lower(coalesce(${col}, '')) like '%' || lower(${p(r.value)}) || '%')`;
    }
    // Champ personnalisé : le moteur SQL existant (cf_filtrer_brut → cf_condition_sql).
    const { type: _t, ...condition } = r;
    return `c.id in (select public.cf_filtrer_brut($1, 'client', ${p(JSON.stringify([condition]))}::jsonb))`;
  };
  const inclure = ciblage?.inclure?.regles.length
    ? `(${ciblage.inclure.regles.map(regle).join(ciblage.inclure.mode === 'une' ? ' or ' : ' and ')})` : 'true';
  const exclure = (ciblage?.exclure ?? []).length ? `not (${ciblage!.exclure!.map(regle).join(' or ')})` : 'true';
  return {
    sql: `
      with cibles as (
        select c.id, c.phone, c.email from public.clients c
         where c.org_id = $1 and c.deleted_at is null and ${inclure} and ${exclure}
      )
      select count(*)::int as total,
             count(*) filter (where exists (select 1 from public.sms_opt_outs o where o.org_id = $1 and o.phone = public.normaliser_telephone(x.phone)))::int as stop_texto,
             count(*) filter (where exists (select 1 from public.email_unsubscribes u where u.org_id = $1 and lower(u.email) = lower(x.email) and u.category <> 'pending'))::int as desabonnes_courriel,
             count(*) filter (where coalesce(x.phone, '') = '')::int as sans_telephone,
             count(*) filter (where coalesce(x.email, '') = '')::int as sans_courriel
        from cibles x`,
    params,
  };
}

const mediane = (xs: number[]) => [...xs].sort((a, c) => a - c)[Math.floor(xs.length / 2)];
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await db.connect();
// `cf_filtrer_brut` exige un membre du bureau ou le rôle de service : on se présente comme le serveur.
await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);

const resultats: Array<Record<string, unknown>> = [];
for (const s of SCENARIOS) {
  const { sql, params } = sqlDe(s.ciblage);
  const tempsSql: number[] = [];
  let ligne: Record<string, number> = {};
  for (let i = 0; i < 15; i++) {
    const t0 = performance.now();
    ligne = (await db.query(sql, params)).rows[0];
    tempsSql.push(performance.now() - t0);
  }
  const tempsMemoire: number[] = [];
  let memoire = { total: -1, lectures: 0 };
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    memoire = await compterEnMemoire(s.ciblage);
    tempsMemoire.push(performance.now() - t0);
  }
  resultats.push({
    scenario: s.nom, touche: ligne.total, dont_stop_texto: ligne.stop_texto, dont_desabonnes_courriel: ligne.desabonnes_courriel,
    sql_ms_mediane: Math.round(mediane(tempsSql) * 10) / 10, sql_ms_max: Math.round(Math.max(...tempsSql) * 10) / 10,
    memoire_total: memoire.total, memoire_ms_mediane: Math.round(mediane(tempsMemoire)), memoire_lectures: memoire.lectures,
    concordent: memoire.total === ligne.total,
  });
}

// L'aperçu de la liste : les 20 premiers clients touchés (scénario 3), triés par nom.
const { sql: sqlApercu, params: paramsApercu } = sqlDe(SCENARIOS[2].ciblage);
const t0 = performance.now();
const apercu = await db.query(
  sqlApercu.replace(/select count\(\*\)::int as total[\s\S]*$/, 'select x.id from cibles x order by x.id limit 20'), paramsApercu);
const apercuMs = Math.round((performance.now() - t0) * 10) / 10;
await db.end();

const sortie = { org, clients: 5000, quand: new Date().toISOString(), resultats, apercu_20_lignes: { lignes: apercu.rowCount, ms: apercuMs } };
writeFileSync('D:/lume-final/sorties/e/mesure-compteur-ciblage.json', JSON.stringify(sortie, null, 2));
console.table(resultats.map((r) => ({ scénario: String(r.scenario).slice(0, 48), touche: r.touche, STOP: r.dont_stop_texto, désab: r.dont_desabonnes_courriel, 'SQL ms': r.sql_ms_mediane, 'mémoire ms': r.memoire_ms_mediane, lectures: r.memoire_lectures, concordent: r.concordent })));
console.log('aperçu (20 lignes) :', apercuMs, 'ms');
