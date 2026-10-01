// Vrai site, interface en ANGLAIS : sur les écrans de la section, aucun texte d'interface ne doit rester en français.
// LECTURE SEULE. La langue du COMPTE l'emporte sur la préférence locale : on la fixe dans les réponses d'auth
// (rien n'est écrit sur le compte de test).
import { ouvrir, capture } from './outils.mjs';

const o = await ouvrir({ langue: 'en' });
const { page, context } = o;
const enAnglais = (m) => ({ ...(m ?? {}), language: 'en' });
const relayer = async (route, retoucher) => {
  try {
    const r = await route.fetch({ timeout: 25_000 });
    const j = await r.json().catch(() => null);
    if (j && typeof j === 'object') retoucher(j);
    await route.fulfill({ response: r, json: j ?? {} });
  } catch { await route.continue().catch(() => undefined); }
};
await context.route('**/auth/v1/user**', (route) => (route.request().method() === 'GET'
  ? relayer(route, (j) => { j.user_metadata = enAnglais(j.user_metadata); }) : route.continue().catch(() => undefined)));
await context.route('**/auth/v1/token**', (route) => relayer(route, (j) => { if (j.user) j.user.user_metadata = enAnglais(j.user.user_metadata); }));

// Des mots qui n'existent qu'en français dans une interface (les NOMS des automatisations du bureau, eux,
// sont des données : on ne lit que hors du tableau et hors du canevas).
const FRANCAIS = /\b(Créer|Rechercher|Enregistr\w+|Annuler|Supprimer|Modifier|Ajouter|Brouillon|Publiée?s?|Corbeille|Réglages|Aucune?|Toutes|Étape|étapes?|Déclencheur|Fermer|Retour|Dossier|Nouveau|Nouvelle|Parcours|Journaux|Historique|Aperçu|Bibliothèque|Modèles|Filtres|Trier|Messages en|Tout arrêter|Vue d’ensemble|Automatisations?)\b/;
const hors = async (selecteursAExclure) => page.evaluate((exclus) => {
  const clone = document.body.cloneNode(true);
  for (const s of exclus) clone.querySelectorAll(s).forEach((n) => n.remove());
  return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ');
}, selecteursAExclure);

let ok = 0; let total = 0;
const verifier = async (nom, chemin, pret, exclus) => {
  total += 1;
  try {
    await page.goto(`https://lumecrm.net${chemin}`, { waitUntil: 'domcontentloaded' });
    await pret().waitFor({ timeout: 60_000 });
    await o.temoins();
    await page.waitForTimeout(1200);
    const texte = await hors(exclus);
    await capture(page, `p60-anglais-${nom}`);
    const restes = [...new Set([...texte.matchAll(new RegExp(FRANCAIS.source, 'g'))].map((m) => m[0]))];
    if (restes.length) throw new Error(`texte(s) resté(s) en français : ${restes.slice(0, 12).join(', ')}`);
    ok += 1; console.log(`✓ anglais-${nom} — aucun texte d’interface en français`);
  } catch (e) { console.log(`✗ anglais-${nom} : ${String(e).split('\n')[0].slice(0, 300)}`); }
};

try {
  // Hors du tableau (noms et sous-titres des automatisations = données) et hors du menu latéral de l'app.
  await verifier('liste', '/automations', () => page.getByRole('button', { name: /^Actions for / }).first(), ['tbody', 'aside', 'nav[aria-label="Main"]']);
  await verifier('vue-ensemble', '/automations/apercu', () => page.getByRole('navigation', { name: 'Sections' }), ['aside', 'table']);
  await verifier('reglages', '/automations/reglages', () => page.getByRole('heading', { name: /Global workflow settings/ }), ['aside']);
  await verifier('editeur-neuf', '/automations/nouvelle', () => page.getByRole('button', { name: /My automations/ }).first(), []);
} finally {
  await o.fermer();
  console.log(`BILAN : ${ok}/${total}`);
}
