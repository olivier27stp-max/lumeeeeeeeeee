/**
 * Agent D, puis agent S — points 4 et 5 de la mission : ce que les ÉCRANS affichent, au vrai
 * navigateur, contre le jeu connu (../jeu-connu.ts, fabriqué par integration/10-jeu-connu.preuve.ts).
 *
 * Chaque chiffre est comparé au jeu pour CHAQUE période (7, 30, 90 jours), en français et en
 * anglais. Les tests « [D-nn] » portent le numéro de leur constat (D:/lume-final/notes/D-constats.md) ;
 * les « [D-EL-nn] » fixent l'état des lieux.
 *
 * Ce qui a changé avec les corrections (les attentes ont suivi les DÉFINITIONS retenues, écrites
 * dans server/lib/automations-stats.ts) :
 *   · une période se choisit (7, 30, 90 jours) : les attentes sont calculées par période
 *     (`attendu(regle, jours)`), plus sur 60 ou 49 jours fixes ;
 *   · « échouée » = échec DÉFINITIF : la règle E (fournisseur en panne) compte 2 échecs et 1 fiche
 *     en reprise, plus 3 ; le plafond de fréquence (F4) est un envoi ignoré, plus un échec ;
 *   · « envoyée » = message parti chez un client : la notification interne (A) est une action faite ;
 *   · l'Historique montre une ligne par PASSAGE d'un client (plus une ligne par tâche de la file) ;
 *   · les Journaux montrent aussi les états de la file que le journal ne raconte pas (envoi en
 *     attente, report) : leur total suit `attendu().journal`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Page } from '@playwright/test';
import { ouvrirOnglet, fermerNavigateur, avecCapture, admin, type Onglet } from '../../../automations-suite/harnais/navigateur';
import { lireManifeste, attendu, attenduTotal, type Manifeste, type RegleDuJeu } from '../jeu-connu';
import { groupeDuCode, GROUPES_MOTIFS } from '../../../../src/lib/automationMotifs';

let jeu: Manifeste;
let fr: Onglet;
let en: Onglet;

const PERIODES = [7, 30, 90] as const;
const propre = (t: string | null | undefined) => String(t ?? '').replace(/\s+/g, ' ').trim();
const francais = (t: string) => /[éèêàçù]|\b(le|la|les|une?|des|pas|est|été|envoi|aucune?)\b/i.test(t);

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

/** Choisit la période dans le sélecteur de l'écran courant (liste, Vue d'ensemble, onglets). */
async function choisirPeriode(page: Page, jours: number): Promise<void> {
  await page.getByLabel(/^(Période|Period)$/).first().selectOption(String(jours));
}

/** La liste, réduite au jeu connu (recherche par préfixe, 50 lignes par page), sur une période. */
async function ouvrirListe(o: Onglet, jours = 30): Promise<void> {
  await o.page.goto(`${o.base}/automations`);
  await o.page.locator('#rech-automations').waitFor();
  await o.page.locator('table tbody tr').first().waitFor();
  await o.page.locator('#rech-automations').fill('[QA-D jeu]');
  await expect.poll(() => o.page.locator('#par-page').count()).toBeGreaterThan(0);
  await o.page.locator('#par-page').selectOption('50');
  await choisirPeriode(o.page, jours);
  // Les chiffres de la période sont là quand l'en-tête la nomme et que la colonne n'est plus « — ».
  await expect.poll(async () => propre(await o.page.locator('thead').innerText())).toMatch(new RegExp(`\\(${jours} (j|d)\\)`));
}

const ligneListe = (page: Page, r: RegleDuJeu) => page.locator('table tbody tr').filter({ hasText: r.nom }).first();

async function cellules(page: Page, r: RegleDuJeu): Promise<string[]> {
  return (await ligneListe(page, r).locator('td').allInnerTexts()).map(propre);
}

/** Le texte du panneau « › » d'une règle. */
async function panneau(o: Onglet, r: RegleDuJeu, anglais = false): Promise<string> {
  const bouton = ligneListe(o.page, r).getByRole('button', { name: anglais ? /^Stats for/ : /^Statistiques de/ });
  await bouton.click();
  const texte = propre(await ligneListe(o.page, r).locator('xpath=following-sibling::tr[1]').innerText());
  await bouton.click();
  return texte;
}

/** Ouvre un onglet de l'éditeur, sur une période, et attend la fin de sa lecture. */
async function ouvrirOngletEditeur(o: Onglet, ruleId: string, onglet: 'historique' | 'journaux', anglais = false, jours = 90): Promise<void> {
  const nom = onglet === 'historique' ? (anglais ? 'Enrollment history' : 'Historique') : (anglais ? 'Execution logs' : 'Journaux');
  await o.page.goto(`${o.base}/automations/${ruleId}`);
  await o.page.getByRole('tab', { name: nom, exact: true }).click();
  await o.page.getByRole('heading', { level: 2 }).first().waitFor();
  await finDeLecture(o.page);
  await choisirPeriode(o.page, jours);
  await finDeLecture(o.page);
}

async function finDeLecture(page: Page): Promise<void> {
  await page.waitForTimeout(150);
  await page.locator('.section-card .animate-spin').waitFor({ state: 'detached' });
}

const lignesTableau = (page: Page) => page.locator('table tbody tr[role="button"]');
/** « 12 ligne(s) », ou « 1 à 50 sur 230 ligne(s) » : le total rendu par la base. */
async function total(page: Page): Promise<number> {
  const texte = propre(await page.locator('span.ml-auto[aria-live]').first().innerText());
  const m = /(?:sur|of) (\d+)/.exec(texte) ?? /^(\d+)/.exec(texte);
  return Number(m?.[1] ?? NaN);
}

