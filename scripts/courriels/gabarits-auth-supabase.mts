/**
 * Les courriels que SUPABASE AUTH envoie lui-même (confirmation, changement
 * d'adresse, invitation, lien magique, code de réauthentification, mot de
 * passe) — rendus par le gabarit Lume, en français, au tutoiement.
 *
 * Jusqu'ici : les gabarits anglais par défaut (« Confirm Your Signup »,
 * « Confirm Reauthentication »), sans marque. Ces textes vivent dans la
 * configuration Auth du projet, pas dans une migration : ce script les pose.
 *
 *   node --env-file=.env.local --import tsx scripts/courriels/gabarits-auth-supabase.mts                 → aperçu (rien n'est écrit)
 *   node --env-file=.env.local --import tsx scripts/courriels/gabarits-auth-supabase.mts --appliquer      → staging
 *   node --env-file=.env.local --import tsx scripts/courriels/gabarits-auth-supabase.mts --appliquer --prod
 *
 * PRÉALABLE (constaté le 2026-09-30) : un SMTP personnalisé dans Auth →
 * SMTP Settings, sur les DEUX projets. Sans lui, Supabase refuse l'écriture
 * (« not available for free tier projects using the default email
 * provider », staging) et son service par défaut ne livre qu'aux membres de
 * l'équipe du projet (limite 2/h) : les clients ne recevaient donc pas ces
 * courriels. Poser les gabarits d'abord sur staging, puis la prod.
 *
 * Avant d'écrire, la configuration actuelle est sauvegardée dans
 * qa-captures/auth-gabarits-avant-<projet>.json (retour arrière possible).
 * Les variables Go de Supabase ({{ .ConfirmationURL }}, {{ .Token }}…) passent
 * telles quelles dans le gabarit.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { GABARITS_AUTH } from '../../server/lib/courriels/gabarits-auth';
import { ecartsObjet } from '../../server/lib/courriels/garde-envoi';

const PROD = 'bbzcuzqfgsdvjsymfwmr';
const STAGING = 'boylnjjlhexljmddmjyg';
const appliquer = process.argv.includes('--appliquer');
const projet = process.argv.includes('--prod') ? PROD : STAGING;

const GABARITS = GABARITS_AUTH;

for (const [cle, g] of Object.entries(GABARITS)) {
  const ecarts = ecartsObjet(g.sujet);
  if (ecarts.length) throw new Error(`${cle} : objet non conforme (${ecarts.join(', ')})`);
  console.log(`${cle.padEnd(17)} « ${g.sujet} » (${g.html.length} car.)`);
}
if (!appliquer) { console.log('\nAperçu seulement. --appliquer pour écrire (staging), --appliquer --prod pour la prod.'); process.exit(0); }

const jeton = process.env.SUPABASE_ACCESS_TOKEN;
if (!jeton) throw new Error('SUPABASE_ACCESS_TOKEN absent (.env.local)');
const url = `https://api.supabase.com/v1/projects/${projet}/config/auth`;
const entetes = { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' };

const avant = await (await fetch(url, { headers: entetes })).json() as Record<string, unknown>;
const sauvegarde: Record<string, unknown> = {};
for (const cle of Object.keys(GABARITS)) {
  sauvegarde[`mailer_subjects_${cle}`] = avant[`mailer_subjects_${cle}`];
  sauvegarde[`mailer_templates_${cle}_content`] = avant[`mailer_templates_${cle}_content`];
}
mkdirSync('qa-captures', { recursive: true });
writeFileSync(`qa-captures/auth-gabarits-avant-${projet}.json`, JSON.stringify(sauvegarde, null, 1));

const corps: Record<string, string> = {};
for (const [cle, g] of Object.entries(GABARITS)) {
  corps[`mailer_subjects_${cle}`] = g.sujet;
  corps[`mailer_templates_${cle}_content`] = g.html;
}
const r = await fetch(url, { method: 'PATCH', headers: entetes, body: JSON.stringify(corps) });
if (!r.ok) throw new Error(`PATCH ${r.status} : ${(await r.text()).slice(0, 300)}`);
const apres = await (await fetch(url, { headers: entetes })).json() as Record<string, unknown>;
const manquants = Object.entries(corps).filter(([k, v]) => apres[k] !== v).map(([k]) => k);
if (manquants.length) throw new Error(`relu différent après écriture : ${manquants.join(', ')}`);
console.log(`\n✓ ${Object.keys(GABARITS).length} gabarits posés et relus sur ${projet === PROD ? 'PROD' : 'staging'} (sauvegarde : qa-captures/auth-gabarits-avant-${projet}.json)`);
