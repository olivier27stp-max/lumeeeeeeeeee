/* ═══════════════════════════════════════════════════════════════
   Conversion entre le HTML des courriels d'automatisation et un
   texte lisible.

   Les corps sont stockés en HTML — nécessaire pour l'envoi, illisible pour
   celui qui veut juste changer « Bonjour » en « Salut ». Personne ne devrait
   avoir à lire `<div style="font-family:sans-serif;...">` pour corriger une
   phrase.

   La conversion est volontairement SIMPLE et réversible : les corps suivent
   tous la même structure (titre, paragraphes, parfois une liste ou un lien).
   Elle ne cherche pas à couvrir du HTML arbitraire — seulement celui que le
   produit génère.
   ═══════════════════════════════════════════════════════════════ */

/** Enveloppe utilisée pour tous les courriels d'automatisation. */
const ENVELOPPE_OUVERTE = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">';
const ENVELOPPE_FERMEE = '</div>';

function decoderEntites(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function echapper(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * HTML → texte éditable.
 *
 * Chaque paragraphe devient une ligne, les sauts de ligne sont préservés, et
 * les liens deviennent leur seule adresse (le libellé est réintroduit à la
 * conversion inverse).
 */
export function htmlVersTexte(html: string): string {
  if (!html) return '';
  let t = html;

  // Retire l'enveloppe et les attributs de style, qui n'ont aucun sens pour
  // celui qui édite.
  t = t.replace(/<div[^>]*>/gi, '').replace(/<\/div>/gi, '');

  // Une liste devient des lignes préfixées d'un tiret.
  t = t.replace(/<li[^>]*>(.*?)<\/li>/gis, '- $1\n');
  t = t.replace(/<\/?ul[^>]*>/gi, '');

  // Un lien devient son adresse seule.
  t = t.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, '$1');

  // Titres et paragraphes : un bloc = une ligne.
  t = t.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gis, '$1\n');
  t = t.replace(/<p[^>]*>(.*?)<\/p>/gis, '$1\n');

  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/?strong[^>]*>/gi, '');
  t = t.replace(/<\/?em[^>]*>/gi, '');

  // Toute balise résiduelle disparaît plutôt que d'apparaître dans le champ.
  t = t.replace(/<[^>]+>/g, '');

  return decoderEntites(t)
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Texte éditable → HTML.
 *
 * La première ligne devient le titre, les lignes commençant par « - » forment
 * une liste, les adresses web deviennent des liens cliquables, et le reste
 * devient des paragraphes.
 */
export function texteVersHtml(texte: string): string {
  if (!texte.trim()) return `${ENVELOPPE_OUVERTE}${ENVELOPPE_FERMEE}`;

  const lignes = texte.split('\n');
  const blocs: string[] = [];
  let listeEnCours: string[] = [];
  let premiereLigne = true;

  const viderListe = () => {
    if (listeEnCours.length > 0) {
      blocs.push(
        `<ul style="padding-left:18px;line-height:1.6;">${listeEnCours.map((li) => `<li>${li}</li>`).join('')}</ul>`,
      );
      listeEnCours = [];
    }
  };

  /** Rend cliquable une adresse web, et met en gras les variables. */
  const enrichir = (s: string): string =>
    echapper(s).replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" style="color:#1F5F4F;">$1</a>',
    );

  for (const brute of lignes) {
    const ligne = brute.trim();

    if (!ligne) {
      viderListe();
      continue;
    }

    if (ligne.startsWith('- ')) {
      listeEnCours.push(enrichir(ligne.slice(2)));
      continue;
    }

    viderListe();

    if (premiereLigne) {
      blocs.push(`<h2 style="color:#1a1a1a;font-size:18px;">${enrichir(ligne)}</h2>`);
      premiereLigne = false;
    } else {
      blocs.push(`<p style="color:#333;line-height:1.6;">${enrichir(ligne)}</p>`);
    }
  }
  viderListe();

  return `${ENVELOPPE_OUVERTE}${blocs.join('')}${ENVELOPPE_FERMEE}`;
}

/**
 * Remplace les variables par un exemple, pour l'aperçu.
 *
 * L'utilisateur doit voir « Bonjour Marie » plutôt que
 * « Bonjour [client_first_name] » — c'est ce que son client recevra.
 */
const EXEMPLES: Record<string, string> = {
  client_first_name: 'Marie',
  client_name: 'Marie Tremblay',
  client_last_name: 'Tremblay',
  company_name: 'Votre entreprise',
  invoice_number: 'FAC-1042',
  invoice_total: '450,00 $',
  invoice_due_date: '2026-08-30',
  quote_number: 'SOU-218',
  quote_total: '1 250,00 $',
  appointment_date: '14 août 2026',
  appointment_time: '9 h 00',
  appointment_address: '120 rue Principale',
  job_name: 'Lavage de vitres',
  google_review_url: 'https://g.page/exemple',
  client_phone: '(514) 555-0123',
  client_email: 'marie@exemple.ca',
};

export function remplacerVariables(s: string): string {
  return s.replace(/\[(\w+)\]/g, (tout, cle) => EXEMPLES[cle] ?? tout);
}