describe('D — la liste des automatisations contre le jeu connu', () => {
  it.each(PERIODES)('[D-EL-10] %i jours : « Déclenchées » et « En cours » de chaque règle = le jeu', async (jours) => {
    await avecCapture(fr, `d-liste-colonnes-${jours}`, async () => {
      await ouvrirListe(fr, jours);
      const S = jeu.regles.S;
      await expect.poll(async () => (await cellules(fr.page, S))[3]).toBe(String(attendu(S, jours).declenchees));
      const ecarts: string[] = [];
      for (const r of Object.values(jeu.regles)) {
        const c = await cellules(fr.page, r);
        const veut = attendu(r, jours);
        if (c[3] !== String(veut.declenchees)) ecarts.push(`${r.cle} Déclenchées : écran ${c[3]} ≠ jeu ${veut.declenchees}`);
        if (c[4] !== String(veut.en_cours)) ecarts.push(`${r.cle} En cours : écran ${c[4]} ≠ jeu ${veut.en_cours}`);
      }
      expect(ecarts, ecarts.join('\n')).toEqual([]);
    });
  });

  it.each(PERIODES)('[D-EL-11] %i jours : le panneau « › » de chaque règle — déclenchées, messages envoyés, échecs, ignorées, reportées, actions faites, en cours = le jeu', async (jours) => {
    await avecCapture(fr, `d-liste-panneau-${jours}`, async () => {
      await ouvrirListe(fr, jours);
      await expect.poll(async () => (await cellules(fr.page, jeu.regles.S))[3]).toBe(String(attendu(jeu.regles.S, jours).declenchees));
      const ecarts: string[] = [];
      for (const r of Object.values(jeu.regles)) {
        const s = attendu(r, jours);
        const veut = `${jours} derniers jours : ${s.declenchees} déclenchée(s), ${s.envoyees} message(s) envoyé(s), ${s.echouees} échec(s), ${s.ignorees} ignorée(s), ${s.reportees} reportée(s), ${s.actions} action(s) interne(s) faite(s). ${s.en_cours} en cours.`;
        const vu = await panneau(fr, r);
        if (!vu.startsWith(veut)) ecarts.push(`${r.cle} : écran « ${vu.slice(0, 190)} » ≠ « ${veut} »`);
      }
      expect(ecarts, ecarts.join('\n')).toEqual([]);
    });
  });

  it('[D-23] une notification interne n’est pas comptée comme un message envoyé : c’est une action interne faite', async () => {
    await ouvrirListe(fr, 30);
    const A = jeu.regles.A;
    await expect.poll(async () => (await cellules(fr.page, A))[3]).toBe('1');
    const texte = await panneau(fr, A);
    // La règle A ne fait que créer une notification pour l'équipe : aucun message n'est parti vers un client.
    expect(texte).not.toContain('1 envoi(s)');
    expect(texte).toContain('0 message(s) envoyé(s)');
    expect(texte).toContain('1 action(s) interne(s) faite(s)');
  });

  it('[D-24] la liste et la Vue d’ensemble laissent choisir la période des chiffres (7, 30, 90 jours), et l’écrivent', async () => {
    const options = async () => (await fr.page.getByRole('combobox', { name: /période|period/i }).first().locator('option').allInnerTexts()).map(propre);
    await ouvrirListe(fr, 7);
    expect(await options()).toEqual(['7 derniers jours', '30 derniers jours', '90 derniers jours']);
    expect(propre(await fr.page.locator('thead').innerText())).toContain('Déclenchées (7 j)');
    await fr.page.goto(`${fr.base}/automations/apercu`);
    await fr.page.locator('[role="img"]').first().waitFor();
    expect(await options()).toEqual(['7 derniers jours', '30 derniers jours', '90 derniers jours']);
    // La période choisie dans la liste est retenue d'un écran à l'autre, et écrite sur chaque chiffre.
    expect(await fr.page.getByRole('combobox', { name: /période/i }).first().inputValue()).toBe('7');
    expect(await fr.page.getByText(/^7 derniers jours ·/).count()).toBe(4);
  });

  it('[D-25] les envois ignorés sont détaillés PAR RAISON dans le panneau de la liste', async () => {
    await ouvrirListe(fr, 30);
    await expect.poll(async () => (await cellules(fr.page, jeu.regles.T))[3]).toBe('2');
    expect(await panneau(fr, jeu.regles.T)).toContain('Ignorées, par raison : Donnée manquante (2)');
    expect(await panneau(fr, jeu.regles.C)).toContain('Ignorées, par raison : Désabonné ou sans consentement (2)');
    expect(await panneau(fr, jeu.regles.K)).toContain('Ignorées, par raison : Hors ciblage (3)');
    expect(await panneau(fr, jeu.regles.F4)).toContain('Ignorées, par raison : Limite d’envois atteinte (1)');
    expect(await panneau(fr, jeu.regles.H)).toContain('Reportées : Reporté au prochain créneau d’envoi (1)');
  });

  it.each([7, 30])('[D-EL-12] %i jours : pastille « N échec(s) dans les N derniers jours » et onglet « À vérifier (N) » = les échecs DÉFINITIFS du jeu', async (jours) => {
    await avecCapture(fr, `d-liste-echecs-${jours}`, async () => {
      await ouvrirListe(fr, jours);
      await expect.poll(async () => propre(await fr.page.getByRole('tab', { name: /^À vérifier/ }).innerText()))
        .toBe(`À vérifier (${attenduTotal(jeu, jours).regles_en_echec})`);
      for (const r of Object.values(jeu.regles)) {
        const nom = (await cellules(fr.page, r))[1];
        const lu = Number(new RegExp(`(\\d+) échec\\(s\\) dans les ${jours} derniers jours`).exec(nom)?.[1] ?? 0);
        expect(lu, `règle ${r.cle} : « ${nom} »`).toBe(attendu(r, jours).echouees);
      }
    });
  });

  it('[D-03] un envoi retenu par le plafond de fréquence n’est pas montré comme un échec, et la règle n’est pas « À vérifier »', async () => {
    await ouvrirListe(fr, 7);
    await expect.poll(async () => (await cellules(fr.page, jeu.regles.F4))[3]).toBe('1');
    const nom = (await cellules(fr.page, jeu.regles.F4))[1];
    expect(nom).not.toMatch(/échec\(s\)/);
    const texte = await panneau(fr, jeu.regles.F4);
    expect(texte).toContain('0 échec(s), 1 ignorée(s)');
    // Ni le numéro du client, ni le texte anglais du moteur (constat D-03b).
    expect(texte).not.toMatch(/\+1\d{10}|Frequency cap/i);
    expect(texte).toContain('Dernier envoi ignoré : Ce client a déjà reçu le maximum de messages commerciaux sur 24 h');
    await fr.page.getByRole('tab', { name: /^À vérifier/ }).click();
    expect(await fr.page.locator('table tbody tr').filter({ hasText: jeu.regles.F4.nom }).count()).toBe(0);
  });

  it('[D-12a] en anglais, le panneau de la liste dit les raisons en anglais', async () => {
    await ouvrirListe(en, 30);
    await expect.poll(async () => (await cellules(en.page, jeu.regles.T))[3]).toBe('2');
    const T = await panneau(en, jeu.regles.T, true);
    expect(T).toContain('Last 30 days: 2 triggered, 0 message(s) sent, 0 failure(s), 2 skipped');
    expect(T).toContain('Skipped, by reason: Missing information (2)');
    expect(T).toContain('Last skipped send: No phone number for this client');
    const K = await panneau(en, jeu.regles.K, true);
    expect(K).toContain('Last skipped send: Conditions not met');
    expect(francais(T + K), T + K).toBe(false);
  });
});

