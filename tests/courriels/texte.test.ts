/**
 * Version texte d'un courriel (server/lib/courriels/texte.ts) : dérivée du HTML
 * du gabarit pour la partie `text` de chaque envoi. Pure, sans envoi.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { htmlVersTextePourEnvoi, texteDeLien, decoderEntites } from '../../server/lib/courriels/texte';
import { rendreCourrielClient, rendreCourrielLume } from '../../server/lib/courriels/gabarit';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const marque = { nom: 'Vision Lavage', logoUrl: null, couleur: '#0f766e', email: 'info@visionlavage.ca', telephone: '514 555-0199', adresse: '12 rue Principale, Laval, QC', siteWeb: 'visionlavage.ca', liensSociaux: { facebook: 'https://facebook.com/visionlavage' }, lignesTaxes: ['TPS No : 123456789 RT0001'] };

describe('courriel client → texte', () => {
  const html = rendreCourrielClient({
    langue: 'fr', marque, preheader: 'PRÉ-EN-TÊTE CACHÉ — Facture 40', titre: 'Votre facture 40', salutation: 'Bonjour Rafba,', intro: 'Voici votre facture. Vous pouvez la payer en ligne en un clic.',
    montant: { libelle: 'Montant à payer', valeur: '1 234,56 $', sous: 'Échéance : 1er octobre 2026' },
    lignes: [{ libelle: 'Numéro', valeur: '40' }, { libelle: 'Échéance', valeur: '1er octobre 2026', fort: true }],
    bouton: { texte: 'Voir et payer la facture', url: 'https://lumecrm.net/invoice/abc?x=1&y=2' },
    note: 'Une question ? Répondez simplement à ce courriel.',
  });
  const texte = htmlVersTextePourEnvoi(html);

  it('garde le titre, la salutation, le montant et les lignes de détail', () => {
    expect(texte).toContain('Votre facture 40');
    expect(texte).toContain('Bonjour Rafba,');
    expect(texte).toContain('1 234,56 $');
    /* « Montant à payer » n'est plus écrit quand une phrase le dit mieux :
       « 1 234,56 $ » suivi de « Échéance : 1er octobre 2026 » se passe d'une
       étiquette, qui ne faisait que retarder le chiffre (2026-09-23). Le
       libellé reste affiché quand il n'y a PAS de sous-titre — c'est alors la
       seule chose qui nomme le montant. */
    expect(texte).toContain('Échéance : 1er octobre 2026');
    expect(texte).toContain('Numéro : 40');
    expect(texte).toContain('Échéance : 1er octobre 2026');
  });

  it('le bouton devient « Libellé : URL », avec l’URL décodée', () => {
    expect(texte).toContain('Voir et payer la facture : https://lumecrm.net/invoice/abc?x=1&y=2');
    // Le lien de secours (« Copiez ce lien ») répéterait l'adresse : omis.
    expect(texte).not.toContain('Copiez ce lien');
  });

  it('ne contient ni balise, ni CSS, ni pré-en-tête', () => {
    expect(texte).not.toMatch(/<[^>]+>/);
    expect(texte).not.toMatch(/font-family|padding|border-radius|display:none|#111827/);
    expect(texte).not.toContain('PRÉ-EN-TÊTE CACHÉ');
    expect(texte).not.toContain('&nbsp;');
    expect(texte).not.toContain('&amp;');
    expect(texte).not.toContain('​');
  });

  it('porte la signature et le pied : nom, coordonnées, réseaux, taxes — et jamais Lume', () => {
    expect(texte).toContain('— Vision Lavage');
    expect(texte).toContain('info@visionlavage.ca');
    expect(texte).toContain('514 555-0199');
    expect(texte).toContain('Facebook : https://facebook.com/visionlavage');
    expect(texte).toContain('TPS No : 123456789 RT0001');
    // Le courriel vient de l'entreprise : la plateforme ne se NOMME nulle part.
    // (le lien du bouton pointe vers lumecrm.net, c'est l'URL du document — normal)
    expect(texte).not.toMatch(/Envoyé avec|Sent with/i);
    expect(texte).not.toMatch(/Lume/);
  });

  it('reste lisible : une idée par ligne, pas de lignes vides en rafale', () => {
    const lignes = texte.split('\n');
    expect(lignes[0]).toBe('Vision Lavage');
    expect(texte).not.toMatch(/\n{3,}/);
    expect(lignes.every((l) => l === l.trim())).toBe(true);
    /* L'ordre a changé le 2026-09-23 : le MONTANT et le BOUTON ouvrent le
       courriel, la salutation et le texte suivent. Comparé aux courriels de
       Jobber, c'est ce qui frappe dans les leurs — on sait combien et on peut
       payer sans avoir lu une phrase. Personne n'ouvre une facture pour lire
       de la prose. */
    expect(texte.indexOf('Votre facture 40')).toBeLessThan(texte.indexOf('1 234,56 $'));
    expect(texte.indexOf('1 234,56 $')).toBeLessThan(texte.indexOf('Voir et payer la facture :'));
    expect(texte.indexOf('Voir et payer la facture :')).toBeLessThan(texte.indexOf('Bonjour Rafba,'));
  });

  it('un logo devient le nom de l’entreprise (texte alternatif)', () => {
    const t = htmlVersTextePourEnvoi(rendreCourrielClient({ langue: 'fr', marque: { ...marque, logoUrl: 'https://x/logo.png' }, titre: 'T' }));
    expect(t.split('\n')[0]).toBe('Vision Lavage');
    expect(t).not.toContain('logo.png');
  });

  it('les données échappées ressortent telles que saisies, sans être prises pour des balises', () => {
    const t = htmlVersTextePourEnvoi(rendreCourrielClient({ langue: 'fr', marque: { ...marque, nom: 'A & B' }, titre: 'Prix < 100 $', intro: 'Voir <b>ici</b>' }));
    expect(t).toContain('A & B');
    expect(t).toContain('Prix < 100 $');
    expect(t).toContain('Voir <b>ici</b>');
  });
});

