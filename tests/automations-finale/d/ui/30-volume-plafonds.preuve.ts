/**
 * Agent D, puis agent S — point 4 : les chiffres tiennent-ils quand il y a du VOLUME ?
 *
 * Prod, 2026-10-01 (compte agrégé, lecture seule) : un bureau a 2 961 lignes de journal en
 * 49 jours, une règle en a 2 727 en 60 jours, un bureau a 120 échecs en 7 jours.
 * PostgREST rend au plus 1 000 lignes par réponse (prod et pile locale) : avant les corrections,
 * la Vue d'ensemble s'arrêtait à 1 000, les pastilles à 200, les onglets à 200.
 *
 * Ici le volume est POSÉ en base dans le bureau B (d) — même forme que les lignes du moteur,
 * fiches distinctes. Le moteur réel est prouvé par le jeu connu du bureau A ; ce fichier-ci
 * ne prouve que la LECTURE : 1 285 lignes, comptées en base, justes sur chaque période.
 *
 *   V1 : 1 000 exécutions il y a 30 jours + 50 aujourd'hui  → Vue d'ensemble, liste, Historique
 *   V2 : 230 échecs aujourd'hui                             → pastille de la liste, Journaux
 *   V3 : 5 échecs il y a 5 jours                            → onglet « À vérifier »
 */
import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { ouvrirOnglet, fermerNavigateur, avecCapture, admin, sessionComplete, type Onglet } from '../../../automations-suite/harnais/navigateur';
import { COMPTES } from '../../../automations-suite/harnais/bureau-test';

const JOUR = 86_400_000;
const propre = (t: string | null | undefined) => String(t ?? '').replace(/\s+/g, ' ').trim();
let orgB: string;
let b: Onglet;
let jetonB: string;
const regles: Record<'V1' | 'V2' | 'V3', { id: string; nom: string }> = {} as never;

/** Ce que chaque période doit montrer (les 1 000 exécutions d'il y a 30 jours sortent de 7 et de 30 jours). */
const ATTENDU = {
  7: { declenchees: 285, envoyees: 50, echouees: 235, V1: 50, V2: 230, V3: 5 },
  30: { declenchees: 285, envoyees: 50, echouees: 235, V1: 50, V2: 230, V3: 5 },
  90: { declenchees: 1285, envoyees: 1050, echouees: 235, V1: 1050, V2: 230, V3: 5 },
} as const;
const PERIODES = [7, 30, 90] as const;

async function inserer(lignes: Array<Record<string, unknown>>): Promise<void> {
  for (let i = 0; i < lignes.length; i += 500) {
    const { error } = await admin.from('automation_execution_logs').insert(lignes.slice(i, i + 500));
    if (error) throw new Error(`volume : ${error.message}`);
  }
}

beforeAll(async () => {
  orgB = inject('uiOrgB');
  await admin.from('automation_execution_logs').delete().eq('org_id', orgB);
  await admin.from('automation_scheduled_tasks').delete().eq('org_id', orgB);
  await admin.from('automation_rules').delete().eq('org_id', orgB).like('name', '[QA-D%');
  for (const cle of ['V1', 'V2', 'V3'] as const) {
    const nom = `[QA-D volume] ${cle}`;
    const { data, error } = await admin.from('automation_rules').insert({
      org_id: orgB, name: nom, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: false, is_preset: false,
      actions: [{ type: 'send_sms', config: { body: 'Bonjour.', type_envoi: 'transactionnel' } }],
    }).select('id').single();
    if (error) throw new Error(error.message);
    regles[cle] = { id: data.id as string, nom };
    // Les trois règles n'ont pas la même milliseconde de création.
    await new Promise((ok) => setTimeout(ok, 15));
  }
  const ligne = (regle: string, quand: number, succes: boolean) => ({
    org_id: orgB, automation_rule_id: regle, trigger_event: 'lead.created', entity_type: 'client', entity_id: randomUUID(),
    action_type: 'send_sms', action_config: { body: 'Bonjour.' }, result_success: succes,
    result_data: succes ? { to: '+15145550199', body: 'Bonjour.' } : null,
    result_error: succes ? null : 'Twilio 30007 : message filtré par l’opérateur', duration_ms: 40,
    created_at: new Date(quand).toISOString(),
  });
  const maintenant = Date.now();
  await inserer([
    ...Array.from({ length: 1000 }, (_, i) => ligne(regles.V1.id, maintenant - 30 * JOUR - i * 1000, true)),
    ...Array.from({ length: 50 }, (_, i) => ligne(regles.V1.id, maintenant - 3_600_000 - i * 1000, true)),
    ...Array.from({ length: 230 }, (_, i) => ligne(regles.V2.id, maintenant - 1_800_000 - i * 1000, false)),
    ...Array.from({ length: 5 }, (_, i) => ligne(regles.V3.id, maintenant - 5 * JOUR - i * 1000, false)),
  ]);
  b = await ouvrirOnglet({ langue: 'fr', email: COMPTES.proprioB.email, org: orgB });
  jetonB = (await sessionComplete(COMPTES.proprioB.email)).access_token;
});

