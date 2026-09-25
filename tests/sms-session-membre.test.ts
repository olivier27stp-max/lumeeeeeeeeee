/**
 * Une vraie session pour le membre qui écrit par texto.
 *
 * Sans elle, une vingtaine d'outils échouent : les fonctions de base de
 * données sont gardées par `has_org_membership(auth.uid(), org_id)`, et le
 * client de service n'a pas d'`auth.uid()`. Mesuré en production le
 * 2026-09-24 : « regarde mes relances » → « ça bogue de mon côté ».
 *
 * Ce que ces tests protègent : le cache ne sert jamais un jeton périmé, et un
 * échec de session ne rend jamais Lumi plus permissif.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { oublierSession } from '../server/lib/sms/session-membre';

beforeEach(() => {
  oublierSession();
  vi.restoreAllMocks();
});

describe('oublierSession', () => {
  it('vide tout le cache sans argument', () => {
    // Un changement de mot de passe invalide les sessions : on doit pouvoir
    // tout oublier d'un coup.
    expect(() => oublierSession()).not.toThrow();
  });

  it('oublie une seule personne quand on la nomme', () => {
    expect(() => oublierSession('un-user-id')).not.toThrow();
  });
});

describe('contrat du module', () => {
  it('expose ce que le canal texto attend', async () => {
    const mod = await import('../server/lib/sms/session-membre');
    expect(typeof mod.jetonPourMembre).toBe('function');
    expect(typeof mod.clientPourMembre).toBe('function');
    expect(typeof mod.oublierSession).toBe('function');
  });

  it('un identifiant invalide ne fait pas remonter d’exception', async () => {
    // `getUserById` LÈVE sur un identifiant mal formé — un compte supprimé
    // dont le numéro traîne encore dans l'équipe suffit à déclencher ce cas.
    // Sans la garde, l'exception remonterait jusqu'au webhook et le texto
    // resterait sans réponse.
    const mod = await import('../server/lib/sms/session-membre');
    await expect(mod.jetonPourMembre('pas-un-uuid')).resolves.toBeNull();
  });

  it('rend un client utilisable même quand la session échoue', async () => {
    // Le repli n'est pas une faille : sans session, la base REFUSE les
    // fonctions gardées. On est plus restreint, jamais plus permissif — et
    // Lumi peut quand même répondre aux questions simples.
    const mod = await import('../server/lib/sms/session-membre');
    const r = await mod.clientPourMembre('pas-un-uuid', '00000000-0000-4000-8000-000000000001');
    expect(r.client).toBeTruthy();
    expect(r.accessToken).toBeUndefined();
  });
});
