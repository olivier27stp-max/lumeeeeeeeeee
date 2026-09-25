/**
 * À qui parle-t-on quand un texto arrive ?
 *
 * C'est la frontière de sécurité du canal SMS : ce qui passe ici obtient les
 * droits d'un utilisateur réel sur les données d'une entreprise. Ces tests
 * figent les refus — un faux positif ici, c'est répondre le chiffre d'affaires
 * de quelqu'un à un inconnu.
 */
import { describe, it, expect, vi } from 'vitest';
import { membreParTelephone, estConfirmation, estAnnulation } from '../server/lib/sms/identifier-membre';

/** Un client Supabase minimal qui rend la liste fournie. */
function client(rows: any[] | null, error: { message: string } | null = null) {
  const chaine: any = {
    select: () => chaine,
    eq: () => chaine,
    not: () => chaine,
    then: undefined,
  };
  // La dernière méthode chaînée doit résoudre : on rend un thenable.
  chaine.not = (..._a: any[]) => ({ ...chaine, not: chaine.not, then: (r: any) => r({ data: rows, error }) });
  return { from: () => chaine } as any;
}

const membre = (o: Partial<any> = {}) => ({
  user_id: 'u1', org_id: 'org1', first_name: 'Will', role: 'owner', status: 'active', phone: '+15145550199', ...o,
});

describe('membreParTelephone', () => {
  it('reconnaît un membre actif de l’org qui a reçu le texto', async () => {
    const r = await membreParTelephone(client([membre()]), { telephone: '+15145550199', orgId: 'org1' });
    expect(r).not.toBeNull();
    expect(r!.userId).toBe('u1');
    expect(r!.prenom).toBe('Will');
  });

  it('reconnaît le même numéro écrit autrement', async () => {
    // Les numéros sont saisis à la main dans la fiche d'équipe.
    for (const saisi of ['514-555-0199', '(514) 555-0199', '5145550199', '+1 514 555 0199']) {
      const r = await membreParTelephone(client([membre({ phone: saisi })]), { telephone: '+15145550199', orgId: 'org1' });
      expect(r, saisi).not.toBeNull();
    }
  });

  it('REFUSE quand deux membres partagent le numéro', async () => {
    // Répondre au hasard, c'est risquer de donner les données à la mauvaise
    // personne. On préfère retomber dans la messagerie client.
    const r = await membreParTelephone(
      client([membre({ user_id: 'u1' }), membre({ user_id: 'u2', first_name: 'Marc' })]),
      { telephone: '+15145550199', orgId: 'org1' },
    );
    expect(r).toBeNull();
  });

  it('refuse un membre sans compte utilisateur', async () => {
    // Sans `user_id`, aucune permission ne peut être appliquée.
    const r = await membreParTelephone(client([]), { telephone: '+15145550199', orgId: 'org1' });
    expect(r).toBeNull();
  });

  it('refuse un numéro inconnu — c’est un client, pas l’équipe', async () => {
    const r = await membreParTelephone(client([membre({ phone: '+15145550000' })]), { telephone: '+15145559999', orgId: 'org1' });
    expect(r).toBeNull();
  });

  it('refuse sans org : on ne cherche jamais à l’échelle de toute la base', async () => {
    const r = await membreParTelephone(client([membre()]), { telephone: '+15145550199', orgId: '' });
    expect(r).toBeNull();
  });

  it('refuse un téléphone vide ou illisible', async () => {
    for (const t of ['', '   ', 'allo', '+']) {
      expect(await membreParTelephone(client([membre()]), { telephone: t, orgId: 'org1' })).toBeNull();
    }
  });

  it('rend null si la base est illisible, sans lever', async () => {
    // Une panne de lecture ne doit pas ouvrir l'accès ni casser le webhook.
    const r = await membreParTelephone(client(null, { message: 'boom' }), { telephone: '+15145550199', orgId: 'org1' });
    expect(r).toBeNull();
  });
});

describe('estConfirmation / estAnnulation', () => {
  it('reconnaît les façons de dire oui', () => {
    for (const t of ['oui', 'Oui', 'OUI!', 'ok', 'vas-y', 'envoie', 'go', 'parfait', '👍']) {
      expect(estConfirmation(t), t).toBe(true);
    }
  });

  it('reconnaît les façons de dire non', () => {
    for (const t of ['non', 'Non.', 'annule', 'laisse faire', 'oublie ça', '👎']) {
      expect(estAnnulation(t), t).toBe(true);
    }
  });

  it('ne prend pas une phrase entière pour une confirmation', () => {
    // « oui mais change le montant » n'est PAS un feu vert : une phrase doit
    // repartir au modèle, sinon on exécute autre chose que ce qui est demandé.
    for (const t of ['oui mais change le montant', 'ok pour Sophie seulement', 'non, plutôt demain']) {
      expect(estConfirmation(t), t).toBe(false);
      expect(estAnnulation(t), t).toBe(false);
    }
  });

  it('un message vide n’est ni l’un ni l’autre', () => {
    expect(estConfirmation('')).toBe(false);
    expect(estAnnulation('')).toBe(false);
  });
});
