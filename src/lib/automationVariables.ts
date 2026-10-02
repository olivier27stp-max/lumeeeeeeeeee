/* ═══════════════════════════════════════════════════════════════
   « INSÉRER UN CHAMP » — LE catalogue unique des variables d'un message.

   Avant ce fichier, sept listes disaient chacune autre chose (les 6 raccourcis
   du panneau d'étape, les 90 champs de formulaire, les 8 de l'éditeur de la
   liste, les 35 clés du détecteur, les 18 variables pointées, celles des
   modèles de courriel, et ce que le moteur remplit vraiment). Le propriétaire
   voyait ses champs personnalisés affichés comme « Champs de base », et les
   vrais champs de base cachés dans une ligne repliée.

   Ici, UNE entrée par variable — jeton, groupe, libellé fr / en, les fiches où
   elle a une valeur, un exemple, d'où vient la valeur — et cinq usages :
     · la palette (`variablesPour`) : seulement ce qui AURA une valeur pour le
       déclencheur ; « Champs de base » d'abord, « Champs personnalisés » à part ;
     · l'aperçu en direct (`rendreAvecExemples`) ;
     · le détecteur (`variablesInconnues`) : inconnue, hors contexte, mal écrite ;
     · le rendu avec valeur de remplacement (`appliquerRemplacement`) —
       « Bonjour [client_first_name|là] » ;
     · la consigne de Lumi (`variablesPourConsigne`).

   TROIS ÉCRITURES, un seul moteur de rendu (server/lib/actions `resolveTemplate`) :
   `[cle]`, `{cle}` / `{{cle}}`, et `{{objet.cle}}` pour un champ de fiche.
   La palette n'en écrit qu'UNE par variable (`ecriture`).

   « EN ATTENTE » : une variable que le moteur ne remplit pas ENCORE (solde dû,
   jours de retard, courriel de l'entreprise, technicien). Elle est au catalogue
   — libellé, exemple, source — mais ni offerte ni reconnue tant que `enAttente`
   est vrai : une variable offerte que le moteur laisse vide est pire qu'une
   variable absente. Un test (tests/automations-finale/p/variables-parite.test.ts)
   dit quand le moteur la remplit et qu'il faut retirer le drapeau.

   Imports : catalogue des automatisations et champs seulement — ce fichier est
   lu par le serveur (ligne COPY du Dockerfile).
   ═══════════════════════════════════════════════════════════════ */

import { ENTITE_PAR_DECLENCHEUR, trouverDeclencheur } from './automationCatalogue';
import { champsSysteme } from './champs/standard';
import { LIBELLES_OBJET, type ChampPerso, type ObjetChamp, type TypeChamp } from './champs/types';

// ── Le catalogue ────────────────────────────────────────────

export type GroupeVariable = 'client' | 'entreprise' | 'facture' | 'job' | 'devis' | 'pipeline' | 'avis' | 'contrat';

export const LIBELLES_GROUPE: Record<GroupeVariable, { fr: string; en: string }> = {
  client: { fr: 'Client', en: 'Client' },
  entreprise: { fr: 'Entreprise', en: 'Company' },
  facture: { fr: 'Facture', en: 'Invoice' },
  job: { fr: 'Job', en: 'Job' },
  devis: { fr: 'Devis', en: 'Quote' },
  pipeline: { fr: 'Pipeline', en: 'Pipeline' },
  avis: { fr: 'Avis', en: 'Reviews' },
  contrat: { fr: 'Contrat et dépôt', en: 'Agreement and deposit' },
};

/** Les fiches (entités du moteur) qui ont un client. */
const AVEC_CLIENT = ['client', 'quote', 'invoice', 'job', 'schedule_event', 'deal'] as const;
/** Toutes les fiches, y compris l'appel reçu de l'extérieur (aucun client). */
const TOUJOURS = '*' as const;

export interface VariableCatalogue {
  /** La clé que le moteur remplit : `client_first_name`, ou `job.visits` pour un champ de fiche. */
  jeton: string;
  groupe: GroupeVariable;
  fr: string;
  en: string;
  /** Les fiches où elle a une valeur (`*` = toujours). Entités du moteur : un prospect est un `client`. */
  entites: readonly string[] | typeof TOUJOURS;
  exemple: { fr: string; en: string };
  /** D'où vient la valeur — pour qui lit le catalogue, et pour le moteur quand elle est à créer. */
  source: string;
  /**
   * Où la palette la range : `base` (« Champs de base », visible d'emblée),
   * `plus` (groupe replié « Plus »), `masquee` (reconnue, jamais offerte : une
   * autre écriture de la même valeur, ou une variable technique).
   */
  rang: 'base' | 'plus' | 'masquee';
  /** Le moteur ne la remplit pas encore : ni offerte ni reconnue (voir l'en-tête). */
  enAttente?: boolean;
  /** Le libellé du raccourci de l'éditeur, quand il en a un (« Nom du client »). */
  raccourci?: { fr: string; en: string };
  /** N'a de valeur que pour ces déclencheurs (ex. le lien de réservation d'un client inactif). */
  declencheurs?: readonly string[];
}

const v = (
  jeton: string, groupe: GroupeVariable, rang: VariableCatalogue['rang'], fr: string, en: string,
  entites: VariableCatalogue['entites'], exemple: [string, string], source: string, plus: Partial<VariableCatalogue> = {},
): VariableCatalogue => ({ jeton, groupe, rang, fr, en, entites, exemple: { fr: exemple[0], en: exemple[1] }, source, ...plus });

