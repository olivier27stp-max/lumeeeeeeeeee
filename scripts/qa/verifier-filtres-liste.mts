/**
 * Parité des deux moteurs de filtres de champs personnalisés, sur staging :
 *   · SQL (cf_filtrer — pipeline, automatisations) ;
 *   · PostgREST (compilerFiltresListe — listes clients, jobs, devis).
 * Chaque opérateur de chaque famille, sur des valeurs variées (dont des
 * fiches SANS valeur). Les deux doivent renvoyer exactement les mêmes fiches.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa/verifier-filtres-liste.mts
 *
 * Crée des champs temporaires sur 8 clients de l'org du compte QA, puis les
 * retire (valeurs, options, champs). Staging seulement.
 */
import { createClient } from '@supabase/supabase-js';
import { compilerFiltresListe } from '../../src/lib/champs/filtresListe';
import type { ChampPerso } from '../../src/lib/champs/types';
import type { Condition } from '../../src/lib/champs/filtres';
import { heureMurale } from '../../src/lib/champs/filtres';

const url = process.env.VITE_SUPABASE_URL!;
if (!url.includes(process.env.SUPABASE_PROJECT_REF!) || url.includes(process.env.SUPABASE_PROJECT_REF_PROD!)) throw new Error('staging seulement');
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const TZ = 'America/Toronto';

// L'org de démonstration de staging (celle des captures) : QA_ORG pour en viser une autre.
const org = process.env.QA_ORG || ((await db.from('deals').select('org_id').eq('id', '23aa57ee-3ae3-4628-ab35-819215349765').single()).data!.org_id as string);
const { data: cl } = await db.from('clients').select('id').eq('org_id', org).is('deleted_at', null).limit(8);
const ids = (cl ?? []).map((c) => c.id as string);
if (ids.length < 6) throw new Error('pas assez de clients de test');

const cree: string[] = [];
async function champ(label: string, field_type: string, config: Record<string, unknown> = {}, options: string[] = []) {
  const { data, error } = await db.from('custom_fields').insert({ org_id: org, object_type: 'client', key: '', label, field_type, config }).select('*').single();
  if (error) throw error;
  cree.push(data.id);
  const opts = [];
  for (const [i, l] of options.entries()) {
    const { data: o } = await db.from('custom_field_options').insert({ org_id: org, field_id: data.id, label: l, position: i }).select('id, label, color, position, archived_at').single();
    opts.push(o);
  }
  return { ...data, options: opts } as ChampPerso;
}
const pose = async (f: ChampPerso, client: string, cols: Record<string, unknown>, multi?: string[]) => {
  const { data, error } = await db.from('custom_field_values').insert({ org_id: org, field_id: f.id, object_type: 'client', client_id: client, ...cols }).select('id').single();
  if (error) throw error;
  for (const o of multi ?? []) await db.from('custom_field_value_options').insert({ org_id: org, field_id: f.id, value_id: data.id, option_id: o });
};

