/**
 * Agent D — points 4 et 5 de la mission : ce que les ÉCRANS affichent, au vrai navigateur,
 * contre le jeu connu (../jeu-connu.ts, fabriqué par integration/10-jeu-connu.preuve.ts).
 *
 * Les blocs « état des lieux » sont verts : ils fixent ce qui est juste aujourd'hui.
 * Les tests « [D-nn] » portent le numéro de leur constat (D:/lume-final/notes/D-constats.md)
 * et sont ROUGES tant que le constat n'est pas corrigé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Page } from '@playwright/test';
import { ouvrirOnglet, fermerNavigateur, avecCapture, admin, type Onglet } from '../../../automations-suite/harnais/navigateur';
import { lireManifeste, type Manifeste, type RegleDuJeu } from '../jeu-connu';

let jeu: Manifeste;
let fr: Onglet;
let en: Onglet;

const propre = (t: string | null | undefined) => String(t ?? '').replace(/\s+/g, ' ').trim();

beforeAll(async () => {
  jeu = lireManifeste();
  fr = await ouvrirOnglet({ langue: 'fr' });
  en = await ouvrirOnglet({ langue: 'en' });
});

afterAll(async () => {
  await fr?.fermer();
  await en?.fermer();
  await fermerNavigateur();
});

/** La liste, réduite au jeu connu (recherche par préfixe, 50 lignes par page). */
async function ouvrirListe(o: Onglet): Promise<void> {
  await o.page.goto(`${o.base}/automations`);
  await o.page.locator('#rech-automations').waitFor();
  await o.page.locator('table tbody tr').first().waitFor();
  await o.page.locator('#rech-automations').fill('[QA-D jeu]');
  await expect.poll(() => o.page.locator('#par-page').count()).toBeGreaterThan(0);
  await o.page.locator('#par-page').selectOption('50');
}

const ligneListe = (page: Page, r: RegleDuJeu) => page.locator('table tbody tr').filter({ hasText: r.nom }).first();

async function cellules(page: Page, r: RegleDuJeu): Promise<string[]> {
  return (await ligneListe(page, r).locator('td').allInnerTexts()).map(propre);
}

/** Ouvre un onglet de l'éditeur et attend la fin de sa lecture. */
async function ouvrirOngletEditeur(o: Onglet, ruleId: string, onglet: 'historique' | 'journaux', anglais = false): Promise<void> {
  const nom = onglet === 'historique' ? (anglais ? 'Enrollment history' : 'Historique') : (anglais ? 'Execution logs' : 'Journaux');
  await o.page.goto(`${o.base}/automations/${ruleId}`);
  await o.page.getByRole('tab', { name: nom, exact: true }).click();
  await o.page.getByRole('heading', { level: 2 }).first().waitFor();
  await o.page.locator('.section-card .animate-spin').waitFor({ state: 'detached' });
}

const lignesJournaux = (page: Page) => page.locator('table tbody tr[role="button"]');
const lignesHistorique = (page: Page) => page.locator('table tbody tr');