describe('D — la Vue d’ensemble contre le jeu connu', () => {
  const tuile = async (o: Onglet, libelle: string) =>
    propre(await o.page.locator('.section-card').filter({ has: o.page.locator('p', { hasText: new RegExp(`^${libelle}$`) }) }).first().locator('p').nth(1).innerText());

  async function ouvrirApercu(o: Onglet, jours: number): Promise<void> {
    await o.page.goto(`${o.base}/automations/apercu`);
    await o.page.locator('[role="img"]').first().waitFor();
    await choisirPeriode(o.page, jours);
    await expect.poll(async () => await o.page.getByText(new RegExp(`^(${jours} derniers jours|Last ${jours} days) ·`)).count()).toBe(4);
    await o.page.locator('[role="img"]').first().waitFor();
  }

  it.each(PERIODES)('[D-09] %i jours : « Déclenchées » = la somme de la colonne de la liste ; Envoyées, Échouées, Ignorées = le jeu', async (jours) => {
    await avecCapture(fr, `d-apercu-total-${jours}`, async () => {
      const veut = attenduTotal(jeu, jours);
      await ouvrirApercu(fr, jours);
      expect({
        declenchees: Number(await tuile(fr, 'Déclenchées')), envoyees: Number(await tuile(fr, 'Envoyées')),
        echouees: Number(await tuile(fr, 'Échouées')), ignorees: Number(await tuile(fr, 'Ignorées')),
      }).toEqual({ declenchees: veut.declenchees, envoyees: veut.envoyees, echouees: veut.echouees, ignorees: veut.ignorees });
      // La courbe : ses barres font le total (aucune ligne perdue, aucune comptée deux fois).
      const courbe = String(await fr.page.locator('[role="img"]').first().getAttribute('aria-label'));
      const barres = courbe.replace(/^.*:/, '').split(',').map((n) => Number(n.trim()));
      expect(barres.reduce((s, n) => s + n, 0), `courbe : ${courbe}`).toBe(veut.declenchees);
      expect(barres).toHaveLength(jours === 90 ? 13 : jours);

      // Et la liste, sur la même période : la somme de la colonne « Déclenchées » du jeu.
      await ouvrirListe(fr, jours);
      await expect.poll(async () => (await cellules(fr.page, jeu.regles.S))[3]).toBe(String(attendu(jeu.regles.S, jours).declenchees));
      let somme = 0;
      for (const r of Object.values(jeu.regles)) somme += Number((await cellules(fr.page, r))[3]);
      expect(somme, 'somme de la colonne « Déclenchées » de la liste').toBe(veut.declenchees);
    });
  });

  it.each([7, 30])('[D-EL-13] %i jours : « N action(s) ont échoué ces N derniers jours » = les échecs définitifs du jeu', async (jours) => {
    await avecCapture(fr, `d-apercu-erreurs-${jours}`, async () => {
      await ouvrirApercu(fr, jours);
      await expect.poll(async () => propre(await fr.page.locator('.section-card').last().innerText()))
        .toContain(`${attenduTotal(jeu, jours).echouees} action(s) ont échoué ces ${jours} derniers jours.`);
    });
  });

  it('[D-25b] le tableau « Envois ignorés, par raison » = le jeu, groupe par groupe (30 jours), en français et en anglais', async () => {
    const veut = attenduTotal(jeu, 30);
    const parGroupe: Record<string, number> = {};
    for (const [code, n] of Object.entries(veut.ignorees_par_code)) parGroupe[groupeDuCode(code)] = (parGroupe[groupeDuCode(code)] ?? 0) + n;
    for (const [o, langue] of [[fr, 'fr'], [en, 'en']] as const) {
      await ouvrirApercu(o, 30);
      const carte = o.page.locator('.section-card').filter({ hasText: langue === 'fr' ? 'Envois ignorés, par raison' : 'Skipped sends, by reason' });
      const lignes = (await carte.locator('tbody tr').allInnerTexts()).map(propre);
      for (const [groupe, n] of Object.entries(parGroupe)) {
        const libelle = GROUPES_MOTIFS[groupe as keyof typeof GROUPES_MOTIFS][langue];
        expect(lignes, lignes.join(' | ')).toContain(`${libelle} ${n}`);
      }
      // Le report n'est pas un envoi ignoré : il est dit à part.
      expect(lignes.some((l) => /partira|will go out/.test(l) && l.endsWith(` ${veut.reportees}`)), lignes.join(' | ')).toBe(true);
      if (langue === 'en') expect(francais(lignes.join(' ')), lignes.join(' | ')).toBe(false);
    }
  });
});

