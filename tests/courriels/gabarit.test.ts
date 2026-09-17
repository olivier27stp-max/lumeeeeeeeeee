/**
 * Gabarit commun des courriels (2026-09-17) : ce qu'un client voit d'une
 * entreprise, ce qu'un abonné voit de Lume. Pur, sans envoi.
 */
import { describe, it, expect } from 'vitest';
import { rendreCourrielClient, rendreCourrielLume, couleurBouton, montant, dateLisible, langueDe, echapper, COULEUR_LUME } from '../../server/lib/courriels/gabarit';

const marque = { nom: 'Vision Lavage', logoUrl: null, couleur: '#0f766e', email: 'info@visionlavage.ca', telephone: '514 555-0199', adresse: '12 rue Principale, Laval, QC', siteWeb: 'visionlavage.ca', liensSociaux: { facebook: 'https://facebook.com/visionlavage' }, lignesTaxes: ['TPS No : 123456789 RT0001'] };

describe('gabarit client', () => {
  const html = rendreCourrielClient({
    langue: 'fr', marque, preheader: 'Facture 40 — 1,00 $ à payer', titre: 'Votre facture 40', salutation: 'Bonjour Rafba,', intro: 'Voici votre facture. Vous pouvez la payer en ligne en un clic.',
    montant: { libelle: 'Montant à payer', valeur: '1,00 $', sous: 'Échéance : 1er octobre 2026' },
    lignes: [{ libelle: 'Numéro', valeur: '40' }, { libelle: 'Échéance', valeur: '1er octobre 2026', fort: true }],
    bouton: { texte: 'Voir et payer la facture', url: 'https://lumecrm.net/invoice/abc?x=1&y=2' },
    note: 'Une question ? Répondez simplement à ce courriel.',
  });
  it('porte la langue, le pré-en-tête, le titre, le montant, les lignes, le bouton à la couleur de marque, le lien de secours, la signature et le pied', () => {
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('Facture 40 — 1,00 $ à payer');
    expect(html).toContain('Votre facture 40');
    expect(html).toContain('1,00 $');
    expect(html).toContain('Échéance');
    expect(html).toContain('background:#0f766e;border-radius:8px;');
    expect(html).toContain('href="https://lumecrm.net/invoice/abc?x=1&amp;y=2"');
    expect(html).toContain('Copiez ce lien');
    expect(html).toContain('— Vision Lavage');
    expect(html).toContain('info@visionlavage.ca');
    expect(html).toContain('Facebook');
    expect(html).toContain('TPS No : 123456789 RT0001');
    expect(html).toContain('Envoyé avec <a href="https://lumecrm.net"');
    expect(html).not.toContain('Sent via');
    expect(html).not.toContain('on behalf of');
  });
  it('un logo remplace le nom en tête ; sans logo, le nom', () => {
    expect(html).toContain('<span style="font-size:20px;font-weight:700;color:#111827;">Vision Lavage</span>');
    const avecLogo = rendreCourrielClient({ langue: 'fr', marque: { ...marque, logoUrl: 'https://x/logo.png' }, titre: 'T' });
    expect(avecLogo).toContain('<img src="https://x/logo.png" alt="Vision Lavage"');
  });
  it('en anglais, les textes fixes suivent', () => {
    const en = rendreCourrielClient({ langue: 'en', marque, titre: 'Your invoice 40', bouton: { texte: 'View invoice', url: 'https://x' } });
    expect(en).toContain('<html lang="en">');
    expect(en).toContain('Copy this link');
    expect(en).toContain('Sent with <a');
  });
  it('échappe tout ce qui vient des données', () => {
    const h = rendreCourrielClient({ langue: 'fr', marque: { ...marque, nom: '<b>X</b>' }, titre: '<script>alert(1)</script>', intro: 'a & b' });
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(h).toContain('a &amp; b');
  });
});

describe('gabarit Lume', () => {
  it('marque Lume, adresse de support, signature de l’équipe', () => {
    const h = rendreCourrielLume({ langue: 'fr', titre: 'Paiement reçu', intro: 'Un client vient de payer.', montant: { libelle: 'Reçu', valeur: '125,00 $' }, bouton: { texte: 'Voir la facture', url: 'https://lumecrm.net/invoices/1' } });
    expect(h).toContain('alt="Lume"');
    expect(h).toContain('support@lumecrm.net');
    expect(h).toContain('— L’équipe Lume');
    expect(h).toContain(`background:${COULEUR_LUME};border-radius:8px;`);
  });
});

describe('outils', () => {
  it('une couleur de marque trop pâle laisse la place au noir (texte blanc illisible)', () => {
    expect(couleurBouton('#0f766e')).toBe('#0f766e');
    expect(couleurBouton('FFEE58')).toBe(COULEUR_LUME);
    expect(couleurBouton('#ffffff')).toBe(COULEUR_LUME);
    expect(couleurBouton(null)).toBe(COULEUR_LUME);
    expect(couleurBouton('rouge')).toBe(COULEUR_LUME);
  });
  it('montant et date dans la langue', () => {
    expect(montant(123456, 'CAD', 'fr')).toMatch(/1\s?234,56\s?\$/);
    expect(montant(123456, 'CAD', 'en')).toBe('$1,234.56');
    expect(dateLisible('2026-10-01', 'fr')).toBe('1 octobre 2026');
    expect(dateLisible('2026-10-01', 'en')).toBe('October 1, 2026');
    expect(dateLisible(null, 'fr')).toBe('');
    expect(langueDe('en')).toBe('en');
    expect(langueDe('fr')).toBe('fr');
    expect(langueDe(null)).toBe('fr');
    expect(echapper('<a>')).toBe('&lt;a&gt;');
  });
});
