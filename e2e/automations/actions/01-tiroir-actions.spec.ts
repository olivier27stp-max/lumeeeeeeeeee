/**
 * Le tiroir « Actions » (carte de l'éditeur § 2.5 : EDT-056, 057, 059 à 063).
 *
 * Ce que le fichier prouve :
 *  · le tiroir s'ouvre, se ferme, se filtre (sans accents ni casse) ;
 *  · il liste les 21 actions de la carte, par famille, plus les 3 étapes de parcours ;
 *  · « Envoyer dans Slack » y est présentée comme indisponible, avec sa raison,
 *    et ne peut être ni choisie ni retrouvée dans « Quoi faire » ;
 *  · COMPATIBILITÉ : pour chacun des 28 déclencheurs, ce que le tiroir grise est
 *    exactement ce que le moteur ne saurait pas exécuter, ET exactement ce que
 *    le serveur refuse à la publication (pistes S-09 de la carte).
 */
import { test, expect } from './_aides';
import { appelApi } from '../_outils/banc';
import {
  CAPTURES, donnees, creerBrouillon, creerBrouillonAvecAction, ouvrirEditeur, ouvrirTiroir, tiroirActions, itemTiroir, panneauEtape, carte, finStable,
  attendreEtapes, etapesEnBase, enregistrerEtape, type Donnees,
} from './_aides';
import { ACTIONS_ATTENDUES, ACTIONS_DISPONIBLES } from './_catalogue';
import type { Page } from '@playwright/test';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5191';

interface ItemLu { titre: string; sous: string; desactive: boolean; infobulle: string; famille: string }

/** Tout ce que le tiroir montre : titre, texte sous le titre, état, famille. */
async function lireTiroir(page: Page): Promise<ItemLu[]> {
  return tiroirActions(page).locator('section').evaluateAll((sections) => sections.flatMap((s) => {
    const famille = (s.querySelector('h3')?.textContent ?? '').trim();
    return Array.from(s.querySelectorAll('li button')).map((b) => {
      const blocs = b.querySelectorAll('span.block');
      return {
        titre: (blocs[0]?.textContent ?? '').trim(), sous: (blocs[1]?.textContent ?? '').trim(),
        desactive: (b as HTMLButtonElement).disabled, infobulle: b.getAttribute('title') ?? '', famille,
      };
    });
  }));
}

test.describe('tiroir Actions — ouverture, fermeture, recherche', () => {
  test('[EDT-056] « Fermer » referme le tiroir sans rien ajouter au parcours', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created');
    await ouvrirEditeur(page, regle.id);
    const t = await ouvrirTiroir(page);
    await expect(t.getByRole('heading', { name: 'Actions', level: 2 })).toBeVisible();
    await expect(t.getByText('Ce que l’automatisation fera')).toBeVisible();
    await t.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(t).toBeHidden();
    await expect(page.getByRole('button', { name: 'Ajouter une première étape' })).toBeVisible();
    await expect(page.getByText('Enregistré', { exact: true })).toBeVisible();
    expect((await bureau.admin.from('automation_rules').select('steps').eq('id', regle.id).single()).data?.steps).toEqual([]);
  });

  test('[EDT-057] la recherche filtre sur le titre et sur l’aide, sans accents ni majuscules, et dit quand rien ne correspond', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created');
    await ouvrirEditeur(page, regle.id);
    const t = await ouvrirTiroir(page);
    const recherche = t.getByRole('searchbox', { name: 'Rechercher dans Actions' });
    await expect(recherche).toHaveAttribute('placeholder', 'Rechercher…');

    await recherche.fill('ETIQUETTE');
    expect((await lireTiroir(page)).map((i) => i.titre)).toEqual(['Ajouter une étiquette', 'Retirer une étiquette']);

    // Par l'aide : « téléphone » n'est dans aucun titre, seulement dans l'aide du texto.
    await recherche.fill('telephone');
    expect((await lireTiroir(page)).map((i) => i.titre)).toEqual(['Envoyer un texto']);

    await recherche.fill('zzzz introuvable');
    await expect(t.getByText('Rien ne correspond à cette recherche.')).toBeVisible();
    expect(await lireTiroir(page)).toEqual([]);

    await recherche.fill('');
    expect(await lireTiroir(page)).toHaveLength(24);
  });

  test('[EDT-057] à l’ouverture du tiroir, le curseur est dans la recherche : on peut taper tout de suite', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created');
    await ouvrirEditeur(page, regle.id);
    const t = await ouvrirTiroir(page);
    await expect(t.getByRole('searchbox', { name: 'Rechercher dans Actions' })).toBeFocused();
  });

  test('[EDT-057][EDT-059] Entrée dans la recherche choisit l’unique action restante @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created');
    await ouvrirEditeur(page, regle.id);
    const t = await ouvrirTiroir(page);
    const recherche = t.getByRole('searchbox', { name: 'Rechercher dans Actions' });
    await recherche.fill('webhook');
    expect((await lireTiroir(page)).map((i) => i.titre)).toEqual(['Appeler un webhook']);
    await recherche.press('Enter');
    await expect(panneauEtape(page).getByRole('heading', { level: 2 })).toHaveText('Appeler un webhook');
  });
});

