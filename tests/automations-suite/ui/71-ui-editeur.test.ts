/**
 * Page Automatisations — l'ÉDITEUR plein écran : créer depuis zéro, modifier
 * (déclencheur, réglages du déclencheur, action, texte, attente, condition,
 * réglages de la règle), publier / dépublier, validations, états de
 * chargement et d'erreur.
 *
 * La règle d'or : CE QUI EST SAUVEGARDÉ = EXACTEMENT CE QUI EST AFFICHÉ. Après
 * chaque geste, la ligne `automation_rules` (service_role) est comparée à ce
 * que l'écran montre, puis la page est rechargée et l'écran recomparé.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import type { Locator } from '@playwright/test';
import {
  admin, attendreToast, avecCapture, confirmerDialogue, creerRegle, fermerNavigateur, lireRegle, marqueUi,
  nettoyer, ouvrirOnglet, reglesParNom, voir, type LigneRegle, type Onglet,
} from '../harnais/navigateur';

const ORG = () => inject('uiOrgA');
const MARQUE = marqueUi('editeur');

let o: Onglet;
beforeAll(async () => { o = await ouvrirOnglet(); });
// Une interception oubliée (test en échec) fausserait tous les suivants.
afterEach(async () => { await o?.page.unrouteAll({ behavior: 'ignoreErrors' }); });
afterAll(async () => {
  await o?.fermer();
  await fermerNavigateur();
  await nettoyer(ORG(), MARQUE);
});

const UUID = /\/automations\/([0-9a-f-]{36})/;

/** Ouvre l'éditeur d'une règle et attend le canevas. */
async function ouvrirEditeur(id: string): Promise<void> {
  await o.page.goto(`${o.base}/automations/${id}`);
  await o.page.getByRole('tab', { name: 'Parcours' }).waitFor({ timeout: 60_000 });
}

/** L'indicateur d'enregistrement de la barre du haut. */
const etat = () => o.page.locator('header span.text-xs').last();
async function attendreEnregistre(): Promise<void> {
  await expect.poll(async () => (await etat().textContent())?.trim(), { timeout: 30_000 }).toBe('Enregistré');
}

/** Les cartes du canevas, dans l'ordre d'affichage : [titre, détail]. */
async function cartes(): Promise<Array<[string, string]>> {
  const boutons = o.page.locator('div.relative.w-\\[260px\\] > button:first-child');
  const n = await boutons.count();
  const out: Array<[string, string]> = [];
  for (let i = 0; i < n; i++) {
    const spans = boutons.nth(i).locator('span.min-w-0 > span');
    const titre = ((await spans.nth(0).textContent()) ?? '').trim();
    const detail = (await spans.count()) > 1 ? ((await spans.nth(1).textContent()) ?? '').trim() : '';
    out.push([titre, detail]);
  }
  return out;
}
const carte = (titre: string): Locator =>
  o.page.locator('div.relative.w-\\[260px\\]').filter({ has: o.page.locator('span.font-medium', { hasText: titre }) }).first();

const panneau = () => o.page.getByRole('complementary', { name: 'Modifier l’étape' });
const tiroir = (titre: 'Actions' | 'Déclencheurs') => o.page.getByRole('complementary', { name: titre });

/** Choisit une entrée du tiroir (actions ou déclencheurs) par son titre. */
async function choisirDansTiroir(titre: 'Actions' | 'Déclencheurs', choix: string): Promise<void> {
  const t = tiroir(titre);
  await t.waitFor();
  await t.getByRole('searchbox').fill(choix);
  await t.getByRole('button', { name: new RegExp(`^${choix.replace(/[()[\]]/g, '\\$&')}`) }).first().click();
}

