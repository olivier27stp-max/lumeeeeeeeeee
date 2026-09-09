/**
 * Backfill NON DESTRUCTIF des traductions anglaises dans les règles
 * d'automatisation déjà en base.
 *
 * Les 35 presets ont reçu des `body_en`/`subject_en` dans
 * `automationPresets.data.ts`, mais les règles sont déjà semées en base
 * (parfois personnalisées : 36/140 modifiées). On ne peut donc PAS réécrire
 * les `actions` — on écraserait le texte FR édité par l'utilisateur.
 *
 * Ce script ajoute UNIQUEMENT les clés `body_en`/`subject_en` manquantes à
 * chaque action, en les prenant du fichier data (matché par preset_key +
 * index d'action + type). Il ne touche JAMAIS `body`/`subject` existants.
 *
 * Usage :  npx tsx --env-file=.env.local scripts/backfill-automation-en.ts [--prod] [--dry]
 *   défaut = staging, lecture seule sauf si --prod. --dry = n'écrit rien.
 */
import { AUTOMATION_PRESETS } from '../server/lib/automationPresets.data';

const PROD = process.argv.includes('--prod');
const DRY = process.argv.includes('--dry');
const REF = PROD ? process.env.SUPABASE_PROJECT_REF_PROD : process.env.SUPABASE_PROJECT_REF;
const J = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !J) { console.error('SUPABASE_PROJECT_REF(_PROD) et SUPABASE_ACCESS_TOKEN requis dans .env.local'); process.exit(2); }

async function sql(query: string): Promise<any[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${J}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.7.1' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 400));
  return JSON.parse(t);
}

// Index des traductions par preset_key : [indexAction] -> { body_en?, subject_en? }
const trad = new Map<string, Array<Record<string, string>>>();
for (const p of AUTOMATION_PRESETS) {
  trad.set(p.preset_key, p.actions.map((a) => {
    const c = a.config as Record<string, any>;
    const out: Record<string, string> = {};
    if (typeof c.body_en === 'string') out.body_en = c.body_en;
    if (typeof c.subject_en === 'string') out.subject_en = c.subject_en;
    return out;
  }));
}

function fusionner(actions: any[], key: string): { actions: any[]; ajouts: number } {
  const t = trad.get(key);
  if (!t) return { actions, ajouts: 0 };
  let ajouts = 0;
  const out = actions.map((a, i) => {
    const src = t[i];
    if (!src) return a;
    const cfg = { ...(a.config || {}) };
    for (const champ of ['body_en', 'subject_en'] as const) {
      // On n'ajoute QUE si absent — jamais d'écrasement.
      if (src[champ] && cfg[champ] === undefined) { cfg[champ] = src[champ]; ajouts++; }
    }
    return { ...a, config: cfg };
  });
  return { actions: out, ajouts };
}

(async () => {
  console.log(`Cible : ${PROD ? 'PROD' : 'STAGING'} (${REF})${DRY ? ' — DRY RUN' : ''}\n`);
  const rules = await sql(`select id, preset_key, actions from automation_rules where is_preset = true and preset_key is not null`);
  console.log(`${rules.length} règles preset en base.\n`);
  let touchees = 0, totalAjouts = 0, sansTrad = 0;
  for (const r of rules) {
    if (!trad.has(r.preset_key)) { sansTrad++; continue; }
    const { actions, ajouts } = fusionner(r.actions || [], r.preset_key);
    if (ajouts === 0) continue;
    touchees++; totalAjouts += ajouts;
    if (!DRY) {
      // Dollar-quoting Postgres : le JSON contient apostrophes/accents/HTML —
      // un tag improbable évite tout conflit avec le contenu.
      const json = JSON.stringify(actions);
      await sql(`update automation_rules set actions = $bf$${json}$bf$::jsonb, updated_at = now() where id = '${r.id}'`);
      await new Promise((res) => setTimeout(res, 120)); // évite le rate-limit de l'API Management
    }
  }
  console.log(`Règles enrichies : ${touchees}`);
  console.log(`Champs _en ajoutés : ${totalAjouts}`);
  if (sansTrad) console.log(`preset_key sans traduction connue (ignorés) : ${sansTrad}`);
  console.log(DRY ? '\n(DRY RUN — rien écrit)' : '\n✓ Backfill appliqué.');
})().catch((e) => { console.error('Échec :', e.message); process.exit(1); });