describe('D — la liste des automatisations contre le jeu connu (état des lieux)', () => {
  it('[D-EL-10] « Total déclenché » et « En cours » de chaque règle = le jeu (fenêtre de 60 jours)', async () => {
    await avecCapture(fr, 'd-liste-colonnes', async () => {
      await ouvrirListe(fr);
      const S = jeu.regles.S;
      await expect.poll(async () => (await cellules(fr.page, S))[3]).toBe(String(S.attendu.stats60.declenches));
      const ecarts: string[] = [];
      for (const r of Object.values(jeu.regles)) {
        const c = await cellules(fr.page, r);
        if (c[3] !== String(r.attendu.stats60.declenches)) ecarts.push(`${r.cle} Total déclenché : écran ${c[3]} ≠ jeu ${r.attendu.stats60.declenches}`);
        if (c[4] !== String(r.attendu.stats60.en_cours)) ecarts.push(`${r.cle} En cours : écran ${c[4]} ≠ jeu ${r.attendu.stats60.en_cours}`);
      }
      expect(ecarts, ecarts.join('\n')).toEqual([]);
    });
  });

  it('[D-EL-11] le panneau « › » de chaque règle : déclenchements, envois, étapes sautées, échecs, en cours = le jeu', async () => {
    await avecCapture(fr, 'd-liste-panneau', async () => {
      await ouvrirListe(fr);
      await expect.poll(async () => (await cellules(fr.page, jeu.regles.S))[3]).toBe('5');
      const ecarts: string[] = [];
      for (const r of Object.values(jeu.regles)) {
        const bouton = ligneListe(fr.page, r).getByRole('button', { name: /^Statistiques de/ });
        await bouton.click();
        const panneau = propre(await ligneListe(fr.page, r).locator('xpath=following-sibling::tr[1]').innerText());
        await bouton.click();
        const s = r.attendu.stats60;
        const attendu = `60 derniers jours : ${s.declenches} déclenchement(s), ${s.envoyes} envoi(s), ${s.sautes} étape(s) sautée(s), ${s.echecs} échec(s). ${s.en_cours} en cours.`;
        if (!panneau.startsWith(attendu)) ecarts.push(`${r.cle} : écran « ${panneau.slice(0, 130)} » ≠ « ${attendu} »`);
      }
      expect(ecarts, ecarts.join('\n')).toEqual([]);
    });
  });

  it('[D-EL-12] pastille « N échec(s) dans les 7 derniers jours » et onglet « À vérifier (N) » = le jeu', async () => {
    await avecCapture(fr, 'd-liste-echecs', async () => {
      await ouvrirListe(fr);
      await expect.poll(async () => propre(await fr.page.getByRole('tab', { name: /^À vérifier/ }).innerText()))
        .toBe(`À vérifier (${jeu.totaux.regles_a_verifier})`);
      for (const r of Object.values(jeu.regles)) {
        const nom = (await cellules(fr.page, r))[1];
        const lu = Number(/(\d+) échec\(s\) dans les 7 derniers jours/.exec(nom)?.[1] ?? 0);
        expect(lu, `règle ${r.cle} : « ${nom} »`).toBe(r.attendu.echecs7j);
      }
    });
  });
});

describe('D — la Vue d’ensemble contre le jeu connu', () => {
  const tuile = async (o: Onglet, libelle: string) =>
    propre(await o.page.locator('.section-card').filter({ hasText: libelle }).first().locator('p').nth(1).innerText());

  it('[D-EL-13] « N envoi(s) ont échoué ces 7 derniers jours » = les échecs du jeu', async () => {
    await avecCapture(fr, 'd-apercu-erreurs', async () => {
      await fr.page.goto(`${fr.base}/automations/apercu`);
      await expect.poll(async () => propre(await fr.page.locator('.section-card').last().innerText()))
        .toContain(`${jeu.totaux.echecs7j} envoi(s) ont échoué ces 7 derniers jours.`);
    });
  });

  it('[D-09] « Total des déclenchements » = la somme des « Total déclenché » de la liste sur la même période', async () => {
    await avecCapture(fr, 'd-apercu-total', async () => {
      await fr.page.goto(`${fr.base}/automations/apercu`);
      await fr.page.locator('[role="img"]').first().waitFor();
      // Le jeu : 24 déclenchements en 7 semaines. La liste (colonne par colonne) en montre 24.
      // La tuile compte des couples (fiche, événement) : 4 règles sur le même client = 1, un envoi reporté = 0.
      expect(Number(await tuile(fr, 'Total des déclenchements')), 'tuile « Total des déclenchements »').toBe(jeu.totaux.declenchements49j);
    });
  });
});