describe('D — l’onglet Journaux contre le jeu connu', () => {
  it('[D-EL-14] chaque exécution du jeu apparaît (90 jours) : nombre de lignes et total par règle', async () => {
    await avecCapture(fr, 'd-journaux-lignes', async () => {
      const ecarts: string[] = [];
      for (const r of Object.values(jeu.regles)) {
        await ouvrirOngletEditeur(fr, r.id, 'journaux');
        const veut = attendu(r, 90).journal;
        const n = await lignesTableau(fr.page).count();
        const t = await total(fr.page);
        if (n !== veut || t !== veut) ecarts.push(`${r.cle} : ${n} ligne(s) à l'écran, total ${t} ≠ ${veut}`);
      }
      expect(ecarts, ecarts.join('\n')).toEqual([]);
    });
  });

  it('[D-10] le filtre « Réussis » ne montre pas les envois IGNORÉS (client sans téléphone)', async () => {
    await avecCapture(fr, 'd-journaux-filtre-reussis', async () => {
      await ouvrirOngletEditeur(fr, jeu.regles.T.id, 'journaux');
      await fr.page.getByLabel('Statut').selectOption('reussis');
      await finDeLecture(fr.page);
      // Rien n'est parti pour ces deux clients : « Réussis » est vide.
      expect((await lignesTableau(fr.page).allInnerTexts()).map(propre)).toEqual([]);
      expect(await total(fr.page)).toBe(0);
    });
  });

  it('[D-10b] un filtre de statut isole les envois ignorés', async () => {
    await ouvrirOngletEditeur(fr, jeu.regles.T.id, 'journaux');
    const options = (await fr.page.getByLabel('Statut').locator('option').allInnerTexts()).map(propre);
    expect(options).toEqual(['Tous les statuts', 'Réussis', 'Ignorés', 'Reportés', 'Échoués', 'En cours', 'Tentatives reprises']);
    await fr.page.getByLabel('Statut').selectOption('ignores');
    await finDeLecture(fr.page);
    const lignes = (await lignesTableau(fr.page).allInnerTexts()).map(propre);
    expect(lignes).toHaveLength(2);
    expect(lignes.every((l) => l.includes('Ignoré : aucun numéro de téléphone pour ce client')), lignes.join(' | ')).toBe(true);
  });

  it('[D-11] le détail d’un envoi ÉCHOUÉ montre le message qui devait partir et l’erreur exacte', async () => {
    await avecCapture(fr, 'd-journaux-detail-echec', async () => {
      await ouvrirOngletEditeur(fr, jeu.regles.E.id, 'journaux');
      await fr.page.getByLabel('Statut').selectOption('echoues');
      await finDeLecture(fr.page);
      expect(await total(fr.page), 'échecs définitifs de E sur 90 jours').toBe(attendu(jeu.regles.E, 90).echouees);
      await lignesTableau(fr.page).first().click();
      const detail = propre(await fr.page.locator('table tbody tr').nth(1).innerText());
      expect(detail).not.toContain('exécution antérieure au journal détaillé');
      // (Le titre du bloc est écrit en capitales par la feuille de style.)
      expect(detail.toLowerCase()).toContain('rien n’est parti — le message prévu');
      expect(detail).toContain('Bonjour, votre demande est bien reçue.');
      expect(detail).toMatch(/Texte exact du moteur .*panne/i);
    });
  });

  it('[D-26] le détail d’une ligne donne l’événement déclencheur, la décision, la durée et la clé d’exécution', async () => {
    await ouvrirOngletEditeur(fr, jeu.regles.S.id, 'journaux');
    await lignesTableau(fr.page).first().click();
    const detail = propre(await fr.page.locator('table tbody tr').nth(1).innerText());
    expect(detail, detail).toMatch(/Événement déclencheur Nouveau prospect \(lead\.created\)/);
    expect(detail).toMatch(/Décision Envoyé \(fait\)/);
    expect(detail).toMatch(/Durée \d+ ms/);
    expect(detail).toContain('Clé d’exécution');
    expect(detail).toContain('Bonjour, merci de votre demande.');

    // Une règle écartée par ses conditions : la condition qui a écarté la fiche, jamais des clés brutes.
    await ouvrirOngletEditeur(fr, jeu.regles.K.id, 'journaux');
    await lignesTableau(fr.page).first().click();
    const ecartee = propre(await fr.page.locator('table tbody tr').nth(1).innerText());
    expect(ecartee).toMatch(/Décision Conditions non remplies : source \(conditions\)/);
    expect(ecartee).toContain('Condition non remplie source');
    expect(ecartee).not.toMatch(/saute_code:|saute:/);
  });

  it('[D-12] en anglais, la raison d’un envoi ignoré est en anglais (Journaux et Historique)', async () => {
    await avecCapture(en, 'd-journaux-anglais', async () => {
      const restes: string[] = [];
      for (const cle of ['T', 'D', 'C', 'N', 'K', 'H', 'F4', 'E']) {
        for (const onglet of ['journaux', 'historique'] as const) {
          await ouvrirOngletEditeur(en, jeu.regles[cle].id, onglet, true);
          const lignes = (await lignesTableau(en.page).allInnerTexts()).map(propre)
            // Le nom du client et celui de l'étape viennent des données ; on juge la raison.
            .map((l) => l.replace(/Jeu \S+ \S+/g, ''));
          for (const l of lignes) if (francais(l)) restes.push(`${cle} ${onglet} : « ${l.slice(0, 140)} »`);
        }
      }
      expect(restes, `raisons restées en français dans l'interface anglaise :\n${restes.join('\n')}`).toEqual([]);
    });
  });

  it('[D-13] les Journaux se cherchent par client, et se filtrent par dates', async () => {
    const S = jeu.regles.S;
    await ouvrirOngletEditeur(fr, S.id, 'journaux');
    const contenu = fr.page.getByRole('heading', { name: 'Journaux d’exécution' }).locator('..');
    expect(await contenu.locator('input[type="search"]').count(), 'champ de recherche (client)').toBe(1);
    expect(await contenu.locator('input[type="date"]').count(), 'filtres de date').toBe(2);

    // Recherche : le nom d'UN client du jeu ne laisse que sa ligne.
    const client = S.clients[2];
    await fr.page.getByLabel('Client').fill(client.nom);
    await expect.poll(async () => { await finDeLecture(fr.page); return total(fr.page); }).toBe(1);
    expect(propre(await lignesTableau(fr.page).first().innerText())).toContain(client.nom);
    await fr.page.getByLabel('Client').fill('personne-ne-s-appelle-ainsi');
    await expect.poll(async () => { await finDeLecture(fr.page); return total(fr.page); }).toBe(0);
    expect(propre(await fr.page.locator('.section-card').last().innerText())).toContain('Aucun journal pour ces filtres.');
    await fr.page.getByLabel('Client').fill('');
    await expect.poll(async () => { await finDeLecture(fr.page); return total(fr.page); }).toBe(attendu(S, 90).journal);

    // Dates : « du » aujourd'hui (fuseau du bureau) ne garde que les exécutions du jour.
    const aujourdHui = new Intl.DateTimeFormat('en-CA', { timeZone: jeu.fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    await fr.page.getByLabel('Du', { exact: true }).fill(aujourdHui);
    await expect.poll(async () => { await finDeLecture(fr.page); return total(fr.page); }).toBe(S.clients.filter((c) => c.age_jours === 0).length);
  });

  it('[D-14] le nom du client d’une ligne mène à sa fiche', async () => {
    await ouvrirOngletEditeur(fr, jeu.regles.S.id, 'journaux');
    const liens = fr.page.locator('table tbody a[href*="/clients/"]');
    expect(await liens.count(), 'liens vers une fiche client dans le tableau des Journaux').toBe(attendu(jeu.regles.S, 90).journal);
    const ids = jeu.regles.S.clients.map((c) => c.id);
    expect(ids).toContain(String(await liens.first().getAttribute('href')).split('/').pop());
  });

  it('[D-19] les heures des Journaux sont dans le fuseau de l’ENTREPRISE, pas celui de Montréal en dur', async () => {
    const avant = (await admin.from('company_settings').select('timezone').eq('org_id', jeu.orgA).single()).data?.timezone as string;
    const autre = avant === 'America/Vancouver' ? 'Asia/Tokyo' : 'America/Vancouver';
    await admin.from('company_settings').update({ timezone: autre }).eq('org_id', jeu.orgA);
    try {
      const x = jeu.regles.X;
      const { data } = await admin.from('automation_execution_logs').select('created_at').eq('automation_rule_id', x.id).order('created_at').limit(1).single();
      const instant = new Date(String(data?.created_at));
      const heure = (tz: string) => instant.toLocaleString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz });
      await ouvrirOngletEditeur(fr, x.id, 'journaux');
      const lignes = (await lignesTableau(fr.page).allInnerTexts()).map(propre).join(' | ');
      expect(lignes, `heure de Montréal : ${heure('America/Montreal')}`).toContain(propre(heure(autre)));
    } finally {
      await admin.from('company_settings').update({ timezone: avant }).eq('org_id', jeu.orgA);
    }
  });
});