test.describe('tiroir Actions — contenu', () => {
  test('[EDT-059][EDT-060][EDT-061][EDT-062] le tiroir liste les 21 actions de la carte par famille, puis les 3 étapes de parcours', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created');
    await ouvrirEditeur(page, regle.id);
    await ouvrirTiroir(page);
    const items = await lireTiroir(page);
    await page.screenshot({ path: `${CAPTURES}/tiroir-actions.png`, fullPage: true });

    expect(items.map((i) => `${i.famille} › ${i.titre}`)).toEqual([
      'Communication › Envoyer un courriel', 'Communication › Envoyer un texto', 'Communication › Notifier l’équipe',
      'Communication › Demander un avis', 'Communication › Envoyer dans Slack',
      'Client › Ajouter une étiquette', 'Client › Retirer une étiquette', 'Client › Modifier le client',
      'Client › Assigner un responsable', 'Client › Ajouter une note', 'Client › Mettre à jour un champ personnalisé',
      'Travail › Créer une tâche', 'Travail › Changer le statut du rendez-vous',
      'Ventes › Déplacer l’opportunité', 'Ventes › Modifier l’opportunité', 'Ventes › Assigner l’opportunité',
      'Argent › Envoyer la facture', 'Argent › Envoyer le devis',
      'Technique › Appeler un webhook', 'Technique › Démarrer une automatisation', 'Technique › Arrêter une automatisation',
      'Parcours › Attendre', 'Parcours › Condition', 'Parcours › Arrêter ici',
    ]);
    // Une action offerte montre son aide ; une action grisée montre sa raison.
    for (const a of ACTIONS_ATTENDUES) {
      const lu = items.find((i) => i.titre === a.fr);
      expect(lu, a.fr).toBeTruthy();
      if (lu && !lu.desactive) expect(lu.sous).toBe(a.aide_fr);
    }
    expect(items.find((i) => i.titre === 'Attendre')?.sous).toBe('Met le parcours en pause avant la suite.');
    expect(items.find((i) => i.titre === 'Condition')?.sous).toBe('Sépare le parcours en deux chemins.');
    expect(items.find((i) => i.titre === 'Arrêter ici')?.sous).toBe('Le client sort du parcours.');
  });

  test('[EDT-060][EDT-033] « Attendre », choisie par le « + » en tête, insère une attente d’un jour avant l’action et ouvre son panneau', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'create_task', { title: 'Rappeler [client_name]' });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: 'Ajouter une étape ici' }).first().click();
    await itemTiroir(page, 'Attendre').click();
    const p = panneauEtape(page);
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Attendre');
    await expect(p.getByLabel('Attendre *', { exact: true })).toHaveValue('1');
    await expect(p.getByLabel('Unité de temps')).toHaveValue('jours');
    await expect(carte(page, 'Attendre')).toContainText('1 jour(s)');
    // Choisie dans le tiroir, l'étape est montrée sur le canevas mais n'est pas encore dans le parcours (3b739958).
    expect(await etapesEnBase(bureau, regle.id)).toHaveLength(1);
    // « Enregistrer » dans son panneau l'y fait entrer, à sa place : en tête, avant l'action.
    await enregistrerEtape(p);
    await expect(carte(page, 'Attendre')).toContainText('1 jour(s)');
    const etapes = await attendreEtapes(bureau, regle.id, (e) => e.length === 2);
    expect(etapes[0]).toEqual({ id: 'e2', type: 'attendre', delai_secondes: 86400, suivant: 'e1' });
    await finStable(page);
  });

  test('[EDT-061] « Condition » insère une condition à deux branches et ouvre son panneau', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'create_task', { title: 'Rappeler [client_name]' });
    await ouvrirEditeur(page, regle.id);
    await ouvrirTiroir(page);
    await itemTiroir(page, 'Condition').click();
    const p = panneauEtape(page);
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Condition');
    await expect(page.getByText('si oui', { exact: true })).toBeVisible();
    await expect(page.getByText('si non', { exact: true })).toBeVisible();
    // Pas encore dans le parcours : elle y entre à « Enregistrer » de son panneau (3b739958).
    expect(await etapesEnBase(bureau, regle.id)).toHaveLength(1);
    await enregistrerEtape(p);
    await expect(page.getByText('si oui', { exact: true })).toBeVisible();
    await expect(page.getByText('si non', { exact: true })).toBeVisible();
    const etapes = await attendreEtapes(bureau, regle.id, (e) => e.length === 2);
    expect(etapes[1]).toEqual({ id: 'e2', type: 'si', conditions: {}, alors: null, sinon: null });
    await finStable(page);
  });

  test('[EDT-062] « Arrêter ici » insère une fin de parcours et ouvre son panneau', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'create_task', { title: 'Rappeler [client_name]' });
    await ouvrirEditeur(page, regle.id);
    await ouvrirTiroir(page);
    await itemTiroir(page, 'Arrêter ici').click();
    const p = panneauEtape(page);
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Arrêter ici');
    await expect(p.getByText('Rien à configurer. Le client sort du parcours en arrivant ici.')).toBeVisible();
    await expect(carte(page, 'Arrêter ici')).toBeVisible();
    // Pas encore dans le parcours : elle y entre à « Enregistrer » de son panneau (3b739958).
    expect(await etapesEnBase(bureau, regle.id)).toHaveLength(1);
    await enregistrerEtape(p);
    await expect(carte(page, 'Arrêter ici')).toBeVisible();
    const etapes = await attendreEtapes(bureau, regle.id, (e) => e.length === 2);
    expect(etapes[1]).toEqual({ id: 'e2', type: 'arreter' });
    await finStable(page);
  });
});

