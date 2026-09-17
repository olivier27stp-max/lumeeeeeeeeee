/**
 * Essai des actions directes contre l'API locale (staging) : chaque phrase doit
 * être servie à l'étage 2 (0 ¢) avec le bon genre (texte, exécution, carte).
 * Les cartes ne sont PAS confirmées ; les écritures directes (pointage, pause)
 * s'exécutent vraiment sur le compte QA. 0 $ de modèle attendu.
 *
 *   PORT=3012 node --env-file=.env.local --import tsx scripts/qa/essayer-directes.mts
 */
import { createClient } from '@supabase/supabase-js';

const API = process.env.QA_API_URL || 'http://localhost:3012';
const url = process.env.VITE_SUPABASE_URL ?? '';
if (process.env.SUPABASE_PROJECT_REF_PROD && url.includes(process.env.SUPABASE_PROJECT_REF_PROD)) throw new Error('Refus : la prod.');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });
const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email: process.env.QA_COMPTE || 'willhebert30@gmail.com' });
if (!l?.properties?.hashed_token) throw new Error('lien magique');
const { data: s } = await anon.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', s!.session!.user.id).eq('status', 'active').limit(1).maybeSingle();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${s!.session!.access_token}`, 'x-org-id': m!.org_id as string };

const CAS: Array<[string, 'texte' | 'carte' | 'execution']> = [
  ['Pointe-moi', 'execution'], ['Je pars en pause', 'execution'], ['Je reviens de pause', 'execution'], ['Dépointe-moi', 'execution'],
  ['Retiens que le test des actions directes a tourné.', 'execution'],
  ['C’est quoi mes taxes ?', 'texte'], ['mes modèles de soumission', 'texte'], ['mes équipes', 'texte'], ['mes automatisations', 'texte'],
  ['mes relances automatiques', 'texte'], ['mes formations', 'texte'], ['mes factures récurrentes', 'texte'], ['mes heures cette semaine', 'texte'],
  ['la fiche de Fortin', 'texte'], ['le job 33', 'texte'],
  ['Marque le job 33 terminé', 'carte'], ['Assigne le job 33 à Antoine', 'carte'], ['Ajoute une note sur le job 33 : test des actions directes', 'carte'],
  ['Envoie la facture INV-000006', 'carte'], ['Invite exec.direct@example.com comme technicien', 'carte'],
  ['Crée une tâche : vérifier les actions directes demain', 'carte'], ['Désactive l’automatisation Rappel', 'carte'],
];
let ok = 0;
for (const [message, attendu] of CAS) {
  const r = await fetch(`${API}/api/lumi/chat`, { method: 'POST', headers: H, body: JSON.stringify({ message }) });
  const brut = await r.text();
  const evts = brut.split('\n').filter((x) => x.startsWith('data:')).map((x) => { try { return JSON.parse(x.slice(5)); } catch { return null; } }).filter(Boolean);
  const done = evts.find((e: any) => e.etage !== undefined || e.cost_cents !== undefined) ?? {};
  const texte = evts.filter((e: any) => e.type === 'text').map((e: any) => e.delta).join('');
  const proposal = evts.find((e: any) => e.type === 'proposal');
  const executed = evts.find((e: any) => e.type === 'executed');
  const genre = proposal ? 'carte' : executed ? 'execution' : 'texte';
  const etage = done.etage; const cout = Number(done.cost_cents ?? 0);
  const bon = etage === 2 && genre === attendu && cout === 0;
  if (bon) ok++;
  // Une carte préparée par le code se confirme exactement comme une carte du modèle (/lumi/execute).
  if (bon && proposal && message.startsWith('Crée une tâche')) {
    const ex = await fetch(`${API}/api/lumi/execute`, { method: 'POST', headers: H, body: JSON.stringify({ conversation_id: done.conversation_id, tool_use_id: proposal.tool_use_id, decision: 'confirm' }) });
    // La confirmation répond en SSE : un événement « executed » par écriture, puis le reçu en texte.
    const flux = await ex.text();
    const ev = flux.split('\n').filter((x) => x.startsWith('data:')).map((x) => { try { return JSON.parse(x.slice(5)); } catch { return null; } }).filter(Boolean);
    const recus = ev.filter((e: any) => e.type === 'executed' || (e.tool_use_id && typeof e.ok === 'boolean'));
    const reussi = ex.ok && recus.length > 0 && recus.every((e: any) => e.ok);
    const recu = ev.filter((e: any) => e.type === 'text').map((e: any) => e.delta).join('').replace(/\n/g, ' ').slice(0, 80);
    console.log(`${reussi ? 'OK  ' : 'RATE'} ${'→ confirmation de la carte (tâche créée)'.padEnd(58)} HTTP ${ex.status} · ${recu || flux.slice(0, 80)}`);
    if (!reussi) ok--;
  }
  console.log(`${bon ? 'OK  ' : 'RATE'} ${message.padEnd(58)} étage ${etage ?? '?'} · ${genre.padEnd(9)} · ${cout} ¢ · ${(proposal ? `${proposal.tool} ${JSON.stringify(proposal.args).slice(0, 60)}` : texte.replace(/\n/g, ' ').slice(0, 70))}`);
}
console.log(`\nTOTAL ${ok} / ${CAS.length} servis à 0 ¢ par le code`);
process.exit(ok === CAS.length ? 0 : 1);
