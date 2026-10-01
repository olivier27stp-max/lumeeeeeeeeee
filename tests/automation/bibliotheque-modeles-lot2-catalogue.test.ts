/**
 * Catalogue de la bibliothèque de modèles — constats de l'audit UI du
 * 2026-10-01 (lot 2), prouvés sur les VRAIES données (préréglages + pack) et
 * sur la vraie route GET /api/automations/templates ; seule la session est
 * simulée.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  requireAuthedClient: async () => ({ orgId: '11111111-1111-4111-8111-111111111111', user: { id: 'u' }, client: {} }),
}));

import router from '../../server/routes/automation-rules';
import { MODELES_AUTOMATISATION, trouverModele } from '../../server/lib/automationTemplates';
import { etapesApercu, type CanalModele, type ModeleAutomatisation } from '../../src/lib/automationTemplates';
import { projeterFormatOrigine, type Etape } from '../../src/lib/sequenceTypes';

const app = express();
app.use(express.json());
app.use('/api', router);
const serveur = app.listen(0);
const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api/automations/templates`;
afterAll(() => serveur.close());

/** Ce que la route sert vraiment (pas seulement la constante importée). */
async function catalogueServi(): Promise<ModeleAutomatisation[]> {
  const r = await fetch(base);
  expect(r.status).toBe(200);
  return ((await r.json()) as { modeles: ModeleAutomatisation[] }).modeles;
}

const CANAL: Record<string, CanalModele> = {
  send_sms: 'sms', send_email: 'courriel', create_notification: 'notification',
  create_task: 'tache', request_review: 'avis', move_deal_stage: 'pipeline',
};

/** Toutes les étapes qu'on peut atteindre depuis la première, par N'IMPORTE quelle sortie. */
function atteignables(steps: Etape[]): Etape[] {
  const parId = new Map(steps.map((e) => [e.id, e]));
  const vues = new Set<string>();
  const pile = [steps[0]?.id];
  while (pile.length > 0) {
    const id = pile.pop();
    const e = id ? parId.get(id) : undefined;
    if (!e || vues.has(e.id)) continue;
    vues.add(e.id);
    if (e.type === 'si') pile.push(e.alors ?? undefined, e.sinon ?? undefined);
    else if (e.type === 'attendre') pile.push(e.suivant ?? undefined, e.si_reponse ?? undefined, e.si_depasse ?? undefined);
    else if (e.type === 'action') pile.push(e.suivant ?? undefined);
  }
  return steps.filter((e) => vues.has(e.id));
}

describe('modeles-07 — le nombre d’étapes annoncé est celui que l’éditeur montrera', () => {
  /** Les étapes de la COPIE, telles que la route « Utiliser ce modèle » les crée : une carte chacune dans l'éditeur. */
  const cartesDeLaCopie = (m: ModeleAutomatisation) => atteignables(
    m.steps ?? projeterFormatOrigine({ actions: m.actions, delay_seconds: m.delai_secondes }),
  ).filter((e) => e.type !== 'arreter');

  it('« Prospect — Bienvenue » : 4 étapes (texto, courriel, notification, note dans l’historique), pas 3', async () => {
    const m = (await catalogueServi()).find((x) => x.id === 'welcome_new_lead')!; // présent : préréglage du socle
    expect(cartesDeLaCopie(m).map((e) => (e.type === 'action' ? e.action.type : e.type)))
      .toEqual(['send_sms', 'send_email', 'create_notification', 'log_activity']);
    expect(m.nb_etapes).toBe(4);
  });

  it('« Rappel de rendez-vous — la veille » : l’attente compte aussi (4 étapes)', async () => {
    const m = (await catalogueServi()).find((x) => x.id === 'job_reminder_1d')!; // présent : préréglage du socle
    expect(cartesDeLaCopie(m).map((e) => (e.type === 'action' ? e.action.type : e.type)))
      .toEqual(['attendre', 'send_sms', 'send_email', 'log_activity']);
    expect(m.nb_etapes).toBe(4);
  });

  it('pour CHAQUE modèle servi : nb_etapes = le nombre de cartes de la copie, et l’aperçu en liste autant', async () => {
    const servis = await catalogueServi();
    expect(servis.length).toBe(MODELES_AUTOMATISATION.length);
    const ecarts = servis
      .map((m) => ({ id: m.id, annonce: m.nb_etapes, apercu: etapesApercu(m).filter((e) => e.genre !== 'fin').length, cartes: cartesDeLaCopie(m).length }))
      .filter((x) => x.annonce !== x.cartes || x.apercu !== x.cartes);
    expect(ecarts).toEqual([]);
  });
});

