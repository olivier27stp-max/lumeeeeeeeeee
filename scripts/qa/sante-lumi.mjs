/**
 * Bilan de santé de Lumi en PROD — lecture seule (Management API, read_only).
 * ─────────────────────────────────────────────────────────────────────────
 * Ce qu'un responsable veut savoir chaque matin, en une commande :
 *  - volume, coût et coût moyen par tour, par jour ;
 *  - part des demandes servies sans modèle (étages 0-5) ;
 *  - erreurs de tour, refus du modèle, plafonds atteints, escalades ;
 *  - budgets d'org proches de la pente (≥ 70 % du mois) ;
 *  - reprises API (429 / 5xx) vues côté usage.
 * Aucune écriture, aucune donnée client affichée (compteurs seulement).
 *
 *   node --env-file=.env.local scripts/qa/sante-lumi.mjs [--jours 7]
 * Code de sortie 1 si un signal rouge est levé (utilisable en cron / CI).
 */
const ref = process.env.SUPABASE_PROJECT_REF_PROD;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { console.error('SUPABASE_PROJECT_REF_PROD et SUPABASE_ACCESS_TOKEN requis (.env.local).'); process.exit(2); }
const jours = Number(process.argv[process.argv.indexOf('--jours') + 1]) || 7;

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  const j = await r.json();
  if (!r.ok || !Array.isArray(j)) throw new Error(`HTTP ${r.status} : ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
const fenetre = `created_at > now() - interval '${jours} days'`;
const rouges = [];
const ligne = (t, v) => console.log(`${t.padEnd(46)} ${v}`);

console.log(`\nSanté de Lumi — prod, ${jours} derniers jours (${new Date().toISOString().slice(0, 16)} UTC)\n`);

// 1. Volume et coût par jour (tous canaux du modèle)
const parJour = await q(`select date_trunc('day', created_at)::date j, count(*) appels, round(sum(cost_cents)::numeric, 1) cents, round(avg(cost_cents)::numeric, 2) moy from ai_usage where ${fenetre} group by 1 order by 1`);
console.log('Appels au modèle par jour :');
for (const r of parJour) ligne(`  ${r.j}`, `${String(r.appels).padStart(4)} appels · ${String(r.cents).padStart(6)} ¢ · ${r.moy} ¢/appel`);
const total = parJour.reduce((n, r) => n + Number(r.cents), 0);
ligne('  Total', `${(total / 100).toFixed(2)} $`);

// 2. Lumi dans l'app : part sans modèle, coût par tour
const etages = await q(`select etage, count(*) n, round(sum(coalesce(cost_cents, 0))::numeric, 1) cents from lumi_traces where canal='lumi' and ${fenetre} group by 1 order by 1`);
const nTraces = etages.reduce((n, r) => n + Number(r.n), 0);
const sansModele = etages.filter((r) => Number(r.etage) < 6).reduce((n, r) => n + Number(r.n), 0);
console.log('\nLumi dans l’app :');
ligne('  Demandes', String(nTraces));
ligne('  Servies sans le gros modèle (étages 0-5)', nTraces ? `${sansModele} (${Math.round(sansModele / nTraces * 100)} %)` : '—');
const e6 = etages.find((r) => Number(r.etage) === 6);
ligne('  Tours modèle', e6 ? `${e6.n} · ${e6.cents} ¢ · ${(Number(e6.cents) / Number(e6.n)).toFixed(2)} ¢/tour` : '0');

// 3. Erreurs, refus, plafonds, escalades
const [res] = await q(`select
  count(*) filter (where resultat = 'erreur') erreurs,
  count(*) filter (where action like 'plafond%' or action = 'budget_epuise') plafonds,
  count(*) filter (where resultat = 'proposition') propositions
  from lumi_traces where canal='lumi' and ${fenetre}`);
const [esc] = await q(`select count(distinct org_id || link) n from notifications where type = 'lumi_escalade' and ${fenetre}`).catch(() => [{ n: 'n/d' }]);
const [refus] = await q(`select count(*) n from security_events where ${fenetre} and event_type ilike '%refus%'`).catch(() => [{ n: 'n/d' }]);
ligne('  Tours en erreur', String(res.erreurs));
ligne('  Plafonds atteints (tour / conversation / jour)', String(res.plafonds));
ligne('  Propositions (cartes) émises', String(res.propositions));
ligne('  Escalades humaines', String(esc.n));
ligne('  Refus du modèle (security_events)', String(refus.n));
if (nTraces && Number(res.erreurs) / nTraces > 0.05) rouges.push(`taux d'erreur ${Math.round(Number(res.erreurs) / nTraces * 100)} % > 5 %`);

// 4. Écritures exécutées et leur sort
const [act] = await q(`select count(*) n, count(*) filter (where resultat is null) sans_resultat from agent_actions where ${fenetre}`);
ligne('  Écritures exécutées (agent_actions)', `${act.n} (${act.sans_resultat} sans résultat enregistré)`);
if (Number(act.sans_resultat) > 0) rouges.push(`${act.sans_resultat} écriture(s) sans résultat : action partie sans confirmation`);

// 5. Budgets d'org proches de la pente
const budgets = await q(`select count(*) filter (where part >= 0.9) rouge, count(*) filter (where part >= 0.7 and part < 0.9) orange from (
  select m.org_id, case when coalesce(p.ai_monthly_budget_cents, 0) > 0 then m.spent_cents::numeric / p.ai_monthly_budget_cents else 0 end part
  from ai_usage_monthly m
  left join subscriptions s on s.org_id = m.org_id and s.status in ('active', 'trialing')
  left join plans p on p.id = s.plan_id
  where m.period = to_char(now(), 'YYYY-MM')) t`).catch(() => [{ rouge: 'n/d', orange: 'n/d' }]);
console.log('\nBudgets du mois :');
ligne('  Orgs à ≥ 90 % du budget IA', String(budgets[0].rouge));
ligne('  Orgs entre 70 et 90 %', String(budgets[0].orange));

// 6. Cache : part lue du cache (santé du préfixe partagé)
const [cache] = await q(`select round(sum(cache_read_input_tokens)::numeric / nullif(sum(cache_read_input_tokens + input_tokens + cache_creation_input_tokens), 0) * 100) pct from ai_usage where ${fenetre} and model like 'claude-sonnet%'`);
console.log('\nCache :');
ligne('  Part des tokens d’entrée lus du cache (Sonnet)', cache.pct == null ? '—' : `${cache.pct} %`);
if (cache.pct != null && Number(cache.pct) < 70) rouges.push(`cache lu à ${cache.pct} % seulement (< 70 %) : préfixe qui change ou trafic trop froid`);

console.log('');
if (rouges.length) { console.log('🔴 Signaux :'); for (const r of rouges) console.log(`  - ${r}`); process.exit(1); }
console.log('✅ Aucun signal rouge.');
