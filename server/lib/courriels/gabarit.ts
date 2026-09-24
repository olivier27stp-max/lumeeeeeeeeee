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
  /** Un seul geste. `sousBouton` leve la derniere objection, colle au bouton. */
  bouton?: { texte: string; url: string; sousBouton?: string | null } | null;
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
  /** Un seul geste. `sousBouton` leve la derniere objection, colle au bouton. */
  bouton?: { texte: string; url: string; sousBouton?: string | null } | null;
  corpsHtml?: string | null;
  note?: string | null;
  /** Adresse de support au pied. */
  supportEmail?: string | null;
  /** Phrase de signature ; défaut « — L’équipe Lume » ; null = aucune (alertes internes). */
  signature?: string | null;
}

export const COULEUR_LUME = '#111827';
/* Le logo HORIZONTAL, celui du site (2026-09-24).

   Les courriels servaient `lume-logo.png` : 1536 × 1024, un logo VERTICAL
   (le panda au-dessus, « LUME » dessous, « CRM » encore dessous) écrasé à
   36 px de haut. Mesuré sur le fichier : le mot « LUME » y faisait 8 px et
   « CRM » en faisait 2 — invisibles. L'image entière occupait 54 px de large,
   un timbre au milieu du courriel, pour 140 Ko téléchargés.

   `lume-logo-v2.png` est celui que l'app et le site utilisent déjà à neuf
   endroits (barre latérale, pied de page). Horizontal, ratio 3,85 : 139 px de
   large à 36 px de haut, et 65 Ko au lieu de 140.

   Les courriels étaient les derniers restés sur le vertical. */
export const LOGO_LUME_URL = 'https://lumecrm.net/lume-logo-v2.png';
const GRIS_TEXTE = '#374151';
const GRIS_DOUX = '#6b7280';
const GRIS_PALE = '#9ca3af';
const FOND = '#f3f4f6';
const BORDURE = '#e5e7eb';

/* ── Deux décors, parce qu'il y a deux marques (2026-09-23) ────────────────

   Le ciel bleu des pages marketing a d'abord été posé sur TOUS les courriels,
   y compris ceux qu'une entreprise envoie à ses propres clients. C'était une
   erreur de destinataire : quand Coquin lavage facture Sophie, Sophie doit
   voir Coquin lavage. Le ciel est la marque de LUME — Sophie ne le connaît
   pas, et il concurrence la couleur de l'entreprise.

   L'anomalie qui le prouvait : la couleur de marque de l'entreprise ne servait
   qu'au bouton. Tout le décor était du Lume. L'inverse de ce qu'il faut.

   Donc :
   - `rendreCourrielClient` → fond gris neutre, et la couleur de l'entreprise
     porte le filet de tête, le bouton et les liens. C'est elle qu'on voit.
   - `rendreCourrielLume` → le ciel. Là, la marque de Lume est à sa place :
     le destinataire est l'abonné, qui la connaît. */
const CIEL_HAUT = '#e6f0ff';
const CIEL_BAS = '#f3f8ff';
const BLEU_LUME = '#0b5cad';
const CIEL_FILET = '#d3e3f7';
/* Le décor d'un courriel d'entreprise : BLANC.

   C'était d'abord un gris très pâle (#f4f5f7), sur lequel la carte blanche se
   détachait. Deux raisons de l'abandonner, la seconde décisive :

   1. Rafba, en recevant le courriel : « c'est comme dark, je suis pas sûr
      d'aimer ça ». Un gris clair sur un écran est lu comme une teinte, et
      une teinte qu'on n'a pas choisie paraît sale.

   2. Surtout : Gmail sur Android et iOS IGNORE `color-scheme: light` et
      inverse les couleurs en mode sombre. Un gris pâle y devient un gris
      foncé — exactement ce qui a été observé. Le blanc pur, lui, reste le
      fond que ces clients gardent ou inversent proprement en noir, sans
      teinte intermédiaire douteuse.

   La carte perd donc son fond distinct et devient un simple cadre : c'est le
   contour, pas le contraste, qui la sépare maintenant du fond. */