describe('modeles-08 — le décompte et les canaux suivent TOUTES les branches', () => {
  it('« Relance de devis » : 23 étapes et le courriel, pas 18 étapes sans courriel', async () => {
    const m = (await catalogueServi()).find((x) => x.id === 'pack_relance_devis')!; // présent : parcours du pack
    const etapes = m.steps as Etape[]; // un parcours du pack porte ses étapes
    expect(etapes.length).toBe(23);
    expect(etapes.filter((e) => e.type === 'action' && e.action.type === 'send_email').length).toBe(5);
    expect(m.nb_etapes).toBe(23);
    expect(m.canaux).toEqual(['sms', 'courriel', 'notification', 'tache']);
  });

  it('l’aperçu liste les messages des deux branches : les 5 textos ET les 5 courriels', () => {
    const m = trouverModele('pack_relance_devis')!; // présent : parcours du pack
    const apercu = etapesApercu(m);
    const types = apercu.flatMap((e) => (e.genre === 'action' ? [e.type] : []));
    expect(types.filter((t) => t === 'send_sms').length).toBe(5);
    expect(types.filter((t) => t === 'send_email').length).toBe(5);
    // Chaque message d'une branche dit de quel côté du « si » il se trouve.
    const branches = apercu.flatMap((e) => (e.genre === 'action' && (e.type === 'send_sms' || e.type === 'send_email') ? [`${e.type}:${e.branche ?? '-'}`] : []));
    expect(new Set(branches)).toEqual(new Set(['send_sms:alors', 'send_email:sinon']));
    // … et ce qui suit la jonction (l'alerte à l'équipe, l'attente suivante) n'est dans aucune branche.
    expect(apercu.filter((e) => e.genre === 'attente').every((e) => e.branche === undefined)).toBe(true);
    // Dans l'ordre du parcours : attendre → si → texto → courriel.
    expect(apercu.slice(0, 4).map((e) => (e.genre === 'action' ? e.type : e.genre))).toEqual(['attente', 'condition', 'send_sms', 'send_email']);
  });

  for (const m of MODELES_AUTOMATISATION.filter((x) => x.steps)) {
    it(`${m.id} : chaque étape atteignable est comptée une fois, chaque canal est annoncé`, () => {
      const etapes = atteignables(m.steps as Etape[]).filter((e) => e.type !== 'arreter');
      expect(m.nb_etapes).toBe(etapes.length);
      expect(etapesApercu(m).filter((e) => e.genre !== 'fin').length).toBe(etapes.length);
      const canaux = new Set(etapes.flatMap((e) => (e.type === 'action' && CANAL[e.action.type] ? [CANAL[e.action.type]] : [])));
      expect(new Set(m.canaux)).toEqual(canaux);
    });
  }

  it('une sortie « si réponse » ou « moment dépassé » qui mène ailleurs est suivie aussi', () => {
    const steps: Etape[] = [
      { id: 'a', type: 'action', action: { type: 'send_sms', config: { body: 'x' } }, suivant: 'w' },
      { id: 'w', type: 'attendre', mode: 'reponse', delai_secondes: 3600, suivant: null, si_reponse: 'r' },
      { id: 'r', type: 'action', action: { type: 'create_task', config: { title: 't' } }, suivant: null },
    ];
    const apercu = etapesApercu({ steps, actions: [], delai_secondes: 0 });
    expect(apercu.map((e) => (e.genre === 'action' ? e.type : e.genre))).toEqual(['send_sms', 'attente', 'create_task']);
  });

  it('un « si » dont une branche s’arrête : l’autre continue, rien n’est compté deux fois', () => {
    const steps: Etape[] = [
      { id: 's', type: 'si', conditions: { channel: 'sms' }, alors: 't', sinon: null },
      { id: 't', type: 'action', action: { type: 'send_sms', config: { body: 'x' } }, suivant: 'n' },
      { id: 'n', type: 'action', action: { type: 'create_notification', config: { title: 't' } }, suivant: null },
    ];
    const apercu = etapesApercu({ steps, actions: [], delai_secondes: 0 });
    expect(apercu.map((e) => `${e.genre === 'action' ? e.type : e.genre}:${e.branche ?? '-'}`))
      .toEqual(['condition:-', 'send_sms:alors', 'create_notification:alors']);
  });
});
