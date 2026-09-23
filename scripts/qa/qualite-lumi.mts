/**
 * Qualité de Lumi — lecture seule, prod ou staging.
 *   npm run qa:qualite [-- --prod] [-- --jours 7]
 *
 * Pendant tout un chantier d'optimisation, j'ai mesuré le coût au centième
 * de cent et la qualité… pas du tout. Le seul contrôle était une batterie de
 * 80 questions lancée à la main (~2,30 $ la passe) et mon jugement sur des
 * réponses isolées.
 *
 * Or l'architecture produit déjà les meilleurs signaux, gratuitement :
 *
 *  1. TAUX D'ACCEPTATION DES CARTES. Chaque écriture est proposée puis
 *     confirmée ou annulée par un humain. C'est un jugement de qualité
 *     rendu par l'utilisateur lui-même, sur une action réelle — plus
 *     probant qu'une batterie synthétique. Un outil souvent annulé propose
 *     mal : mauvais client, mauvaise date, ou il n'aurait pas dû proposer.
 *
 *  2. MONTANTS SANS SOURCE. Le prompt exige que chaque chiffre vienne d'un
 *     résultat d'outil ; `verifier-chiffres.ts` le constate à chaque tour.
 *     Un montant cité qu'aucun outil ne justifie est une hallucination
 *     probable — le pire défaut possible dans un CRM.
 *
 *  3. SIGNAUX D'ÉCHEC. Refus du modèle, limite d'étapes atteinte, erreur
 *     d'outil : le tour n'a pas abouti, quoi qu'en dise le coût.
 *
 * Aucun appel au modèle : tout vient de `lumi_traces`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const prod = args.includes('--prod');
const jours = Number(args[args.indexOf('--jours') + 1]) || 7;

const url = prod ? process.env.SUPABASE_URL_PROD : process.env.VITE_SUPABASE_URL;
const cle = prod ? process.env.SUPABASE_SERVICE_ROLE_KEY_PROD : process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !cle) throw new Error(prod ? 'SUPABASE_URL_PROD / SUPABASE_SERVICE_ROLE_KEY_PROD manquants' : 'VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants');

const admin: SupabaseClient = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });
const depuis = new Date(Date.now() - jours * 86_400_000).toISOString();
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : '—');

type Ligne = {
  created_at: string; canal: string; origine: string | null; etage: number | null;
  action: string | null; outils: string[] | null; resultat: string | null;
  params: Record<string, any> | null; enonce_normalise: string | null; duree_ms: number | null;
};

const lignes: Ligne[] = [];
for (let page = 0; page < 30; page++) {
  const { data, error } = await admin.from('lumi_traces')
    .select('created_at, canal, origine, etage, action, outils, resultat, params, enonce_normalise, duree_ms')
    .gte('created_at', depuis).order('created_at', { ascending: false })
    .range(page * 1000, page * 1000 + 999);
  if (error) throw new Error(`lumi_traces: ${error.message}`);
  if (!data?.length) break;
  lignes.push(...(data as Ligne[]));
  if (data.length < 1000) break;
}

console.log(`\n═══ Qualité de Lumi · ${prod ? 'PRODUCTION' : 'staging'} · ${jours} derniers jours ═══\n`);
if (!lignes.length) { console.log('Aucun tour sur la période.\n'); process.exit(0); }

// ── 1. Le jugement de l'utilisateur ──────────────────────────────────
const cartes = lignes.filter((l) => l.origine === 'carte' && (l.action === 'confirm' || l.action === 'cancel'));
const confirmees = cartes.filter((l) => l.action === 'confirm').length;
console.log('1. ÉCRITURES PROPOSÉES — ce que l\'utilisateur a accepté');
if (!cartes.length) console.log('   aucune proposition sur la période.');
else {
  console.log(`   ${confirmees}/${cartes.length} confirmées — taux d'acceptation ${pct(confirmees, cartes.length)}`);
  const parOutil = new Map<string, { ok: number; non: number }>();
  for (const l of cartes) for (const o of l.outils ?? []) {
    const e = parOutil.get(o) ?? { ok: 0, non: 0 };
    if (l.action === 'confirm') e.ok++; else e.non++;
    parOutil.set(o, e);
  }
  const rangs = [...parOutil].filter(([, v]) => v.ok + v.non >= 3).sort((a, b) => (a[1].ok / (a[1].ok + a[1].non)) - (b[1].ok / (b[1].ok + b[1].non)));
  if (rangs.length) {
    console.log('\n   les moins bien accueillis (≥ 3 propositions) :');
    for (const [o, v] of rangs.slice(0, 8)) {
      const t = v.ok / (v.ok + v.non);
      console.log(`     ${String(Math.round(t * 100) + ' %').padStart(5)} (${v.ok}/${v.ok + v.non}) ${o}${t < 0.6 ? '   ← à regarder' : ''}`);
    }
  }
  const echecs = cartes.filter((l) => l.action === 'confirm' && l.resultat === 'erreur').length;
  if (echecs) console.log(`\n   ⚠ ${echecs} écriture(s) CONFIRMÉE(S) puis échouée(s) — l'utilisateur a dit oui et ça n'a pas marché.`);
}

// ── 2. Les chiffres ──────────────────────────────────────────────────
const suspects = lignes.filter((l) => Array.isArray(l.params?.chiffres_suspects) && l.params!.chiffres_suspects.length);
console.log('\n2. MONTANTS CITÉS SANS SOURCE');
if (!suspects.length) console.log('   aucun — chaque montant cité vient d\'un résultat d\'outil.');
else {
  console.log(`   ⚠ ${suspects.length} tour(s) sur ${lignes.filter((l) => l.etage === 6).length} passés au modèle :`);
  for (const l of suspects.slice(0, 10)) {
    console.log(`     ${l.created_at.slice(5, 16)} · ${(l.params!.chiffres_suspects as string[]).join(', ')} · « ${(l.enonce_normalise ?? '').slice(0, 40)} »`);
  }
}

// ── 3. Les tours qui n'ont pas abouti ────────────────────────────────
const agent = lignes.filter((l) => l.etage === 6);
const erreurs = agent.filter((l) => l.resultat === 'erreur');
const refus = agent.filter((l) => l.resultat === 'refus');
console.log('\n3. TOURS QUI N\'ONT PAS ABOUTI');
console.log(`   erreurs ${erreurs.length} · refus ${refus.length} · sur ${agent.length} tours au modèle`);

// ── 4. Ce qui n'a rien coûté ─────────────────────────────────────────
const gratuits = lignes.filter((l) => (l.etage ?? 6) < 6);
console.log('\n4. RÉPONDU SANS LE MODÈLE');
console.log(`   ${gratuits.length}/${lignes.length} tours (${pct(gratuits.length, lignes.length)})`);

// ── 5. Latence ───────────────────────────────────────────────────────
// Par CANAL, parce qu'ils ne se comparent pas : le bot de migration traite
// des fichiers en lot (47 s de médiane, personne n'attend devant un écran)
// tandis que le chat répond à quelqu'un. Les mélanger donnait un p90 de
// 50 s qui envoyait sur une fausse piste (2026-09-22).
console.log('\n5. LATENCE — par canal');
const parCanal = new Map<string, number[]>();
for (const l of agent) {
  if (!l.duree_ms) continue;
  const c = parCanal.get(l.canal) ?? [];
  c.push(l.duree_ms);
  parCanal.set(l.canal, c);
}
for (const [canal, dd] of [...parCanal].sort((a, b) => b[1].length - a[1].length)) {
  dd.sort((a, b) => a - b);
  const interactif = canal === 'lumi' || canal === 'support' || canal === 'public';
  console.log(
    `   ${canal.padEnd(12)} n=${String(dd.length).padStart(3)} · médiane ${String(dd[Math.floor(dd.length / 2)]).padStart(6)} ms`
    + ` · p90 ${String(dd[Math.floor(dd.length * 0.9)]).padStart(6)} ms${interactif ? '   ← quelqu\'un attend' : '   (traitement en lot)'}`,
  );
}
console.log('');
