/**
 * Aperçu des courriels (gabarit commun) — pour les voir avant qu'un client les voie.
 *
 *   node --env-file=.env.local --import tsx scripts/qa/apercu-courriels.mts                → qa-captures/courriel-*.png + .html
 *   node --env-file=.env.local --import tsx scripts/qa/apercu-courriels.mts --envoyer x@y  → les envoie aussi à x@y (Resend/SMTP local)
 *   --seulement mot / --sauf mot                                                       → un sous-ensemble (nom contenant / ne contenant pas le mot)
 *
 * Données d'exemple (entreprise « Vision Lavage », client « Rafba ») : aucune
 * base, aucune écriture. Les vrais envois (facture, soumission…) passent par
 * les routes ; ici on rend les mêmes gabarits avec les mêmes fonctions.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const envoyerA = (() => { const i = process.argv.indexOf('--envoyer'); return i >= 0 ? process.argv[i + 1] : null; })();
if (envoyerA) { delete process.env.SLACK_BOT_TOKEN; }

// Les exemples, une famille par fichier dans scripts/qa/courriels-exemples/ (chacun exporte EXEMPLES).
import { readdirSync } from 'node:fs';
interface Exemple { nom: string; sujet: string; html: string; de?: string }
const COURRIELS: Exemple[] = [];
const dossierExemples = resolve(dirname(fileURLToPath(import.meta.url)), 'courriels-exemples');
for (const f of readdirSync(dossierExemples).filter((x) => x.endsWith('.mts')).sort()) {
  const mod = await import(pathToFileURL(resolve(dossierExemples, f)).href) as { EXEMPLES?: Exemple[] };
  for (const e of mod.EXEMPLES || []) COURRIELS.push(e);
}
const seulement = (() => { const i = process.argv.indexOf('--seulement'); return i >= 0 ? process.argv[i + 1] : null; })();
const sauf = (() => { const i = process.argv.indexOf('--sauf'); return i >= 0 ? process.argv[i + 1] : null; })();
const RETENUS = COURRIELS.filter((c) => (!seulement || c.nom.includes(seulement)) && (!sauf || !c.nom.includes(sauf)));

const dossier = resolve('qa-captures');
mkdirSync(dossier, { recursive: true });
const b = await puppeteer.launch({ headless: true });
for (const c of RETENUS) {
  writeFileSync(resolve(dossier, `courriel-${c.nom}.html`), c.html);
  const p = await b.newPage();
  await p.setViewport({ width: 720, height: 900 });
  await p.setContent(c.html, { waitUntil: 'load' });
  await p.screenshot({ path: resolve(dossier, `courriel-${c.nom}.png`), fullPage: true });
  await p.close();
  console.log(`${c.nom} → qa-captures/courriel-${c.nom}.png (${c.html.length} car.)`);
}
await b.close();

if (envoyerA) {
  const { sendEmail } = await import('../../server/lib/mailer');
  for (const c of RETENUS) {
    const r = await sendEmail({ from: `${c.de || 'Vision Lavage'} <${process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] || process.env.SMTP_USER || 'noreply@lumecrm.net'}>`, to: envoyerA, subject: `[Aperçu] ${c.sujet}`, html: c.html });
    console.log(`envoyé : ${c.nom} → ${envoyerA} : ${r.sent ? 'ok' : r.error}`);
  }
}