test.describe('tiroir Actions — « Envoyer dans Slack » (indisponible)', () => {
  test('[ACT-05][CHA-14][EDT-063] elle est affichée grisée avec sa raison, ne se choisit pas, et n’apparaît pas dans « Quoi faire »', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created');
    await ouvrirEditeur(page, regle.id);
    await ouvrirTiroir(page);
    const slack = itemTiroir(page, 'Envoyer dans Slack');
    await expect(slack).toBeDisabled();
    await expect(slack).toContainText('Bientôt : la connexion à votre Slack n’existe pas encore.');
    await expect(slack).toHaveAttribute('title', 'Bientôt : la connexion à votre Slack n’existe pas encore.');
    await tiroirActions(page).getByRole('listitem').filter({ hasText: 'Envoyer dans Slack' }).screenshot({ path: `${CAPTURES}/tiroir-slack.png` });
    // Un clic forcé (ce que ferait un utilisateur têtu) n'ajoute rien.
    await slack.click({ force: true });
    await expect(tiroirActions(page)).toBeVisible();
    await expect(panneauEtape(page)).toBeHidden();

    // Dans le panneau d'une autre action, « Quoi faire » ne la propose pas.
    await itemTiroir(page, 'Créer une tâche').click();
    const options = await panneauEtape(page).getByLabel('Quoi faire *', { exact: true }).locator('option').allInnerTexts();
    expect(options).not.toContain('Envoyer dans Slack');
    expect(options).toEqual(ACTIONS_DISPONIBLES
      .filter((a) => !['modifier_statut_rendezvous', 'move_deal_stage', 'modifier_deal', 'assigner_deal', 'envoyer_facture', 'envoyer_soumission'].includes(a.cle))
      .map((a) => a.fr));
    await finStable(page);
  });

  test('[ACT-05][EDT-063] au clavier ou au lecteur d’écran, on peut atteindre l’action grisée et lire pourquoi elle l’est @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created');
    await ouvrirEditeur(page, regle.id);
    await ouvrirTiroir(page);
    const slack = itemTiroir(page, 'Envoyer dans Slack');
    // Un bouton `disabled` sort de l'ordre de tabulation : la raison n'est lisible qu'à la souris.
    await slack.focus();
    await expect(slack).toBeFocused();
  });
});