const suffixe = Date.now().toString(36);
let ok = 0; const echecs: string[] = [];
try {
  const nb = await champ(`QA nombre ${suffixe}`, 'number');
  const txt = await champ(`QA texte ${suffixe}`, 'single_line');
  const tel = await champ(`QA tel ${suffixe}`, 'phone');
  const liste = await champ(`QA liste ${suffixe}`, 'dropdown_single', {}, ['Rouge', 'Bleu', 'Vert']);
  const multi = await champ(`QA multi ${suffixe}`, 'dropdown_multi', {}, ['A', 'B', 'C']);
  const date = await champ(`QA date ${suffixe}`, 'date');
  const ts = await champ(`QA ts ${suffixe}`, 'date', { include_time: true });
  const argent = await champ(`QA argent ${suffixe}`, 'monetary', { currency: 'CAD' });

  const auj = heureMurale(new Date(), TZ).slice(0, 10);
  const jour = (dec: number) => { const [a, mo, j] = auj.split('-').map(Number); return new Date(Date.UTC(a, mo - 1, j - dec)).toISOString().slice(0, 10); };
  // 0..5 remplis de façon variée, 6 et 7 vides partout.
  await pose(nb, ids[0], { value_number: 10 }); await pose(nb, ids[1], { value_number: 500 }); await pose(nb, ids[2], { value_number: -3 });
  await pose(txt, ids[0], { value_text: 'Asphalte neuf' }); await pose(txt, ids[1], { value_text: 'pavé uni' }); await pose(txt, ids[3], { value_text: '100% bio_x' });
  await pose(tel, ids[0], { value_text: '8195551234' }); await pose(tel, ids[4], { value_text: '+33612345678' });
  await pose(liste, ids[0], { value_option_id: liste.options[0].id }); await pose(liste, ids[1], { value_option_id: liste.options[1].id }); await pose(liste, ids[2], { value_option_id: liste.options[0].id });
  await pose(multi, ids[0], {}, [multi.options[0].id, multi.options[1].id]); await pose(multi, ids[1], {}, [multi.options[2].id]);
  await pose(date, ids[0], { value_date: auj }); await pose(date, ids[1], { value_date: jour(1) }); await pose(date, ids[2], { value_date: jour(10) }); await pose(date, ids[3], { value_date: jour(40) });
  await pose(ts, ids[0], { value_timestamp: new Date().toISOString() }); await pose(ts, ids[1], { value_timestamp: new Date(Date.now() - 3 * 86400e3).toISOString() }); await pose(ts, ids[2], { value_timestamp: new Date(Date.now() - 20 * 86400e3).toISOString() });
  await pose(argent, ids[0], { value_money_cents: 125000, value_currency: 'CAD' }); await pose(argent, ids[5], { value_money_cents: 900, value_currency: 'CAD' });

  const champs = [nb, txt, tel, liste, multi, date, ts, argent];
  const cas: Array<[string, Condition]> = [
    ['nombre =', { field_id: nb.id, op: 'eq', value: 10 }], ['nombre ≠', { field_id: nb.id, op: 'neq', value: 10 }],
    ['nombre >', { field_id: nb.id, op: 'gt', value: 0 }], ['nombre <', { field_id: nb.id, op: 'lt', value: 100 }],
    ['nombre entre', { field_id: nb.id, op: 'between', value: 600, value2: -5 }],
    ['nombre vide', { field_id: nb.id, op: 'is_empty' }], ['nombre pas vide', { field_id: nb.id, op: 'is_not_empty' }],
    ['texte est', { field_id: txt.id, op: 'is', value: '  ASPHALTE   neuf' }], ['texte n’est pas', { field_id: txt.id, op: 'is_not', value: 'asphalte neuf' }],
    ['texte contient', { field_id: txt.id, op: 'contains', value: 'Uni' }], ['texte ne contient pas', { field_id: txt.id, op: 'not_contains', value: 'a' }],
    ['texte contient %', { field_id: txt.id, op: 'contains', value: '%' }], ['texte contient _', { field_id: txt.id, op: 'contains', value: '_x' }],
    ['tél est (format libre)', { field_id: tel.id, op: 'is', value: '(819) 555-1234' }], ['tél contient', { field_id: tel.id, op: 'contains', value: '336' }],
    ['liste l’un de', { field_id: liste.id, op: 'any_of', value: [liste.options[0].id] }], ['liste aucun de', { field_id: liste.id, op: 'none_of', value: [liste.options[0].id] }],
    ['liste vide', { field_id: liste.id, op: 'is_empty' }],
    ['multi l’un de', { field_id: multi.id, op: 'any_of', value: [multi.options[1].id, multi.options[2].id] }],
    ['multi aucun de', { field_id: multi.id, op: 'none_of', value: [multi.options[0].id] }],
    ['date aujourd’hui', { field_id: date.id, op: 'today' }], ['date hier', { field_id: date.id, op: 'yesterday' }],
    ['date 7 derniers jours', { field_id: date.id, op: 'in_last', n: 7, unit: 'days' }], ['date > 1 semaine', { field_id: date.id, op: 'more_than_ago', n: 1, unit: 'weeks' }],
    ['date < 1 mois', { field_id: date.id, op: 'less_than_ago', n: 1, unit: 'months' }],
    ['date avant', { field_id: date.id, op: 'before', value: jour(5) }], ['date après', { field_id: date.id, op: 'after', value: jour(5) }],
    ['date entre', { field_id: date.id, op: 'between', value: jour(0), value2: jour(15) }],
    ['ts aujourd’hui', { field_id: ts.id, op: 'today' }], ['ts 7 derniers jours', { field_id: ts.id, op: 'in_last', n: 7, unit: 'days' }],
    ['ts > 7 jours', { field_id: ts.id, op: 'more_than_ago', n: 7, unit: 'days' }], ['ts entre', { field_id: ts.id, op: 'between', value: jour(5), value2: jour(0) }],
    ['ts avant', { field_id: ts.id, op: 'before', value: jour(2) }], ['ts après', { field_id: ts.id, op: 'after', value: jour(2) }],
    ['argent > 10 $', { field_id: argent.id, op: 'gt', value: 1000 }], ['argent vide', { field_id: argent.id, op: 'is_empty' }],
  ];
  // Combinaisons (ET) aussi.
  const combos: Array<[string, Condition[]]> = [
    ['nombre > 0 ET liste = Rouge', [cas[2][1], cas[15][1]]],
    ['texte vide ET date pas vide', [{ field_id: txt.id, op: 'is_empty' }, { field_id: date.id, op: 'is_not_empty' }]],
  ];
  for (const [nom, conds] of [...cas.map(([n, c]) => [n, [c]] as [string, Condition[]]), ...combos]) {
    const { data: sql, error: e1 } = await db.rpc('cf_filtrer_brut', { p_org: org, p_object: 'client', p_conditions: conds, p_ids: ids });
    if (e1) { echecs.push(`${nom} : SQL ${e1.message}`); continue; }
    const f = compilerFiltresListe(conds, champs, TZ);
    const { data: rest, error: e2 } = await f.appliquer(db.from('clients').select(`id${f.select}`).in('id', ids) as never) as unknown as { data: { id: string }[] | null; error: { message: string } | null };
    if (e2) { echecs.push(`${nom} : PostgREST ${e2.message}`); continue; }
    const a = [...(sql as string[])].sort().join(',');
    const b = (rest ?? []).map((r) => r.id).sort().join(',');
    if (a === b) ok++; else echecs.push(`${nom} : SQL [${(sql as string[]).length}] ≠ liste [${(rest ?? []).length}]`);
  }
} finally {
  if (cree.length) {
    await db.from('custom_field_values').delete().in('field_id', cree);
    await db.from('custom_field_options').delete().in('field_id', cree);
    await db.from('custom_fields').delete().in('id', cree);
  }
}
for (const e of echecs) console.log('ECHEC', e);
console.log(`${ok}/${ok + echecs.length} cas identiques entre le moteur SQL et le filtre de liste`);
process.exit(echecs.length ? 1 : 0);
