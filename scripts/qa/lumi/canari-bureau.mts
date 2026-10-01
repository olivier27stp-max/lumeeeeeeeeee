/**
 * Canari des envois d'un bureau de test de la PRODUCTION.
 * ─────────────────────────────────────────────────────────────────────────
 * Depuis un compte du bureau, un courriel et un texto sont envoyés par les
 * VRAIES routes de l'app (https://lumecrm.net). Rien ne doit partir : on vérifie
 * que c'est le PREMIER filet (l'entreprise, `orgs_envois_simules`) qui les
 * arrête — une ligne `envois_simules` par canal avec `meta.raison = 'entreprise'`.
 *
 * Les destinataires sont fictifs (@lume-qa.test, 555-01xx) : si le premier filet
 * ratait, le second (le destinataire) retiendrait l'envoi quand même, et la
 * raison lue serait « destinataire » — le canari le dirait sans que rien ne parte.
 *
 *   node --env-file=C:/Users/Rafba/lumeeeeeeeeee/.env.local --import tsx scripts/qa/lumi/canari-bureau.mts --org <id> --compte <courriel d'un propriétaire du bureau>
 *
 * Refuse un bureau dont le nom ne dit pas QA, TEST ou « banc », ou qui n'est pas
 * au bac à sable. Aucun appel à Lumi, aucun modèle. Sortie : un JSON ; code 0
 * seulement si les deux envois ont été arrêtés par le filet « entreprise ».
 */
import { createClient } from '@supabase/supabase-js';

const arg = (k: string): string => { const i = process.argv.indexOf(k); const v = i > -1 ? process.argv[i + 1] : undefined; return v && !v.startsWith('--') ? v : ''; };
const ORG = arg('--org');
const COMPTE = arg('--compte');
const BASE = (arg('--api') || 'https://lumecrm.net').replace(/\/$/, '');
if (!ORG || !COMPTE) throw new Error('--org <id> et --compte <courriel> requis.');

const URL_PROD = process.env.SUPABASE_URL_PROD ?? '';
const CLE = process.env.SUPABASE_SERVICE_ROLE_KEY_PROD ?? '';
if (!URL_PROD || !CLE) throw new Error('SUPABASE_URL_PROD et SUPABASE_SERVICE_ROLE_KEY_PROD requis (--env-file=…/.env.local).');
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
// Deux clients : celui qui fait verifyOtp agit ensuite comme l'utilisateur et perd les droits serveur.
const admin = createClient(URL_PROD, CLE, opts);
const session = createClient(URL_PROD, CLE, opts);

const DEST_COURRIEL = 'canari@lume-qa.test';
const DEST_TEXTO = '+15145550142';
const res: Record<string, unknown> = { org: ORG, compte: COMPTE, api: BASE, debut: new Date().toISOString() };
const finir = (code: number): never => { console.log(JSON.stringify(res, null, 1)); process.exit(code); };

const { data: org } = await admin.from('orgs').select('name').eq('id', ORG).maybeSingle();
res.bureau = org?.name ?? null;
if (!org || !/\b(QA|TEST)\b|\bbanc\b/i.test(String(org.name))) { res.arret = 'bureau introuvable ou sans nom de bureau de test : canari non lancé'; finir(1); }
const { data: bac } = await admin.from('orgs_envois_simules').select('mode, raison, created_at').eq('org_id', ORG).maybeSingle();
res.bacASable = bac;
if (!bac) { res.arret = 'bureau hors bac à sable : canari non lancé'; finir(1); }

const { data: lien, error: eLien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
if (eLien || !lien?.properties?.hashed_token) throw new Error(`lien magique : ${eLien?.message}`);
const { data: s, error: eSession } = await session.auth.verifyOtp({ type: 'magiclink', token_hash: lien.properties.hashed_token });
if (eSession || !s.session) throw new Error(`session : ${eSession?.message}`);
const { data: adhesion } = await admin.from('memberships').select('role, status').eq('org_id', ORG).eq('user_id', s.session.user.id).maybeSingle();
if (!adhesion || adhesion.status !== 'active') { res.arret = `${COMPTE} n’est pas membre actif de ce bureau : canari non lancé`; await admin.auth.admin.signOut(s.session.access_token, 'local').catch(() => {}); finir(1); }

const entetes = { Authorization: `Bearer ${s.session.access_token}`, 'Content-Type': 'application/json', 'x-org-id': ORG };
const poster = async (chemin: string, corps: Record<string, unknown>): Promise<{ statut: number; corps: string }> => {
  const r = await fetch(BASE + chemin, { method: 'POST', headers: entetes, body: JSON.stringify(corps) });
  let j: unknown = null;
  try { j = await r.json(); } catch { /* corps non JSON */ }
  return { statut: r.status, corps: JSON.stringify(j).slice(0, 260) };
};
const marque = `CANARI-${Date.now()}`;
type Simule = { canal: string; destinataire: string; sujet: string | null; corps: string | null; meta: { raison?: string; mode?: string } | null };
let simules: Simule[] = [];
try {
  res.courriel = await poster('/api/communications/send-email', { to: DEST_COURRIEL, subject: `[${marque}] aucun envoi réel`, body: 'Canari du bureau de test : ce message ne doit jamais partir.' });
  res.texto = await poster('/api/messages/send', { phone_number: DEST_TEXTO, message_text: `[${marque}] aucun envoi réel` });
  await new Promise((ok) => setTimeout(ok, 2500));
  const { data: sim } = await admin.from('envois_simules').select('canal, destinataire, sujet, corps, meta').eq('org_id', ORG).gte('created_at', res.debut as string).order('created_at');
  simules = ((sim ?? []) as Simule[]).filter((e) => `${e.sujet ?? ''} ${e.corps ?? ''}`.includes(marque));
  res.envoisSimules = simules.map((e) => ({ canal: e.canal, destinataire: e.destinataire, raison: e.meta?.raison ?? null, mode: e.meta?.mode ?? null }));
  // Ce que l'app a noté de ces deux envois : un identifiant de fournisseur réel ici voudrait dire qu'un envoi est parti.
  const { data: textos } = await admin.from('messages').select('phone_number, status, provider_message_id').eq('org_id', ORG).gte('created_at', res.debut as string);
  res.textosNotes = textos ?? [];
  const { data: livraisons } = await admin.from('email_deliveries').select('to_email, status, provider, message_id').eq('org_id', ORG).gte('created_at', res.debut as string);
  res.livraisonsCourriel = livraisons ?? [];
} finally {
  // Portée locale : la portée globale fermerait les sessions des autres agents sur ce compte.
  await admin.auth.admin.signOut(s.session.access_token, 'local').catch(() => {});
}
const arrete = (canal: string, destinataire: string): boolean => simules.some((e) => e.canal === canal && e.destinataire === destinataire && e.meta?.raison === 'entreprise');
const textoReel = ((res.textosNotes as Array<{ provider_message_id: string | null }>) ?? []).some((t) => t.provider_message_id && !String(t.provider_message_id).startsWith('SM_SIMULE_'));
const ok = arrete('courriel', DEST_COURRIEL) && arrete('sms', DEST_TEXTO) && simules.every((e) => e.meta?.raison === 'entreprise') && !textoReel;
res.verdict = ok ? 'OK : les deux envois arrêtés par le filet ENTREPRISE, rien n’est parti' : 'À EXAMINER';
finir(ok ? 0 : 1);