const LIEN_EXEMPLE = 'https://lumecrm.net';

/**
 * Toutes les variables. L'ordre est celui de l'affichage.
 * Un exemple ne porte JAMAIS le nom d'un vrai client ni d'une vraie entreprise
 * (tests/courriels/exemples-sans-vrai-client.test.ts ; même règle ici).
 */
export const CATALOGUE_VARIABLES: readonly VariableCatalogue[] = [
  // ── Client ──
  v('client_first_name', 'client', 'base', 'Prénom du client', 'Client first name', AVEC_CLIENT, ['Marie', 'Marie'],
    'clients.first_name (repli : compagnie, puis nom complet)'),
  v('client_last_name', 'client', 'base', 'Nom de famille du client', 'Client last name', AVEC_CLIENT, ['Tremblay', 'Tremblay'], 'clients.last_name'),
  v('client_name', 'client', 'base', 'Nom complet du client', 'Client full name', AVEC_CLIENT, ['Marie Tremblay', 'Marie Tremblay'],
    'prénom + nom (repli : compagnie)', { raccourci: { fr: 'Nom du client', en: 'Client name' } }),
  v('client_email', 'client', 'plus', 'Courriel du client', 'Client email', AVEC_CLIENT, ['marie@example.com', 'marie@example.com'], 'clients.email'),
  v('client_phone', 'client', 'plus', 'Téléphone du client', 'Client phone', AVEC_CLIENT, ['514 555-0123', '514 555-0123'], 'clients.phone'),
  v('client.nom', 'client', 'masquee', 'Nom complet du client', 'Client full name', AVEC_CLIENT, ['Marie Tremblay', 'Marie Tremblay'], 'autre écriture de [client_name]'),
  v('client.lien_reservation', 'client', 'plus', 'Lien de réservation', 'Booking link', AVEC_CLIENT,
    [`${LIEN_EXEMPLE}/reserver/exemple`, `${LIEN_EXEMPLE}/reserver/exemple`], 'lien de 30 jours créé à l’envoi (drapeau auto_client_inactif)',
    { declencheurs: ['client.inactive'] }),

  // ── Entreprise ──
  v('company_name', 'entreprise', 'base', 'Nom de l’entreprise', 'Company name', TOUJOURS, ['Votre entreprise', 'Your company'],
    'company_settings.company_name (repli : nom du bureau)', { raccourci: { fr: 'Nom de votre entreprise', en: 'Your company name' } }),
  v('company_phone', 'entreprise', 'base', 'Téléphone de l’entreprise', 'Company phone', TOUJOURS, ['514 555-0100', '514 555-0100'], 'company_settings.phone'),
  v('company_email', 'entreprise', 'base', 'Courriel de l’entreprise', 'Company email', TOUJOURS, ['info@example.com', 'info@example.com'],
    'company_settings.email', { enAttente: true }),

  // ── Facture ──
  v('invoice_number', 'facture', 'base', 'Numéro de facture', 'Invoice number', ['invoice'], ['FAC-1042', 'INV-1042'], 'invoices.invoice_number'),
  v('invoice_total', 'facture', 'base', 'Montant de la facture', 'Invoice amount', ['invoice'], ['450,00 $', '$450.00'],
    'invoices.total_cents', { raccourci: { fr: 'Total', en: 'Total' } }),
  v('invoice_balance', 'facture', 'base', 'Solde dû', 'Balance due', ['invoice'], ['250,00 $', '$250.00'], 'invoices.balance_cents', { enAttente: true }),
  v('invoice_due_date', 'facture', 'base', 'Date d’échéance', 'Due date', ['invoice'], ['30 août 2026', 'August 30, 2026'], 'invoices.due_date'),
  v('invoice_days_overdue', 'facture', 'base', 'Jours de retard', 'Days overdue', ['invoice'], ['7', '7'],
    'aujourd’hui − échéance, fuseau de l’entreprise ; vide si la facture n’est pas en retard', { enAttente: true }),
  v('invoice_link', 'facture', 'base', 'Lien de paiement', 'Payment link', ['invoice'], [`${LIEN_EXEMPLE}/invoice/exemple`, `${LIEN_EXEMPLE}/invoice/example`],
    'page publique de la facture (bouton de paiement)', { raccourci: { fr: 'Lien facture', en: 'Invoice link' } }),
  ...(['numero', 'total', 'lien', 'lien_interne', 'nb_vues', 'consultee_le'] as const).map((c) => v(
    `facture.${c}`, 'facture', 'masquee', `Facture · ${c}`, `Invoice · ${c}`, ['invoice'], ['', ''], 'variable pointée du moteur (préréglages « facture consultée »)')),
  ...(['montant', 'raison', 'facture', 'lien'] as const).map((c) => v(
    `paiement.${c}`, 'facture', 'masquee', `Paiement · ${c}`, `Payment · ${c}`, ['invoice'], ['', ''], 'variable pointée du moteur (préréglages « paiement échoué »)')),

  // ── Job ──
  v('appointment_date', 'job', 'base', 'Date du rendez-vous', 'Appointment date', ['schedule_event'], ['14 août 2026', 'August 14, 2026'],
    'schedule_events.start_at, fuseau de l’entreprise', { raccourci: { fr: 'Date du rendez-vous', en: 'Appointment date' } }),
  v('appointment_time', 'job', 'base', 'Heure du rendez-vous', 'Appointment time', ['schedule_event'], ['9 h 00', '9:00 a.m.'], 'schedule_events.start_at, fuseau de l’entreprise'),
  v('appointment_address', 'job', 'base', 'Adresse du rendez-vous', 'Appointment address', ['schedule_event'], ['120 rue Principale', '120 Main Street'], 'jobs.property_address'),
  v('job.visits', 'job', 'base', 'Date de la prochaine visite', 'Next visit date', ['job'], ['14 août 2026', 'August 14, 2026'], 'prochaine visite du job (schedule_events)'),
  v('job.visit_start_time', 'job', 'base', 'Heure de la visite', 'Visit time', ['job'], ['9 h 00', '9:00 a.m.'], 'prochaine visite du job (schedule_events)'),
  v('job.property', 'job', 'base', 'Adresse des travaux', 'Job address', ['job'], ['120 rue Principale', '120 Main Street'], 'jobs.property_address'),
  v('technician_name', 'job', 'base', 'Technicien', 'Technician', ['schedule_event', 'job'], ['Alex', 'Alex'],
    'schedule_events.assigned_user, sinon jobs.assigned_user_id, sinon le nom de l’équipe', { enAttente: true }),
  v('job_name', 'job', 'plus', 'Titre du job', 'Job title', ['job', 'schedule_event', 'quote', 'invoice'], ['Lavage de vitres', 'Window cleaning'], 'jobs.title (le job lié à un devis ou à une facture)'),
  v('appointment_title', 'job', 'masquee', 'Titre du rendez-vous', 'Appointment title', ['schedule_event'], ['Lavage de vitres', 'Window cleaning'], 'autre écriture de [job_name]'),

  // ── Devis ──
  v('quote_number', 'devis', 'base', 'Numéro du devis', 'Quote number', ['quote'], ['SOU-218', 'QUO-218'], 'quotes.quote_number'),
  v('quote_total', 'devis', 'base', 'Montant du devis', 'Quote amount', ['quote'], ['1 250,00 $', '$1,250.00'], 'quotes.total_cents', { raccourci: { fr: 'Total', en: 'Total' } }),
  v('quote_link', 'devis', 'base', 'Lien du devis', 'Quote link', ['quote'], [`${LIEN_EXEMPLE}/quote/exemple`, `${LIEN_EXEMPLE}/quote/example`],
    'page publique du devis', { raccourci: { fr: 'Lien du devis', en: 'Quote link' } }),
  v('quote_valid_until', 'devis', 'plus', 'Devis valide jusqu’au', 'Quote valid until', ['quote'], ['2 mai 2026', 'May 2, 2026'], 'quotes.valid_until'),
  ...(['numero', 'total', 'lien', 'lien_interne', 'nb_vues', 'ouverte_le'] as const).map((c) => v(
    `soumission.${c}`, 'devis', 'masquee', `Devis · ${c}`, `Quote · ${c}`, ['quote'], ['', ''], 'variable pointée du moteur (préréglages « devis ouvert »)')),

  // ── Pipeline ──
  v('deal_stage', 'pipeline', 'plus', 'Étape du pipeline', 'Pipeline stage', ['deal'], ['Soumission envoyée', 'Quote sent'], 'pipeline_stages.name_fr'),
  v('deal_stage_en', 'pipeline', 'masquee', 'Étape du pipeline (anglais)', 'Pipeline stage (English)', ['deal'], ['Quote sent', 'Quote sent'], 'pipeline_stages.name_en'),
  v('deal_source', 'pipeline', 'plus', 'Source de l’opportunité', 'Deal source', ['deal'], ['Formulaire web', 'Web form'], 'deals.source'),
  v('deal_jours_dans_etape', 'pipeline', 'plus', 'Jours dans l’étape', 'Days in stage', ['deal'], ['5', '5'], 'aujourd’hui − deals.stage_entered_at'),

  // ── Avis ──
  v('google_review_url', 'avis', 'plus', 'Lien d’avis Google', 'Google review link', TOUJOURS, ['https://g.page/r/exemple/review', 'https://g.page/r/example/review'], 'company_settings.google_review_url'),
  v('facebook_review_url', 'avis', 'plus', 'Lien d’avis Facebook', 'Facebook review link', TOUJOURS, ['https://facebook.com/exemple/reviews', 'https://facebook.com/example/reviews'], 'company_settings.facebook_review_url'),
  v('review_page_url', 'avis', 'plus', 'Page d’avis', 'Review page', TOUJOURS, [`${LIEN_EXEMPLE}/survey/exemple`, `${LIEN_EXEMPLE}/survey/example`], 'la page d’avis du job, sinon la première destination d’avis'),
  v('review_link', 'avis', 'masquee', 'Lien du sondage', 'Survey link', AVEC_CLIENT, [`${LIEN_EXEMPLE}/survey/exemple`, `${LIEN_EXEMPLE}/survey/example`], 'posée par l’action « Demander un avis »'),
  v('survey_url', 'avis', 'masquee', 'Lien du sondage', 'Survey link', AVEC_CLIENT, [`${LIEN_EXEMPLE}/survey/exemple`, `${LIEN_EXEMPLE}/survey/example`], 'posée par l’action « Demander un avis »'),

  // ── Contrat et dépôt ──
  v('contract_link', 'contrat', 'plus', 'Lien du contrat à signer', 'Agreement link', ['job', 'schedule_event'], [`${LIEN_EXEMPLE}/contract/exemple`, `${LIEN_EXEMPLE}/contract/example`], 'contrat en attente du job'),
  v('contract_line', 'contrat', 'masquee', 'Phrase du contrat (texto)', 'Agreement sentence (text)', ['job', 'schedule_event'], ['', ''], 'phrase complète, vide s’il n’y a rien à signer'),
  v('contract_html', 'contrat', 'masquee', 'Paragraphe du contrat (courriel)', 'Agreement paragraph (email)', ['job', 'schedule_event'], ['', ''], 'paragraphe HTML bâti par Lume'),
  v('signed_contract_link', 'contrat', 'plus', 'Lien du contrat signé', 'Signed agreement link', ['job'], [`${LIEN_EXEMPLE}/contract/exemple`, `${LIEN_EXEMPLE}/contract/example`], 'contrat signé du job'),
  v('deposit_amount', 'contrat', 'plus', 'Montant du dépôt', 'Deposit amount', ['job'], ['150,00 $', '$150.00'], 'dépôt exigé par le job'),
  v('deposit_line', 'contrat', 'masquee', 'Phrase du dépôt', 'Deposit sentence', ['job'], ['', ''], 'phrase complète, vide sans dépôt'),
];

