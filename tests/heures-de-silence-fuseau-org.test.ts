/**
 * QUAND LES MESSAGES PARTENT, VU DE L'ENTREPRISE.
 *
 * La fenêtre d'envoi (8 h-20 h) et les jours ouvrables étaient calculés
 * dans `America/Toronto`, figé dans le moteur. Juste au Québec — Toronto et
 * Montréal partagent offset et heure avancée — faux ailleurs.
 *
 * À Vancouver (UTC-7 l'été contre UTC-4), la fenêtre « 8 h-20 h » s'ouvrait
 * à 5 h du matin et se fermait à 17 h : un client réveillé par un texto à
 * 5 h, et des relances qui ne partent plus en fin d'après-midi.
 *
 * Ces fonctions sont pures : on peut donc prouver le décalage, pas seulement
 * vérifier que le source « a l'air » correct.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isQuietHours, horsFenetre, nextSendTime } from '../server/lib/automationEngine';
import { fuseauOrg, viderCacheFuseau, FUSEAU_DEFAUT } from '../server/lib/automations-fuseau-org';

const EST = 'America/Toronto';
const OUEST = 'America/Vancouver';

describe('la fenêtre d’envoi suit le fuseau passé', () => {
  /*
   * Un seul instant, deux verdicts opposés — c'est tout le bogue.
   * 2026-07-15T12:00Z = 8 h à Toronto (on peut envoyer) et 5 h à Vancouver
   * (on réveille le client).
   */
  const huitHeuresEst = new Date('2026-07-15T12:00:00Z');

  it('8 h à l’Est est 5 h sur la côte Ouest — et 5 h est une heure calme', () => {
    expect(isQuietHours(huitHeuresEst, EST), '8 h doit passer').toBe(false);
    expect(isQuietHours(huitHeuresEst, OUEST), '5 h doit être calme').toBe(true);
  });

  it('22 h à l’Est est 19 h sur la côte Ouest — et 19 h peut encore envoyer', () => {
    const vingtDeuxHeuresEst = new Date('2026-07-16T02:00:00Z');
    expect(isQuietHours(vingtDeuxHeuresEst, EST), '22 h doit être calme').toBe(true);
    expect(isQuietHours(vingtDeuxHeuresEst, OUEST), '19 h doit passer').toBe(false);
  });

  it('`horsFenetre` suit le même fuseau', () => {
    expect(horsFenetre(null, huitHeuresEst, EST)).toBe(false);
    expect(horsFenetre(null, huitHeuresEst, OUEST)).toBe(true);
  });

  it('les jours ouvrables aussi — le samedi n’arrive pas au même instant', () => {
    /*
     * Fenêtre ouverte 24 h pour isoler la règle du week-end de celle de
     * l'heure. 2026-07-18T05:00Z = samedi 1 h à Toronto, mais encore
     * vendredi 22 h à Vancouver.
     */
    const reglages = { jours_ouvrables: true, fenetre: { debut: 0, fin: 24 } };
    const instant = new Date('2026-07-18T05:00:00Z');
    expect(horsFenetre(reglages, instant, EST), 'samedi à l’Est → bloqué').toBe(true);
    expect(horsFenetre(reglages, instant, OUEST), 'vendredi à l’Ouest → permis').toBe(false);
  });

  it('le créneau proposé par `nextSendTime` est dans la fenêtre de CE fuseau', () => {
    const prochain = nextSendTime(new Date('2026-07-15T12:00:00Z'), null, OUEST);
    expect(horsFenetre(null, prochain, OUEST), 'le créneau doit être valide à l’Ouest').toBe(false);
  });
});

describe('sans fuseau, rien ne change', () => {
  /*
   * Le point le plus important de ce changement : tout appelant non câblé,
   * et tous les tests existants, gardent le comportement d'avant. Le défaut
   * des signatures est le DEFAULT de la colonne en base.
   */
  it('le défaut est l’Est, exactement comme avant', () => {
    const a = new Date('2026-07-15T12:00:00Z');
    expect(isQuietHours(a)).toBe(isQuietHours(a, EST));
    expect(horsFenetre(null, a)).toBe(horsFenetre(null, a, EST));
    expect(FUSEAU_DEFAUT).toBe(EST);
  });
});

/** Client minimal : une seule lecture de company_settings. */
function faireClient(reponse: { data: unknown; error: unknown }) {
  const compte = { lectures: 0 };
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => { compte.lectures++; return reponse; },
        }),
      }),
    }),
  };
  return { client: client as never, compte };
}

describe('fuseauOrg', () => {
  beforeEach(() => viderCacheFuseau());

  it('rend le fuseau réglé', async () => {
    const { client } = faireClient({ data: { timezone: OUEST }, error: null });
    expect(await fuseauOrg(client, 'org-1')).toBe(OUEST);
  });

  it('ne relit pas la base pour la même entreprise', async () => {
    const { client, compte } = faireClient({ data: { timezone: OUEST }, error: null });
    await fuseauOrg(client, 'org-1');
    await fuseauOrg(client, 'org-1');
    await fuseauOrg(client, 'org-1');
    expect(compte.lectures, 'le cache doit servir').toBe(1);
  });

  it('retombe sur le défaut si la ligne n’existe pas', async () => {
    const { client } = faireClient({ data: null, error: null });
    expect(await fuseauOrg(client, 'org-1')).toBe(FUSEAU_DEFAUT);
  });

  it('retombe sur le défaut si la lecture échoue, SANS mettre l’échec en cache', async () => {
    const { client, compte } = faireClient({ data: null, error: { message: 'réseau' } });
    expect(await fuseauOrg(client, 'org-1')).toBe(FUSEAU_DEFAUT);
    await fuseauOrg(client, 'org-1');
    expect(compte.lectures, 'une panne passagère ne doit pas figer 5 minutes').toBe(2);
  });

  it('un fuseau inconnu ne fait pas tomber le moteur', async () => {
    /*
     * Intl LÈVE sur un fuseau inconnu. Sans le garde, le réglage farfelu
     * d'une seule entreprise arrêtait les automatisations de tout le monde.
     */
    const { client } = faireClient({ data: { timezone: 'Mars/Olympus_Mons' }, error: null });
    expect(await fuseauOrg(client, 'org-1')).toBe(FUSEAU_DEFAUT);
  });
});
