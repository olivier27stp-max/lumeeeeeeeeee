/**
 * Essai de l'extraction par le routeur : des phrases NATURELLES (pas les motifs
 * stricts) doivent produire une carte bâtie par le code, à l'étage 5, pour le
 * seul coût du routeur (< 0,3 ¢). Les phrases à rédiger ou ambiguës doivent
 * rester au modèle (étage 6). Les cartes ne sont pas confirmées.
 *
 *   PORT=3012 node --env-file=.env.local --import tsx scripts/qa/essayer-extraction.mts
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

// [phrase, attendu] — 'carte5' = carte du code à l'étage 5 ; 'modele' = étage 6 (à rédiger, ambigu)
const CAS: Array<[string, 'carte5' | 'modele']> = [
  ['fais-moi une job chez Julie Fortin jeudi matin pour les vitres', 'carte5'],
  ['peux-tu me planifier une job pour Julie Fortin demain après-midi', 'carte5'],
  ['ajoute Linda Extraction comme cliente, son cell c’est 514-555-0188', 'carte5'],
  ['nouveau prospect, Marc Extraction, marc.extraction@example.com', 'carte5'],
  ['texte à Julie Fortin mot pour mot : on arrive dans 10 minutes', 'carte5'],
  ['mets une note sur la fiche de Julie Fortin, elle préfère les rendez-vous le matin', 'carte5'],
  ['rappelle-moi de commander du sel demain', 'carte5'],
  ['déplace la job 33 à lundi 13 h', 'carte5'],
  ['texte à Julie Fortin qu’on arrive dans 10 minutes', 'modele'],          // à rédiger
  ['fais une job chez Julie Fortin le 12 octobre', 'modele'],                 // date chiffrée
  ['crée une job chez Julie Fortin et texte-lui', 'modele'],                  // deux demandes
  ['ajoute Linda comme cliente', 'modele'],                                   // nom incomplet
];
// Échauffement : le premier appel après un redémarrage réécrit le cache du routeur (≈ 1,5 ¢ une fois) ; on ne le mesure pas.
await fetch(`${API}/api/lumi/chat`, { method: 'POST', headers: H, body: JSON.stringify({ message: 'chu tu occupé demain matin ?' }) }).then((r) => r.text());
await new Promise((r) => setTimeout(r, 2500));
let ok = 0;
for (const [message, attendu] of CAS) {
  await new Promise((r) => setTimeout(r, 2500));
  const r = await fetch(`${API}/api/lumi/chat`, { method: 'POST', headers: H, body: JSON.stringify({ message }) });
  const brut = await r.text();
  const evts = brut.split('\n').filter((x) => x.startsWith('data:')).map((x) => { try { return JSON.parse(x.slice(5)); } catch { return null; } }).filter(Boolean);
  const done = evts.find((e: any) => e.etage !== undefined) ?? {};
  const proposal = evts.find((e: any) => e.type === 'proposal');
  const texte = evts.filter((e: any) => e.type === 'text').map((e: any) => e.delta).join('');
  const etage = done.etage; const cout = Number(done.cost_cents ?? 0);
  // Un motif strict (étage 2, 0 ¢) qui passe avant l'extraction est encore mieux que l'extraction.
  const bon = attendu === 'carte5' ? ((etage === 5 || etage === 2) && !!proposal && cout < 0.3) : (etage === 6 || etage === undefined);
  if (bon) ok++;
  console.log(`${bon ? 'OK  ' : 'RATE'} ${message.padEnd(66)} étage ${etage ?? '?'} · ${(proposal ? 'carte' : 'texte').padEnd(5)} · ${cout.toFixed(2)} ¢ · ${proposal ? `${proposal.tool} ${JSON.stringify(proposal.args).slice(0, 70)}` : texte.replace(/\n/g, ' ').slice(0, 70)}`);
}
console.log(`\nTOTAL ${ok} / ${CAS.length}`);
process.exit(ok === CAS.length ? 0 : 1);