const FOND_CLIENT = '#ffffff';
const FILET_CLIENT = '#e4e7ec';
/* Le cadenas sous le bouton de paiement.

   Jobber en pose un (« Secure payments · Debit or credit ») et c'est la seule
   chose qu'ils font mieux : au moment exact du clic, une icône rassure plus
   qu'une phrase. Le nôtre disait « Carte de crédit · aucun compte à créer »
   sans signal visuel.

   En SVG inline, jamais en image : Gmail et Outlook bloquent les images
   distantes par défaut, et un cadenas qui ne s'affiche pas rassure moins
   qu'une absence de cadenas. `currentColor` est évité — un SVG hérite mal
   selon les clients, on fixe la couleur. */
const CADENAS = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

/* La mascotte au pied d'un courriel d'entreprise.

   Le pied disait « Envoyé avec Lume », en texte seul. Une pastille ronde avec
   le bonhomme se reconnaît d'un coup d'œil là où trois mots gris se lisent
   à peine — et elle reste DISCRÈTE : 18 px, à côté de notre nom, sous les
   coordonnées de l'entreprise. Jamais en tête : le courriel appartient à
   l'entreprise, pas à nous.

   `favicon-mascot-v2.png` est le bonhomme SEUL, sans le mot « LUME » : 512 px
   carrés, fond transparent, 32 Ko. Le logo complet (v2) porte le mot, donc il
   ferait doublon avec le texte à côté.

   Dimensions en attributs ET en style : Outlook ignore le style seul et
   afficherait l'image à sa taille native — 512 px au milieu du pied.

   `vertical-align:middle` sur les deux cellules : sans lui, le texte se pose
   sur la ligne de base et flotte sous la pastille. */
const MASCOTTE_LUME_URL = 'https://lumecrm.net/favicon-mascot-v2.png';
const SIGNATURE_LUME = (envoyeAvec: string) => `
<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:14px auto 0;">
<tr>
<td style="padding-right:6px;vertical-align:middle;line-height:0;"><img src="${MASCOTTE_LUME_URL}" alt="" width="18" height="18" style="width:18px;height:18px;display:block;border:0;outline:none;border-radius:50%;"/></td>
<td style="vertical-align:middle;font-size:11px;color:${GRIS_PALE};">${envoyeAvec} <a href="https://lumecrm.net" style="color:${GRIS_PALE};text-decoration:none;font-weight:600;">Lume</a></td>
</tr>
</table>`;

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

/**
 * Le chiffre que le lecteur cherche du regard. Il ouvre le courriel : pas de
 * cadre gris autour, mais un filet sous lui qui le sépare du reste. Le libellé
 * reste en minuscules — une capitale espacée fait « facture d'agence » là où
 * on veut la voix d'un artisan.
 */
/**
 * Le montant, en ouverture du courriel.
 *
 * Il était centré, sous un libellé et au-dessus d'un filet. Il est maintenant
 * aligné à GAUCHE, sans filet, et son libellé passe en dessous sous forme de
 * phrase (« Votre facture est due le 24 avril ») — la forme de Jobber, et
 * celle qui se lit le mieux : un chiffre aligné à gauche se lit comme le début
 * d'un document, centré il se lit comme une affiche.
 *
 * Le libellé au-dessus (« Solde à payer ») disparaît : « 1 220,17 $ » suivi de
 * « Votre facture est due le… » dit tout, et l'étiquette ne faisait que
 * retarder le chiffre.
 */
function blocMontant(m: NonNullable<CourrielClient['montant']>): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin:0 0 4px;">
<tr><td style="background:#ffffff;">
<div style="font-size:38px;line-height:1.05;font-weight:800;color:#101828;letter-spacing:-1.6px;">${echapper(m.valeur)}</div>
<div style="font-size:14px;color:${GRIS_DOUX};margin-top:8px;">${echapper(m.sous || m.libelle)}</div>
</td></tr>
</table>`;
}

function blocLignes(lignes: LigneDetail[]): string {
  if (!lignes.length) return '';
  const rows = lignes.map((l, i) => `