describe('D — l’onglet Journaux contre le jeu connu', () => {
  it('[D-EL-14] chaque exécution du jeu apparaît (60 jours) : nombre de lignes par règle', async () => {
    await avecCapture(fr, 'd-journaux-lignes', async () => {
      const ecarts: string[] = [];
      for (const r of Object.values(jeu.regles)) {
        await ouvrirOngletEditeur(fr, r.id, 'journaux');
        const n = await lignesJournaux(fr.page).count();
        if (n !== r.attendu.journaux60) ecarts.push(`${r.cle} : ${n} ligne(s) à l'écran ≠ ${r.attendu.journaux60}`);
      }
      expect(ecarts, ecarts.join('\n')).toEqual([]);
    });
  });

  it('[D-10] le filtre « Réussis » ne montre pas les envois SAUTÉS (client sans téléphone)', async () => {
    await avecCapture(fr, 'd-journaux-filtre-reussis', async () => {
      await ouvrirOngletEditeur(fr, jeu.regles.T.id, 'journaux');
      await fr.page.locator('select').nth(1).selectOption('succes');
      await fr.page.locator('.section-card .animate-spin').waitFor({ state: 'detached' });
      await fr.page.waitForTimeout(400);
      const lignes = (await lignesJournaux(fr.page).allInnerTexts()).map(propre);
      // Rien n'est parti pour ces deux clients : « Réussis » devrait être vide.
      expect(lignes, lignes.join(' | ')).toEqual([]);
    });
  });

  it('[D-10b] un filtre de statut permet d’isoler les envois sautés / ignorés', async () => {
    await ouvrirOngletEditeur(fr, jeu.regles.T.id, 'journaux');
    const options = (await fr.page.locator('select').nth(1).locator('option').allInnerTexts()).map(propre);
    expect(options.some((o) => /saut|ignor/i.test(o)), `options du filtre : ${options.join(', ')}`).toBe(true);
  });

  it('[D-11] le détail d’un envoi ÉCHOUÉ montre le message qui devait partir, pas « exécution antérieure au journal détaillé »', async () => {
    await avecCapture(fr, 'd-journaux-detail-echec', async () => {
      await ouvrirOngletEditeur(fr, jeu.regles.E.id, 'journaux');
      await lignesJournaux(fr.page).first().click();
      const detail = propre(await fr.page.locator('table tbody tr').nth(1).innerText());
      // L'échec date d'aujourd'hui ; le texte du message est dans action_config, que l'écran ne lit pas.
      expect(detail).not.toContain('exécution antérieure au journal détaillé');
      expect(detail).toContain('Bonjour, votre demande est bien reçue.');
    });
  });

  it('[D-12] en anglais, la raison d’un envoi sauté est en anglais (Journaux et panneau de la liste)', async () => {
    await avecCapture(en, 'd-journaux-anglais', async () => {
      const francais: string[] = [];
      for (const cle of ['T', 'D', 'C', 'N', 'K']) {
        await ouvrirOngletEditeur(en, jeu.regles[cle].id, 'journaux', true);
        const ligne = propre(await lignesJournaux(en.page).first().innerText());
        if (/Aucun|désabonné|Consentement manquant|Conditions non remplies/.test(ligne)) francais.push(`${cle} : « ${ligne.slice(0, 120)} »`);
      }
      expect(francais, `raisons restées en français dans l'interface anglaise :\n${francais.join('\n')}`).toEqual([]);
    });
  });

  it('[D-13] les Journaux se filtrent par client et par date, et se cherchent', async () => {
    await ouvrirOngletEditeur(fr, jeu.regles.S.id, 'journaux');
    // Le contenu de l'onglet seulement (l'en-tête de l'éditeur porte le champ du nom).
    const contenu = fr.page.getByRole('heading', { name: 'Journaux d’exécution' }).locator('..');
    const controles = {
      recherche: await contenu.locator('input[type="search"], input[type="text"]').count(),
      date: await contenu.locator('input[type="date"]').count(),
    };
    // Aujourd'hui : deux listes (action, statut) et rien d'autre.
    expect(controles.recherche, 'champ de recherche (client)').toBeGreaterThan(0);
    expect(controles.date, 'filtre de date').toBeGreaterThan(0);
  });

  it('[D-14] le nom du client d’une ligne mène à sa fiche', async () => {
    await ouvrirOngletEditeur(fr, jeu.regles.S.id, 'journaux');
    const liens = await fr.page.locator('table tbody a[href*="/clients/"]').count();
    expect(liens, 'liens vers une fiche client dans le tableau des Journaux').toBeGreaterThan(0);
  });

  it('[D-19] les heures des Journaux sont dans le fuseau de l’ENTREPRISE, pas celui de Montréal en dur', async () => {
    const avant = (await admin.from('company_settings').select('timezone').eq('org_id', jeu.orgA).single()).data?.timezone as string;
    await admin.from('company_settings').update({ timezone: 'America/Vancouver' }).eq('org_id', jeu.orgA);
    try {
      const x = jeu.regles.X;
      const { data } = await admin.from('automation_execution_logs').select('created_at').eq('automation_rule_id', x.id).single();
      const instant = new Date(String(data?.created_at));
      const heure = (tz: string) => instant.toLocaleString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz });
      await ouvrirOngletEditeur(fr, x.id, 'journaux');
      const ligne = propre(await lignesJournaux(fr.page).first().innerText());
      expect(ligne, `heure de Montréal affichée : ${heure('America/Montreal')}`).toContain(propre(heure('America/Vancouver')));
    } finally {
      await admin.from('company_settings').update({ timezone: avant }).eq('org_id', jeu.orgA);
    }
  });
});

