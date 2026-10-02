// Passe prod, étape 2 : créer une automatisation de zéro, comme un utilisateur. Bureau de test, bac à sable.
import { ouvrir, capture, inventaire, admin, ORG, nettoyer } from '../nav-prod.mjs';

const MARQUE = '[QA-UI p2]';
const o = await ouvrir({});
const { page, m } = o;
const visibles = async (filtre = () => true) => (await inventaire(page)).elements.filter((e) => e.dansEcran && filtre(e)).map((e) => `${e.tag}${e.role ? `[${e.role}]` : ''}:${(e.nom || '(sans nom)').slice(0, 50)}${e.desactive ? ' (désactivé)' : ''}${e.couvert ? ` ⚠couvert par ${e.couvert}` : ''}`);
const enBase = async () => {
  const depuis = new Date(Date.now() - 20 * 60_000).toISOString();
  const { data } = await admin.from('automation_rules').select('id, name, trigger_event, is_active, steps, actions, created_at').eq('org_id', ORG).gte('created_at', depuis).is('deleted_at', null).order('created_at', { ascending: false });
  return data ?? [];
};
const etat = async (quoi) => {
  const indicateur = await page.locator('header, body').first().evaluate(() => {
    const t = [...document.querySelectorAll('span, p, div')].map((e) => (e.childElementCount === 0 ? e.textContent?.trim() : '')).filter((x) => /^(Enregistré|Enregistrement…|Modifié|Non enregistré|Enregistrement|Saved|Erreur.*)$/.test(x || ''));
    return [...new Set(t)].join(' / ');
  });
  const lignes = await enBase();
  console.log(`[${quoi}] indicateur : « ${indicateur} » | URL : ${page.url().replace('https://lumecrm.net', '')} | en base (20 min) : ${lignes.length} ${lignes.slice(0, 2).map((r) => `${r.name} / ${r.trigger_event} / ${Array.isArray(r.steps) ? r.steps.length : 0} étape(s)`).join(' ; ')}`);
};
try {
  const avant = (await enBase()).length;
  await page.goto('https://lumecrm.net/automations', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 60_000 });
  await o.temoins();
  await page.getByRole('button', { name: /^Créer/ }).click();
  await page.getByRole('menuitem', { name: /Partir de zéro/ }).click();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(1500);
  await capture(page, 'p2-01-nouvelle');
  await etat('ouverture');
  console.log('règles en base avant / après ouverture :', avant, '/', (await enBase()).length);
  console.log('ÉLÉMENTS :\n  ' + (await visibles((e) => e.x > 240 || e.y < 100)).join('\n  '));
  console.log('TEXTE DU CANEVAS :', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 600));
} catch (e) {
  console.log('ÉCHEC :', String(e).slice(0, 400));
  await capture(page, 'p2-echec', true);
} finally {
  console.log('MONITEUR : console', m.console.length, '| exceptions', m.exceptions.length, '| réseau >=400', m.reseau.length, '| échecs', m.echecs.length);
  for (const x of [...m.console, ...m.exceptions, ...m.reseau, ...m.echecs].slice(0, 10)) console.log('  ', JSON.stringify(x).slice(0, 260));
  await o.fermer();
  console.log('ménage :', await nettoyer(MARQUE), 'règle(s) marquée(s) retirée(s)');
}
