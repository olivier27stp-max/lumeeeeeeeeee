/**
 * Gabarit commun des courriels (2026-09-17).
 * ──────────────────────────────────────────
 * Avant : chaque route bricolait son HTML (six mises en page, anglais par
 * défaut, bouton indigo générique, « Sent via LUME on behalf of… »). Rafba,
 * en recevant une facture test : « les envois de courriel sont laids ».
 *
 * Ici, UN seul gabarit, deux voix :
 *   - `rendreCourrielClient` : ce qu'une ENTREPRISE envoie à SON client
 *     (facture, soumission, demande de paiement, rappel, contrat, formulaire).
 *     Aux couleurs de l'entreprise (logo, couleur de marque), dans la langue
 *     de l'entreprise (company_settings.default_language), signé par elle ;
 *     Lume n'apparaît qu'en une ligne discrète au pied.
 *   - `rendreCourrielLume` : ce que LUME envoie à ses abonnés (compte,
 *     abonnement, support, paiement reçu). Marque Lume, noir sur blanc.
 *
 * Structure d'un courriel : pré-en-tête (résumé dans la boîte de réception),
 * bande de couleur, logo ou nom, titre, salutation, phrase, carte du montant
 * (ce qu'on cherche du regard en premier), lignes de détail, UN bouton,
 * lien texte de secours, note, signature, pied (coordonnées, réseaux, numéros
 * de taxes, « Envoyé avec Lume »).
 *
 * Règles d'un courriel qui s'affiche partout : tableaux, CSS en ligne, 600 px,
 * pas d'image pour le bouton, pas de police web, texte alternatif sur le logo,
 * `lang` posé, une couleur de marque trop pâle est remplacée pour le contraste.
 * Pur, testé (tests/courriels/gabarit.test.ts) ; aperçu et envoi d'essai :
 * scripts/qa/apercu-courriels.mts.
 */
import { RESEAUX, RESEAU_LABEL, lireLiensSociaux, type SocialLinks } from '../socialLinks';

export type Langue = 'fr' | 'en';

export interface Marque {
  nom: string;
  logoUrl?: string | null;
  /** Couleur de marque (#rrggbb) ; sinon le noir Lume. */
  couleur?: string | null;
  email?: string | null;
  telephone?: string | null;
  adresse?: string | null;
  siteWeb?: string | null;
  liensSociaux?: SocialLinks | null;
  /** « TPS No : 123… », « TVQ No : … » */
  lignesTaxes?: string[] | null;
}

export interface LigneDetail { libelle: string; valeur: string; fort?: boolean }

export interface CourrielClient {
  langue: Langue;
  marque: Marque;
  /** Résumé affiché par Gmail/Outlook sous le sujet, avant d'ouvrir. */
  preheader?: string | null;
  /** Vide = pas de titre (contenu libre qui porte le sien). */
  titre?: string | null;
  /** « Bonjour Marie, » — vide = pas de salutation. */
  salutation?: string | null;
  intro?: string | null;
  /** La carte du montant : ce que le client cherche du regard en premier. */
  montant?: { libelle: string; valeur: string; sous?: string | null } | null;
  lignes?: LigneDetail[] | null;
  bouton?: { texte: string; url: string } | null;
  /** Contenu libre (modèle de l'entreprise, texte personnalisé) — HTML déjà assaini par l'appelant. */
  corpsHtml?: string | null;
  note?: string | null;
  /** Phrase de signature ; défaut : le nom de l'entreprise. */
  signature?: string | null;
}

export interface CourrielLume {
  langue: Langue;
  preheader?: string | null;
  titre?: string | null;
  salutation?: string | null;
  intro?: string | null;
  montant?: { libelle: string; valeur: string; sous?: string | null } | null;
  lignes?: LigneDetail[] | null;
  bouton?: { texte: string; url: string } | null;
  corpsHtml?: string | null;
  note?: string | null;
  /** Adresse de support au pied. */
  supportEmail?: string | null;
  /** Phrase de signature ; défaut « — L’équipe Lume » ; null = aucune (alertes internes). */
  signature?: string | null;
}

