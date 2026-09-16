/**
 * Sondage de coût Lumi (audit A2) : rejoue 30 requêtes typiques contre l'API
 * locale (staging) et journalise l'usage réel renvoyé par l'API Anthropic
 * (entrée, cache écrit/lu, sortie) par requête, puis agrège par conversation.
 *
 *   PORT=3012 node --env-file=.env.local --import tsx server/index.ts
 *   node --env-file=.env.local --import tsx scripts/lumi-cost-probe.ts [--api http://localhost:3012] [--sortie fichier.json]
 *
 * Lecture seule côté code ; écrit des conversations dans la base de STAGING
 * (compte QA_COMPTE, défaut willhebert30@gmail.com). Chaque requête coûte de
 * l'argent réel : ne pas lancer contre la prod (refus si l'URL est la prod).
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { TARIFS } from '../server/lib/lumi/tarifs';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const API = arg('--api', process.env.QA_API_URL || 'http://localhost:3012').replace(/\/$/, '');
const SORTIE = arg('--sortie', 'lumi-cost-probe.json');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const url = process.env.VITE_SUPABASE_URL ?? '';
if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.VITE_SUPABASE_ANON_KEY) throw new Error('.env.local incomplet (VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY)');
if (process.env.SUPABASE_PROJECT_REF_PROD && url.includes(process.env.SUPABASE_PROJECT_REF_PROD)) throw new Error('Refus : VITE_SUPABASE_URL pointe sur la prod.');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(url, process.env.VITE_SUPABASE_ANON_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });

/** 30 requêtes typiques, groupées en conversations (un fil = une entrée ; chaque tour suit le précédent). */
const CONVERSATIONS: Array<{ id: string; tours: string[]; lang?: 'fr' | 'en' }> = [
  { id: 'retards', tours: ["Combien de factures en retard j'ai en ce moment ?", "C'est qui le pire ?", 'Ok relance-le poliment'] },
  { id: 'horaire', tours: ["C'est quoi mon horaire demain ?", 'Pis cette semaine ?'] },
  { id: 'client-360', tours: ['Parle-moi de mon client le plus récent', 'Il a-tu des factures pas payées ?'] },
  { id: 'creneau', tours: ['Trouve-moi un trou de 2 h jeudi prochain'] },
  { id: 'howto', tours: ['Comment je fais pour envoyer une facture à un client ?', 'Et pour la marquer payée ?'] },
  { id: 'brief', tours: ['Mon brief du matin'] },
  { id: 'soumissions', tours: ['Mes soumissions en attente', 'Laquelle traîne depuis le plus longtemps ?'] },
  { id: 'revenus', tours: ['Mes revenus ce mois-ci vs le mois passé', "Pourquoi c'est plus bas ?"] },
  { id: 'taches', tours: ['Crée une tâche : rappeler le fournisseur demain 9 h', 'Mes tâches en cours'] },
  { id: 'memoire', tours: ["Retiens que le lavage de vitres c'est toujours 80 $ minimum", "C'est quoi mon minimum pour les vitres ?"] },
  { id: 'joual', tours: ['chu tu occupé demain matin ?', 'faque tu peux tu me céduler un rappel vendredi ?'] },
  { id: 'ambigu', tours: ['Envoie-lui un texto', "À Tremblay, pour dire que j'arrive à 10 h"] },
  { id: 'equipe', tours: ['Où est mon équipe en ce moment ?', 'Les feuilles de temps de la semaine'] },
  { id: 'hors-scope', tours: ['Peux-tu me bâtir un site web ?'] },
  { id: 'english', lang: 'en', tours: ['How many jobs do I have this week?', 'Which ones are not invoiced yet?'] },
  { id: 'abonnement', tours: ['Mon paiement Lume a échoué, je fais quoi ?'] },
  { id: 'facturer', tours: ['Fais-moi la facture du dernier job terminé'] },
];

interface Appel { model: string; input: number; cache_5m: number; cache_1h: number; cache_lu: number; output: number; cost_cents: number }
interface Resultat { conversation: string; tour: number; message: string; etage: number | null; raccourci: string | null; appels: Appel[]; cost_cents: number; duree_ms: number; outils: string[]; proposition: boolean; texte: string; erreur: string | null; conversation_id: string | null }

async function session(email: string) {
  const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`lien magique : ${error.message}`);
  const { data: s, error: e2 } = await anon().auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`session : ${e2?.message}`);
  const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', s.session.user.id).eq('status', 'active').limit(1).maybeSingle();
  if (!m) throw new Error('aucune org pour ce compte');
  return { access_token: s.session.access_token, orgId: m.org_id as string };
}