/** Le parcours tel qu'en base, dans l'ordre du chemin principal. */
function cheminPrincipal(r: LigneRegle): Array<Record<string, unknown>> {
  const steps = (r.steps ?? []) as Array<Record<string, unknown>>;
  const vus = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  let courant: Record<string, unknown> | undefined = steps[0];
  while (courant && !vus.has(String(courant.id))) {
    vus.add(String(courant.id));
    out.push(courant);
    const suite = (courant.type === 'si' ? courant.alors : courant.suivant) as string | null | undefined;
    courant = suite ? steps.find((e) => e.id === suite) : undefined;
  }
  return out;
}

describe('Créer depuis zéro puis construire le parcours', () => {
  let idRegle = '';

  it('[J-010] « Partir de zéro » n’écrit RIEN en base avant le premier geste ; renommer crée le brouillon', async () => {
    await avecCapture(o, 'J-010', async () => {
      const t0 = new Date().toISOString();
      await o.page.goto(`${o.base}/automations`);
      await o.page.getByRole('button', { name: 'Créer', exact: false }).first().click();
      await o.page.getByRole('menuitem', { name: /Partir de zéro/ }).click();
      await o.page.waitForURL(/\/automations\/nouvelle/);
      await o.page.getByRole('button', { name: /Cliquer pour choisir un autre déclencheur/ }).waitFor({ timeout: 60_000 });
      const { count } = await admin.from('automation_rules').select('id', { count: 'exact', head: true })
        .eq('org_id', ORG()).gte('created_at', t0);
      expect(count).toBe(0);

      // Renommer : la première vraie sauvegarde crée la règle, EN BROUILLON.
      await o.page.getByRole('button', { name: /Nouvelle automatisation/ }).click();
      const champNom = o.page.getByRole('textbox', { name: 'Nom de l’automatisation' });
      await champNom.fill(`${MARQUE} zéro`);
      await champNom.press('Enter');
      await o.page.waitForURL(UUID, { timeout: 30_000 });
      idRegle = o.page.url().match(UUID)![1];
      await attendreEnregistre();
      const r = await lireRegle(idRegle);
      expect(r.org_id).toBe(ORG());
      expect(r.name).toBe(`${MARQUE} zéro`);
      expect(r.is_active).toBe(false);
      expect(r.is_preset).toBe(false);
      expect(r.trigger_event).toBe('quote.sent');
      expect(r.steps ?? []).toEqual([]);
      // Une seule règle créée, même avec deux sauvegardes proches.
      expect((await reglesParNom(ORG(), `${MARQUE} zéro`)).length).toBe(1);
    });
  });

  it('[J-011] changer le déclencheur : écrit trigger_event, la carte « Quand » le montre', async () => {
    await avecCapture(o, 'J-011', async () => {
      await o.page.getByRole('button', { name: /Cliquer pour choisir un autre déclencheur/ }).click();
      await choisirDansTiroir('Déclencheurs', 'Facture envoyée');
      await expect.poll(async () => (await lireRegle(idRegle)).trigger_event).toBe('invoice.sent');
      await expect.poll(() => o.page.getByRole('button', { name: /Cliquer pour choisir un autre déclencheur/ }).textContent()).toContain('Facture envoyée');
    });
  });

  it('[J-012] ajouter une action « Notifier l’équipe » avec son titre et son nom : la base = la carte', async () => {
    await avecCapture(o, 'J-012', async () => {
      await o.page.getByRole('button', { name: /Ajouter une première étape/ }).click();
      await choisirDansTiroir('Actions', 'Notifier l’équipe');
      const p = panneau();
      await p.waitFor();
      await p.getByLabel(/Nom de l’action/).fill('Alerte QA');
      await p.getByLabel(/^Titre/).fill('Relancer [client_name]');
      await p.getByRole('button', { name: 'Enregistrer' }).click();
      await p.waitFor({ state: 'hidden' });
      await attendreEnregistre();

      const r = await lireRegle(idRegle);
      const chemin = cheminPrincipal(r);
      expect(chemin).toHaveLength(1);
      expect(chemin[0]).toMatchObject({ type: 'action', nom: 'Alerte QA', suivant: null, action: { type: 'create_notification', config: { title: 'Relancer [client_name]' } } });
      expect(await cartes()).toEqual([['Alerte QA', 'Relancer [client_name]']]);
    });
  });

  it('[J-013] ajouter une attente de 2 jours puis un texto : la chaîne en base suit l’écran', async () => {
    await avecCapture(o, 'J-013', async () => {
      // L'attente, à la fin.
      await o.page.getByRole('button', { name: 'Ajouter', exact: true }).click();
      await choisirDansTiroir('Actions', 'Attendre');
      const p = panneau();
      await p.waitFor();
      await p.getByLabel('Attendre').fill('2');
      await p.getByLabel('Unité de temps').selectOption('jours');
      await p.getByRole('button', { name: 'Enregistrer' }).click();
      await p.waitFor({ state: 'hidden' });

      // Le texto, après l'attente.
      await o.page.getByRole('button', { name: 'Ajouter', exact: true }).click();
      await choisirDansTiroir('Actions', 'Envoyer un texto');
      await p.waitFor();
      await p.getByLabel(/Texte du message/).fill('Bonjour [client_name], votre facture est partie. — QA');
      await p.getByRole('button', { name: 'Enregistrer' }).click();
      await p.waitFor({ state: 'hidden' });
      await attendreEnregistre();

      const r = await lireRegle(idRegle);
      const chemin = cheminPrincipal(r);
      expect(chemin.map((e) => e.type)).toEqual(['action', 'attendre', 'action']);
      expect(chemin[1]).toMatchObject({ type: 'attendre', delai_secondes: 172800 });
      expect(chemin[2]).toMatchObject({ action: { type: 'send_sms', config: { body: 'Bonjour [client_name], votre facture est partie. — QA' } }, suivant: null });
      expect((r.steps ?? []).length).toBe(3);
      expect(await cartes()).toEqual([
        ['Alerte QA', 'Relancer [client_name]'],
        ['Attendre', '2 jour(s)'],
        ['Envoyer un texto', 'Bonjour [client_name], votre facture est partie. — QA'],
      ]);
    });
  });

  it('[J-014] modifier le texte d’une action existante : la base suit, rien d’autre ne bouge', async () => {
    await avecCapture(o, 'J-014', async () => {
      const avant = await lireRegle(idRegle);
      await carte('Envoyer un texto').locator('button').first().click();
      const p = panneau();
      await p.waitFor();
      await p.getByLabel(/Texte du message/).fill('Merci [client_name] ! Texte modifié — QA');
      await p.getByRole('button', { name: 'Enregistrer' }).click();
      await p.waitFor({ state: 'hidden' });
      await attendreEnregistre();
      const apres = await lireRegle(idRegle);
      const [a0, a1, a2] = cheminPrincipal(avant);
      const [b0, b1, b2] = cheminPrincipal(apres);
      expect(b0).toEqual(a0);
      expect(b1).toEqual(a1);
      expect(b2).toEqual({ ...a2, action: { ...(a2.action as object), config: { ...((a2.action as { config: object }).config), body: 'Merci [client_name] ! Texte modifié — QA' } } });
      expect((await cartes())[2]).toEqual(['Envoyer un texto', 'Merci [client_name] ! Texte modifié — QA']);
    });
  });

  it('[J-015] ajouter une condition (« si ») : le texte saisi devient l’objet conditions attendu', async () => {
    await avecCapture(o, 'J-015', async () => {
      // Condition insérée APRÈS l'alerte : la suite passe sous « alors ».
      await carte('Alerte QA').getByRole('button', { name: /Options de l’étape/ }).waitFor();
      // 0 = avant la 1re carte, 1 = après « Alerte QA ».
      const plus = o.page.getByRole('button', { name: 'Ajouter une étape ici' }).nth(1);
      await plus.click();
      await choisirDansTiroir('Actions', 'Condition');
      const p = panneau();
      await p.waitFor();
      await p.getByLabel('Conditions').fill('total_cents > 5000\nstatut = sent');
      await p.getByRole('button', { name: 'Enregistrer' }).click();
      await p.waitFor({ state: 'hidden' });
      await attendreEnregistre();
      const r = await lireRegle(idRegle);
      const si = (r.steps ?? []).find((e) => e.type === 'si') as Record<string, unknown>;
      expect(si).toBeTruthy();
      expect(si.conditions).toEqual({ total_cents: { gt: 5000 }, statut: 'sent' });
      // L'alerte (1re étape) pointe vers la condition ; la condition garde la suite sous « alors ».
      const alerte = cheminPrincipal(r)[0];
      expect(alerte.suivant).toBe(si.id);
      expect(si.alors).toBe((r.steps ?? []).find((e) => e.type === 'attendre')?.id);
      expect(si.sinon ?? null).toBeNull();
      await expect.poll(() => o.page.getByText('2 condition(s)').isVisible()).toBe(true);
    });
  });

  it('[J-016] recharger la page : l’écran montre EXACTEMENT la même chose, la base n’a pas bougé', async () => {
    await avecCapture(o, 'J-016', async () => {
      const avant = await lireRegle(idRegle);
      const ecranAvant = await cartes();
      await o.page.reload();
      await o.page.getByRole('tab', { name: 'Parcours' }).waitFor({ timeout: 60_000 });
      await expect.poll(() => cartes()).toEqual(ecranAvant);
      await voir(o.page.getByRole('button', { name: new RegExp(`${MARQUE.replace(/[[\]]/g, '\\$&')} zéro`) })).visible();
      const apres = await lireRegle(idRegle);
      expect(apres.steps).toEqual(avant.steps);
      expect(apres.updated_at).toBe(avant.updated_at);
    });
  });

  it('[J-017] Réglages : ré-entrée, fenêtre 9 h–17 h, jours ouvrables, 7 jours entre passages → settings exact, relu après rechargement', async () => {
    await avecCapture(o, 'J-017', async () => {
      await o.page.getByRole('tab', { name: 'Réglages' }).click();
      await o.page.getByRole('switch', { name: 'Laisser le client repasser' }).click();
      await o.page.getByLabel('De', { exact: true }).selectOption('9');
      await o.page.getByLabel('à', { exact: true }).selectOption('17');
      await o.page.getByRole('switch', { name: 'Jours ouvrables seulement' }).click();
      await o.page.getByLabel('Une fois par client tous les…').selectOption('7');
      await expect.poll(async () => (await lireRegle(idRegle)).settings, { timeout: 20_000 }).toMatchObject({
        reentree: true, fenetre: { debut: 9, fin: 17 }, jours_ouvrables: true, delai_entre_passages_jours: 7,
      });
      const s = (await lireRegle(idRegle)).settings as Record<string, unknown>;
      // Rien d'autre que ce que l'écran permet (plus, éventuellement, la sortie auto posée à la création).
      expect(Object.keys(s).filter((k) => k !== 'arreter_si_resolu').sort()).toEqual(['delai_entre_passages_jours', 'fenetre', 'jours_ouvrables', 'reentree']);

      await o.page.reload();
      await o.page.getByRole('tab', { name: 'Réglages' }).click();
      await voir(o.page.getByRole('switch', { name: 'Laisser le client repasser' })).attribut('aria-checked', 'true');
      await voir(o.page.getByRole('switch', { name: 'Arrêter si le client répond' })).attribut('aria-checked', 'false');
      await voir(o.page.getByRole('switch', { name: 'Jours ouvrables seulement' })).attribut('aria-checked', 'true');
      await voir(o.page.getByLabel('De', { exact: true })).valeur('9');
      await voir(o.page.getByLabel('à', { exact: true })).valeur('17');
      await voir(o.page.getByLabel('Une fois par client tous les…')).valeur('7');

      // Revenir aux défauts efface la clé (jamais `false` en base).
      await o.page.getByRole('switch', { name: 'Jours ouvrables seulement' }).click();
      await expect.poll(async () => 'jours_ouvrables' in ((await lireRegle(idRegle)).settings ?? {})).toBe(false);
      await o.page.getByRole('tab', { name: 'Parcours' }).click();
    });
  });

  it('[J-018] Publier : confirmation, is_active en base, « Publiée » à l’écran ; [J-019] dépublier = brouillon', async () => {
    await avecCapture(o, 'J-018', async () => {
      const interrupteur = o.page.getByRole('switch', { name: 'Publier l’automatisation' });
      await voir(interrupteur).attribut('aria-checked', 'false');
      await interrupteur.click();
      await confirmerDialogue(o.page, 'Publier');
      await expect.poll(async () => (await lireRegle(idRegle)).is_active, { timeout: 20_000 }).toBe(true);
      await voir(interrupteur).attribut('aria-checked', 'true');
      await voir(o.page.getByText('Publiée', { exact: true })).visible();

      await interrupteur.click();
      await expect.poll(async () => (await lireRegle(idRegle)).is_active, { timeout: 20_000 }).toBe(false);
      await voir(interrupteur).attribut('aria-checked', 'false');
      await voir(o.page.getByText('Brouillon', { exact: true })).visible();
      await o.page.reload();
      await voir(o.page.getByRole('switch', { name: 'Publier l’automatisation' })).attribut('aria-checked', 'false');
    });
  });
});