afterAll(async () => {
  await b?.fermer();
  await fermerNavigateur();
});

const choisirPeriode = (page: Page, jours: number) => page.getByLabel(/^(Période|Period)$/).first().selectOption(String(jours));

async function ouvrirListe(o: Onglet, jours: number): Promise<void> {
  await o.page.goto(`${o.base}/automations`);
  await o.page.locator('#rech-automations').waitFor();
  await o.page.locator('table tbody tr').first().waitFor();
  await o.page.locator('#rech-automations').fill('[QA-D volume]');
  await choisirPeriode(o.page, jours);
  await expect.poll(async () => propre(await o.page.locator('thead').innerText())).toContain(`(${jours} j)`);
}
const cellules = async (o: Onglet, nom: string) =>
  (await o.page.locator('table tbody tr').filter({ hasText: nom }).first().locator('td').allInnerTexts()).map(propre);
const finDeLecture = async (page: Page) => { await page.waitForTimeout(150); await page.locator('.section-card .animate-spin').waitFor({ state: 'detached' }); };
const compteur = async (page: Page) => propre(await page.locator('span.ml-auto[aria-live]').first().innerText());

describe('D — volume : la base compte tout (1 285 lignes), sur chaque période', () => {
  it.each(PERIODES)('[D-ST-10] %i jours : la route de statistiques = un compte direct en base', async (jours) => {
    const r = await fetch(`${inject('uiApi')}/api/automations/rules/stats?jours=${jours}`, { headers: { Authorization: `Bearer ${jetonB}`, 'x-org-id': orgB } });
    expect(r.status).toBe(200);
    const s = await r.json() as { periode: { depuis: string }; total: Record<string, number>; par_regle: Record<string, Record<string, number>>; par_jour: Array<{ declenchees: number }> };
    // La vérité, comptée sans le code du produit : les lignes depuis le début de la période.
    const compte = async (filtre: (q: any) => any) => {
      const { count, error } = await filtre(admin.from('automation_execution_logs').select('id', { count: 'exact', head: true }).eq('org_id', orgB).gte('created_at', s.periode.depuis));
      if (error) throw new Error(error.message);
      return count ?? 0;
    };
    const base = {
      declenchees: await compte((q) => q),
      envoyees: await compte((q) => q.eq('result_success', true)),
      echouees: await compte((q) => q.eq('result_success', false)),
    };
    expect(base).toEqual({ declenchees: ATTENDU[jours].declenchees, envoyees: ATTENDU[jours].envoyees, echouees: ATTENDU[jours].echouees });
    expect({ declenchees: s.total.declenchees, envoyees: s.total.envoyees, echouees: s.total.echouees }).toEqual(base);
    for (const cle of ['V1', 'V2', 'V3'] as const) expect(s.par_regle[regles[cle].id]?.declenchees ?? 0, cle).toBe(ATTENDU[jours][cle]);
    expect(s.par_jour.reduce((t, j) => t + j.declenchees, 0), 'somme des jours').toBe(base.declenchees);
  });
});

