/**
 * Rapport de coût du support — lisible à tout moment, chiffres mesurés (lumi_traces, canal 'support').
 *
 *   node --env-file=.env.local --import tsx scripts/qa/rapport-couts-support.mts            (staging, 30 jours)
 *   node --env-file=.env.local --import tsx scripts/qa/rapport-couts-support.mts -- --prod   (prod, lecture seule via l'API de gestion)
 *   … --jours 7
 *
 * Par jour : questions, sans modèle (étage 0 réponses fixes, étage 4 cache), au modèle (étage 6), coût en ¢ et en $.
 * Puis les 10 entreprises qui coûtent le plus et les 10 questions au modèle les plus fréquentes (à transformer en réponses fixes).
 */
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const prod = args.includes('--prod');
const jours = Number(args[args.indexOf('--jours') + 1]) || 30;
const depuis = new Date(Date.now() - jours * 86_400_000).toISOString();

type Ligne = { created_at: string; org_id: string | null; etage: number | null; action: string | null; enonce_normalise: string | null; cost_cents: number | null; resultat: string | null };

async function lignes(): Promise<Ligne[]> {
  const sql = `select created_at, org_id, etage, action, enonce_normalise, cost_cents, resultat from public.lumi_traces where canal = 'support' and created_at >= '${depuis}' order by created_at`;
  if (prod) {
    const token = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_PROJECT_REF_PROD;
    if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF_PROD manquants');
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql, read_only: true }) });
    const j = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
    return j as Ligne[];
  }
  const admin = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await admin.from('lumi_traces').select('created_at, org_id, etage, action, enonce_normalise, cost_cents, resultat').eq('canal', 'support').gte('created_at', depuis).order('created_at').limit(50_000);
  if (error) throw error;
  return (data ?? []) as Ligne[];
}

const L = await lignes();
console.log(`Support — ${prod ? 'PROD' : 'staging'} — ${jours} derniers jours — ${L.length} question${L.length > 1 ? 's' : ''}\n`);
const parJour = new Map<string, { n: number; sans: number; modele: number; cout: number }>();
for (const l of L) {
  const j = l.created_at.slice(0, 10);
  const e = parJour.get(j) ?? { n: 0, sans: 0, modele: 0, cout: 0 };
  e.n += 1;
  if (l.etage === 6) e.modele += 1; else e.sans += 1;
  e.cout += Number(l.cost_cents ?? 0);
  parJour.set(j, e);
}
console.log('jour        questions  sans modèle  au modèle   coût');
for (const [j, e] of [...parJour.entries()].sort()) console.log(`${j}  ${String(e.n).padStart(9)}  ${String(e.sans).padStart(11)}  ${String(e.modele).padStart(9)}   ${e.cout.toFixed(1).padStart(6)} ¢`);
const total = [...parJour.values()].reduce((a, e) => ({ n: a.n + e.n, sans: a.sans + e.sans, modele: a.modele + e.modele, cout: a.cout + e.cout }), { n: 0, sans: 0, modele: 0, cout: 0 });
console.log(`\nTotal : ${total.n} questions, ${total.sans} sans modèle (${total.n ? Math.round(100 * total.sans / total.n) : 0} %), ${total.modele} au modèle, ${total.cout.toFixed(1)} ¢ = ${(total.cout / 100).toFixed(2)} $`);
if (total.modele) console.log(`Coût moyen d'une réponse du modèle : ${(total.cout / total.modele).toFixed(2)} ¢ ; par question toutes confondues : ${(total.cout / total.n).toFixed(2)} ¢`);

const parOrg = new Map<string, { n: number; cout: number }>();
for (const l of L) { const k = l.org_id ?? '(sans org)'; const e = parOrg.get(k) ?? { n: 0, cout: 0 }; e.n += 1; e.cout += Number(l.cost_cents ?? 0); parOrg.set(k, e); }
console.log('\nEntreprises qui coûtent le plus :');
for (const [org, e] of [...parOrg.entries()].sort((a, b) => b[1].cout - a[1].cout).slice(0, 10)) console.log(`  ${org}  ${e.n} questions  ${e.cout.toFixed(1)} ¢`);

const freq = new Map<string, number>();
for (const l of L) if (l.etage === 6 && l.enonce_normalise) freq.set(l.enonce_normalise, (freq.get(l.enonce_normalise) ?? 0) + 1);
const repetees = [...freq.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 10);
if (repetees.length) {
  console.log('\nQuestions au modèle qui reviennent (candidates à une réponse fixe, 0 ¢) :');
  for (const [q, n] of repetees) console.log(`  ${n}×  ${q.slice(0, 100)}`);
}
const transferts = L.filter((l) => l.resultat === 'proposition').length;
console.log(`\nTransferts à l'équipe : ${transferts} (${total.n ? Math.round(100 * transferts / total.n) : 0} % des questions)`);