const PAR_JETON = new Map(CATALOGUE_VARIABLES.map((x) => [x.jeton, x]));

/** L'entrée du catalogue pour une clé (`client_first_name`, `job.visits`). */
export function variableDuCatalogue(jeton: string): VariableCatalogue | undefined {
  return PAR_JETON.get(jeton);
}

/** Comment on ÉCRIT une variable dans un message : `[cle]`, ou `{{objet.cle}}` pour un champ de fiche. */
export function ecriture(jeton: string, remplacement?: string | null): string {
  const suite = remplacement != null && remplacement !== '' ? `|${remplacement}` : '';
  return jeton.includes('.') ? `{{${jeton}${suite}}}` : `[${jeton}${suite}]`;
}

// ── Le contexte : quelle fiche le déclencheur fait arriver ──

/** L'entité du moteur pour un déclencheur (`lead` = `client`). `null` = inconnue ou variable (`*`) : on n'exclut rien. */
export function entiteDuDeclencheur(declencheur: string | null | undefined, entiteConnue?: string | null): string | null {
  const brute = entiteConnue || (declencheur ? ENTITE_PAR_DECLENCHEUR[declencheur] : undefined);
  if (!brute || brute === '*') return null;
  return brute === 'lead' ? 'client' : brute === 'appointment' ? 'schedule_event' : brute;
}