describe('Réglages du déclencheur', () => {
  it('[J-030] « Devis ouvert » : première ouverture + montant minimum → conditions exactes, détail sous la carte', async () => {
    await avecCapture(o, 'J-030', async () => {
      const r = await creerRegle(ORG(), {
        name: `${MARQUE} devis ouvert`, trigger_event: 'quote.viewed', conditions: {},
        actions: [{ type: 'create_notification', config: { title: 'Devis ouvert' } }],
        steps: [{ id: 'e1', type: 'action', action: { type: 'create_notification', config: { title: 'Devis ouvert' } }, suivant: null }],
      });
      await ouvrirEditeur(r.id);
      await o.page.getByRole('button', { name: /Quand/ }).first().click();
      const p = o.page.getByRole('complementary', { name: 'Réglages du déclencheur' });
      await p.waitFor();
      await p.getByLabel(/Quand déclencher/).selectOption('premiere');
      await p.getByLabel(/Montant minimum/).fill('500');
      await p.getByRole('button', { name: 'Enregistrer' }).click();
      await attendreToast(o.page, 'Réglages enregistrés');
      const lu = await lireRegle(r.id);
      expect(lu.conditions).toMatchObject({ ouverture: 'premiere', montant__gte: 500 });
      expect(lu.conditions).not.toHaveProperty('montant__lte');
      await voir(o.page.getByRole('button', { name: /Quand/ }).first()).contient('Première ouverture seulement');
      await voir(o.page.getByRole('button', { name: /Quand/ }).first()).contient('500');
      await o.page.reload();
      await o.page.getByRole('button', { name: /Quand/ }).first().click();
      await voir(p.getByLabel(/Quand déclencher/)).valeur('premiere');
      await voir(p.getByLabel(/Montant minimum/)).valeur('500');
    });
  });
});

