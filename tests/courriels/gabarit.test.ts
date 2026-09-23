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
    expect(html).toContain('background:#0f766e;border-radius:10px;');
    expect(html).toContain('href="https://lumecrm.net/invoice/abc?x=1&amp;y=2"');
    expect(html).toContain('Le bouton ne fonctionne pas ?');
    expect(html).toContain('— Vision Lavage');
    expect(html).toContain('info@visionlavage.ca');
    expect(html).toContain('Facebook');
    expect(html).toContain('TPS No : 123456789 RT0001');
    expect(html).toContain('Envoyé avec <a href="https://lumecrm.net"');
    expect(html).not.toContain('Sent via');
    expect(html).not.toContain('on behalf of');
  });
  it('un logo remplace le nom en tête ; sans logo, le nom', () => {
    expect(html).toContain('<span style="font-size:20px;font-weight:700;color:#101828;">Vision Lavage</span>');
    const avecLogo = rendreCourrielClient({ langue: 'fr', marque: { ...marque, logoUrl: 'https://x/logo.png' }, titre: 'T' });
    expect(avecLogo).toContain('<img src="https://x/logo.png" alt="Vision Lavage"');
  });
  it('un bouton téléphone ou courriel n’a pas de lien de secours (« tel:514… » sous le bouton, c’est laid)', () => {
    const h = rendreCourrielLume({ langue: 'fr', titre: 'Nouveau lead', bouton: { texte: 'Appeler le prospect', url: 'tel:5145550100' } });
    expect(h).toContain('href="tel:5145550100"');
    expect(h).not.toContain('Le bouton ne fonctionne pas');
  });
  it('en anglais, les textes fixes suivent', () => {
    const en = rendreCourrielClient({ langue: 'en', marque, titre: 'Your invoice 40', bouton: { texte: 'View invoice', url: 'https://x' } });
    expect(en).toContain('<html lang="en">');
    expect(en).toContain('Button not working?');
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
    expect(h).toContain(`background:${COULEUR_LUME};border-radius:10px;`);
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

/**
 * Les décisions prises avec Rafba sur les maquettes (2026-09-17), figées ici.
 * Sans ces tests, une prochaine session les déferait sans le savoir.
 */
describe('le ciel et les règles des maquettes', () => {
  const base = { langue: 'fr' as const, marque, titre: 'Votre facture 48' };

  it('un courriel d’ENTREPRISE est neutre : c’est SA couleur qu’on voit, pas le ciel de Lume', () => {
    /* Ce test exigeait l'inverse jusqu'au 2026-09-23 : le ciel partout.
       C'était une erreur de destinataire. Quand Coquin lavage facture Sophie,
       Sophie doit voir Coquin lavage — le ciel est la marque de LUME, qu'elle
       ne connaît pas, et il concurrence la couleur de l'entreprise.

       L'anomalie qui le prouvait : la couleur de l'entreprise ne servait qu'au
       bouton, tout le décor était du Lume. */
    const h = rendreCourrielClient(base);
    /* Le fond est BLANC depuis le 2026-09-23. Il a d'abord été gris (#f4f5f7),
       jusqu'à ce que Rafba le reçoive : « c'est encore en noir et vert ».

       Gmail sur Android et iOS ignore `color-scheme: light` et inverse les
       couleurs en mode sombre. Un gris pâle y devient un gris foncé. Le blanc
       résiste mieux, et surtout : chaque conteneur porte désormais son fond en
       ligne, parce que Gmail inverse un par un les éléments où il n'en trouve
       aucun — c'était ça, la vraie cause. */
    expect(h).toContain('background:#ffffff');
    expect(h).not.toContain('#f4f5f7');
    expect(h).not.toContain('#e6f0ff');
    // Sa couleur porte le filet de tête, tout en haut du courriel.
    expect(h).toContain('background:#0f766e;height:4px');
  });

  it('une couleur trop pâle ne devient pas un filet invisible sur le gris', () => {
    // Le jaune ne passe pas `couleurBouton` : il retombe sur le noir Lume,
    // et le filet reste visible. Sans ça, un filet #ffee58 sur du blanc
    // disparaîtrait — l'entreprise n'aurait plus aucune couleur du tout.
    const h = rendreCourrielClient({ ...base, marque: { ...marque, couleur: '#ffee58' } });
    expect(h).toContain(`background:${COULEUR_LUME};height:4px`);
  });

  it('un courriel de LUME garde le ciel : là, la marque est à sa place', () => {
    const h = rendreCourrielLume({ langue: 'fr', titre: 'Votre abonnement' });
    expect(h).toContain('background:#e6f0ff');
    // Pas de filet de tête : Lume n'a pas de couleur de marque à afficher ici.
    expect(h).not.toContain('height:4px');
  });

  it('le bouton vient AVANT la note, jamais après (sinon il passe sous la ligne de flottaison)', () => {
    const h = rendreCourrielClient({
      ...base,
      bouton: { texte: 'Payer 1 220,17 $', url: 'https://lumecrm.net/pay/x' },
      note: 'Paiement par carte, sans créer de compte.',
    });
    expect(h.indexOf('Payer 1 220,17')).toBeLessThan(h.indexOf('Paiement par carte'));
  });

  it('la ligne sous le bouton lève la dernière objection, collée au bouton', () => {
    const h = rendreCourrielClient({
      ...base,
      bouton: { texte: 'Payer', url: 'https://x/pay', sousBouton: 'Carte de crédit · aucun compte à créer' },
      note: 'Une note plus bas.',
    });
    expect(h).toContain('Carte de crédit &middot; aucun compte à créer'.replace('&middot;', '·'));
    expect(h.indexOf('aucun compte')).toBeLessThan(h.indexOf('Une note plus bas'));
  });

  it('le téléphone du pied est cliquable, chiffres seulement dans le lien', () => {
    const h = rendreCourrielClient(base);
    expect(h).toContain('href="tel:5145550199"');
    expect(h).toContain('href="mailto:info@visionlavage.ca"');
  });

  it('le nom de l’entreprise n’est pas écrit deux fois quand il y a un logo', () => {
    const h = rendreCourrielClient({ ...base, marque: { ...marque, logoUrl: 'https://x/logo.png' } });
    /* On coupe au TITRE du courriel : tout ce qui précède est l'en-tête.

       Ce test a déjà été cassé deux fois par un repère qui n'était pas le bon
       — `border-radius:16px` (la carte, retirée côté client le 2026-09-23),
       puis `background:#ffffff` (devenu omniprésent quand chaque conteneur a
       reçu son fond). Le titre, lui, est ce que l'en-tête précède par
       définition. */
    const enTete = h.slice(0, h.indexOf('<h1'));
    expect(enTete).toContain('alt="Vision Lavage"');
    expect(enTete.split('Vision Lavage').length - 1).toBe(1);
  });

  it('le montant reste le plus gros élément de la page', () => {
    const h = rendreCourrielClient({ ...base, montant: { libelle: 'Solde à payer', valeur: '1 220,17 $' } });
    expect(h).toContain('font-size:38px');
    expect(h).toContain('1 220,17 $');
  });
});