/**
 * Le rendez-vous porte-t-il les champs de fiche de son client et de son job ?
 * FAUX tant que le moteur ne les remplit pas (constat E-37 : sur « Rendez-vous
 * planifié », `{{client.first_name}}` part vide). À passer à VRAI avec le
 * correctif du moteur — voir notes/P-branchements.md.
 */
export const CHAMPS_DE_FICHE_SUR_RENDEZ_VOUS = false;

/**
 * Les fiches dont le moteur REMPLIT les champs (`{{objet.cle}}`), par entité —
 * relevé dans `resolveEntityVariables` : la fiche de l'événement, son client,
 * le job lié, l'opportunité liée. Sert au détecteur (ce qui est écrit aura-t-il
 * une valeur ?).
 */
export function objetsDeChamps(entite: string | null): ObjetChamp[] {
  switch (entite) {
    case null: return ['client', 'deal', 'job', 'quote', 'invoice'];
    case 'client': return ['client', 'deal'];
    case 'quote': return ['client', 'quote', 'job', 'deal'];
    case 'invoice': return ['client', 'invoice', 'job'];
    case 'job': return ['client', 'job', 'deal'];
    case 'deal': return ['client', 'deal'];
    case 'schedule_event': return CHAMPS_DE_FICHE_SUR_RENDEZ_VOUS ? ['client', 'job'] : [];
    default: return [];
  }
}

/**
 * Les fiches dont la PALETTE offre les champs — plus étroit que ce que le
 * moteur remplit : l'opportunité « liée » à un prospect ou à un devis n'existe
 * pas toujours, et l'offrir ferait écrire une variable souvent vide. Une
 * variable écrite à la main sur une fiche liée reste reconnue (`objetsDeChamps`).
 */
export function objetsOfferts(entite: string | null): ObjetChamp[] {
  switch (entite) {
    case 'client': return ['client'];
    case 'quote': return ['client', 'quote', 'job'];
    case 'invoice': return ['client', 'invoice', 'job'];
    case 'job': return ['client', 'job'];
    default: return objetsDeChamps(entite);
  }
}

const aUneValeur = (x: VariableCatalogue, entite: string | null, declencheur: string | null | undefined): boolean => {
  if (x.enAttente) return false;
  if (x.declencheurs && declencheur && !x.declencheurs.includes(declencheur)) return false;
  if (entite === null || x.entites === TOUJOURS) return true;
  return x.entites.includes(entite);
};

// ── Les champs de fiche ─────────────────────────────────────

/** Ce qu'on lit d'un champ personnalisé du bureau. */
export type ChampPourVariables = Pick<ChampPerso, 'object_type' | 'key' | 'label' | 'field_type'> & {
  config?: ChampPerso['config'] & { dans_messages?: boolean };
  archived_at?: string | null;
};