describe('Validations', () => {
  it('[J-040] une étape incomplète (texto vide) : « Enregistrer » grisé avec la raison, rien n’est écrit', async () => {
    await avecCapture(o, 'J-040', async () => {
      const r = await creerRegle(ORG(), {
        name: `${MARQUE} incomplet`, trigger_event: 'invoice.sent',
        actions: [{ type: 'send_sms', config: { body: 'Bonjour' } }],
        steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour' } }, suivant: null }],
      });
      await ouvrirEditeur(r.id);
      await carte('Envoyer un texto').locator('button').first().click();
      const p = panneau();
      await p.getByLabel(/Texte du message/).fill('');
      await voir(p.getByRole('button', { name: 'Enregistrer' })).grise();
      await voir(p.getByText('« Texte du message » est vide.').first()).visible();
      await p.getByRole('button', { name: 'Annuler' }).click();
      await confirmerDialogue(o.page, 'Fermer sans enregistrer');
      expect((await lireRegle(r.id)).steps).toEqual(r.steps);
    });
  });

  it('[J-041] publier un parcours avec un problème bloquant : refusé AVANT, message nommant le problème, rien en base', async () => {
    await avecCapture(o, 'J-041', async () => {
      // « Date atteinte » sans le champ date à surveiller : ne partirait jamais.
      const r = await creerRegle(ORG(), {
        name: `${MARQUE} bloquant`, trigger_event: 'date.reached', conditions: {},
        actions: [{ type: 'create_notification', config: { title: 'Date' } }],
        steps: [{ id: 'e1', type: 'action', action: { type: 'create_notification', config: { title: 'Date' } }, suivant: null }],
      });
      await ouvrirEditeur(r.id);
      await voir(o.page.getByText(/choses? à corriger avant de publier/)).visible();
      await o.page.getByRole('switch', { name: 'Publier l’automatisation' }).click();
      const message = await attendreToast(o.page, /date|champ/i);
      expect(message.length).toBeGreaterThan(10);
      await voir(o.page.getByRole('dialog')).absent();
      await voir(o.page.getByRole('switch', { name: 'Publier l’automatisation' })).attribut('aria-checked', 'false');
      expect((await lireRegle(r.id)).is_active).toBe(false);
    });
  });
});

