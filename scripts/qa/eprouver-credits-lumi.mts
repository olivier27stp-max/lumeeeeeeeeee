/* ═══════════════════════════════════════════════════════════════
   CRÉDITS LUMI — épreuve en BASE (staging uniquement).

   Ce que les tests unitaires ne peuvent pas prouver, parce que c'est la
   base qui le garantit :
     · conversion ¢ → micro-crédits par le trigger ;
     · idempotence : même request_id = un seul débit ;
     · grand livre en ajout seul (UPDATE / DELETE directs refusés), mais la
       suppression EN CASCADE d'un bureau passe (fermeture, Loi 25) ;
     · concurrence : 50 réservations simultanées près de zéro ne dépassent
       jamais le plafond ;
     · période anniversaire (ancre au 31, fuseau du bureau) ;
     · le support ne consomme pas de crédits.

   Il crée un BUREAU JETABLE, puis le supprime : rien ne reste.
   Usage : npx tsx --env-file=.env.local scripts/qa/eprouver-credits-lumi.mts
   ═══════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.VITE_SUPABASE_URL!;
if (/bbzcuzqfgsdvjsymfwmr/.test(URL)) { console.error('REFUS : ce banc écrit — jamais sur la production.'); process.exit(1); }
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const resultats: Array<[string, boolean, string]> = [];
const verifier = (nom: string, ok: boolean, detail = '') => resultats.push([nom, ok, detail]);

const { data: plan } = await db.from('plans').select('id, lumi_credits_mensuels').eq('slug', 'autopilot').single();
const { data: membre } = await db.from('memberships').select('user_id').eq('status', 'active').limit(1).single();
const { data: groupe, error: eG } = await db.from('company_groups').insert({ name: '[QA-CREDITS] groupe jetable' }).select('id').single();
if (eG) throw eG;
const { data: org, error: eO } = await db.from('orgs').insert({ name: '[QA-CREDITS] bureau jetable', company_group_id: groupe!.id }).select('id').single();
if (eO) throw eO;
const ORG = org!.id;
let subId: string | null = null;

try {
  await db.from('company_settings').upsert({ org_id: ORG, timezone: 'America/Montreal' }, { onConflict: 'org_id' });
  const { data: sub, error: eS } = await db.from('subscriptions').insert({
    org_id: ORG, plan_id: plan!.id, status: 'active', user_id: membre!.user_id,
    current_period_start: '2026-08-31T16:00:00Z', current_period_end: '2027-08-31T16:00:00Z', interval: 'monthly',
  }).select('id').single();
  if (eS) throw eS;
  subId = sub!.id;

  // 1. Période anniversaire (ancre le 31) : fonction PURE, valeurs connues.
  const periode = async (a: string, fuseau = 'America/Montreal') =>
    String((await db.rpc('lumi_periode_debut_pour', { p_ancre: '2026-08-31T16:00:00Z', p_fuseau: fuseau, p_a: a })).data);
  const p1 = await periode('2026-09-30T15:00:00Z');   // septembre a 30 j : le 30 (ancre bornée)
  verifier('ancre 31 → le 30 septembre', p1.startsWith('2026-09-30'), p1);
  const p2 = await periode('2026-09-29T15:00:00Z');   // avant le 30 : période du 31 août
  verifier('avant le jour d’ancrage → période précédente (31 août)', p2.startsWith('2026-08-31'), p2);
  const p3 = await periode('2027-02-28T15:00:00Z');   // février : le 28
  verifier('février → le 28', p3.startsWith('2027-02-28'), p3);
  const p4 = await periode('2026-10-31T03:30:00Z');   // 23 h 30 le 30 oct. à Montréal : encore la période du 30 sept.
  verifier('fuseau : 23 h 30 la veille (Montréal) reste dans la période précédente', p4.startsWith('2026-09-30'), p4);
  const p5 = String((await db.rpc('lumi_periode_debut_pour', { p_ancre: null, p_fuseau: 'America/Montreal', p_a: '2026-09-15T15:00:00Z' })).data);
  verifier('sans abonnement → 1er du mois', p5.startsWith('2026-09-01'), p5);
  const renouv = String((await db.rpc('lumi_prochain_renouvellement', { p_org: ORG })).data);
  verifier('prochain renouvellement existe et est futur', new Date(renouv).getTime() > Date.now(), renouv);

  // 2. Conversion + idempotence
  const ligne = { org_id: ORG, model: 'claude-sonnet-5', source: 'lumi', cost_cents: 2990, request_id: 'qa-credits-1' };
  const i1 = await db.from('ai_usage').upsert(ligne, { onConflict: 'org_id,request_id', ignoreDuplicates: true });
  const i2 = await db.from('ai_usage').upsert(ligne, { onConflict: 'org_id,request_id', ignoreDuplicates: true });
  const i3 = await db.from('ai_usage').insert(ligne);
  const { data: lignes } = await db.from('ai_usage').select('id, credits_micro, taux_version').eq('org_id', ORG).eq('request_id', 'qa-credits-1');
  verifier('même request_id rejoué (upsert) = UNE ligne', !i1.error && !i2.error && (lignes ?? []).length === 1, `${(lignes ?? []).length} ligne(s)`);
  verifier('insertion directe du même request_id refusée (23505)', i3.error?.code === '23505', i3.error?.code ?? 'acceptée');
  verifier('2 990 ¢ → 996 666 667 micro-crédits (taux 2026-10)', Number(lignes?.[0]?.credits_micro) === 996_666_667 && lignes?.[0]?.taux_version === '2026-10', String(lignes?.[0]?.credits_micro));

  // 3. Le support ne compte pas
  await db.from('ai_usage').insert({ org_id: ORG, model: 'claude-sonnet-5', source: 'support', cost_cents: 500, request_id: 'qa-credits-support' });
  const { data: utilises } = await db.rpc('lumi_credits_utilises', { p_org: ORG });
  verifier('le support ne consomme pas de crédits', Number(utilises) === 996_666_667, String(utilises));

  // 4. Ajout seul
  const u = await db.from('ai_usage').update({ cost_cents: 0 }).eq('org_id', ORG).eq('request_id', 'qa-credits-1');
  verifier('UPDATE direct refusé', !!u.error && /ajout seulement/.test(u.error.message), u.error?.message ?? 'accepté');
  const d = await db.from('ai_usage').delete().eq('org_id', ORG).eq('request_id', 'qa-credits-1');
  verifier('DELETE direct refusé', !!d.error && /ajout seulement/.test(d.error.message), d.error?.message ?? 'accepté');

  // 5. Concurrence : 2 990 ¢ dépensés sur 3 000 (1 000 crédits) ; 50 réservations de 1 ¢ en même temps.
  const essais = await Promise.all(Array.from({ length: 50 }, () => db.rpc('reserve_ai_budget', { p_org: ORG, p_cents: 1, p_proactive: false })));
  const acceptees = essais.filter((r) => r.data && (r.data as { reservation_id?: string | null }).reservation_id).length;
  const refusees = essais.filter((r) => (r.data as { status?: string } | null)?.status === 'capped').length;
  const { data: resa } = await db.from('ai_reservations').select('cents').eq('org_id', ORG).is('settled_at', null);
  const reserve = (resa ?? []).reduce((n: number, r: { cents: number | string }) => n + Number(r.cents), 0);
  verifier('50 réservations simultanées : jamais au-delà du plafond', acceptees <= 10 && acceptees + refusees === 50 && 2990 + reserve <= 3000,
    `${acceptees} acceptées, ${refusees} refusées, ${reserve} ¢ réservés`);
} finally {
  // Ménage : abonnement (RESTRICT) puis bureau — ai_usage, réservations et réglages suivent en CASCADE.
  if (subId) await db.from('subscriptions').delete().eq('id', subId);
  const del = await db.from('orgs').delete().eq('id', ORG);
  verifier('suppression du bureau EN CASCADE passe malgré le grand livre', !del.error, del.error?.message ?? '');
  await db.from('company_groups').delete().eq('id', groupe!.id);
  const { count } = await db.from('ai_usage').select('id', { count: 'exact', head: true }).eq('org_id', ORG);
  verifier('rien ne reste (ai_usage du bureau jetable)', (count ?? 0) === 0, String(count));
}

for (const [nom, ok, detail] of resultats) console.log(`${ok ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
const ko = resultats.filter(([, ok]) => !ok).length;
console.log(`\n${resultats.length - ko}/${resultats.length} vérifications`);
process.exit(ko ? 1 : 0);
