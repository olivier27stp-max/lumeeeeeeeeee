// Passe prod, phase 4 : appareils × navigateurs sur lumecrm.net (bureau de test en bac à sable). LECTURE SEULE :
// on ouvre les écrans, on mesure (défilement horizontal, boutons recouverts ou hors écran, cibles trop petites
// au doigt, erreurs console / réseau), on capture. Rien n'est créé, modifié ni envoyé.
//   node --env-file=… prod/p7-matrice.mjs [nom-de-config]
import { writeFileSync } from 'node:fs';
import { ouvrir, capture, inventaire, admin, ORG } from '../nav-prod.mjs';

const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const CONFIGS = [
  { nom: 'bureau-chromium', navigateur: 'chromium', viewport: { width: 1440, height: 900 } },
  { nom: 'ipad-paysage', navigateur: 'webkit', viewport: { width: 1024, height: 768 }, tactile: true, userAgent: IPAD },
  { nom: 'ipad-portrait', navigateur: 'webkit', viewport: { width: 768, height: 1024 }, tactile: true, userAgent: IPAD },
  { nom: 'mobile-375', navigateur: 'webkit', viewport: { width: 375, height: 812 }, tactile: true, userAgent: IPHONE },
  { nom: 'firefox', navigateur: 'firefox', viewport: { width: 1440, height: 900 } },
  { nom: 'webkit-bureau', navigateur: 'webkit', viewport: { width: 1440, height: 900 } },
];
const seule = process.argv[2];

// Un parcours à étapes existant du bureau de test, pour ouvrir l'éditeur sur du contenu réel.
const { data: regles } = await admin.from('automation_rules').select('id, name, steps, is_preset').eq('org_id', ORG).is('deleted_at', null);
const parcours = (regles ?? []).filter((r) => Array.isArray(r.steps) && r.steps.length >= 4).sort((a, b) => b.steps.length - a.steps.length)[0];
console.log('éditeur ouvert sur :', parcours ? `${parcours.name} (${parcours.steps.length} étapes)` : 'AUCUN parcours à étapes');

const ECRANS = [
  { nom: 'liste', chemin: '/automations', pret: (p) => p.getByRole('button', { name: /^Actions pour / }).first() },
  { nom: 'apercu', chemin: '/automations/apercu', pret: (p) => p.getByRole('navigation', { name: 'Sections' }) },
  { nom: 'reglages', chemin: '/automations/reglages', pret: (p) => p.getByRole('heading', { name: /Réglages globaux/ }) },
  { nom: 'nouvelle', chemin: '/automations/nouvelle', pret: (p) => p.getByText('Décris ton automatisation à Lumi') },
  ...(parcours ? [{ nom: 'editeur', chemin: `/automations/${parcours.id}`, pret: (p) => p.getByRole('button', { name: /Aperçu/ }).first() }] : []),
];

const bilan = [];
for (const cfg of CONFIGS) {
  if (seule && cfg.nom !== seule) continue;
  let o;
  try { o = await ouvrir({ navigateur: cfg.navigateur, viewport: cfg.viewport, tactile: cfg.tactile, userAgent: cfg.userAgent, delai: 30_000 }); }
  catch (e) { console.log(`✗ ${cfg.nom} : ouverture impossible — ${String(e).split('\n')[0].slice(0, 200)}`); bilan.push({ config: cfg.nom, ecran: '(ouverture)', erreur: String(e).split('\n')[0] }); continue; }
  const { page, m } = o;
  for (const ecran of ECRANS) {
    const marque = m.marque();
    const ligne = { config: cfg.nom, ecran: ecran.nom };
    try {
      await page.goto(`https://lumecrm.net${ecran.chemin}`, { waitUntil: 'domcontentloaded' });
      const pret = await ecran.pret(page).waitFor({ timeout: 45_000 }).then(() => true, () => false);
      await o.temoins();
      await page.waitForTimeout(1200);
      const inv = await inventaire(page);
      const visibles = inv.elements.filter((e) => e.dansEcran && !e.desactive);
      ligne.pret = pret;
      ligne.url = page.url().replace('https://lumecrm.net', '');
      ligne.titre = (await page.locator('h1, h2').first().innerText().catch(() => '')).slice(0, 60);
      ligne.defilementX = inv.defilementX;
      ligne.elements = inv.elements.length;
      ligne.recouverts = visibles.filter((e) => e.couvert).map((e) => `${e.nom.slice(0, 40)} ← ${e.couvert}`).slice(0, 12);
      ligne.debordent = inv.elements.filter((e) => e.debordeX).map((e) => `${e.nom.slice(0, 40)} (x=${e.x}, l=${e.l})`).slice(0, 12);
      // Au doigt : une cible de moins de 32 px de côté se rate (Apple recommande 44).
      ligne.petites = cfg.tactile ? visibles.filter((e) => e.l < 32 || e.h < 32).filter((e) => !['input'].includes(e.tag) || e.type !== 'checkbox')
        .map((e) => `${e.nom.slice(0, 32) || e.tag} ${e.l}×${e.h}`).slice(0, 14) : [];
      ligne.sansNom = visibles.filter((e) => !e.nom && ['button', 'a'].includes(e.tag)).length;
      const d = m.depuis(marque);
      ligne.console = d.console.slice(0, 4); ligne.exceptions = d.exceptions.slice(0, 4);
      ligne.reseau = d.reseau.slice(0, 6); ligne.echecs = d.echecs.slice(0, 4);
      await capture(page, `p7-${cfg.nom}-${ecran.nom}`);
    } catch (e) {
      ligne.erreur = String(e).split('\n')[0].slice(0, 240);
      await capture(page, `p7-${cfg.nom}-${ecran.nom}-echec`);
    }
    bilan.push(ligne);
    const pb = [ligne.erreur ? `ERREUR ${ligne.erreur}` : null, ligne.pret === false ? 'écran pas prêt' : null, ligne.defilementX ? 'défilement horizontal' : null,
      ligne.recouverts?.length ? `${ligne.recouverts.length} recouvert(s)` : null, ligne.debordent?.length ? `${ligne.debordent.length} hors écran en X` : null,
      ligne.petites?.length ? `${ligne.petites.length} cible(s) < 32 px` : null, ligne.exceptions?.length ? `${ligne.exceptions.length} exception(s)` : null,
      ligne.console?.length ? `${ligne.console.length} erreur(s) console` : null, ligne.reseau?.length ? `${ligne.reseau.length} réponse(s) ≥ 400` : null].filter(Boolean);
    console.log(`${pb.length ? '⚠' : '✓'} ${cfg.nom} · ${ecran.nom} — ${ligne.url ?? ''} « ${ligne.titre ?? ''} »${pb.length ? ' : ' + pb.join(' ; ') : ''}`);
  }
  await o.fermer();
}
const sortie = `D:/lume-uiaudit/sorties/matrice-prod${seule ? '-' + seule : ''}.json`;
writeFileSync(sortie, JSON.stringify(bilan, null, 2));
console.log('détail :', sortie);