export const COULEUR_LUME = '#111827';
export const LOGO_LUME_URL = 'https://lumecrm.net/lume-logo.png';
const GRIS_TEXTE = '#374151';
const GRIS_DOUX = '#6b7280';
const GRIS_PALE = '#9ca3af';
const FOND = '#f3f4f6';
const BORDURE = '#e5e7eb';
const POLICE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function echapper(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** 1 234,56 $ en français, $1,234.56 en anglais. */
export function montant(cents: number, currency = 'CAD', langue: Langue = 'fr'): string {
  return new Intl.NumberFormat(langue === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: currency || 'CAD' }).format((cents || 0) / 100);
}

/** « 17 septembre 2026 » / « September 17, 2026 » ; une date seule (AAAA-MM-JJ) n'est jamais décalée par le fuseau. */
export function dateLisible(iso: string | null | undefined, langue: Langue = 'fr', fuseau = 'America/Toronto'): string {
  if (!iso) return '';
  const seule = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = seule ? new Date(Date.UTC(Number(seule[1]), Number(seule[2]) - 1, Number(seule[3]), 12)) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(langue === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'long', timeZone: seule ? 'UTC' : fuseau }).format(d);
}

/** Une couleur de marque trop pâle (jaune, blanc cassé) ne porte pas du texte blanc : on retombe sur le noir Lume. */
export function couleurBouton(couleur: string | null | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(couleur || '').trim());
  if (!m) return COULEUR_LUME;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contraste avec le blanc = 1.05 / (L + 0.05) ; sous 3:1 le texte blanc devient illisible.
  return 1.05 / (luminance + 0.05) >= 3 ? `#${m[1].toLowerCase()}` : COULEUR_LUME;
}

function liensSociauxHtml(liens: SocialLinks | null | undefined): string {
  const propres = lireLiensSociaux(liens);
  const items = RESEAUX.filter((r) => propres[r]).map((r) => `<a href="${echapper(propres[r])}" style="color:${GRIS_DOUX};text-decoration:none;font-weight:600;">${RESEAU_LABEL[r]}</a>`);
  return items.length ? `<p style="margin:10px 0 0;font-size:12px;color:${GRIS_PALE};">${items.join(' &nbsp;&middot;&nbsp; ')}</p>` : '';
}

function blocMontant(m: NonNullable<CourrielClient['montant']>): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
<tr><td style="background:#f9fafb;border:1px solid ${BORDURE};border-radius:10px;padding:18px 20px;text-align:center;">
<div style="font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:${GRIS_DOUX};font-weight:600;">${echapper(m.libelle)}</div>
<div style="font-size:32px;line-height:1.2;font-weight:700;color:#111827;margin-top:4px;">${echapper(m.valeur)}</div>
${m.sous ? `<div style="font-size:13px;color:${GRIS_DOUX};margin-top:4px;">${echapper(m.sous)}</div>` : ''}
</td></tr>
</table>`;
}

function blocLignes(lignes: LigneDetail[]): string {
  if (!lignes.length) return '';
  const rows = lignes.map((l, i) => `
<tr>
<td style="padding:10px 0;font-size:14px;color:${GRIS_DOUX};${i ? `border-top:1px solid ${BORDURE};` : ''}">${echapper(l.libelle)}</td>
<td align="right" style="padding:10px 0;font-size:14px;color:#111827;${l.fort ? 'font-weight:700;' : ''}${i ? `border-top:1px solid ${BORDURE};` : ''}">${echapper(l.valeur)}</td>
</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${rows}</table>`;
}

function blocBouton(b: NonNullable<CourrielClient['bouton']>, couleur: string, langue: Langue, tu = false): string {
  const url = echapper(b.url);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px auto 14px;">
<tr><td align="center" style="background:${couleur};border-radius:8px;">
<a href="${url}" style="display:inline-block;padding:14px 36px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;font-family:${POLICE};">${echapper(b.texte)}</a>
</td></tr>
</table>
${/^(tel|mailto|sms):/i.test(b.url) ? '' : `<p style="margin:0 0 20px;font-size:12px;color:${GRIS_PALE};text-align:center;">${langue === 'fr' ? (tu ? 'Le bouton ne fonctionne pas ? Copie ce lien :' : 'Le bouton ne fonctionne pas ? Copiez ce lien :') : 'Button not working? Copy this link:'}<br/><a href="${url}" style="color:${GRIS_DOUX};word-break:break-all;">${url}</a></p>`}`;
}

