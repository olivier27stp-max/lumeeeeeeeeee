/**
 * « Salut, c'est Lumi » — le premier texto.
 *
 * C'est le premier contact avec l'assistant. Il ne doit ni promettre ce que
 * le produit ne fait pas, ni ressembler à du pourriel, ni partir deux fois.
 */
import { describe, it, expect } from 'vitest';
import { texteBienvenue } from '../server/lib/sms/bienvenue';

describe('texteBienvenue', () => {
  it('salue la personne par son prénom', () => {
    expect(texteBienvenue('William')).toContain('Salut William');
  });

  it('tient sans prénom, sans laisser d’espace bancal', () => {
    const t = texteBienvenue('');
    expect(t.startsWith("Salut, c'est Lumi")).toBe(true);
    expect(t).not.toMatch(/Salut {2}/);
  });

  it('donne des exemples à copier, pas une description', () => {
    // Les gens réutilisent les exemples mot pour mot : ils doivent être de
    // vraies demandes que Lumi sait traiter.
    const t = texteBienvenue('Will');
    expect(t).toContain('mes jobs demain');
    expect(t).toContain('factures en retard');
    expect(t).toContain("combien j'ai fait ce mois-ci");
  });

  it('annonce le vocal : c’est le vrai déblocage en camion', () => {
    expect(texteBienvenue('Will')).toMatch(/vocal/i);
  });

  it('dit la règle d’or dès le premier message', () => {
    // « je ne fais jamais rien sans te demander » : c'est ce qui permet de
    // faire confiance à un assistant qui peut écrire dans le CRM.
    expect(texteBienvenue('Will')).toMatch(/jamais rien sans te demander/i);
  });

  it('n’emploie aucun terme technique', () => {
    const t = texteBienvenue('Will').toLowerCase();
    for (const mot of ['sms', 'twilio', 'api', 'webhook', 'ia', 'crm', 'forfait', 'numéro twilio']) {
      expect(t, `ne doit pas contenir « ${mot} »`).not.toContain(mot);
    }
  });

  it('tient dans un texto raisonnable', () => {
    // Un SMS se facture par tranche de 160 caractères. On reste court, mais
    // pas au point de couper les exemples.
    const t = texteBienvenue('William');
    expect(t.length).toBeGreaterThan(200);
    expect(t.length).toBeLessThan(700);
  });

  it('existe en anglais, avec le même contenu', () => {
    const en = texteBienvenue('Will', 'en');
    expect(en).toContain("it's Lumi");
    expect(en).toMatch(/voice message/i);
    expect(en).toMatch(/never do anything without asking/i);
    expect(en).not.toEqual(texteBienvenue('Will', 'fr'));
  });

  it('porte la marque que l’anti-doublon recherche', () => {
    // `dejaEnvoye` cherche « c'est Lumi » dans les messages déjà partis :
    // si le texte changeait au point de perdre cette formule, le message
    // repartirait à chaque activation.
    expect(texteBienvenue('Will')).toContain("c'est Lumi");
  });
});
