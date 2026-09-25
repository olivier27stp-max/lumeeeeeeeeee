#!/usr/bin/env node
/**
 * Le parcours d'un CLIENT FINAL sur les pages publiques — sans session,
 * exactement ce qu'il vit en cliquant le bouton de son courriel.
 *
 * Contre la PRODUCTION, avec des documents de test. Aucune écriture : le
 * script lit les pages et vérifie ce qui s'affiche.
 *
 * Ce qu'il prouve :
 *   1. ISOLATION — la facture d'une entreprise ne montre jamais le nom, la
 *      ville ou la couleur d'une autre. Deux tenants au branding opposé
 *      (orange/Sherbrooke contre bleu/Montréal) servent de révélateur.
 *   2. JETONS — un jeton inexistant ou malformé donne un message clair,
 *      jamais une page blanche ni une trace technique.
 *   3. MARQUE — la plateforme ne se nomme nulle part ; seule la pastille
 *      reste, sans texte ni lien.
 *   4. MOBILE — pas de débordement horizontal à 390 px.
 *
 *   npm run qa:parcours-client
 */
import puppeteer from 'puppeteer';

const TENANTS = {
  'Coquin lavage': {
    nom: 'Coquin lavage',
    ville: 'Wickham',
    rgb: 'rgb(222, 122, 27)', // #de7a1b
    url: 'https://lumecrm.net/invoice/76dd712b-e1ed-4391-9543-63270455a38d',
  },
  'Grok Audit': {
    nom: 'Grok Audit (TEST)',
    ville: 'Montréal',
    rgb: 'rgb(29, 78, 216)', // #1d4ed8
    url: 'https://lumecrm.net/invoice/be36dd89-b3e7-4616-a840-bdd243dd4180',
  },
};

let echecs = 0;
const verifier = (ok, libelle, detail = '') => {
  if (!ok) echecs++;
  console.log(`  ${ok ? 'OK   ' : 'ÉCHEC'} ${libelle}${detail ? ` — ${detail}` : ''}`);
};

const texte = (pg) => pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));

/** Les couleurs réellement appliquées par le navigateur, pas celles du CSS source. */
const couleurs = (pg) => pg.evaluate(() => {
  const out = [];
  for (const e of Array.from(document.querySelectorAll('*')).slice(0, 600)) {
    const s = getComputedStyle(e);
    out.push(s.color, s.backgroundColor, s.borderTopColor);
  }
  return out.join(' ');
});

const navigateur = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

// ── 1. Isolation ──
console.log('\n── Isolation entre entreprises');
for (const [cle, t] of Object.entries(TENANTS)) {
  const pg = await navigateur.newPage();
  await pg.setViewport({ width: 1200, height: 1000 });
  await pg.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 3500));
  const vu = await texte(pg);
  const style = await couleurs(pg);

  verifier(vu.includes(t.nom), `${cle} affiche son nom`);
  verifier(vu.includes(t.ville), `${cle} affiche sa ville`);
  verifier(style.includes(t.rgb), `${cle} porte sa couleur`, t.rgb);

  for (const [autreCle, autre] of Object.entries(TENANTS)) {
    if (autreCle === cle) continue;
    verifier(!vu.includes(autre.nom), `${cle} n'affiche PAS ${autre.nom}`);
    verifier(!vu.includes(autre.ville), `${cle} n'affiche PAS ${autre.ville}`);
    verifier(!style.includes(autre.rgb), `${cle} ne porte PAS la couleur de ${autreCle}`);
  }
  await pg.close();
}

// ── 2. Jetons ──
console.log('\n── Jetons invalides');
for (const [libelle, url] of [
  ['jeton inexistant', 'https://lumecrm.net/invoice/00000000-0000-4000-8000-000000000000'],
  ['jeton malformé', 'https://lumecrm.net/invoice/pas-un-uuid'],
  ['devis inexistant', 'https://lumecrm.net/quote/00000000-0000-4000-8000-000000000000'],
]) {
  const pg = await navigateur.newPage();
  await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 3000));
  const vu = await texte(pg);
  verifier(vu.trim().length > 20, `${libelle} : la page n'est pas vide`);
  verifier(/introuvable|not found|expir|invalide|invalid/i.test(vu), `${libelle} : message clair`);
  verifier(!/error:|stack|constraint|violates|undefined/i.test(vu), `${libelle} : aucune trace technique`);
  await pg.close();
}

// ── 3. La plateforme ne se nomme pas ──
console.log('\n── Marque de la plateforme');
for (const [cle, t] of Object.entries(TENANTS)) {
  const pg = await navigateur.newPage();
  await pg.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 3500));
  const vu = await texte(pg);
  verifier(!/powered by lume|propuls. par lume|g.n.r.. avec lume/i.test(vu), `${cle} : la plateforme ne se nomme pas`);
  const pastille = await pg.evaluate(() => document.querySelectorAll('img[src*="mascotte"]').length);
  verifier(pastille === 1, `${cle} : la pastille est présente`, `${pastille} trouvée(s)`);
  await pg.close();
}

// ── 4. Mobile ──
console.log('\n── Téléphone (390 px)');
for (const [cle, t] of Object.entries(TENANTS)) {
  const pg = await navigateur.newPage();
  await pg.setViewport({ width: 390, height: 844, isMobile: true });
  await pg.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 3500));
  const debordement = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  verifier(debordement <= 2, `${cle} : aucun défilement horizontal`, `${debordement} px`);
  await pg.close();
}

await navigateur.close();
console.log(`\n${echecs === 0 ? 'Tout passe.' : `${echecs} vérification(s) en échec.`}`);
process.exit(echecs === 0 ? 0 : 1);