describe('États de l’éditeur', () => {
  it('[J-050] chargement : un indicateur, jamais un faux « introuvable »', async () => {
    await avecCapture(o, 'J-050', async () => {
      const r = await creerRegle(ORG(), { name: `${MARQUE} chargement`, trigger_event: 'invoice.sent' });
      let relacher: () => void = () => undefined;
      const retenue = new Promise<void>((ok) => { relacher = ok; });
      await o.page.route('**/api/automations/editeur*', async (route) => { await retenue; await route.continue().catch(() => undefined); });
      try {
        await o.page.goto(`${o.base}/automations/${r.id}`);
        await expect.poll(() => o.page.locator('div.fixed.inset-0 .animate-spin').count(), { timeout: 60_000 }).toBeGreaterThan(0);
        await voir(o.page.getByText('Cette automatisation est introuvable.')).absent();
      } finally {
        relacher();
        await o.page.unroute('**/api/automations/editeur*');
      }
      await o.page.getByRole('tab', { name: 'Parcours' }).waitFor({ timeout: 60_000 });
    });
  });

  it('[J-051] API en panne : « Impossible de charger » + « Réessayer » qui recharge vraiment', async () => {
    await avecCapture(o, 'J-051', async () => {
      const r = await creerRegle(ORG(), { name: `${MARQUE} panne`, trigger_event: 'invoice.sent' });
      await o.page.route('**/api/automations/editeur*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"panne simulée"}' }));
      await o.page.goto(`${o.base}/automations/${r.id}`);
      await voir(o.page.getByText('Impossible de charger cette automatisation pour le moment.'), 60_000).visible();
      await voir(o.page.getByText('Cette automatisation est introuvable.')).absent();
      await o.page.unroute('**/api/automations/editeur*');
      await o.page.getByRole('button', { name: 'Réessayer' }).click();
      await o.page.getByRole('tab', { name: 'Parcours' }).waitFor({ timeout: 60_000 });
      await voir(o.page.getByRole('button', { name: new RegExp('panne') })).visible();
    });
  });
});