function coquille(p: { langue: Langue; titreDocument: string; preheader?: string | null; couleur: string; enTeteHtml: string; corpsHtml: string; piedHtml: string }): string {
  return `<!DOCTYPE html>
<html lang="${p.langue}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<title>${echapper(p.titreDocument)}</title>
</head>
<body style="margin:0;padding:0;background:${FOND};font-family:${POLICE};-webkit-text-size-adjust:100%;">
${p.preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${FOND};">${echapper(p.preheader)}${'&#8203;&nbsp;'.repeat(40)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FOND};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BORDURE};">
<tr><td style="height:6px;background:${p.couleur};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:26px 32px 8px;text-align:center;">${p.enTeteHtml}</td></tr>
<tr><td style="padding:8px 32px 28px;">${p.corpsHtml}</td></tr>
<tr><td style="padding:18px 32px 22px;background:#f9fafb;border-top:1px solid ${BORDURE};text-align:center;">${p.piedHtml}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function corpsCommun(c: { langue: Langue; titre?: string | null; salutation?: string | null; intro?: string | null; montant?: CourrielClient['montant']; lignes?: LigneDetail[] | null; bouton?: CourrielClient['bouton']; corpsHtml?: string | null; note?: string | null; signature?: string | null }, couleur: string, tu = false): string {
  return `
${c.titre ? `<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:#111827;">${echapper(c.titre)}</h1>` : ''}
${c.salutation ? `<p style="margin:0 0 10px;font-size:15px;color:${GRIS_TEXTE};">${echapper(c.salutation)}</p>` : ''}
${c.intro ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:${GRIS_TEXTE};">${echapper(c.intro)}</p>` : ''}
${c.montant ? blocMontant(c.montant) : ''}
${c.lignes?.length ? blocLignes(c.lignes) : ''}
${c.corpsHtml ? `<div style="font-size:15px;line-height:1.55;color:${GRIS_TEXTE};margin:0 0 20px;">${c.corpsHtml}</div>` : ''}
${c.bouton ? blocBouton(c.bouton, couleur, c.langue, tu) : ''}
${c.note ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${GRIS_DOUX};">${echapper(c.note)}</p>` : ''}
${c.signature ? `<p style="margin:0;font-size:15px;color:${GRIS_TEXTE};">${echapper(c.signature)}</p>` : ''}`;
}

/** Ce qu'une entreprise envoie à son client, à ses couleurs et dans sa langue. */
export function rendreCourrielClient(c: CourrielClient): string {
  const couleur = couleurBouton(c.marque.couleur);
  const nom = c.marque.nom || 'Lume';
  const enTete = c.marque.logoUrl
    ? `<img src="${echapper(c.marque.logoUrl)}" alt="${echapper(nom)}" style="max-height:52px;max-width:220px;display:inline-block;"/>`
    : `<span style="font-size:20px;font-weight:700;color:#111827;">${echapper(nom)}</span>`;
  const coordonnees = [c.marque.adresse, c.marque.telephone, c.marque.email, c.marque.siteWeb].filter(Boolean).map((x) => echapper(x)).join(' &nbsp;&middot;&nbsp; ');
  const taxes = (c.marque.lignesTaxes || []).filter(Boolean);
  const envoyeAvec = c.langue === 'fr' ? 'Envoyé avec' : 'Sent with';
  const pied = `
<p style="margin:0;font-size:13px;font-weight:600;color:${GRIS_TEXTE};">${echapper(nom)}</p>
${coordonnees ? `<p style="margin:4px 0 0;font-size:12px;line-height:1.5;color:${GRIS_DOUX};">${coordonnees}</p>` : ''}
${liensSociauxHtml(c.marque.liensSociaux)}
${taxes.length ? `<p style="margin:8px 0 0;font-size:11px;color:${GRIS_PALE};">${taxes.map(echapper).join(' &nbsp;&middot;&nbsp; ')}</p>` : ''}
<p style="margin:12px 0 0;font-size:11px;color:${GRIS_PALE};">${envoyeAvec} <a href="https://lumecrm.net" style="color:${GRIS_PALE};text-decoration:none;font-weight:600;">Lume</a></p>`;
  return coquille({
    langue: c.langue, titreDocument: c.titre || nom, preheader: c.preheader, couleur, enTeteHtml: enTete,
    corpsHtml: corpsCommun({ ...c, signature: c.signature === undefined ? (c.langue === 'fr' ? `— ${nom}` : `— ${nom}`) : c.signature }, couleur),
    piedHtml: pied,
  });
}

/** Ce que Lume envoie à ses abonnés : marque Lume, noir sur blanc, TUTOIEMENT (c'est la voix de Lume envers ses abonnés ; les entreprises vouvoient leurs clients). */
export function rendreCourrielLume(c: CourrielLume): string {
  const support = c.supportEmail || 'support@lumecrm.net';
  const enTete = `<img src="${LOGO_LUME_URL}" alt="Lume" style="height:36px;display:inline-block;"/>`;
  const pied = `
<p style="margin:0;font-size:12px;line-height:1.5;color:${GRIS_DOUX};">${c.langue === 'fr' ? 'Une question ? Réponds à ce courriel ou écris-nous à' : 'Questions? Reply to this email or write to'} <a href="mailto:${echapper(support)}" style="color:${GRIS_DOUX};">${echapper(support)}</a>.</p>
<p style="margin:8px 0 0;font-size:11px;color:${GRIS_PALE};">Lume CRM &nbsp;&middot;&nbsp; <a href="https://lumecrm.net" style="color:${GRIS_PALE};text-decoration:none;">lumecrm.net</a></p>`;
  return coquille({ langue: c.langue, titreDocument: c.titre || 'Lume', preheader: c.preheader, couleur: COULEUR_LUME, enTeteHtml: enTete, corpsHtml: corpsCommun({ ...c, signature: c.signature === undefined ? (c.langue === 'fr' ? '— L’équipe Lume' : '— The Lume team') : c.signature }, COULEUR_LUME, true), piedHtml: pied });
}

/** Les mots qui reviennent dans tous les courriels client, dans les deux langues. */
export const MOTS = {
  fr: { bonjour: (nom: string) => `Bonjour ${nom},`, facture: 'Facture', soumission: 'Soumission', contrat: 'Contrat', montantDu: 'Montant à payer', montantTotal: 'Montant', echeance: 'Échéance', valideJusquau: 'Valide jusqu’au', numero: 'Numéro', statut: 'Statut', payee: 'Payée', voirFacture: 'Voir et payer la facture', voirSoumission: 'Voir la soumission', payer: (m: string) => `Payer ${m}`, voirContrat: 'Voir et signer le contrat', question: 'Une question ? Répondez simplement à ce courriel.', envoyeAvec: 'Envoyé avec' },
  en: { bonjour: (nom: string) => `Hi ${nom},`, facture: 'Invoice', soumission: 'Quote', contrat: 'Contract', montantDu: 'Amount due', montantTotal: 'Amount', echeance: 'Due date', valideJusquau: 'Valid until', numero: 'Number', statut: 'Status', payee: 'Paid', voirFacture: 'View and pay invoice', voirSoumission: 'View quote', payer: (m: string) => `Pay ${m}`, voirContrat: 'View and sign contract', question: 'Questions? Just reply to this email.', envoyeAvec: 'Sent with' },
} as const;

export function langueDe(valeur: unknown): Langue {
  return String(valeur || '').toLowerCase().startsWith('en') ? 'en' : 'fr';
}