describe('D — l’onglet Historique contre le jeu connu', () => {
  it.each(PERIODES)('[D-16] %i jours : une ligne par PASSAGE d’un client, y compris pour une automatisation immédiate', async (jours) => {
    await avecCapture(fr, `d-historique-passages-${jours}`, async () => {
      const ecarts: string[] = [];
      for (const r of Object.values(jeu.regles)) {
        await ouvrirOngletEditeur(fr, r.id, 'historique', false, jours);
        const veut = attendu(r, jours).passages;
        const n = await lignesTableau(fr.page).count();
        if (n !== veut || (await total(fr.page)) !== veut) ecarts.push(`${r.cle} : ${n} passage(s) à l'écran ≠ ${veut}`);
      }
      expect(ecarts, ecarts.join('\n')).toEqual([]);
    });
  });

  it('[D-16b] l’Historique dit le résultat en clair : envoyé, ignoré et pourquoi, échec et pourquoi, à venir', async () => {
    const resultats = async (cle: string) => {
      await ouvrirOngletEditeur(fr, jeu.regles[cle].id, 'historique');
      return (await lignesTableau(fr.page).allInnerTexts()).map(propre);
    };
    const S = await resultats('S');
    expect(S).toHaveLength(6);
    expect(S.every((l) => l.includes('Envoyé') && l.includes('Texto envoyé')), S.join(' | ')).toBe(true);
    expect(await fr.page.getByText('Aucune inscription').count()).toBe(0);

    const T = await resultats('T');
    expect(T.every((l) => l.includes('Ignoré : aucun numéro de téléphone pour ce client')), T.join(' | ')).toBe(true);
    const D = await resultats('D');
    expect(D.every((l) => /Ignoré : client désabonné/.test(l)), D.join(' | ')).toBe(true);
    const K = await resultats('K');
    expect(K.every((l) => l.includes('Ignoré : conditions non remplies : source')), K.join(' | ')).toBe(true);
    const A = await resultats('A');
    expect(A[0]).toContain('Équipe notifiée');

    // E : deux échecs définitifs (avec leur cause), une fiche encore en reprise.
    const E = await resultats('E');
    expect(E.filter((l) => /Échec : le fournisseur d’envoi \(bac à sable\) était en panne/.test(l))).toHaveLength(2);
    expect(E.filter((l) => /En cours Échec passager : nouvelle tentative prévue — prévu le/.test(l))).toHaveLength(1);

    // P : le courriel est parti, le texto est À VENIR — avec le nom de l'étape en clair, pas « e3 ».
    const P = await resultats('P');
    expect(P.every((l) => /En cours À venir : Étape 3 · Texto, prévu le/.test(l)), P.join(' | ')).toBe(true);
    expect(P.join(' ')).not.toMatch(/\(e3\)/);
    await lignesTableau(fr.page).first().click();
    const etapes = propre(await fr.page.locator('table tbody tr').nth(1).innerText());
    expect(etapes).toMatch(/Étape 1 · Courriel Courriel envoyé/);
    expect(etapes).toMatch(/Étape 3 · Texto En attente — prévu le/);
  });

  it('[D-05] un envoi reporté hors des heures d’envoi dit POURQUOI il attend', async () => {
    await avecCapture(fr, 'd-historique-report', async () => {
      await ouvrirOngletEditeur(fr, jeu.regles.H.id, 'historique');
      const ligne = propre(await lignesTableau(fr.page).first().innerText());
      expect(ligne, `ligne affichée : « ${ligne} »`).toMatch(/Reporté au prochain créneau d’envoi — prévu le/);
    });
  });

  it('[D-14b] le nom du client d’une ligne de l’Historique mène à sa fiche', async () => {
    await ouvrirOngletEditeur(fr, jeu.regles.P.id, 'historique');
    expect(await fr.page.locator('table tbody a[href*="/clients/"]').count()).toBe(2);
  });

  it('[D-10c] l’Historique se filtre par résultat : « Ignorés », « Échoués », « En cours »', async () => {
    await ouvrirOngletEditeur(fr, jeu.regles.E.id, 'historique');
    const options = (await fr.page.getByLabel('Statut').locator('option').allInnerTexts()).map(propre);
    expect(options).toEqual(['Tous les statuts', 'Réussis', 'Ignorés', 'Reportés', 'Échoués', 'En cours']);
    await fr.page.getByLabel('Statut').selectOption('echoues');
    await finDeLecture(fr.page);
    expect(await total(fr.page)).toBe(2);
    await fr.page.getByLabel('Statut').selectOption('en_cours');
    await finDeLecture(fr.page);
    expect(await total(fr.page)).toBe(1);
    await fr.page.getByLabel('Statut').selectOption('reussis');
    await finDeLecture(fr.page);
    expect(await total(fr.page)).toBe(0);
  });
});

