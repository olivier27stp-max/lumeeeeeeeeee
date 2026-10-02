// Passe prod, étape 3 : bâtir un parcours à la main (déclencheur, courriel, attente, tâche), enregistrer, relire.
import { ouvrir, capture, inventaire, admin, ORG, nettoyer } from '../nav-prod.mjs';

const MARQUE = '[QA-UI p3]';
const o = await ouvrir({});
const { page, m } = o;
const liste = async (zone) => (await inventaire(page, zone)).elements.filter((e) => e.dansEcran).map((e) => `${e.tag}${e.role ? `[${e.role}]` : ''}${e.type ? `(${e.type})` : ''}:${(e.nom || '(sans nom)').slice(0, 60)}${e.desactive ? ' (désactivé)' : ''}${e.couvert ? ` ⚠couvert:${e.couvert}` : ''}`);
const regle = async () => {
  const id = page.url().match(/automations\/([0-9a-f-]{36})/)?.[1];
  if (!id) return null;
  const { data } = await admin.from('automation_rules').select('id, name, trigger_event, conditions, is_active, steps, actions, settings').eq('org_id', ORG).eq('id', id).maybeSingle();
  return data;
};
const indicateur = () => page.locator('header').first().innerText().then((t) => t.replace(/\s+/g, ' ').slice(-60));
const etape = async (nom, f) => {
  const i = m.marque();
  try { await f(); } catch (e) { console.log(`✗ ${nom} : ${String(e).split('\n')[0].slice(0, 220)}`); await capture(page, `p3-echec-${nom}`); throw e; }
  const d = m.depuis(i);
  const pb = [...d.console, ...d.exceptions, ...d.reseau, ...d.echecs];
  console.log(`✓ ${nom}${pb.length ? ` — ⚠ ${pb.length} problème(s) : ${JSON.stringify(pb).slice(0, 300)}` : ''}`);
};
try {
  await page.goto('https://lumecrm.net/automations/nouvelle', { waitUntil: 'domcontentloaded' });
  await page.getByText('Décris ton automatisation à Lumi').waitFor({ timeout: 60_000 });
  await o.temoins();

  await etape('ouvrir le tiroir des déclencheurs', async () => {
    await page.getByRole('button', { name: /Choisir le déclencheur|Cliquer pour choisir un autre déclencheur/ }).click();
    await page.waitForTimeout(600);
    await capture(page, 'p3-01-tiroir-declencheurs');
    const t = await liste();
    console.log('  TIROIR :', t.filter((x) => !/^button:(Accueil|Clients|Demandes|Pipeline|Devis|Finances|Jobs|Calendrier|Lumi|Messages|Feuilles|Formations|Map|Classement|Commissions|Plus|Statistiques|Tâches|Mode sombre|Paramètres|Déconnexion|Réduire)/.test(x)).slice(0, 60).join(' | '));
  });
  await etape('choisir « Prospect créé »', async () => {
    const recherche = page.getByPlaceholder(/Rechercher/).last();
    if (await recherche.count()) await recherche.fill('prospect');
    await page.waitForTimeout(400);
    await capture(page, 'p3-02-recherche-prospect');
    await page.getByRole('button', { name: /Nouveau prospect|Prospect créé/ }).first().click();
    await page.waitForTimeout(1500);
    console.log('  indicateur :', await indicateur(), '| URL', page.url().replace('https://lumecrm.net', ''));
    const r = await regle();
    console.log('  en base :', r ? `${r.name} / ${r.trigger_event} / steps ${JSON.stringify(r.steps)} / actions ${JSON.stringify(r.actions)}` : 'RIEN');
    await capture(page, 'p3-03-apres-declencheur');
  });
  await etape('ajouter une première étape : tiroir des actions', async () => {
    await page.getByRole('button', { name: /Ajouter une première étape/ }).click();
    await page.waitForTimeout(600);
    await capture(page, 'p3-04-tiroir-actions');
    const t = await liste();
    console.log('  TIROIR :', t.filter((x) => !/^button:(Accueil|Clients|Demandes|Pipeline|Devis|Finances|Jobs|Calendrier|Lumi|Messages|Feuilles|Formations|Map|Classement|Commissions|Plus|Statistiques|Tâches|Mode sombre|Paramètres|Déconnexion|Réduire)/.test(x)).slice(0, 70).join(' | '));
  });
  await etape('choisir « Envoyer un courriel » et voir le panneau', async () => {
    await page.getByRole('button', { name: /^Envoyer un courriel/ }).first().click();
    await page.waitForTimeout(900);
    await capture(page, 'p3-05-panneau-courriel', true);
    const t = await liste();
    console.log('  PANNEAU :', t.filter((x) => /^(input|textarea|select)/.test(x) || /Enregistrer|Annuler|Supprimer|Fermer|Insérer|Prénom|Nom du|Total|Lien|Date/.test(x)).slice(0, 60).join(' | '));
  });
} catch (e) {
  await capture(page, 'p3-echec-final', true);
} finally {
  console.log('MONITEUR total : console', m.console.length, '| exceptions', m.exceptions.length, '| réseau >=400', m.reseau.length, '| échecs', m.echecs.length);
  const r = await regle().catch(() => null);
  if (r) { await admin.from('automation_rules').update({ name: `${MARQUE} ${r.name}` }).eq('id', r.id).eq('org_id', ORG); }
  await o.fermer();
  console.log('ménage :', await nettoyer(MARQUE), 'règle(s) retirée(s)');
}
