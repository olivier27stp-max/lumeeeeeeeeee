/**
 * Lecture RÉELLE des outils de lecture ajoutés le 2026-10-01, sur STAGING (org QA), avec
 * l'identité et la RLS d'un vrai compte — le pendant de executer-outils-staging.mts pour les
 * lectures. Un outil qui cite une colonne inexistante ou une route absente échoue ici, pas en prod.
 * Refuse la prod. API locale requise (PORT, défaut 3012). Aucune écriture, aucun envoi.
 *
 *   PORT=3012 node --env-file=.env.local --import tsx scripts/qa/lire-outils-lots.mts
 */
import { createClient } from '@supabase/supabase-js';

process.env.PORT = process.env.PORT || '3012';
const url = process.env.VITE_SUPABASE_URL ?? '';
if (process.env.SUPABASE_PROJECT_REF_PROD && url.includes(process.env.SUPABASE_PROJECT_REF_PROD)) throw new Error('Refus : la prod.');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const sansSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', sansSession);
const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
if (error) throw new Error(`lien magique : ${error.message}`);
const { data: s, error: e2 } = await createClient(url, process.env.VITE_SUPABASE_ANON_KEY ?? '', sansSession).auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
if (e2 || !s.session) throw new Error(`session : ${e2?.message}`);
const userId = s.session.user.id;
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle();
if (!m) throw new Error('aucune org');
const client = createClient(url, process.env.VITE_SUPABASE_ANON_KEY ?? '', { ...sansSession, global: { headers: { Authorization: `Bearer ${s.session.access_token}` } } });
const ctx = { client, orgId: m.org_id as string, userId, accessToken: s.session.access_token };
const { AGENT_TOOLS } = await import('../../server/lib/agent/tools');

const jour = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const periode = { from: jour(-90), to: jour(0) };
const { data: unClient } = await client.from('clients').select('id').eq('org_id', ctx.orgId).is('deleted_at', null).limit(1).maybeSingle();

const LECTURES: Array<[string, Record<string, unknown> | null]> = [
  ['get_client_consent', unClient ? { client_id: unClient.id } : null],
  ['list_archived', {}],
  ['get_payroll_amounts', {}],
  ['get_payroll_history', { user_id: userId }],
  ['list_time_entries', { from: jour(-30), to: jour(0) }],
  ['list_commissions', {}],
  ['get_team_schedule', { date: jour(1) }],
  // Une semaine en un appel, avec les visites de jobs par équipe (2026-10-02).
  ['get_team_schedule', { date: jour(-7), date_to: jour(6) }],
  ['get_taxes_collected', periode],
  ['list_automation_templates', { language: 'fr' }],
  ['get_quote_win_rate', periode],
  ['get_payment_methods_breakdown', periode],
  ['get_team_performance', periode],
  // Sans période : le mois en cours, élargi aux 12 derniers mois quand il est encore vide (2026-10-02).
  ['get_quote_win_rate', {}],
  ['get_payment_methods_breakdown', {}],
  ['get_team_performance', {}],
  ['list_stripe_payouts', periode],
];

let erreurs = 0;
for (const [nom, args] of LECTURES) {
  const outil = AGENT_TOOLS.find((t) => t.declaration.name === nom);
  if (!outil?.handler) { console.log(`  ABSENT ${nom}`); erreurs += 1; continue; }
  if (!args) { console.log(`  ?    ${nom} (aucune fiche pour l'essayer)`); continue; }
  try {
    const r = await outil.handler(args, ctx as never);
    if (r && typeof r === 'object' && 'error' in r) throw new Error(String((r as { error: unknown }).error));
    const taille = JSON.stringify(r).length;
    // Un résultat au-delà de 20 000 caractères est tronqué avant d'aller au modèle (compress.ts) : le signaler ici.
    console.log(`  OK   ${nom.padEnd(30)} ${String(taille).padStart(6)} car.${taille > 20_000 ? ' (> 20 000 : sera tronqué)' : ''}  ${JSON.stringify(r).slice(0, Number(process.env.QA_APERCU) || 130)}`);
  } catch (err) {
    erreurs += 1;
    console.log(`  ERR  ${nom.padEnd(30)} ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\nTOTAL ${LECTURES.length - erreurs} ok · ${erreurs} erreur / ${LECTURES.length}`);
process.exit(erreurs ? 1 : 0);