// ── Compatibilité déclencheur × action ────────────────────────────────────

/** Les six actions liées à une entité, et les entités que LE MOTEUR sait traiter (server/lib/actions). */
const ACTIONS_LIEES: Record<string, string[]> = {
  modifier_statut_rendezvous: ['schedule_event'],
  move_deal_stage: ['deal', 'quote'],
  modifier_deal: ['deal'],
  assigner_deal: ['deal'],
  envoyer_facture: ['invoice'],
  envoyer_soumission: ['quote'],
};

interface CasCompat {
  cle: string; fr: string;
  /** L'entité que l'événement fait arriver au moteur ; `*` = dépend de la donnée. */
  entite: string;
  conditions?: (d: Donnees) => Record<string, unknown>;
  variante?: string;
  defaut?: boolean;
}

const CAS: CasCompat[] = [
  { cle: 'quote.sent', fr: 'Devis envoyé', entite: 'quote' },
  { cle: 'quote.viewed', fr: 'Devis ouvert par le client', entite: 'quote' },
  { cle: 'quote.approved', fr: 'Devis accepté', entite: 'quote' },
  { cle: 'quote.declined', fr: 'Devis refusé', entite: 'quote' },
  { cle: 'quote.changes_requested', fr: 'Modifications demandées', entite: 'quote' },
  { cle: 'invoice.sent', fr: 'Facture envoyée', entite: 'invoice' },
  { cle: 'invoice.paid', fr: 'Facture payée', entite: 'invoice' },
  { cle: 'invoice.overdue', fr: 'Facture en retard', entite: 'invoice' },
  { cle: 'payment.failed', fr: 'Paiement échoué', entite: 'invoice' },
  { cle: 'invoice.viewed', fr: 'Facture consultée par le client', entite: 'invoice' },
  { cle: 'appointment.created', fr: 'Rendez-vous planifié', entite: 'schedule_event' },
  { cle: 'appointment.cancelled', fr: 'Rendez-vous annulé', entite: 'schedule_event' },
  { cle: 'job.completed', fr: 'Job terminé', entite: 'job' },
  { cle: 'job.ready_for_invoicing', fr: 'Job prêt à facturer', entite: 'job' },
  { cle: 'lead.created', fr: 'Nouveau prospect', entite: 'lead' },
  { cle: 'lead.status_changed', fr: 'Statut du prospect changé', entite: 'lead' },
  { cle: 'client.replied', fr: 'Le client répond', entite: 'client' },
  { cle: 'client.tagged', fr: 'Étiquette ajoutée', entite: 'client' },
  { cle: 'client.untagged', fr: 'Étiquette retirée', entite: 'client' },
  { cle: 'client.inactive', fr: 'Client inactif', entite: 'client', conditions: () => ({ mois: 6, max_par_heure: 25 }) },
  { cle: 'agreement.signed', fr: 'Contrat signé', entite: 'job' },
  { cle: 'task.completed', fr: 'Tâche terminée', entite: 'client' },
  { cle: 'note.added', fr: 'Note ajoutée', entite: 'client' },
  // Le serveur émet l'entité `automation_webhook_receipt` (server/routes/webhooks-entrants.ts) :
  // ni devis, ni facture, ni rendez-vous, ni opportunité n'arrive jamais par ce déclencheur.
  { cle: 'webhook.received', fr: 'Appel reçu de l’extérieur', entite: 'automation_webhook_receipt' },
  { cle: 'date.reached', fr: 'Date atteinte', entite: 'client', variante: 'sur un champ date du client', conditions: (d) => ({ champ_id: d.champs.qa_fin_garantie.id, jours_avant: 7 }) },
  { cle: 'date.reached', fr: 'Date atteinte', entite: 'deal', variante: 'sur un champ date du pipeline', conditions: (d) => ({ champ_id: d.champs.qa_fermeture.id, jours_avant: 7 }) },
  { cle: 'deal.stage_entered', fr: 'Opportunité entre dans une étape', entite: 'deal' },
  { cle: 'deal.stage_idle', fr: 'Opportunité qui dort', entite: 'deal' },
  { cle: 'custom_field.changed', fr: 'Champ personnalisé modifié', entite: '*', variante: 'sans champ choisi' },
  { cle: 'custom_field.changed', fr: 'Champ personnalisé modifié', entite: 'client', variante: 'sur un champ du client', conditions: (d) => ({ field_id: { eq: d.champs.qa_surnom.id } }) },
];