describe('courriel Lume → texte', () => {
  it('un bouton tel: ou mailto: garde le libellé et l’adresse sans schéma', () => {
    const t = htmlVersTextePourEnvoi(rendreCourrielLume({ langue: 'fr', titre: 'Nouveau lead', bouton: { texte: 'Appeler le prospect', url: 'tel:5145550100' } }));
    expect(t).toContain('Appeler le prospect : 5145550100');
    expect(t).toContain('— L’équipe Lume');
    expect(t).toContain('support@lumecrm.net');
    expect(t).not.toContain('mailto:');
  });

  it('un contenu libre (corpsHtml avec liste et gras) devient des lignes et des puces', () => {
    const t = htmlVersTextePourEnvoi(rendreCourrielLume({ langue: 'fr', titre: 'Résumé', corpsHtml: '<p>Points :</p><ul><li>Un <strong>fort</strong></li><li>Deux</li></ul><p>Fin.<br/>Suite.</p>', signature: null }));
    expect(t).toContain('Points :');
    expect(t).toContain('- Un fort');
    expect(t).toContain('- Deux');
    expect(t).toContain('Fin.\nSuite.');
  });
});

describe('briques', () => {
  it('texteDeLien : libellé : url, ou l’adresse seule quand le libellé la répète', () => {
    expect(texteDeLien('https://a.b/c', 'Voir')).toBe('Voir : https://a.b/c');
    expect(texteDeLien('https://a.b/c', 'https://a.b/c')).toBe('https://a.b/c');
    expect(texteDeLien('mailto:x@y.z', 'x@y.z')).toBe('x@y.z');
    expect(texteDeLien('https://a.b/c', '')).toBe('https://a.b/c');
    expect(texteDeLien('', 'Sans lien')).toBe('Sans lien');
  });

  it('decoderEntites : nommées, décimales, hexadécimales ; l’espace de largeur nulle disparaît', () => {
    expect(decoderEntites('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &nbsp;&middot;&nbsp; &#233; &#x41;&#8203;')).toBe('a & b <c> "d" \'e\'  ·  é A');
  });

  it('HTML vide ou sans structure : rien ne casse', () => {
    expect(htmlVersTextePourEnvoi('')).toBe('');
    expect(htmlVersTextePourEnvoi('Bonjour')).toBe('Bonjour');
    expect(htmlVersTextePourEnvoi('<div style="font-family:sans-serif"><h2>Bonjour Marie,</h2><p>Merci.</p></div>')).toBe('Bonjour Marie,\n\nMerci.');
  });
});

describe('le mailer envoie toujours une partie texte', () => {
  const mailer = read('server/lib/mailer.ts');
  it('dérive text du HTML quand l’appelant n’en donne pas, et le transmet aux deux fournisseurs', () => {
    expect(mailer).toContain("import { htmlVersTextePourEnvoi } from './courriels/texte'");
    expect(mailer).toContain('const text = params.text || htmlVersTextePourEnvoi(params.html)');
    // Resend : champ `text` du JSON ; nodemailer : option `text`.
    expect(mailer).toContain('text: p.text,');
    expect((mailer.match(/subject: qa\.subject,\n\s*html: params\.html,\n\s*text,/g) || []).length).toBe(2);
  });
  it('SendEmailParams expose text?: string', () => {
    const params = mailer.slice(mailer.indexOf('export interface SendEmailParams'), mailer.indexOf('export interface SendEmailResult'));
    expect(params).toMatch(/text\?: string/);
  });
  it('le serveur n’importe rien de src/ pour ça', () => {
    expect(read('server/lib/courriels/texte.ts')).not.toMatch(/from\s+['"][^'"]*\/src\//);
  });
});

describe('numéro de téléphone en version texte', () => {
  it('ne répète pas le numéro sous deux formes (« 514 555-0199 : 5145550199 »)', () => {
    // Le lien porte les chiffres seuls, le libellé la forme lisible : c'est le
    // même numéro, le lecteur ne doit le voir qu'une fois.
    expect(texteDeLien('tel:5145550199', '514 555-0199')).toBe('514 555-0199');
    expect(texteDeLien('tel:+15145550199', '+1 514 555-0199')).toBe('+1 514 555-0199');
  });
  it('un vrai libellé différent reste affiché avec sa cible', () => {
    expect(texteDeLien('tel:5145550199', 'Nous joindre')).toBe('Nous joindre : 5145550199');
    expect(texteDeLien('https://x.test/a', 'Voir')).toBe('Voir : https://x.test/a');
  });
});