describe('D — l’onglet Historique contre le jeu connu', () => {
  it('[D-EL-15] file planifiée : les lignes de l’Historique = les tâches du jeu (règles E, H, P)', async () => {
    await avecCapture(fr, 'd-historique-lignes', async () => {
      for (const cle of ['E', 'H', 'P']) {
        await ouvrirOngletEditeur(fr, jeu.regles[cle].id, 'historique');
        expect(await lignesHistorique(fr.page).count(), `règle ${cle}`).toBe(jeu.regles[cle].attendu.historique60);
      }
    });
  });

  it('[D-16] une automatisation IMMÉDIATE qui a traité 5 clients les montre dans son Historique', async () => {
    await avecCapture(fr, 'd-historique-immediat', async () => {
      await ouvrirOngletEditeur(fr, jeu.regles.S.id, 'historique');
      const texte = propre(await fr.page.locator('.section-card').last().innerText());
      // Aujourd'hui : « Aucune inscription. » — l'onglet ne lit que la file planifiée.
      expect(texte).not.toContain('Aucune inscription');
      expect(await lignesHistorique(fr.page).count()).toBe(jeu.regles.S.attendu.stats60.declenches);
    });
  });

  it('[D-05] un envoi reporté hors des heures d’envoi dit POURQUOI il attend', async () => {
    await avecCapture(fr, 'd-historique-report', async () => {
      await ouvrirOngletEditeur(fr, jeu.regles.H.id, 'historique');
      const ligne = propre(await lignesHistorique(fr.page).first().innerText());
      expect(ligne, `ligne affichée : « ${ligne} »`).toMatch(/heures d.envoi|fenêtre d.envoi|heures calmes|reporté/i);
    });
  });

  it('[D-14b] le nom du client d’une ligne de l’Historique mène à sa fiche', async () => {
    await ouvrirOngletEditeur(fr, jeu.regles.P.id, 'historique');
    expect(await fr.page.locator('table tbody a[href*="/clients/"]').count()).toBeGreaterThan(0);
  });
});