test.describe('tiroir Actions — compatibilité avec le déclencheur, à l’écran et à la publication', () => {
  for (const cas of CAS) {
    test(`[EDT-059][EDT-063][ACT-13][ACT-14][ACT-15][ACT-16][ACT-17][ACT-18] « ${cas.fr} »${cas.variante ? ` (${cas.variante})` : ''} : le tiroir grise exactement ce que le moteur ne sait pas faire, et la publication refuse la même chose${cas.defaut ? ' @defaut' : ''}`, async ({ page, bureau, marque, jetonDe, baseURL }) => {
      const d = await donnees(bureau);
      const conditions = cas.conditions?.(d) ?? {};
      const attenduesGrisees = cas.entite === '*'
        ? []
        : Object.entries(ACTIONS_LIEES).filter(([, entites]) => !entites.includes(cas.entite)).map(([cle]) => cle).sort();

      // 1. L'écran : le tiroir d'un brouillon sur ce déclencheur.
      const brouillon = await creerBrouillon(bureau, marque, cas.cle, { conditions });
      await ouvrirEditeur(page, brouillon.id);
      await ouvrirTiroir(page);
      const items = await lireTiroir(page);
      const griseesEcran = ACTIONS_DISPONIBLES
        .filter((a) => items.find((i) => i.titre === a.fr)?.desactive).map((a) => a.cle).sort();
      // Une action grisée dit pourquoi, en clair et dans l'infobulle.
      for (const a of ACTIONS_DISPONIBLES.filter((x) => griseesEcran.includes(x.cle))) {
        const lu = items.find((i) => i.titre === a.fr);
        expect(lu?.sous).toBe('Ne va pas avec ce déclencheur');
        expect(lu?.infobulle).toBe('Ne va pas avec ce déclencheur');
      }

      // 2. Le serveur : la même règle avec TOUTES les actions, complètes — que refuse la publication ?
      const steps = ACTIONS_DISPONIBLES.map((a, i, tous) => {
        const config: Record<string, string> = {};
        for (const c of a.champs) { const s = c.saisie(d); if (s) config[c.cle] = s.valeur; }
        return { id: `e${i + 1}`, type: 'action', action: { type: a.cle, config }, suivant: i + 1 < tous.length ? `e${i + 2}` : null };
      });
      const complete = await creerBrouillon(bureau, marque, cas.cle, { name: `${marque} ${cas.cle} toutes actions`, conditions, steps });
      const jeton = await jetonDe('proprioA');
      const pub = await appelApi(baseURL ?? BASE, jeton, bureau.orgA, 'POST', `/api/automations/rules/${complete.id}/publication`, { actif: true });
      let refuseesServeur: string[] = [];
      if (pub.status === 200) {
        // Publiée : on la repasse tout de suite en brouillon (bureau en bac à sable, mais rien ne doit rester actif).
        const retour = await appelApi(baseURL ?? BASE, jeton, bureau.orgA, 'POST', `/api/automations/rules/${complete.id}/publication`, { actif: false });
        expect(retour.status).toBe(200);
      } else {
        expect(pub.status, JSON.stringify(pub.json)).toBe(422);
        const problemes = ((pub.json as { problemes?: string[] }).problemes ?? []);
        const autres = problemes.filter((m) => !/ne peut pas suivre ce déclencheur/.test(m));
        expect(autres, 'la publication n’est refusée QUE pour incompatibilité').toEqual([]);
        refuseesServeur = problemes
          .map((m) => m.match(/^« (.+?) » ne peut pas suivre ce déclencheur/)?.[1] ?? '')
          .map((fr) => ACTIONS_DISPONIBLES.find((a) => a.fr === fr)?.cle ?? `?${fr}`).sort();
      }

      expect.soft(griseesEcran, 'actions grisées dans le tiroir (attendu : celles que le moteur ne sait pas exécuter sur cette entité)').toEqual(attenduesGrisees);
      expect.soft(refuseesServeur, 'actions refusées par le serveur à la publication (attendu : les mêmes)').toEqual(attenduesGrisees);
      expect(refuseesServeur, 'le tiroir et la publication disent la même chose').toEqual(griseesEcran);
    });
  }
});
