/**
 * Où part l'argent des modèles — lecture seule, prod ou staging.
 *   node --env-file=.env.local --import tsx scripts/qa/depense-llm.mts [--prod] [--jours 7]
 *
 * Né de l'incident 2026-09-18 : 39,39 $ US brûlés en sept jours sur STAGING
 * pendant que la prod en coûtait 1,95 $, sans que rien ne le signale. Le coût
 * était pourtant en base (ai_usage, lumi_traces) — il n'existait simplement
 * aucune commande pour le regarder, et personne ne regarde une table.
 *
 * Deux sources, volontairement affichées côte à côte :
 *  - `ai_usage`    : une ligne par appel Anthropic, avec le coût calculé ;
 *  - `lumi_traces` : une ligne par TOUR, tous canaux (support, migration,
 *                    public, transcription), y compris ceux dont le tarif
 *                    n'est pas connu du code (Gemini) — leurs tokens sont
 *                    comptés, leur coût reste vide plutôt qu'inventé.
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
const usd = (cents: number) => `${(cents / 100).toFixed(2)} $`;

console.log(`\n═══ Dépense LLM · ${prod ? 'PRODUCTION' : 'staging'} · ${jours} derniers jours ═══\n`);

// ── ai_usage : appels Anthropic, coût connu ──
type LigneUsage = { created_at: string; model: string; cost_cents: number | string; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; conversation_id: string | null };
const lignes: LigneUsage[] = [];
for (let page = 0; page < 60; page++) {
  const { data, error } = await admin.from('ai_usage')
    .select('created_at, model, cost_cents, input_tokens, output_tokens, cache_read_input_tokens, conversation_id')
    .gte('created_at', depuis).order('created_at', { ascending: true })
    .range(page * 1000, page * 1000 + 999);
  if (error) throw new Error(`ai_usage: ${error.message}`);
  if (!data?.length) break;
  lignes.push(...(data as LigneUsage[]));
  if (data.length < 1000) break;
}

if (!lignes.length) console.log('ai_usage : aucun appel sur la période.');
else {
  const parJour = new Map<string, { n: number; cents: number }>();
  const parModele = new Map<string, { n: number; cents: number }>();
  const parConv = new Map<string, number>();
  let total = 0;
  for (const l of lignes) {
    const c = Number(l.cost_cents) || 0;
    total += c;
    const j = l.created_at.slice(0, 10);
    const dj = parJour.get(j) ?? { n: 0, cents: 0 }; dj.n++; dj.cents += c; parJour.set(j, dj);
    const dm = parModele.get(l.model) ?? { n: 0, cents: 0 }; dm.n++; dm.cents += c; parModele.set(l.model, dm);
    if (l.conversation_id) parConv.set(l.conversation_id, (parConv.get(l.conversation_id) ?? 0) + c);
  }
  console.log(`ai_usage · ${lignes.length} appels · ${usd(total)}\n`);
  console.log('  jour         appels      coût');
  for (const [j, d] of [...parJour].sort()) console.log(`  ${j}  ${String(d.n).padStart(8)}  ${usd(d.cents).padStart(9)}`);
  console.log('\n  modèle                        appels      coût');
  for (const [m, d] of [...parModele].sort((a, b) => b[1].cents - a[1].cents)) console.log(`  ${m.padEnd(28)}${String(d.n).padStart(6)}  ${usd(d.cents).padStart(9)}`);
  if (parConv.size) {
    const couts = [...parConv.values()].sort((a, b) => a - b);
    const q = (p: number) => couts[Math.floor(couts.length * p)] ?? 0;
    console.log(`\n  ${parConv.size} conversations · ${(lignes.length / parConv.size).toFixed(1)} appels/conv`);
    console.log(`  coût par conversation — médiane ${usd(q(0.5))} · p90 ${usd(q(0.9))} · max ${usd(couts[couts.length - 1])}`);
  }
}

// ── lumi_traces : tous les canaux, y compris sans tarif connu ──
const { data: traces, error: eTraces } = await admin.from('lumi_traces')
  .select('canal, model, cost_cents, etage').gte('created_at', depuis).limit(10000);
if (eTraces) console.log(`\nlumi_traces : illisible (${eTraces.message})`);
else if (!traces?.length) console.log('\nlumi_traces : aucun tour sur la période.');
else {
  const parCanal = new Map<string, { tours: number; cents: number; sansTarif: number }>();
  let total = 0; let sansModele = 0;
  for (const t of traces as Array<{ canal: string; model: string | null; cost_cents: number | string | null; etage: number | null }>) {
    const d = parCanal.get(t.canal) ?? { tours: 0, cents: 0, sansTarif: 0 };
    d.tours++;
    if (!t.model) sansModele++;
    if (t.cost_cents == null) { if (t.model) d.sansTarif++; } else { const c = Number(t.cost_cents) || 0; d.cents += c; total += c; }
    parCanal.set(t.canal, d);
  }
  console.log(`\nlumi_traces · ${traces.length} tours · ${usd(total)} chiffrés\n`);
  console.log('  canal            tours      coût   appels sans tarif connu');
  for (const [c, d] of [...parCanal].sort((a, b) => b[1].cents - a[1].cents)) {
    console.log(`  ${c.padEnd(14)}${String(d.tours).padStart(7)}  ${usd(d.cents).padStart(9)}${d.sansTarif ? String(d.sansTarif).padStart(10) + '  (Gemini : tokens comptés, prix absent de TARIFS)' : ''}`);
  }
  console.log(`\n  ${sansModele} tours servis sans appeler le modèle (raccourcis, caches) — ceux-là sont gratuits.`);
}

console.log('');