async function demander(H: Record<string, string>, message: string, language: 'fr' | 'en', conversation_id: string | null): Promise<Resultat> {
  const debut = Date.now();
  const res = await fetch(`${API}/api/lumi/chat`, { method: 'POST', headers: H, body: JSON.stringify({ conversation_id, message, language }) });
  const brut = await res.text();
  const r: Resultat = { conversation: '', tour: 0, message, etage: null, raccourci: null, appels: [], cost_cents: 0, duree_ms: 0, outils: [], proposition: false, texte: '', erreur: null, conversation_id: null };
  if (!res.ok) { r.erreur = `${res.status} ${brut.slice(0, 200)}`; r.duree_ms = Date.now() - debut; return r; }
  for (const ev of brut.split('\n\n')) {
    const t = /event: (\w+)/.exec(ev)?.[1]; const d = /data: (.*)/.exec(ev)?.[1]; if (!t || !d) continue;
    let j: any; try { j = JSON.parse(d); } catch { continue; }
    if (t === 'text') r.texte += j.delta;
    else if (t === 'tool' && j.statut === 'debut') r.outils.push(j.name);
    else if (t === 'proposal') r.proposition = true;
    else if (t === 'usage') {
      const u = j.usage ?? {};
      const cc = u.cache_creation ?? null;
      r.appels.push({ model: j.model, input: u.input_tokens ?? 0, cache_5m: cc ? cc.ephemeral_5m_input_tokens : 0, cache_1h: cc ? cc.ephemeral_1h_input_tokens : (u.cache_creation_input_tokens ?? 0), cache_lu: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0, cost_cents: j.cost_cents ?? 0 });
    } else if (t === 'done') { r.cost_cents = j.cost_cents ?? 0; r.conversation_id = j.conversation_id; r.raccourci = j.raccourci ?? null; r.etage = j.etage ?? null; }
    else if (t === 'error') r.erreur = j.message;
  }
  r.duree_ms = Date.now() - debut;
  return r;
}

const p = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };
const moy = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

(async () => {
  const sante = await fetch(`${API}/api/health`).then((r) => r.json()).catch(() => null);
  if (!sante?.status) throw new Error(`API injoignable sur ${API}`);
  const s = await session(COMPTE);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}`, 'x-org-id': s.orgId };
  const resultats: Resultat[] = [];
  for (const c of CONVERSATIONS) {
    let conv: string | null = null;
    for (let i = 0; i < c.tours.length; i++) {
      const r = await demander(H, c.tours[i], c.lang ?? 'fr', conv);
      conv = r.conversation_id ?? conv;
      r.conversation = c.id; r.tour = i + 1;
      resultats.push(r);
      const tok = r.appels.reduce((a, x) => ({ in: a.in + x.input, cw: a.cw + x.cache_5m + x.cache_1h, cr: a.cr + x.cache_lu, out: a.out + x.output }), { in: 0, cw: 0, cr: 0, out: 0 });
      console.log(`${c.id.padEnd(12)} t${i + 1} étage=${r.etage ?? '?'} appels=${r.appels.length} in=${tok.in} cw=${tok.cw} cr=${tok.cr} out=${tok.out} ¢=${r.cost_cents.toFixed(2)} ${r.duree_ms} ms${r.erreur ? ' ERREUR ' + r.erreur : ''}${r.proposition ? ' [proposition]' : ''} outils=${r.outils.join(',') || '-'}`);
    }
  }
  const parConv = new Map<string, number>();
  for (const r of resultats) parConv.set(r.conversation, (parConv.get(r.conversation) ?? 0) + r.cost_cents);
  const couts = [...parConv.values()];
  const parTour = resultats.map((r) => r.cost_cents);
  const appels = resultats.flatMap((r) => r.appels);
  const somme = (k: keyof Appel) => appels.reduce((a, x) => a + (x[k] as number), 0);
  const t = TARIFS['claude-sonnet-5'];
  const postes = {
    entree_fraiche: somme('input') * t.input / 1e4, cache_ecrit_1h: somme('cache_1h') * t.cacheWrite / 1e4,
    cache_ecrit_5m: somme('cache_5m') * t.input * 1.25 / 1e4, cache_lu: somme('cache_lu') * t.cacheRead / 1e4, sortie: somme('output') * t.output / 1e4,
  };
  const etages = resultats.reduce<Record<string, number>>((a, r) => { const k = String(r.etage ?? '?'); a[k] = (a[k] ?? 0) + 1; return a; }, {});
  const synthese = {
    date: new Date().toISOString(), api: API, compte: COMPTE, requetes: resultats.length, conversations: parConv.size,
    appels_modele: appels.length, appels_par_requete: appels.length / resultats.length,
    cout_par_tour_cents: { moyen: moy(parTour), p95: p(parTour, 0.95), max: Math.max(...parTour) },
    cout_par_conversation_cents: { moyen: moy(couts), p95: p(couts, 0.95), max: Math.max(...couts) },
    repartition_cents: postes, etages,
    latence_ms: { moyenne: moy(resultats.map((r) => r.duree_ms)), p95: p(resultats.map((r) => r.duree_ms), 0.95) },
    projection_cad_par_client_mois: Object.fromEntries([['leger_20', 20], ['moyen_150', 150], ['lourd_600', 600]].map(([k, n]) => [k, +((moy(couts) * (n as number)) / 100 * 1.36).toFixed(2)])),
    note: 'projection = coût moyen par conversation (USD) × conversations/mois × 1,36 CAD/USD',
  };
  writeFileSync(SORTIE, JSON.stringify({ synthese, resultats }, null, 2));
  console.log('\n' + JSON.stringify(synthese, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