describe('D — volume : la liste et la Vue d’ensemble (1 285 déclenchements en 90 jours)', () => {
  it.each(PERIODES)('[D-EL-20] %i jours : « Déclenchées » de V1, V2 et V3 dans la liste', async (jours) => {
    await avecCapture(b, `d-volume-liste-${jours}`, async () => {
      await ouvrirListe(b, jours);
      await expect.poll(async () => (await cellules(b, regles.V1.nom))[3]).toBe(String(ATTENDU[jours].V1));
      expect((await cellules(b, regles.V2.nom))[3]).toBe(String(ATTENDU[jours].V2));
      expect((await cellules(b, regles.V3.nom))[3]).toBe(String(ATTENDU[jours].V3));
    });
  });

  it.each(PERIODES)('[D-01] %i jours : la Vue d’ensemble compte tout — « Déclenchées », « Envoyées », « Échouées », et la dernière barre', async (jours) => {
    await avecCapture(b, `d-volume-apercu-${jours}`, async () => {
      await b.page.goto(`${b.base}/automations/apercu`);
      await b.page.locator('[role="img"]').first().waitFor();
      await choisirPeriode(b.page, jours);
      await expect.poll(async () => await b.page.getByText(new RegExp(`^${jours} derniers jours ·`)).count()).toBe(4);
      const tuile = async (libelle: string) => Number(propre(await b.page.locator('.section-card')
        .filter({ has: b.page.locator('p', { hasText: new RegExp(`^${libelle}$`) }) }).first().locator('p').nth(1).innerText()));
      await expect.poll(() => tuile('Déclenchées')).toBe(ATTENDU[jours].declenchees);
      expect({ envoyees: await tuile('Envoyées'), echouees: await tuile('Échouées') }).toEqual({ envoyees: ATTENDU[jours].envoyees, echouees: ATTENDU[jours].echouees });
      const courbe = String(await b.page.locator('[role="img"]').first().getAttribute('aria-label'));
      const barres = courbe.replace(/^.*:/, '').split(',').map((n) => Number(n.trim()));
      expect(barres.reduce((s, n) => s + n, 0), `courbe : ${courbe}`).toBe(ATTENDU[jours].declenchees);
      // Sur 90 jours, une barre = 7 jours finissant aujourd'hui : la dernière porte les 285 de la semaine
      // (avant : « 1000 » au total et « 0 » pour la semaine en cours).
      if (jours === 90) expect(barres[barres.length - 1]).toBe(285);
    });
  });
});

describe('D — volume : les échecs (235 en 7 jours ; l’ancienne lecture s’arrêtait à 200)', () => {
  it('[D-02] la pastille de V2 dit 230 échecs, et V3 (5 échecs il y a 5 jours) est dans « À vérifier »', async () => {
    await avecCapture(b, 'd-volume-echecs', async () => {
      await ouvrirListe(b, 7);
      await expect.poll(async () => (await cellules(b, regles.V2.nom))[1]).toContain('échec(s)');
      const pastille = (nom: string) => cellules(b, nom).then((c) => Number(/(\d+) échec\(s\) dans les 7 derniers jours/.exec(c[1])?.[1] ?? 0));
      const onglet = propre(await b.page.getByRole('tab', { name: /^À vérifier/ }).innerText());
      expect({ V2: await pastille(regles.V2.nom), V3: await pastille(regles.V3.nom), onglet })
        .toEqual({ V2: 230, V3: 5, onglet: 'À vérifier (2)' });
    });
  });

  it('[D-02b] le résumé de la Vue d’ensemble dit 235 échecs', async () => {
    await b.page.goto(`${b.base}/automations/apercu`);
    await b.page.locator('[role="img"]').first().waitFor();
    await choisirPeriode(b.page, 7);
    await expect.poll(async () => propre(await b.page.locator('.section-card').last().innerText())).toContain('ont échoué ces 7 derniers jours');
    const texte = propre(await b.page.locator('.section-card').last().innerText());
    // « action(s) », plus « envoi(s) » : une tâche ou une étiquette en échec n'est pas un envoi (constat D-23).
    expect(Number(/(\d+) action\(s\) ont échoué/.exec(texte)?.[1])).toBe(235);
  });
});