describe('D — l’activité à l’échelle du BUREAU', () => {
  it.each([7, 30])('[D-13b] %i jours : la page Activité montre tous les passages du bureau, filtrables par automatisation et par client', async (jours) => {
    await avecCapture(fr, `d-activite-${jours}`, async () => {
      await fr.page.goto(`${fr.base}/automations/activite`);
      await fr.page.getByRole('heading', { level: 1, name: 'Activité des automatisations' }).waitFor();
      await finDeLecture(fr.page);
      await choisirPeriode(fr.page, jours);
      await finDeLecture(fr.page);
      const veut = attenduTotal(jeu, jours);
      expect(await total(fr.page), 'passages du bureau').toBe(veut.passages);

      // Par automatisation.
      await fr.page.getByLabel('Automatisation').selectOption(jeu.regles.S.id);
      await finDeLecture(fr.page);
      expect(await total(fr.page)).toBe(attendu(jeu.regles.S, jours).passages);
      await fr.page.getByLabel('Automatisation').selectOption('');
      await finDeLecture(fr.page);

      // Par client : « qu'est-ce que ce client a reçu ? » — le client des quatre offres (F1 à F4).
      await fr.page.getByLabel('Client').fill(jeu.regles.F1.clients[0].nom);
      await expect.poll(async () => { await finDeLecture(fr.page); return total(fr.page); }).toBe(4);
      const lignes = (await lignesTableau(fr.page).allInnerTexts()).map(propre);
      expect(lignes.filter((l) => l.includes('Texto envoyé'))).toHaveLength(3);
      expect(lignes.filter((l) => l.includes('Ignoré : ce client a déjà reçu le maximum de messages commerciaux sur 24 h'))).toHaveLength(1);
      // Chaque ligne nomme son automatisation, avec un lien vers elle.
      expect(await fr.page.locator('table tbody a[href*="/automations/"]').count()).toBe(4);

      // Les Journaux du bureau : le même total que la somme des journaux des règles.
      await fr.page.getByRole('tab', { name: 'Journaux', exact: true }).click();
      await finDeLecture(fr.page);
      await choisirPeriode(fr.page, jours);
      await finDeLecture(fr.page);
      expect(await total(fr.page), 'lignes de journal du bureau').toBe(veut.journal);
    });
  });

  it('[D-13c] la sous-navigation mène à l’Activité, et le panneau de la liste y ouvre l’automatisation', async () => {
    await ouvrirListe(fr, 30);
    await expect.poll(async () => (await cellules(fr.page, jeu.regles.S))[3]).toBe(String(attendu(jeu.regles.S, 30).declenchees));
    expect(await fr.page.getByRole('link', { name: 'Activité', exact: true }).getAttribute('href')).toBe('/automations/activite');
    await ligneListe(fr.page, jeu.regles.S).getByRole('button', { name: /^Statistiques de/ }).click();
    await fr.page.getByRole('link', { name: 'Voir l’historique, client par client' }).click();
    await fr.page.getByRole('heading', { level: 1, name: 'Activité des automatisations' }).waitFor();
    await finDeLecture(fr.page);
    expect(await fr.page.getByLabel('Automatisation').inputValue()).toBe(jeu.regles.S.id);
    expect(await total(fr.page)).toBe(attendu(jeu.regles.S, 30).passages);
  });
});

