// Relevé navigateur : pour chaque écran / onglet de la section, la liste des éléments interactifs
// visibles + ce que le moniteur a vu. Sert à recouper la carte tirée du code. Lecture seule.
import { writeFileSync } from 'node:fs';
import { ouvrir, inventaire, capture, admin, etat, SORTIES } from './nav.mjs';

const o = await ouvrir({});
const { page, base, m } = o;
const releve = [];
async function relever(nom) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(600);
  const inv = await inventaire(page);
  const cap = await capture(page, `releve-${nom}`, true);
  releve.push({ ecran: nom, ...inv, capture: cap });
  console.log(nom.padEnd(34), String(inv.elements.length).padStart(4), 'éléments', inv.defilementX ? '⚠ défilement horizontal' : '');
}
const aller = async (chemin) => { await page.goto(base + chemin, { waitUntil: 'domcontentloaded' }); };

await aller('/automations');
await page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 90_000 });
await relever('liste-toutes');
for (const onglet of ['À vérifier', 'Modèles', 'Corbeille']) {
  const b = page.getByRole('button', { name: new RegExp(`^${onglet}`) }).or(page.getByRole('tab', { name: new RegExp(`^${onglet}`) })).first();
  if (await b.count()) { await b.click(); await relever(`liste-${onglet}`); } else console.log('onglet introuvable :', onglet);
}
await aller('/automations/apercu'); await relever('apercu');
await aller('/automations/reglages'); await relever('reglages-globaux');
await aller('/automations/nouvelle'); await relever('editeur-nouvelle');

const { data: regles } = await admin.from('automation_rules').select('id, name, steps, is_active').eq('org_id', etat().orgA).is('deleted_at', null).order('name').limit(60);
const avecEtapes = regles?.find((r) => Array.isArray(r.steps) && r.steps.length > 1) ?? regles?.[0];
console.log('règle ouverte dans l’éditeur :', avecEtapes?.name, avecEtapes?.id);
if (avecEtapes) {
  await aller(`/automations/${avecEtapes.id}`); await relever('editeur-parcours');
  for (const onglet of ['Réglages', 'Historique', 'Journaux']) {
    const b = page.getByRole('button', { name: onglet, exact: true }).or(page.getByRole('tab', { name: onglet, exact: true })).first();
    if (await b.count()) { await b.click(); await relever(`editeur-${onglet}`); } else console.log('onglet introuvable :', onglet);
  }
}
writeFileSync(`${SORTIES}/releve-navigateur.json`, JSON.stringify({ releve, moniteur: { console: m.console, exceptions: m.exceptions, reseau: m.reseau, echecs: m.echecs } }, null, 1));
console.log('moniteur : console', m.console.length, '| exceptions', m.exceptions.length, '| réseau >=400', m.reseau.length, '| échecs', m.echecs.length);
for (const x of [...m.console, ...m.exceptions, ...m.reseau, ...m.echecs].slice(0, 12)) console.log('  ', JSON.stringify(x).slice(0, 300));
await o.fermer();
