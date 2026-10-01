/**
 * Agent D — point 4 : les chiffres tiennent-ils quand il y a du VOLUME ?
 *
 * Prod, 2026-10-01 (compte agrégé, lecture seule) : un bureau a 2 961 lignes de journal en
 * 49 jours, une règle en a 2 727 en 60 jours, un bureau a 120 échecs en 7 jours.
 * PostgREST rend au plus 1 000 lignes par réponse (prod et pile locale).
 *
 * Ici le volume est POSÉ en base dans le bureau B (d) — même forme que les lignes du moteur,
 * fiches distinctes. Le moteur réel est prouvé par le jeu connu du bureau A ; ce fichier-ci
 * ne prouve que la LECTURE des écrans.
 *
 *   V1 : 1 000 exécutions il y a 30 jours + 50 aujourd'hui  → Vue d'ensemble
 *   V2 : 230 échecs aujourd'hui                             → pastille de la liste, Journaux
 *   V3 : 5 échecs il y a 5 jours                            → onglet « À vérifier »
 */
import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ouvrirOnglet, fermerNavigateur, avecCapture, admin, type Onglet } from '../../../automations-suite/harnais/navigateur';
import { COMPTES } from '../../../automations-suite/harnais/bureau-test';

const JOUR = 86_400_000;
const propre = (t: string | null | undefined) => String(t ?? '').replace(/\s+/g, ' ').trim();
let orgB: string;
let b: Onglet;
const regles: Record<'V1' | 'V2' | 'V3', { id: string; nom: string }> = {} as never;

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
});

afterAll(async () => {
  await b?.fermer();
  await fermerNavigateur();
});

async function ouvrirListe(o: Onglet): Promise<void> {
  await o.page.goto(`${o.base}/automations`);
  await o.page.locator('#rech-automations').waitFor();
  await o.page.locator('table tbody tr').first().waitFor();
  await o.page.locator('#rech-automations').fill('[QA-D volume]');
}
const cellules = async (o: Onglet, nom: string) =>
  (await o.page.locator('table tbody tr').filter({ hasText: nom }).first().locator('td').allInnerTexts()).map(propre);

describe('D — volume : la Vue d’ensemble (1 050 déclenchements en 7 semaines)', () => {
  it('[D-EL-20] témoin : la route de statistiques, elle, compte tout (« Total déclenché » de V1 = 1 050)', async () => {
    await avecCapture(b, 'd-volume-liste', async () => {
      await ouvrirListe(b);
      await expect.poll(async () => (await cellules(b, regles.V1.nom))[3]).toBe('1050');
    });
  });

  it('[D-01] « Total des déclenchements » = 1 050 et la semaine en cours = 50 (pas 1 000 et 0)', async () => {
    await avecCapture(b, 'd-volume-apercu', async () => {
      await b.page.goto(`${b.base}/automations/apercu`);
      await b.page.locator('[role="img"]').first().waitFor();
      const total = Number(propre(await b.page.locator('.section-card').filter({ hasText: 'Total des déclenchements' }).first().locator('p').nth(1).innerText()));
      const courbe = String(await b.page.locator('[role="img"]').first().getAttribute('aria-label'));
      const semaines = courbe.replace(/^.*:/, '').split(',').map((n) => Number(n.trim()));
      // Les 280 échecs de V2 et V3 sont aussi des déclenchements (une règle s'est déclenchée, l'envoi a échoué).
      expect({ total, semaine_en_cours: semaines[semaines.length - 1] }, `courbe lue : ${courbe}`)
        .toEqual({ total: 1050 + 230 + 5, semaine_en_cours: 50 + 230 + 5 });
    });
  });
});

describe('D — volume : les échecs (235 en 7 jours, la lecture s’arrête à 200)', () => {
  it('[D-02] la pastille de V2 dit 230 échecs, et V3 (5 échecs il y a 5 jours) est dans « À vérifier »', async () => {
    await avecCapture(b, 'd-volume-echecs', async () => {
      await ouvrirListe(b);
      await expect.poll(async () => (await cellules(b, regles.V2.nom))[1]).toContain('échec(s)');
      const pastille = (nom: string) => cellules(b, nom).then((c) => Number(/(\d+) échec\(s\)/.exec(c[1])?.[1] ?? 0));
      const onglet = propre(await b.page.getByRole('tab', { name: /^À vérifier/ }).innerText());
      expect({ V2: await pastille(regles.V2.nom), V3: await pastille(regles.V3.nom), onglet })
        .toEqual({ V2: 230, V3: 5, onglet: 'À vérifier (2)' });
    });
  });

  it('[D-02b] le résumé de la Vue d’ensemble dit 235 échecs', async () => {
    await b.page.goto(`${b.base}/automations/apercu`);
    await expect.poll(async () => propre(await b.page.locator('.section-card').last().innerText())).toContain('ont échoué ces 7 derniers jours');
    const texte = propre(await b.page.locator('.section-card').last().innerText());
    expect(Number(/(\d+) envoi\(s\)/.exec(texte)?.[1])).toBe(235);
  });
});

describe('D — volume : l’onglet Journaux (230 lignes pour une règle)', () => {
  it('[D-15] au-delà de 200 lignes, l’onglet le dit ou donne la suite (pagination)', async () => {
    await avecCapture(b, 'd-volume-journaux', async () => {
      await b.page.goto(`${b.base}/automations/${regles.V2.id}`);
      await b.page.getByRole('tab', { name: 'Journaux', exact: true }).click();
      await b.page.locator('.section-card .animate-spin').waitFor({ state: 'detached' });
      const contenu = b.page.getByRole('heading', { name: 'Journaux d’exécution' }).locator('..');
      const compteur = propre(await contenu.locator('span.ml-auto').innerText());
      const suite = await contenu.getByRole('button', { name: /suivant|plus|charger/i }).count();
      // Aujourd'hui : « 200 ligne(s) », sans un mot sur les 30 autres.
      expect({ compteur, suite: suite > 0 }).not.toEqual({ compteur: '200 ligne(s)', suite: false });
    });
  });
});