<tr>
<td style="background:#ffffff;padding:10px 0;font-size:14px;color:${GRIS_DOUX};${i ? `border-top:1px solid ${BORDURE};` : ''}">${echapper(l.libelle)}</td>
<td align="right" style="background:#ffffff;padding:10px 0;font-size:14px;color:#111827;${l.fort ? 'font-weight:700;' : ''}${i ? `border-top:1px solid ${BORDURE};` : ''}">${echapper(l.valeur)}</td>
</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin:0 0 20px;">${rows}</table>`;
}

/**
 * Un seul bouton, pleine largeur, et sous lui la ligne qui lève la dernière
 * objection (`sousBouton`) : « Carte de crédit · aucun compte à créer ». Elle
 * est collée au bouton parce que c'est là que naît l'hésitation, pas trois
 * paragraphes plus bas.
 */
function blocBouton(b: NonNullable<CourrielClient['bouton']>, couleur: string, langue: Langue, tu = false): string {
  const url = echapper(b.url);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="background:#ffffff;margin:18px 0 0;">
<tr><td style="background:${couleur};border-radius:9px;">
<a href="${url}" style="display:block;padding:14px 30px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;font-family:${POLICE};text-align:center;">${echapper(b.texte)}</a>
</td></tr>
</table>
${b.sousBouton ? `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#ffffff;margin:12px 0 0;"><tr>
<td style="background:#ffffff;padding-right:7px;vertical-align:middle;line-height:0;">${CADENAS}</td>
<td style="background:#ffffff;font-size:12px;color:${GRIS_DOUX};vertical-align:middle;">${echapper(b.sousBouton)}</td>
</tr></table>` : ''}
${/^(tel|mailto|sms):/i.test(b.url) ? '' : `<p style="margin:0 0 20px;font-size:11px;color:${GRIS_PALE};line-height:1.5;">${langue === 'fr' ? (tu ? 'Le bouton ne fonctionne pas ?' : 'Le bouton ne fonctionne pas ?') : 'Button not working?'} <a href="${url}" style="color:${GRIS_PALE};text-decoration:underline;">${langue === 'fr' ? 'Ouvrir le lien' : 'Open the link'}</a></p>`}`;
}

/**
 * Le décor d'un courriel. Deux seulement, et le choix suit l'expéditeur :
 * `client` quand c'est une ENTREPRISE qui écrit à son client (gris neutre,
 * la couleur de l'entreprise en filet de tête), `lume` quand c'est Lume qui
 * écrit à son abonné (le ciel des pages marketing).
 *
 * `filetTete` est la seule couleur variable : celle de l'entreprise, déjà
 * validée pour le contraste par `couleurBouton`. Le reste du décor est fixe —
 * une entreprise choisit sa couleur, pas la mise en page.
 */
function coquille(p: {
  langue: Langue;
  titreDocument: string;
  preheader?: string | null;
  enTeteHtml: string;
  corpsHtml: string;
  piedHtml: string;
  decor: 'client' | 'lume';
  filetTete?: string | null;
}): string {
  const client = p.decor === 'client';
  const fond = client ? FOND_CLIENT : CIEL_HAUT;
  const filetCarte = client ? FILET_CLIENT : CIEL_FILET;
  /* La carte, des deux côtés — mais pour deux raisons différentes.

     Côté Lume elle se détache du ciel. Côté client, sur fond blanc, elle ne se
     détache de rien : c'est sa BORDURE qui travaille. Elle a été retirée
     brièvement le 2026-09-23, en pensant qu'un cadre sur du blanc n'encadrait
     rien ; Rafba, en recevant le résultat : « blanc sur ordi mais y a pas de
     bordure ». Sans elle le contenu flotte, et un courriel de facture a besoin
     d'un contour pour se lire comme un document. */
  /* Le filet de tête : 4 px de la couleur de l'entreprise, tout en haut. Un
     courriel d'entreprise n'a sinon AUCUNE couleur à elle avant le bouton,
     qui arrive après le montant — trop bas pour signer le message. */
  /* Le filet de la couleur de l'entreprise, SOUS le logo.

     Il était en pleine largeur tout en haut, collé au bandeau de Gmail : sur
     la capture d'un vrai courriel, il se confondait avec l'interface du client
     au lieu de signer le message. Sous le logo, court et centré, il sépare
     l'en-tête du contenu et se lit comme un trait de marque. */
  const bandeau = '';
  /* Le trait sous l'en-tête, pleine largeur.

     Trois formes essayées le 2026-09-23 : pleine largeur tout en haut (il se
     confondait avec le bandeau de Gmail), puis un court trait centré sous un
     logo centré. Celle-ci vient de l'en-tête « papier à lettres » : le trait
     ferme le bloc d'identité et ouvre le message, comme sur une facture
     imprimée. Il porte la couleur de l'entreprise — c'est sa signature. */
  const filetSousLogo = client
    ? `<tr><td style="background:${fond};padding:0 8px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${fond};"><tr><td style="background:${p.filetTete || FILET_CLIENT};height:2px;line-height:2px;font-size:0;">&nbsp;</td></tr></table></td></tr>`
    : '';
  return `<!DOCTYPE html>
<html lang="${p.langue}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<title>${echapper(p.titreDocument)}</title>
<style>
/* Le mode sombre des clients de courriel.

   Les deux balises ci-dessus DEMANDENT le mode clair — et Apple Mail les
   respecte. Gmail (Android, iOS) et Outlook.com, eux, les ignorent et
   inversent les couleurs eux-mêmes : un fond blanc devient gris foncé, un
   texte sombre devient pâle. Rafba, en recevant le courriel : « c’est encore
   en noir et vert, moi je veux blanc et vert ».

   Il n’existe pas de façon propre de l’interdire. Ce qui suit est ce que la
   pratique a retenu :

   - color-scheme: light only sur :root : la déclaration CSS que les
     moteurs récents lisent, plus forte que la balise <meta>.
   - [data-ogsc] / [data-ogsb] : Outlook.com pose ces attributs quand il
     inverse ; on remet alors nos couleurs à la main.
   - La media query : sur les clients qui l’appliquent, on redit explicitement
     ce qu’on veut au lieu de les laisser deviner.

   Gmail supprime les media queries dans certains cas ; c’est pourquoi les
   couleurs restent AUSSI en ligne sur chaque élément. Cette feuille ne
   remplace rien : elle résiste. */
:root { color-scheme: light only; supported-color-schemes: light only; }
body, .lume-fond { background-color: ${fond} !important; }
.lume-texte { color: #101828 !important; }
[data-ogsc] body, [data-ogsb] body,
[data-ogsc] .lume-fond, [data-ogsb] .lume-fond { background-color: ${fond} !important; }
[data-ogsc] .lume-texte, [data-ogsb] .lume-texte { color: #101828 !important; }
@media (prefers-color-scheme: dark) {
  body, .lume-fond { background-color: ${fond} !important; }
  .lume-texte { color: #101828 !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:${fond};font-family:${POLICE};-webkit-text-size-adjust:100%;">
${p.preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${fond};">${echapper(p.preheader)}${'&#8203;&nbsp;'.repeat(40)}</div>` : ''}
<table role="presentation" class="lume-fond" width="100%" cellpadding="0" cellspacing="0" style="background:${fond};">
${bandeau}
<tr><td align="center" style="background:${fond};padding:24px 12px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${fond};max-width:600px;">
<tr><td style="background:${fond};padding:0 8px 12px;text-align:center;">${p.enTeteHtml}</td></tr>
${filetSousLogo}
<tr><td style="${client ? `background:#ffffff;border:1px solid ${filetCarte};border-radius:14px;padding:22px 26px;` : `background:#ffffff;border:1px solid ${filetCarte};border-radius:16px;padding:26px 32px;`}">${p.corpsHtml}</td></tr>
<tr><td style="background:${fond};padding:20px 8px 26px;text-align:center;">${p.piedHtml}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * L'ordre compte, et il vient des maquettes validées avec Rafba :
 * montant → lignes → BOUTON → note → signature.
 *
 * Le bouton était auparavant sous la note. Sur téléphone, cela le poussait
 * sous la ligne de flottaison : le lecteur devait faire défiler pour trouver
 * le geste qu'on lui demande. Le geste vient maintenant juste après le
 * chiffre qui le motive ; la note rassure ensuite, pour qui hésite encore.
 */
/**
 * Le corps d'un courriel : ce qu'on demande d'abord, ce qu'on explique ensuite.
 *
 * L'ordre a changé le 2026-09-23, après comparaison avec les courriels de
 * Jobber : le MONTANT et le BOUTON passent en tête, avant la salutation et le
 * texte. Le lecteur sait combien et peut agir sans avoir lu une phrase — c'est
 * ce qui frappe dans les leurs, et c'est juste : personne n'ouvre une facture
 * pour lire de la prose.
 *
 * Le détail des lignes reste APRÈS le message, là où il répond à la question
 * « pourquoi ce montant » une fois qu'elle se pose.
 *
 * `titre` disparaît quand un montant ouvre le courriel : « Votre facture 48 »
 * au-dessus de « 1 220,17 $ » dit deux fois la même chose, et le chiffre le
 * dit mieux. Il reste pour les courriels sans montant (contrat, rendez-vous),
 * où il porte le sujet.
 */
function corpsCommun(c: { langue: Langue; titre?: string | null; salutation?: string | null; intro?: string | null; montant?: CourrielClient['montant']; lignes?: LigneDetail[] | null; bouton?: CourrielClient['bouton']; corpsHtml?: string | null; note?: string | null; signature?: string | null }, couleur: string, tu = false): string {
  /* Le bloc d'action n'ouvre le courriel QUE s'il porte un montant.

     Sans montant, le bouton seul remontait au-dessus du message : « Voir le
     rendez-vous » arrivait avant la phrase qui dit de quoi il s'agit. Absurde
     sur les 26 relances automatiques, qui n'ont pas de chiffre — on ne
     demande pas de cliquer avant d'avoir dit pourquoi.

     Avec un montant, l'inverse est vrai : le chiffre EST le sujet, et le
     bouton qui le suit se comprend seul. */
  const ouvreParLAction = Boolean(c.montant);
  const aDuTexte = Boolean(c.salutation || c.intro || c.corpsHtml || c.lignes?.length);
  return `
${c.montant ? `${c.titre ? `<p style="margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:.02em;color:${GRIS_DOUX};">${echapper(c.titre)}</p>` : ''}${blocMontant(c.montant)}` : ''}
${ouvreParLAction && c.bouton ? blocBouton(c.bouton, couleur, c.langue, tu) : ''}
${ouvreParLAction && aDuTexte ? `<div style="height:22px;line-height:22px;font-size:0;">&nbsp;</div>` : ''}
${c.titre ? (c.montant
  /* Avec un montant, le titre passe AU-DESSUS du chiffre, en petit : « Votre
     facture 48 » puis « 1 220,17 $ ». Il ne le répète pas, il le nomme — et
     surtout la version texte du courriel garderait sinon un message sans
     sujet, puisque l'objet n'y figure pas. */
  ? ''
  : `<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;font-weight:700;color:#101828;">${echapper(c.titre)}</h1>`) : ''}
${c.salutation ? `<p style="margin:0 0 12px;font-size:15px;color:${GRIS_TEXTE};">${echapper(c.salutation)}</p>` : ''}
${c.intro ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:${GRIS_TEXTE};">${echapper(c.intro)}</p>` : ''}
${c.corpsHtml ? `<div style="font-size:15px;line-height:1.55;color:${GRIS_TEXTE};margin:0 0 18px;">${c.corpsHtml}</div>` : ''}
${c.lignes?.length ? blocLignes(c.lignes) : ''}
${!ouvreParLAction && c.bouton ? blocBouton(c.bouton, couleur, c.langue, tu) : ''}
${c.note ? `<p style="margin:${!ouvreParLAction && c.bouton ? '18px' : '0'} 0 16px;font-size:13px;line-height:1.5;color:${GRIS_DOUX};">${echapper(c.note)}</p>` : ''}
${c.signature ? `<p style="margin:0;font-size:15px;color:${GRIS_TEXTE};">${echapper(c.signature)}</p>` : ''}`;
}

/** Ce qu'une entreprise envoie à son client, à ses couleurs et dans sa langue. */
export function rendreCourrielClient(c: CourrielClient): string {
  const couleur = couleurBouton(c.marque.couleur);
  const nom = c.marque.nom || 'Lume';
  /* L’en-tête, façon papier à lettres : le logo à gauche, aligné.

     Le logo était centré, seul, flottant au-dessus du vide. Une en-tête
     d'entreprise se lit de gauche à droite — c'est ce que fait un en-tête
     imprimé, et ce que Jobber fait aussi.

     Le nom n’est PAS répété à côté du logo : règle décidée avec Rafba et
     gardée par deux tests — la version texte disait « Vision Lavage : Vision
     Lavage ». Le texte alternatif du logo le porte, et le pied le redit.

     Sans logo, le nom prend toute la ligne, à gauche : centré tout seul il
     avait l'air d'un titre, pas d'une signature. */
  const enTete = c.marque.logoUrl
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FOND_CLIENT};">
<tr>
<td align="left" style="background:${FOND_CLIENT};vertical-align:middle;"><img src="${echapper(c.marque.logoUrl)}" alt="${echapper(nom)}" style="max-height:56px;max-width:170px;display:block;"/></td>

</tr>
</table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FOND_CLIENT};">
<tr><td align="left" style="background:${FOND_CLIENT};font-size:19px;font-weight:700;color:#101828;">${echapper(nom)}</td></tr>
</table>`;
  /* Le téléphone et le courriel d'abord, et cliquables : un client qui a une
     question veut souvent appeler, pas écrire. L'adresse postale suit.

     Ils portent la couleur de L'ENTREPRISE, pas le bleu de Lume. Ils étaient
     en `BLEU_LUME` : dans le courriel de Coquin lavage, les seuls liens
     colorés du pied étaient donc au bleu d'un produit que son client ne
     connaît pas. `couleur` a déjà traversé `couleurBouton`, donc elle est
     lisible. */
  const joindre = [
    c.marque.telephone ? `<a href="tel:${echapper(String(c.marque.telephone).replace(/[^\d+]/g, ''))}" style="color:${couleur};text-decoration:none;font-weight:600;">${echapper(c.marque.telephone)}</a>` : '',
    c.marque.email ? `<a href="mailto:${echapper(c.marque.email)}" style="color:${couleur};text-decoration:none;font-weight:600;">${echapper(c.marque.email)}</a>` : '',
  ].filter(Boolean).join(' &nbsp;&middot;&nbsp; ');
  const postal = [c.marque.adresse, c.marque.siteWeb].filter(Boolean).map((x) => echapper(x)).join(' &nbsp;&middot;&nbsp; ');
  const taxes = (c.marque.lignesTaxes || []).filter(Boolean);
  const envoyeAvec = c.langue === 'fr' ? 'Envoyé avec' : 'Sent with';
  const pied = `
${joindre ? `<p style="margin:0;font-size:13px;line-height:1.6;">${joindre}</p>` : ''}
<p style="margin:${joindre ? '4px' : '0'} 0 0;font-size:12px;line-height:1.5;color:${GRIS_DOUX};">${echapper(nom)}${postal ? ` &nbsp;&middot;&nbsp; ${postal}` : ''}</p>
${liensSociauxHtml(c.marque.liensSociaux)}
${taxes.length ? `<p style="margin:8px 0 0;font-size:11px;color:${GRIS_PALE};">${taxes.map(echapper).join(' &nbsp;&middot;&nbsp; ')}</p>` : ''}
${SIGNATURE_LUME(envoyeAvec)}`;
  return coquille({
    langue: c.langue, titreDocument: c.titre || nom, preheader: c.preheader, enTeteHtml: enTete,
    corpsHtml: corpsCommun({ ...c, signature: c.signature === undefined ? (c.langue === 'fr' ? `— ${nom}` : `— ${nom}`) : c.signature }, couleur),
    piedHtml: pied,
    decor: 'client',
    // `couleur` a déjà traversé `couleurBouton` : une teinte trop pâle y est
    // devenue le noir Lume, donc le filet ne disparaît jamais sur le gris.
    filetTete: couleur,
  });
}

/** Ce que Lume envoie à ses abonnés : marque Lume, noir sur blanc, TUTOIEMENT (c'est la voix de Lume envers ses abonnés ; les entreprises vouvoient leurs clients). */
export function rendreCourrielLume(c: CourrielLume): string {
  const support = c.supportEmail || 'support@lumecrm.net';
  /* 44 px de haut, et une LARGEUR déclarée.

     Outlook (moteur Word) ignore `height` seul sur une image et la rend à sa
     taille native — 1051 px de large, soit trois fois la largeur du courriel.
     Déclarer les deux dimensions est la seule façon qu'il les respecte.

     Le fichier fait 273 px de haut pour 44 affichés : six fois la densité, donc
     net sur un écran fin sans peser davantage. */
  const enTete = `<img src="${LOGO_LUME_URL}" alt="Lume" width="169" height="44" style="width:169px;height:44px;display:inline-block;border:0;outline:none;text-decoration:none;"/>`;
  const pied = `
<p style="margin:0;font-size:12px;line-height:1.5;color:${GRIS_DOUX};">${c.langue === 'fr' ? 'Une question ? Réponds à ce courriel ou écris-nous à' : 'Questions? Reply to this email or write to'} <a href="mailto:${echapper(support)}" style="color:${GRIS_DOUX};">${echapper(support)}</a>.</p>
<p style="margin:8px 0 0;font-size:11px;color:${GRIS_PALE};">Lume CRM &nbsp;&middot;&nbsp; <a href="https://lumecrm.net" style="color:${GRIS_PALE};text-decoration:none;">lumecrm.net</a></p>`;
  return coquille({ langue: c.langue, titreDocument: c.titre || 'Lume', preheader: c.preheader, enTeteHtml: enTete, corpsHtml: corpsCommun({ ...c, signature: c.signature === undefined ? (c.langue === 'fr' ? '— L’équipe Lume' : '— The Lume team') : c.signature }, COULEUR_LUME, true), piedHtml: pied, decor: 'lume' });
}

/** Les mots qui reviennent dans tous les courriels client, dans les deux langues. */
/* Les libellés de bouton nomment UN geste, pas deux (2026-09-23).

   « Voir et payer la facture » annonçait deux actions et faisait 24
   caractères — long sur un téléphone, et dilué : un bouton qui propose de
   regarder invite à regarder. « Voir la soumission » était pire encore, parce
   que le geste attendu est d'APPROUVER.

   Jobber écrit « Pay Invoice », pas « View Invoice ». C'est leur meilleur
   choix de verbe, et le seul qu'on leur prend ici. */
export const MOTS = {
  fr: { bonjour: (nom: string) => `Bonjour ${nom},`, facture: 'Facture', soumission: 'Soumission', contrat: 'Contrat', montantDu: 'Montant à payer', montantTotal: 'Montant', echeance: 'Échéance', valideJusquau: 'Valide jusqu’au', numero: 'Numéro', statut: 'Statut', payee: 'Payée', voirFacture: 'Payer la facture', voirSoumission: 'Approuver la soumission', payer: (m: string) => `Payer ${m}`, voirContrat: 'Signer le contrat', question: 'Une question ? Répondez simplement à ce courriel.', envoyeAvec: 'Envoyé avec' },
  en: { bonjour: (nom: string) => `Hi ${nom},`, facture: 'Invoice', soumission: 'Quote', contrat: 'Contract', montantDu: 'Amount due', montantTotal: 'Amount', echeance: 'Due date', valideJusquau: 'Valid until', numero: 'Number', statut: 'Status', payee: 'Paid', voirFacture: 'Pay invoice', voirSoumission: 'Approve quote', payer: (m: string) => `Pay ${m}`, voirContrat: 'Sign contract', question: 'Questions? Just reply to this email.', envoyeAvec: 'Sent with' },
} as const;

export function langueDe(valeur: unknown): Langue {
  return String(valeur || '').toLowerCase().startsWith('en') ? 'en' : 'fr';
}