describe('D — états : chargement, erreur', () => {
  it('[D-EL-16] statistiques illisibles (API en erreur) : « — » dans les colonnes, et le panneau le dit', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      await o.page.route('**/api/automations/rules/stats*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"panne simulée"}' }));
      await ouvrirListe(o);
      const E = jeu.regles.E;
      await expect.poll(async () => (await cellules(o.page, E))[1]).toContain('échec(s)');
      const c = await cellules(o.page, E);
      expect([c[3], c[4]]).toEqual(['—', '—']);
      await ligneListe(o.page, E).getByRole('button', { name: /^Statistiques de/ }).click();
      expect(propre(await ligneListe(o.page, E).locator('xpath=following-sibling::tr[1]').innerText())).toContain('Les chiffres n’ont pas pu être lus.');
    } finally {
      await o.fermer();
    }
  });

  it('[D-EL-17] journaux illisibles : l’onglet le dit (« Les journaux n’ont pas pu être lus. »)', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      await o.page.route('**/rest/v1/automation_execution_logs*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"panne simulée"}' }));
      await ouvrirOngletEditeur(o, jeu.regles.S.id, 'journaux');
      expect(propre(await o.page.locator('.section-card').last().innerText())).toContain('Les journaux n’ont pas pu être lus.');
    } finally {
      await o.fermer();
    }
  });

  it('[D-17] échecs illisibles : la liste le DIT, au lieu d’afficher « À vérifier (0) » comme si tout allait bien', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      await o.page.route('**/rest/v1/automation_execution_logs*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"panne simulée"}' }));
      await ouvrirListe(o);
      await expect.poll(async () => (await cellules(o.page, jeu.regles.S))[3]).toBe('5');
      const onglet = propre(await o.page.getByRole('tab', { name: /^À vérifier/ }).innerText());
      const avertissement = await o.page.getByText(/n’ont pas pu être lu|n'ont pas pu être lu|illisible/i).count();
      await avecCapture(o, 'd-echecs-illisibles', async () => {
        expect({ onglet, avertissement: avertissement > 0 }, 'le jeu contient 2 règles en échec ; la lecture est en panne')
          .not.toEqual({ onglet: 'À vérifier (0)', avertissement: false });
      });
    } finally {
      await o.fermer();
    }
  });

  it('[D-EL-18] pendant la lecture des journaux, l’onglet montre un indicateur de chargement', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      await o.page.route('**/rest/v1/automation_execution_logs*', async (r) => { await new Promise((ok) => setTimeout(ok, 2500)); await r.continue(); });
      await o.page.goto(`${o.base}/automations/${jeu.regles.S.id}`);
      await o.page.getByRole('tab', { name: 'Journaux', exact: true }).click();
      await o.page.locator('.section-card .animate-spin').waitFor({ state: 'visible', timeout: 5000 });
      await o.page.locator('.section-card .animate-spin').waitFor({ state: 'detached' });
      expect(await lignesJournaux(o.page).count()).toBe(jeu.regles.S.attendu.journaux60);
    } finally {
      await o.fermer();
    }
  });
});

describe('D — mise à jour après une nouvelle exécution', () => {
  it('[D-18] une exécution qui arrive pendant que la liste est ouverte y apparaît sans recharger la page', async () => {
    // Une règle à part : le jeu connu ne bouge pas.
    const nom = `[QA-D jeu] Z — rafraîchissement ${Date.now().toString(36)}`;
    const { data: regle, error } = await admin.from('automation_rules').insert({
      org_id: jeu.orgA, name: nom, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: false, is_preset: false,
      actions: [{ type: 'create_notification', config: { title: 'Rafraîchissement', body: 'x' } }],
    }).select('id').single();
    if (error) throw new Error(error.message);
    const ruleId = regle.id as string;
    try {
      await ouvrirListe(fr);
      const ligne = fr.page.locator('table tbody tr').filter({ hasText: nom }).first();
      await expect.poll(async () => propre(await ligne.locator('td').nth(3).innerText())).toBe('0');

      // Une exécution réelle est écrite pendant que l'écran est ouvert (même forme que celle du moteur).
      const client = jeu.regles.A.clients[0].id;
      const { error: eLog } = await admin.from('automation_execution_logs').insert({
        org_id: jeu.orgA, automation_rule_id: ruleId, trigger_event: 'lead.created', entity_type: 'client', entity_id: client,
        action_type: 'create_notification', action_config: { title: 'Rafraîchissement' }, result_success: true, result_data: { title: 'Rafraîchissement' }, duration_ms: 12,
      });
      if (eLog) throw new Error(eLog.message);

      // Sans recharger : 20 secondes laissées à l'écran pour se mettre à jour.
      let vu = '0';
      const fin = Date.now() + 20_000;
      while (Date.now() < fin && vu === '0') {
        await fr.page.waitForTimeout(1000);
        vu = propre(await ligne.locator('td').nth(3).innerText());
      }
      // Témoin : après rechargement, le chiffre est bien là.
      await ouvrirListe(fr);
      await expect.poll(async () => propre(await fr.page.locator('table tbody tr').filter({ hasText: nom }).first().locator('td').nth(3).innerText())).toBe('1');
      expect(vu, '« Total déclenché » 20 s après l’exécution, sans recharger').toBe('1');
    } finally {
      await admin.from('automation_execution_logs').delete().eq('automation_rule_id', ruleId);
      await admin.from('automation_rules').delete().eq('id', ruleId);
    }
  });
});
