/**
 * Détourer les logos déjà en base (2026-09-22).
 *
 * Le détourage automatique n'agit qu'au téléversement : les logos déposés
 * avant gardent leur fond blanc, qui dessine un rectangle sur le ciel des
 * courriels. Ce script repasse sur les existants.
 *
 *   node --env-file=.env.local scripts/qa/detourer-logos-existants.mjs            → liste, ne touche à rien
 *   node --env-file=.env.local scripts/qa/detourer-logos-existants.mjs --appliquer → détoure et remplace
 *   ... --prod                                                                    → cible la production
 *
 * Prudence : le fichier d'origine n'est JAMAIS supprimé. Le logo détouré est
 * déposé à côté (suffixe `-detoure.png`) et `company_settings.logo_url` pointe
 * dessus. Revenir en arrière = remettre l'ancienne URL.
 */
import { createClient } from '@supabase/supabase-js';
import { detourerLogo } from '../../server/lib/images/detourer-logo.ts';

const APPLIQUER = process.argv.includes('--appliquer');
const PROD = process.argv.includes('--prod');

const url = PROD ? process.env.SUPABASE_URL_PROD : process.env.VITE_SUPABASE_URL;
const cle = PROD ? process.env.SUPABASE_SERVICE_ROLE_KEY_PROD : process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !cle) {
  console.error(PROD
    ? 'SUPABASE_URL_PROD et SUPABASE_SERVICE_ROLE_KEY_PROD requis dans .env.local'
    : 'VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env.local');
  process.exit(1);
}

const db = createClient(url, cle, { auth: { persistSession: false } });
console.log(`Cible : ${PROD ? 'PRODUCTION' : 'staging'} — ${APPLIQUER ? 'APPLIQUE' : 'lecture seule'}\n`);

const { data: orgs, error } = await db
  .from('company_settings')
  .select('org_id, company_name, logo_url')
  .not('logo_url', 'is', null);
if (error) { console.error('Lecture impossible :', error.message); process.exit(1); }

let traites = 0, detoures = 0, ignores = 0;

for (const org of orgs ?? []) {
  const nom = org.company_name || org.org_id.slice(0, 8);
  // Le chemin dans le bucket, extrait de l'URL publique.
  const m = /\/company-logos\/(.+)$/.exec(String(org.logo_url));
  if (!m) { console.log(`— ${nom} : logo hors du bucket, ignoré`); ignores++; continue; }
  const chemin = decodeURIComponent(m[1].split('?')[0]);

  traites++;
  const { data: blob, error: eDl } = await db.storage.from('company-logos').download(chemin);
  if (eDl || !blob) { console.log(`— ${nom} : téléchargement impossible (${eDl?.message ?? 'vide'})`); ignores++; continue; }

  const entree = Buffer.from(await blob.arrayBuffer());
  const type = blob.type || 'image/png';
  const r = detourerLogo(entree, type);

  if (!r.detoure) { console.log(`— ${nom} : laissé tel quel (${r.raison})`); ignores++; continue; }

  const ko = (n) => Math.round(n / 1024);
  console.log(`✓ ${nom} : ${ko(entree.length)} ko ${type} → ${ko(r.buffer.length)} ko png détouré`);
  detoures++;

  if (!APPLIQUER) continue;

  // Nouveau fichier À CÔTÉ de l'original : on ne détruit rien.
  const cible = `${chemin.replace(/\.[a-z0-9]+$/i, '')}-detoure.png`;
  const { error: eUp } = await db.storage
    .from('company-logos')
    .upload(cible, r.buffer, { contentType: 'image/png', upsert: true, cacheControl: '3600' });
  if (eUp) { console.log(`  ⚠ dépôt impossible : ${eUp.message}`); continue; }

  const { data: pub } = db.storage.from('company-logos').getPublicUrl(cible);
  const { error: eMaj } = await db
    .from('company_settings')
    .update({ logo_url: pub.publicUrl })
    .eq('org_id', org.org_id);
  if (eMaj) { console.log(`  ⚠ mise à jour impossible : ${eMaj.message}`); continue; }
  console.log(`  → logo_url mis à jour`);
}

console.log(`\n${traites} logo(s) examiné(s) · ${detoures} détourable(s) · ${ignores} laissé(s) tel(s) quel(s)`);
if (detoures > 0 && !APPLIQUER) console.log('Relancer avec --appliquer pour remplacer.');
