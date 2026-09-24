/**
 * L'adresse d'envoi porte le nom de l'entreprise, pas « noreply ».
 *
 * Le client de Coquin lavage qui dépliait l'en-tête lisait
 * « Coquin lavage <noreply@lumecrm.net> ». Le domaine doit rester
 * `lumecrm.net` (c'est lui qui est vérifié chez SES), mais la partie locale
 * est libre : SES accepte n'importe quel préfixe sur un domaine vérifié.
 */
import { describe, expect, it } from 'vitest';
import { prefixeDepuisNom, senderFor } from '../../server/routes/emails';

describe('prefixeDepuisNom', () => {
  it('met en minuscules, retire les accents, joint par des tirets', () => {
    expect(prefixeDepuisNom('Coquin lavage')).toBe('coquin-lavage');
    expect(prefixeDepuisNom('Déneigement Côté-Tremblay inc.')).toBe('deneigement-cote-tremblay-inc');
  });

  it('écarte la ponctuation sans laisser de tiret en bout', () => {
    expect(prefixeDepuisNom('Les Entreprises Bélanger & Fils')).toBe('les-entreprises-belanger-fils');
    expect(prefixeDepuisNom('  Lavage Pro!!!  ')).toBe('lavage-pro');
  });

  it('rend null quand il ne reste rien d’utilisable — l’appelant garde son préfixe', () => {
    // Un nom en idéogrammes ou en emoji ne doit pas produire « @lumecrm.net »
    // ni une adresse d'un seul caractère : on retombe sur noreply.
    expect(prefixeDepuisNom('🎉')).toBeNull();
    expect(prefixeDepuisNom('A')).toBeNull();
    expect(prefixeDepuisNom('')).toBeNull();
    expect(prefixeDepuisNom(null)).toBeNull();
  });

  it('borne la longueur : une partie locale interminable casse des clients', () => {
    const p = prefixeDepuisNom('Entreprise de nettoyage et de déneigement du Grand Montréal et des environs');
    expect(p!.length).toBeLessThanOrEqual(40);
    expect(p).not.toMatch(/-$/);
  });
});

describe('senderFor', () => {
  // Le domaine dépend de EMAIL_FROM, absente en CI : on compare au domaine
  // que le module lit réellement plutôt que d'en coder un en dur.
  const domaine = senderFor({ company_name: 'Repere' } as never).from.replace(/^.*@|>$/g, '');

  it('affiche le nom de l’entreprise des deux côtés de l’adresse', () => {
    const s = senderFor({ company_name: 'Coquin lavage', company_email: 'info@coquinlavage.ca' } as never);
    expect(s.from).toBe(`Coquin lavage <coquin-lavage@${domaine}>`);
    expect(s.from).not.toContain('noreply');
  });

  it('garde le domaine vérifié : en changer ferait rejeter l’envoi par SES', () => {
    const s = senderFor({ company_name: 'Vision Lavage' } as never);
    expect(s.from).toBe(`Vision Lavage <vision-lavage@${domaine}>`);
  });

  it('dirige la réponse vers l’entreprise, et seulement si elle a une adresse', () => {
    expect(senderFor({ company_name: 'X', company_email: 'a@b.ca' } as never).replyTo).toBe('a@b.ca');
    expect(senderFor({ company_name: 'X' } as never).replyTo).toBeUndefined();
    expect(senderFor({ company_name: 'X', company_email: '' } as never).replyTo).toBeUndefined();
  });

  it('retombe sur le préfixe d’origine quand le nom ne donne rien', () => {
    expect(senderFor({ company_name: '🎉' } as never).from).toMatch(/^🎉 <noreply@/);
  });
});