describe('D — volume : Journaux et Historique paginés par le serveur, avec le total', () => {
  it('[D-15] 230 lignes pour une règle : « 1 à 50 sur 230 », et « Suivant » jusqu’à la dernière', async () => {
    await avecCapture(b, 'd-volume-journaux', async () => {
      await b.page.goto(`${b.base}/automations/${regles.V2.id}`);
      await b.page.getByRole('tab', { name: 'Journaux', exact: true }).click();
      await finDeLecture(b.page);
      await choisirPeriode(b.page, 7);
      await finDeLecture(b.page);
      const lignes = b.page.locator('table tbody tr[role="button"]');
      expect(await compteur(b.page)).toBe('1 à 50 sur 230 ligne(s)');
      expect(await lignes.count()).toBe(50);

      await b.page.getByRole('button', { name: 'Suivant' }).click();
      await expect.poll(async () => { await finDeLecture(b.page); return compteur(b.page); }).toBe('51 à 100 sur 230 ligne(s)');

      for (let page = 3; page <= 5; page++) {
        await b.page.getByRole('button', { name: 'Suivant' }).click();
        await expect.poll(async () => { await finDeLecture(b.page); return propre(await b.page.getByText(/^Page \d+ sur 5$/).innerText()); }).toBe(`Page ${page} sur 5`);
      }
      expect(await compteur(b.page)).toBe('201 à 230 sur 230 ligne(s)');
      expect(await lignes.count()).toBe(30);
      expect(await b.page.getByRole('button', { name: 'Suivant' }).isDisabled()).toBe(true);
    });
  });

  it('[D-15a] les cinq pages rendues par le serveur couvrent les 230 lignes, sans doublon ni trou', async () => {
    const ids = new Set<string>();
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(`${inject('uiApi')}/api/automations/rules/journaux?rule_id=${regles.V2.id}&jours=7&page=${page}&par_page=50`, {
        headers: { Authorization: `Bearer ${jetonB}`, 'x-org-id': orgB },
      });
      expect(r.status).toBe(200);
      const corps = await r.json() as { total: number; lignes: Array<{ id: string }> };
      expect(corps.total).toBe(230);
      expect(corps.lignes).toHaveLength(page < 5 ? 50 : 30);
      for (const l of corps.lignes) ids.add(l.id);
    }
    expect(ids.size, 'lignes distinctes sur les cinq pages').toBe(230);
    const { data } = await admin.from('automation_execution_logs').select('id').eq('automation_rule_id', regles.V2.id);
    expect((data ?? []).every((l) => ids.has(l.id as string)), 'chaque ligne de la base est dans une page').toBe(true);
  });

  it('[D-15b] le filtre de statut porte sur TOUTES les lignes, pas sur la page chargée', async () => {
    await b.page.goto(`${b.base}/automations/${regles.V2.id}`);
    await b.page.getByRole('tab', { name: 'Journaux', exact: true }).click();
    await finDeLecture(b.page);
    await choisirPeriode(b.page, 7);
    await b.page.getByLabel('Statut').selectOption('echoues');
    await expect.poll(async () => { await finDeLecture(b.page); return compteur(b.page); }).toBe('1 à 50 sur 230 ligne(s)');
    await b.page.getByLabel('Statut').selectOption('reussis');
    await expect.poll(async () => { await finDeLecture(b.page); return compteur(b.page); }).toBe('0 ligne(s)');
  });

  it('[D-15c] l’Historique d’une règle à 1 050 passages : le total est celui de la base, page par page', async () => {
    await b.page.goto(`${b.base}/automations/${regles.V1.id}`);
    await b.page.getByRole('tab', { name: 'Historique', exact: true }).click();
    await finDeLecture(b.page);
    await choisirPeriode(b.page, 90);
    await expect.poll(async () => { await finDeLecture(b.page); return compteur(b.page); }).toBe('1 à 50 sur 1050 passage(s)');
    await choisirPeriode(b.page, 7);
    await expect.poll(async () => { await finDeLecture(b.page); return compteur(b.page); }).toBe('50 passage(s)');
  });

  it('[D-13d] l’Activité du bureau : 1 285 passages sur 90 jours, 235 en échec', async () => {
    await b.page.goto(`${b.base}/automations/activite`);
    await b.page.getByRole('heading', { level: 1, name: 'Activité des automatisations' }).waitFor();
    await finDeLecture(b.page);
    await choisirPeriode(b.page, 90);
    await expect.poll(async () => { await finDeLecture(b.page); return compteur(b.page); }).toBe('1 à 50 sur 1285 passage(s)');
    await b.page.getByLabel('Statut').selectOption('echoues');
    await expect.poll(async () => { await finDeLecture(b.page); return compteur(b.page); }).toBe('1 à 50 sur 235 passage(s)');
  });
});
