/**
 * Ce que « qu'est-ce que tu as fait récemment ? » rend pour les actions de Lumi sur les
 * automatisations : le handler de `get_recent_agent_actions`, appelé tel quel (aucun modèle).
 *
 *   QA_AUTO_SUFFIXE=a npx tsx --env-file=.env.local scripts/qa/finale/a/journal-actions.mts
 *
 * À lancer après une passe de jouer-conversations.mts (le journal est celui du bureau A (a)).
 */
import { createClient } from '@supabase/supabase-js';
import { admin, bureauA, COMPTES, session, URL_SUPABASE } from './outils.mts';

const b = await bureauA();
const s = await session(COMPTES.proprioA.email);
const client = createClient(URL_SUPABASE, process.env.VITE_SUPABASE_ANON_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${s.access_token}` } } });
const { AGENT_TOOLS } = await import('../../../../server/lib/agent/tools');
const outil = AGENT_TOOLS.find((x) => x.declaration.name === 'get_recent_agent_actions');
const rendu = await outil!.handler!({}, { client, orgId: b.orgA, userId: b.users.proprioA, accessToken: s.access_token } as never) as { actions?: Array<Record<string, unknown>> };
const { data: brut } = await admin.from('agent_actions').select('outil, created_at').eq('org_id', b.orgA).order('created_at', { ascending: false }).limit(20);
console.log('── lignes agent_actions (brut) :', (brut ?? []).map((a) => a.outil).join(', '));
console.log('── ce que Lumi reçoit :');
console.log(JSON.stringify(rendu.actions ?? rendu, null, 1));
process.exit(0);