describe('D — le panneau d’étape › Statistiques contre le jeu connu', () => {
  it('[D-EL-19] parcours P : le courriel (e1) = 2 réussis ; le texto (e3) = 2 en attente', async () => {
    await avecCapture(fr, 'd-etape-statistiques', async () => {
      await fr.page.goto(`${fr.base}/automations/${jeu.regles.P.id}`);
      const carte = (titre: string) => fr.page.locator('div.relative.w-\\[260px\\]').filter({ has: fr.page.locator('span.font-medium', { hasText: titre }) }).first();
      const panneauEtape = fr.page.getByRole('complementary', { name: 'Modifier l’étape' });
      const lire = async (titre: string): Promise<string> => {
        await carte(titre).locator('button').first().click();
        await panneauEtape.waitFor();
        await panneauEtape.getByRole('tab', { name: 'Statistiques' }).click();
        await expect.poll(async () => propre(await panneauEtape.innerText())).toContain('60 derniers jours.');
        const texte = propre(await panneauEtape.innerText());
        await panneauEtape.getByRole('button', { name: 'Fermer le panneau' }).click();
        await panneauEtape.waitFor({ state: 'hidden' });
        return texte;
      };
      const courriel = await lire('Envoyer un courriel');
      for (const veut of ['Réussis 2', 'Sautés 0', 'Échoués 0', 'En attente 0']) expect(courriel, courriel).toContain(veut);
      const texto = await lire('Envoyer un texto');
      for (const veut of ['Réussis 0', 'Sautés 0', 'Échoués 0', 'En attente 2']) expect(texto, texto).toContain(veut);
    });
  });
});