/** Clés de champs personnalisés SENSIBLES : jamais proposées sans un oui explicite de l'entreprise. */
export const CLES_SENSIBLES: readonly string[] = ['code_acces', 'instructions_acces', 'code_alarme'];
/** Types qu'un message ne sait pas porter utilement : une case rend « Oui / Non », un fichier un chemin. */
const TYPES_JAMAIS_PROPOSES: readonly TypeChamp[] = ['checkbox', 'file'];

/**
 * Ce champ personnalisé est-il PROPOSÉ dans la palette ?
 *   · jamais : une case à cocher, un fichier ;
 *   · sur demande seulement (`config.dans_messages = true`, « Proposer dans les
 *     messages ») : les codes et instructions d'accès, et tout paragraphe ;
 *   · sinon oui — sauf si l'entreprise l'a retiré (`dans_messages = false`).
 * Une variable déjà écrite dans une règle reste REMPLIE : on retire de la
 * palette, pas du moteur.
 */
export function champPropose(c: ChampPourVariables): boolean {
  if (c.archived_at) return false;
  if (TYPES_JAMAIS_PROPOSES.includes(c.field_type)) return false;
  const choix = c.config?.dans_messages;
  if (CLES_SENSIBLES.includes(c.key) || c.field_type === 'multi_line') return choix === true;
  return choix !== false;
}

/** Champs de FORMULAIRE jamais proposés : internes, techniques, ou déjà offerts sous un libellé plus clair. */
const CHAMPS_SYSTEME_EXCLUS: Record<ObjetChamp, readonly string[]> = {
  client: ['first_name', 'last_name', 'email', 'phone', 'phone_label', 'email_label', 'lead_source'],
  deal: ['client', 'first_name', 'last_name', 'email', 'phone', 'source'],
  job: ['title', 'client', 'visits', 'visit_start_time', 'property'],
  quote: ['client', 'quote_number', 'total'],
  invoice: ['client', 'total', 'due_date'],
  property: [],
};
const TYPES_SYSTEME_EXCLUS: readonly TypeChamp[] = ['checkbox', 'file', 'multi_line', 'dropdown_multi'];

// ── La palette ──────────────────────────────────────────────

export interface VariableOfferte {
  /** La clé interne (`client_first_name`, `job.visits`, `client.refere_par`). */
  cle: string;
  /** Ce qu'on insère dans le texte. */
  ecrit: string;
  /** Le groupe affiché : « Client », « Facture »… */
  groupe: { fr: string; en: string };
  fr: string;
  en: string;
  exemple: { fr: string; en: string };
}

export interface PaletteVariables {
  /** « Champs de base », visibles d'emblée. */
  base: VariableOfferte[];
  /** Groupe replié « Plus » : le reste de ce que Lume fournit. */
  plus: VariableOfferte[];
  /** « Champs personnalisés » de l'entreprise — section à part. */
  personnalises: VariableOfferte[];
}

const offerte = (x: VariableCatalogue): VariableOfferte => ({
  cle: x.jeton, ecrit: ecriture(x.jeton), groupe: LIBELLES_GROUPE[x.groupe], fr: x.fr, en: x.en, exemple: x.exemple,
});

/**
 * Ce que la palette offre pour ce déclencheur : seulement ce qui aura une
 * valeur. `champsDuBureau` : les champs personnalisés de l'entreprise.
 * `entite` : la fiche réelle quand les réglages de la règle la fixent (« Date
 * atteinte » sur un champ du pipeline fait arriver une opportunité).
 */
export function variablesPour(
  declencheur: string | null | undefined, champsDuBureau: readonly ChampPourVariables[] = [], options: { entite?: string | null } = {},
): PaletteVariables {
  const entite = entiteDuDeclencheur(declencheur, options.entite);
  const duCatalogue = CATALOGUE_VARIABLES.filter((x) => x.rang !== 'masquee' && aUneValeur(x, entite, declencheur));
  const objets = objetsOfferts(entite);
  const systeme = objets.flatMap((objet) => champsSysteme(objet)
    .filter((c) => !TYPES_SYSTEME_EXCLUS.includes(c.field_type) && !CHAMPS_SYSTEME_EXCLUS[objet].includes(c.key))
    .map((c): VariableOfferte => ({
      cle: `${objet}.${c.key}`, ecrit: ecriture(`${objet}.${c.key}`), groupe: LIBELLES_OBJET[objet], fr: c.label.fr, en: c.label.en,
      exemple: { fr: `(${c.label.fr})`, en: `(${c.label.en})` },
    })))
    // Un champ de fiche déjà au catalogue sous un libellé clair (`job.visits`) n'est pas offert deux fois.
    .filter((x) => !PAR_JETON.has(x.cle));
  const personnalises = champsDuBureau
    .filter((c) => c.object_type !== 'property' && objets.includes(c.object_type) && champPropose(c))
    .map((c): VariableOfferte => ({
      cle: `${c.object_type}.${c.key}`, ecrit: ecriture(`${c.object_type}.${c.key}`), groupe: LIBELLES_OBJET[c.object_type], fr: c.label, en: c.label,
      exemple: { fr: `(${c.label})`, en: `(${c.label})` },
    }));
  return {
    base: duCatalogue.filter((x) => x.rang === 'base').map(offerte),
    plus: [...duCatalogue.filter((x) => x.rang === 'plus').map(offerte), ...systeme],
    personnalises,
  };
}