describe('D — états : chargement, erreur', () => {
  it('[D-17] statistiques illisibles (route en erreur) : la liste le DIT — « — » dans les colonnes, « À vérifier (?) », un bandeau, et « Réessayer » les relit', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      let enPanne = true;
      await o.page.route('**/api/automations/rules/stats*', (r) => (enPanne
        ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"panne simulée"}' })
        : r.continue()));
      await o.page.goto(`${o.base}/automations`);
      await o.page.locator('#rech-automations').waitFor();
      await o.page.locator('table tbody tr').first().waitFor();
      await o.page.locator('#rech-automations').fill('[QA-D jeu]');
      await o.page.locator('#par-page').selectOption('50');
      const E = jeu.regles.E;
      await avecCapture(o, 'd-echecs-illisibles', async () => {
        await expect.poll(async () => propre(await o.page.getByRole('tab', { name: /^À vérifier/ }).innerText())).toBe('À vérifier (?)');
        const c = await cellules(o.page, E);
        expect([c[3], c[4]]).toEqual(['—', '—']);
        expect(propre(await o.page.getByRole('alert').first().innerText())).toContain('Les chiffres et les échecs n’ont pas pu être lus');
        await ligneListe(o.page, E).getByRole('button', { name: /^Statistiques de/ }).click();
        expect(propre(await ligneListe(o.page, E).locator('xpath=following-sibling::tr[1]').innerText())).toContain('Les chiffres n’ont pas pu être lus.');
      });
      // La panne passée, « Réessayer » ramène les vrais chiffres — sans recharger la page.
      enPanne = false;
      await o.page.getByRole('button', { name: 'Réessayer' }).click();
      await expect.poll(async () => (await cellules(o.page, E))[3]).toBe(String(attendu(E, 30).declenchees));
      await expect.poll(async () => propre(await o.page.getByRole('tab', { name: /^À vérifier/ }).innerText())).toBe(`À vérifier (${attenduTotal(jeu, 30).regles_en_echec})`);
      expect(await o.page.getByRole('alert').count()).toBe(0);
    } finally {
      await o.fermer();
    }
  });

  it('[D-17b] statistiques illisibles : la Vue d’ensemble affiche « — » et une alerte, jamais 0 ni « Aucune erreur »', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      await o.page.route('**/api/automations/rules/stats*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"panne simulée"}' }));
      await o.page.goto(`${o.base}/automations/apercu`);
      await o.page.getByRole('alert').first().waitFor();
      const texte = propre(await o.page.locator('body').innerText());
      expect(texte).toContain('Les chiffres n’ont pas pu être lus pour le moment');
      expect(texte).toContain('Les erreurs n’ont pas pu être lues');
      expect(texte).not.toContain('Aucune erreur');
      for (const libelle of ['Déclenchées', 'Envoyées', 'Échouées', 'Ignorées']) {
        const valeur = propre(await o.page.locator('.section-card').filter({ has: o.page.locator('p', { hasText: new RegExp(`^${libelle}$`) }) }).first().locator('p').nth(1).innerText());
        expect(valeur, libelle).toBe('—');
      }
    } finally {
      await o.fermer();
    }
  });

  it('[D-EL-17] journaux illisibles : l’onglet le dit, et « Réessayer » les relit', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      let enPanne = true;
      await o.page.route('**/api/automations/rules/journaux*', (r) => (enPanne
        ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"panne simulée"}' })
        : r.continue()));
      await o.page.goto(`${o.base}/automations/${jeu.regles.S.id}`);
      await o.page.getByRole('tab', { name: 'Journaux', exact: true }).click();
      await o.page.getByRole('alert').first().waitFor();
      const carte = propre(await o.page.locator('.section-card').last().innerText());
      expect(carte).toContain('Les journaux n’ont pas pu être lus.');
      expect(carte).not.toContain('Aucun journal');
      enPanne = false;
      await o.page.getByRole('button', { name: 'Réessayer' }).click();
      await expect.poll(() => lignesTableau(o.page).count()).toBe(attendu(jeu.regles.S, 30).journal);
    } finally {
      await o.fermer();
    }
  });

  it('[D-EL-18] pendant la lecture des journaux, l’onglet montre un indicateur de chargement', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      await o.page.route('**/api/automations/rules/journaux*', async (r) => { await new Promise((ok) => setTimeout(ok, 2500)); await r.continue(); });
      await o.page.goto(`${o.base}/automations/${jeu.regles.S.id}`);
      await o.page.getByRole('tab', { name: 'Journaux', exact: true }).click();
      await o.page.locator('.section-card .animate-spin').waitFor({ state: 'visible', timeout: 5000 });
      await o.page.locator('.section-card .animate-spin').waitFor({ state: 'detached' });
      expect(await lignesTableau(o.page).count()).toBe(attendu(jeu.regles.S, 30).journal);
    } finally {
      await o.fermer();
    }
  });

  it('[D-EL-21] un bureau sans exécution : des zéros, et « Aucun journal » — pas une panne', async () => {
    const { data: regle, error } = await admin.from('automation_rules').insert({
      org_id: jeu.orgA, name: `[QA-D jeu] V — jamais déclenchée ${Date.now().toString(36)}`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0,
      is_active: false, is_preset: false, actions: [{ type: 'create_notification', config: { title: 'x', body: 'x' } }],
    }).select('id, name').single();
    if (error) throw new Error(error.message);
    try {
      await ouvrirListe(fr, 30);
      const ligne = fr.page.locator('table tbody tr').filter({ hasText: String(regle.name) }).first();
      await expect.poll(async () => (await ligne.locator('td').allInnerTexts()).map(propre).slice(3, 5)).toEqual(['0', '0']);
      await ouvrirOngletEditeur(fr, String(regle.id), 'journaux');
      expect(propre(await fr.page.locator('.section-card').last().innerText())).toContain('Aucun journal pour ces filtres.');
      expect(await fr.page.getByRole('alert').count()).toBe(0);
    } finally {
      await admin.from('automation_rules').delete().eq('id', regle.id);
    }
  });
});

describe('D — mise à jour après une nouvelle exécution', () => {
  it('[D-18] une exécution qui arrive pendant que la liste est ouverte y apparaît sans recharger la page (relecture toutes les 30 s)', async () => {
    // Une règle à part : le jeu connu ne bouge pas.
    const nom = `[QA-D jeu] Z — rafraîchissement ${Date.now().toString(36)}`;
    const { data: regle, error } = await admin.from('automation_rules').insert({
      org_id: jeu.orgA, name: nom, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: false, is_preset: false,
      actions: [{ type: 'create_notification', config: { title: 'Rafraîchissement', body: 'x' } }],
    }).select('id').single();
    if (error) throw new Error(error.message);
    const ruleId = regle.id as string;
    try {
      await ouvrirListe(fr, 30);
      const ligne = fr.page.locator('table tbody tr').filter({ hasText: nom }).first();
      await expect.poll(async () => propre(await ligne.locator('td').nth(3).innerText())).toBe('0');

      // Une exécution réelle est écrite pendant que l'écran est ouvert (même forme que celle du moteur).
      const client = jeu.regles.A.clients[0].id;
      const { error: eLog } = await admin.from('automation_execution_logs').insert({
        org_id: jeu.orgA, automation_rule_id: ruleId, trigger_event: 'lead.created', entity_type: 'client', entity_id: client,
        action_type: 'create_notification', action_config: { title: 'Rafraîchissement' }, result_success: true, result_data: { title: 'Rafraîchissement' }, duration_ms: 12,
      });
      if (eLog) throw new Error(eLog.message);

      // Sans recharger ni toucher à l'écran : la liste relit ses chiffres toutes les 30 secondes.
      // (La preuve d'origine laissait 20 s ; l'intervalle retenu est de 30 s : on en laisse 45.)
      let vu = '0';
      const fin = Date.now() + 45_000;
      while (Date.now() < fin && vu === '0') {
        await fr.page.waitForTimeout(1000);
        vu = propre(await ligne.locator('td').nth(3).innerText());
      }
      expect(vu, '« Déclenchées » dans les 45 s qui suivent l’exécution, sans recharger').toBe('1');
    } finally {
      await admin.from('automation_execution_logs').delete().eq('automation_rule_id', ruleId);
      await admin.from('automation_rules').delete().eq('id', ruleId);
    }
  }, 240_000);
});