/** Les raccourcis de l'éditeur (« Nom du client », « Total »…) qui ont une valeur pour ce déclencheur. */
export function raccourcisPour(declencheur: string | null | undefined, options: { entite?: string | null } = {}): Array<{ cle: string; ecrit: string; fr: string; en: string }> {
  const entite = entiteDuDeclencheur(declencheur, options.entite);
  // Fiche inconnue (« Champ modifié ») : un seul « Total » ne peut pas viser deux variables — on n'offre que le premier.
  const vus = new Set<string>();
  return CATALOGUE_VARIABLES
    .filter((x) => x.raccourci && aUneValeur(x, entite, declencheur))
    .filter((x) => (vus.has(x.raccourci!.fr) ? false : (vus.add(x.raccourci!.fr), true)))
    .map((x) => ({ cle: x.jeton, ecrit: ecriture(x.jeton), fr: x.raccourci!.fr, en: x.raccourci!.en }));
}

/** Recherche sans accents ni casse, sur le libellé, le groupe et ce qu'on écrit. */
export function normaliserRecherche(texte: string): string {
  return texte.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[’']/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function filtrerVariables(liste: readonly VariableOfferte[], recherche: string, fr = true): VariableOfferte[] {
  const mots = normaliserRecherche(recherche).split(' ').filter(Boolean);
  if (mots.length === 0) return [...liste];
  return liste.filter((x) => {
    const foin = normaliserRecherche(`${fr ? x.groupe.fr : x.groupe.en} ${fr ? x.fr : x.en} ${x.ecrit} ${x.cle.replace(/[._]/g, ' ')}`);
    return mots.every((m) => foin.includes(m));
  });
}

// ── La syntaxe : analyse ────────────────────────────────────

/** Longueur maximale d'une valeur de remplacement. */
export const REMPLACEMENT_MAX = 60;

/**
 * Une variable telle que le MOTEUR la reconnaît — les quatre formes de
 * `resolveTemplate` (server/lib/actions), chacune avec une valeur de
 * remplacement facultative : `|texte` (60 caractères au plus, sans crochet ni
 * accolade). Une clé commence par une lettre sans accent.
 *   1-2 : {{objet.cle}}   3 : {{cle}}   4 : {cle}   5 : [cle]   (+ le remplacement de chacune)
 */
const R = `(?:\\s*\\|([^\\[\\]{}]{0,${REMPLACEMENT_MAX}}))?`;
const SOURCE_VARIABLE = `\\{\\{\\s*([a-z]+)\\.([a-z][a-z0-9_]*)${R}\\s*\\}\\}|\\{\\{\\s*([A-Za-z]\\w*)${R}\\s*\\}\\}|\\{([A-Za-z]\\w*)${R}\\}|\\[([A-Za-z]\\w*)${R}\\]`;
const reVariable = () => new RegExp(SOURCE_VARIABLE, 'g');

export interface JetonEcrit {
  /** Tel qu'écrit dans le texte : `[client_first_name|là]`. */
  brut: string;
  /** La clé que le moteur cherche : `client_first_name`, `client.first_name`. */
  cle: string;
  /** Champ de fiche (`{{objet.cle}}`). */
  pointee: boolean;
  /** La valeur de remplacement, rognée ; `null` s'il n'y en a pas. */
  remplacement: string | null;
  debut: number;
  fin: number;
}

/** Les variables d'un texte, dans l'ordre, telles que le moteur les lira. */
export function analyserJetons(texte: string): JetonEcrit[] {
  const jetons: JetonEcrit[] = [];
  for (const m of texte.matchAll(reVariable())) {
    const pointee = m[1] !== undefined;
    const cle = pointee ? `${m[1]}.${m[2]}` : (m[4] ?? m[6] ?? m[8]);
    const brutRemplacement = pointee ? m[3] : (m[5] ?? m[7] ?? m[9]);
    jetons.push({
      brut: m[0], cle, pointee, remplacement: brutRemplacement === undefined ? null : brutRemplacement.trim(),
      debut: m.index ?? 0, fin: (m.index ?? 0) + m[0].length,
    });
  }
  return jetons;
}

const echapperHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Remplace chaque variable par sa valeur — ou, quand la valeur est VIDE, par
 * sa valeur de remplacement : « Bonjour [client_first_name|là], » → « Bonjour
 * là, ». Fonction PURE, même comportement que `resolveTemplate` du moteur pour
 * un texte sans `|` (un test compare les deux) :
 *   · une seule passe : une valeur insérée n'est jamais relue ;
 *   · seules les clés PROPRES de `valeurs` (jamais `[constructor]`) ;
 *   · `{{objet.cle}}` : la variable pointée du moteur d'abord, sinon le champ
 *     de fiche `objet_cf_cle` ;
 *   · `html: true` : valeur ET remplacement sont échappés (sauf les clés de
 *     `htmlDeConfiance`, que Lume bâtit lui-même).
 */
export function appliquerRemplacement(
  gabarit: string,
  valeurs: Record<string, string | number | null | undefined>,
  options: { html?: boolean; htmlDeConfiance?: ReadonlySet<string> } = {},
): string {
  const lire = (cle: string): string | undefined => {
    if (!Object.prototype.hasOwnProperty.call(valeurs, cle)) return undefined;
    const x: unknown = valeurs[cle];
    return typeof x === 'string' ? x : typeof x === 'number' ? String(x) : undefined;
  };
  return gabarit.replace(reVariable(), (_tout, objet?: string, cleChamp?: string, r1?: string, double?: string, r2?: string, simple?: string, r3?: string, crochet?: string, r4?: string) => {
    const cle = objet ? `${objet}.${cleChamp}` : ((double ?? simple ?? crochet) as string);
    const valeur = objet ? (lire(cle) ?? lire(`${objet}_cf_${cleChamp}`)) : lire(cle);
    const remplacement = (objet ? r1 : (r2 ?? r3 ?? r4))?.trim() ?? '';
    if (valeur) return options.html && !options.htmlDeConfiance?.has(cle) ? echapperHtml(valeur) : valeur;
    return options.html ? echapperHtml(remplacement) : remplacement;
  });
}

// ── Le détecteur ────────────────────────────────────────────

export type RaisonVariable = 'inconnue' | 'hors_contexte' | 'mal_ecrite' | 'remplacement_trop_long';

export interface ProblemeVariable {
  /** Ce qui est écrit dans le texte : `[prenom_du_client]`, `{prénom}`. */
  ecrit: string;
  raison: RaisonVariable;
  fr: string;
  en: string;
}

/** Quelque chose entre crochets ou accolades qui RESSEMBLE à une variable, accents et remplacement compris. */
const RE_CANDIDAT = /\{\{\s*([^{}[\]|\s][^{}[\]|]*?)\s*(?:\|([^{}[\]]*))?\}\}|[[{]\s*([^{}[\]|\s][^{}[\]|]*?)\s*(?:\|([^{}[\]]*))?[\]}]/gu;
/** Un mot (lettres de toute langue, chiffres, `_`, `.`) — pas « 50 % », pas « ci-dessous », pas « A-1234 ». */
const RE_MOT = /^[\p{L}_][\p{L}\p{N}_.]*$/u;
const RE_CLE_MOTEUR = /^[A-Za-z]\w*$/;
const RE_POINTEE_MOTEUR = /^[a-z]+\.[a-z][a-z0-9_]*$/;

/**
 * Les variables d'un texte que le client ne lira pas comme prévu :
 *   · `inconnue` — le moteur la remplacera par du VIDE (« Bonjour , ») ;
 *   · `hors_contexte` — elle existe, mais n'a jamais de valeur pour CE
 *     déclencheur (`[invoice_link]` sur « Nouveau prospect ») ;
 *   · `mal_ecrite` — un accent, une majuscule de trop : le moteur ne la
 *     reconnaît pas, le client lira les crochets (`{prénom}`) ;
 *   · `remplacement_trop_long` — au-delà de 60 caractères, la variable part
 *     telle quelle.
 * Un texte entre crochets qui n'est pas un mot (« Rabais [50 %] », « voir
 * [ci-dessous] ») n'est jamais signalé : le moteur n'y touche pas.
 *
 * `champsDuBureau` absent (`undefined`) : on ne peut pas trancher sur un champ
 * personnalisé, on ne crie pas au loup. Présent : une clé qui n'existe pas (ou
 * plus : champ archivé) est signalée.
 */
export function variablesInconnues(
  texte: string, declencheur: string | null | undefined, champsDuBureau?: readonly ChampPourVariables[], options: { entite?: string | null } = {},
): ProblemeVariable[] {
  const entite = entiteDuDeclencheur(declencheur, options.entite);
  const decl = declencheur ? trouverDeclencheur(declencheur) : undefined;
  const sur = decl ? { fr: ` sur « ${decl.fr} »`, en: ` on “${decl.en}”` } : { fr: ' pour ce déclencheur', en: ' for this trigger' };
  const objets = objetsDeChamps(entite);
  const problemes = new Map<string, ProblemeVariable>();
  const dire = (ecrit: string, raison: RaisonVariable, fr: string, en: string) => {
    if (!problemes.has(ecrit)) problemes.set(ecrit, { ecrit, raison, fr, en });
  };

  for (const m of texte.matchAll(RE_CANDIDAT)) {
    const brut = m[0];
    const nom = (m[1] ?? m[3] ?? '').trim();
    const remplacement = m[1] !== undefined ? m[2] : m[4];
    if (!RE_MOT.test(nom)) continue; // pas une variable : le moteur n'y touche pas
    const double = brut.startsWith('{{');
    const pointee = nom.includes('.');
    // « [cle} » : le moteur exige la paire.
    const apparie = brut.startsWith('[') ? brut.endsWith(']') : brut.endsWith('}');

    // Ce que le moteur ne reconnaît pas du tout : il laisse les crochets chez le client.
    const reconnue = apparie && (pointee ? double && RE_POINTEE_MOTEUR.test(nom) : RE_CLE_MOTEUR.test(nom));
    if (!reconnue) {
      dire(brut, 'mal_ecrite',
        `${brut} n’est pas une variable (pas d’accent, pas d’espace${pointee ? ', et un champ s’écrit {{objet.cle}}' : ''}) : le client lira ce texte tel quel.`,
        `${brut} is not a variable (no accents, no spaces${pointee ? ', and a field is written {{object.key}}' : ''}): the client will read this text as is.`);
      continue;
    }
    if (remplacement !== undefined && remplacement.length > REMPLACEMENT_MAX) {
      dire(brut, 'remplacement_trop_long',
        `La valeur de remplacement de ${ecriture(nom)} dépasse ${REMPLACEMENT_MAX} caractères : la variable partirait telle quelle.`,
        `The fallback text of ${ecriture(nom)} is longer than ${REMPLACEMENT_MAX} characters: the variable would be sent as is.`);
      continue;
    }
    const ecrit = pointee ? `{{${nom}}}` : brut.startsWith('[') ? `[${nom}]` : double ? `{{${nom}}}` : `{${nom}}`;
    const inconnue = () => dire(ecrit, 'inconnue', `${ecrit} n’existe pas : elle serait vide dans le message envoyé.`, `${ecrit} does not exist: it would be empty in the message sent.`);
    const horsContexte = () => dire(ecrit, 'hors_contexte',
      `${ecrit} n’a pas de valeur${sur.fr} : elle serait vide dans le message envoyé.`,
      `${ecrit} has no value${sur.en}: it would be empty in the message sent.`);

    // 1. Une variable du catalogue (`[client_first_name]`, `{{soumission.total}}`).
    const connue = PAR_JETON.get(nom);
    if (connue && !connue.enAttente) {
      if (!aUneValeur(connue, entite, declencheur)) horsContexte();
      continue;
    }
    // 2. Un champ de fiche : `{{objet.cle}}`, ou son nom interne `objet_cf_cle`.
    const champ = pointee ? /^([a-z]+)\.(.+)$/.exec(nom) : /^(client|deal|job|quote|invoice)_cf_([a-z0-9_]+)$/.exec(nom);
    if (champ && ['client', 'deal', 'job', 'quote', 'invoice'].includes(champ[1])) {
      const objet = champ[1] as ObjetChamp;
      const cle = champ[2];
      const systeme = champsSysteme(objet).some((c) => c.key === cle);
      const existe = systeme || (champsDuBureau === undefined
        ? true
        : champsDuBureau.some((c) => c.object_type === objet && c.key === cle && !c.archived_at));
      if (!existe) inconnue();
      else if (!objets.includes(objet)) horsContexte();
      continue;
    }
    inconnue();
  }
  return [...problemes.values()];
}

// ── L'aperçu ────────────────────────────────────────────────

/** L'exemple d'une variable, dans la langue de celui qui lit. Vide si la variable n'est pas au catalogue. */
export function exempleDe(jeton: string, fr = true): string {
  const x = PAR_JETON.get(jeton);
  return x ? (fr ? x.exemple.fr : x.exemple.en) : '';
}

/**
 * « Le client lira : … » avec des valeurs d'EXEMPLE : chaque variable qui a
 * une valeur pour ce déclencheur est remplacée par son exemple, les autres
 * par du vide — comme à l'envoi. Les champs personnalisés donnent leur
 * libellé entre parenthèses.
 */
export function rendreAvecExemples(
  texte: string, declencheur: string | null | undefined, champsDuBureau: readonly ChampPourVariables[] = [], fr = true, options: { entite?: string | null } = {},
): string {
  const entite = entiteDuDeclencheur(declencheur, options.entite);
  const valeurs: Record<string, string> = {};
  for (const x of CATALOGUE_VARIABLES) {
    if (aUneValeur(x, entite, declencheur)) valeurs[x.jeton] = fr ? x.exemple.fr : x.exemple.en;
  }
  const objets = objetsDeChamps(entite);
  for (const objet of objets) {
    for (const c of champsSysteme(objet)) valeurs[`${objet}_cf_${c.key}`] ??= `(${fr ? c.label.fr : c.label.en})`;
  }
  for (const c of champsDuBureau) {
    if (!c.archived_at && c.object_type !== 'property' && objets.includes(c.object_type)) valeurs[`${c.object_type}_cf_${c.key}`] = `(${c.label})`;
  }
  return appliquerRemplacement(texte, valeurs);
}

// ── Lumi ────────────────────────────────────────────────────

/**
 * La liste donnée à Lumi : chaque variable que le moteur remplit, avec son
 * libellé et les fiches où elle a une valeur. Stable (aucune valeur variable) :
 * elle peut vivre dans le préfixe mis en cache du prompt.
 */
export function variablesPourConsigne(fr = true): string[] {
  const noms: Record<string, [string, string]> = {
    client: ['client ou prospect', 'client or lead'], quote: ['devis', 'quote'], invoice: ['facture', 'invoice'], job: ['job', 'job'],
    schedule_event: ['rendez-vous', 'appointment'], deal: ['opportunité', 'deal'],
  };
  return CATALOGUE_VARIABLES.filter((x) => !x.enAttente && x.rang !== 'masquee').map((x) => {
    const ou = x.entites === TOUJOURS
      ? (fr ? 'toujours' : 'always')
      : x.entites.length === AVEC_CLIENT.length
        ? (fr ? 'dès qu’il y a un client' : 'whenever there is a client')
        : x.entites.map((e) => noms[e]?.[fr ? 0 : 1] ?? e).join(', ');
    return `${ecriture(x.jeton)} — ${fr ? x.fr : x.en} (${ou})`;
  });
}

/** Les clés que le moteur doit savoir remplir aujourd'hui (hors « en attente »). */
export function clesDuCatalogue(): string[] {
  return CATALOGUE_VARIABLES.filter((x) => !x.enAttente).map((x) => x.jeton);
}

/** Les variables en attente du moteur (à créer). */
export function variablesEnAttente(): VariableCatalogue[] {
  return CATALOGUE_VARIABLES.filter((x) => x.enAttente);
}
