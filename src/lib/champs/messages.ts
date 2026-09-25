/**
 * Messages des champs personnalisés en anglais.
 *
 * Chaque message naît en français à UN endroit (contrainte en base, service
 * serveur, validation partagée src/lib/champs/valeurs.ts, filtres) ; la
 * traduction se pose à l'affichage, ici, pour ne pas dupliquer les règles ni
 * faire connaître la langue de l'interface à la base. Un message inconnu passe
 * tel quel. tests/champs-perso-messages.test.ts relève chaque message écrit
 * dans le code et exige qu'il ait sa traduction.
 */

const LIB = '«\\s*(.+?)\\s*»';
const APO = "['’]";
const q = (s: string) => `“${s}”`;
const re = (motif: string) => new RegExp(`^${motif.replace(/'/g, APO)}$`);

/** « Impossible de <action>. » */
const ACTIONS: Record<string, string> = {
  'charger les champs': 'load the fields',
  'chercher dans les champs personnalisés': 'search the custom fields',
  'créer le champ': 'create the field',
  'créer le dossier': 'create the folder',
  'enregistrer': 'save',
  'enregistrer les champs cherchables': 'save the searchable fields',
  'enregistrer l’affichage des cartes': 'save the card display',
  'filtrer': 'filter',
  'lire les champs personnalisés': 'read the custom fields',
  'lire les dossiers': 'read the folders',
  'lire les options': 'read the options',
  'lire les options choisies': 'read the selected options',
  'lire les valeurs': 'read the values',
  'lire l’affichage des cartes': 'read the card display',
  'mesurer l’impact': 'measure the impact',
  'modifier le champ': 'update the field',
  'modifier les champs cherchables': 'update the searchable fields',
  'modifier les options': 'update the options',
  'modifier l’affichage des cartes': 'update the card display',
  'modifier l’unicité': 'update uniqueness',
  'purger le champ': 'purge the field',
  'renommer le dossier': 'rename the folder',
  'supprimer le champ': 'delete the field',
  'supprimer le dossier': 'delete the folder',
};
const normApo = (s: string) => s.replace(/'/g, '’');

const REGLES: Array<[RegExp, (...g: string[]) => string]> = [
  // Valeurs (validation partagée + contraintes en base)
  [re(`${LIB} attend un nombre\\.`), (l) => `${q(l)} expects a number.`],
  [re(`${LIB} attend du texte\\.`), (l) => `${q(l)} expects text.`],
  [re(`${LIB} attend un montant\\.`), (l) => `${q(l)} expects an amount.`],
  [re(`${LIB} attend une date AAAA-MM-JJ\\.`), (l) => `${q(l)} expects a YYYY-MM-DD date.`],
  [re(`${LIB} attend une date et une heure\\.`), (l) => `${q(l)} expects a date and time.`],
  [re(`${LIB} attend une date\\.`), (l) => `${q(l)} expects a date.`],
  [re(`${LIB} attend une option de la liste\\.`), (l) => `${q(l)} expects an option from the list.`],
  [re(`${LIB} attend des options de la liste\\.`), (l) => `${q(l)} expects options from the list.`],
  [re(`${LIB} attend une adresse courriel valide\\.`), (l) => `${q(l)} expects a valid email address.`],
  [re(`${LIB} attend un numéro de téléphone valide\\.`), (l) => `${q(l)} expects a valid phone number.`],
  [re(`${LIB} tient sur une ligne\\.`), (l) => `${q(l)} must fit on one line.`],
  [re(`${LIB} : (\\d+) caractères au plus\\.`), (l, n) => `${q(l)}: ${n} characters maximum.`],
  [re(`${LIB} : le montant s'exprime en cents \\(entier\\)\\.`), (l) => `${q(l)}: the amount is expressed in cents (integer).`],
  [re(`${LIB} : montant hors bornes\\.`), (l) => `${q(l)}: amount out of range.`],
  [re(`${LIB} : cette option a été retirée de la liste\\.`), (l) => `${q(l)}: this option was removed from the list.`],
  [re(`${LIB} doit être au moins (.+)\\.`), (l, n) => `${q(l)} must be at least ${n}.`],
  [re(`${LIB} doit être au plus (.+)\\.`), (l, n) => `${q(l)} must be at most ${n}.`],
  [re(`${LIB} est obligatoire\\.`), (l) => `${q(l)} is required.`],
  [re(`${LIB} a été modifié entre-temps : recharge la fiche\\.`), (l) => `${q(l)} was changed in the meantime: reload the record.`],
  [re(`${LIB} est archivé\\.`), (l) => `${q(l)} is archived.`],
  [re('Champ introuvable pour cet objet\\.'), () => 'Field not found for this object.'],
  [re('Ce champ n\'est pas une liste à choix multiples\\.'), () => 'This field is not a multi-select list.'],
  [re('Ce champ n\'a pas de liste d\'options\\.'), () => 'This field has no option list.'],
  [re('Cette valeur existe déjà sur une autre fiche : le champ exige une valeur unique\\.'), () => 'This value already exists on another record: the field requires a unique value.'],
  // Définition des champs
  [re('Champ personnalisé introuvable\\.'), () => 'Custom field not found.'],
  [re('Champ introuvable\\.'), () => 'Field not found.'],
  [re('Champ introuvable ou permission manquante\\.'), () => 'Field not found or missing permission.'],
  [re('Objet inconnu\\.'), () => 'Unknown object.'],
  [re('Type de champ inconnu\\.'), () => 'Unknown field type.'],
  [re(`${LIB} est la clé d'un champ standard : choisis-en une autre\\.`), (k) => `${q(k)} is the key of a standard field: choose another one.`],
  [re('Cette clé est déjà utilisée ou réservée\\.'), () => 'This key is already used or reserved.'],
  [re(`La clé ${LIB} est déjà utilisée ou réservée\\.`), (k) => `The key ${q(k)} is already used or reserved.`],
  [re('La clé d\'un champ est immuable \\(les modèles et automatisations en dépendent\\)\\.'), () => 'A field’s key cannot change (templates and automations depend on it).'],
  [re('L\'objet d\'un champ est immuable\\.'), () => 'A field’s object cannot change.'],
  [re('Une liste a besoin d\'au moins une option\\.'), () => 'A dropdown needs at least one option.'],
  [re('Seule une liste porte des options\\.'), () => 'Only dropdowns have options.'],
  [re('Une option ne peut pas être vide\\.'), () => 'An option cannot be empty.'],
  [re(`L'option ${LIB} est en double\\.`), (o) => `The option ${q(o)} is duplicated.`],
  [re('Ce type de champ ne peut pas être cherchable\\.'), () => 'This field type cannot be searchable.'],
  [re(`${LIB} ne peut pas être cherchable\\.`), (l) => `${q(l)} cannot be searchable.`],
  [re(`${LIB} ne peut pas être unique\\.`), (l) => `${q(l)} cannot be unique.`],
  [re('Le minimum dépasse le maximum\\.'), () => 'The minimum exceeds the maximum.'],
  [re('Conversion (\\S+) → (\\S+) refusée : seules les conversions sans perte sont permises\\.'), (a, b) => `Conversion ${a} → ${b} refused: only lossless conversions are allowed.`],
  [re('Conversion de type refusée : (\\S+) → (\\S+)\\.'), (a, b) => `Type conversion refused: ${a} → ${b}.`],
  [re('Un des champs n\'est pas un champ d\'opportunité actif\\.'), () => 'One of the fields is not an active opportunity field.'],
  [re('Un dossier porte déjà ce nom\\.'), () => 'A folder already has this name.'],
  [re('Doublon refusé\\.'), () => 'Duplicate rejected.'],
  [re('Des doublons empêchent d\'activer l\'unicité\\.'), () => 'Duplicates prevent enabling uniqueness.'],
  [re('Ce champ porte encore des valeurs : archive-le, ou purge-le depuis son rapport d\'impact\\.'), () => 'This field still holds values: archive it, or purge it from its impact report.'],
  [re('Ce champ est utilisé par (\\d+) automatisation\\(s\\) : retire-le d\'abord\\.'), (n) => `This field is used by ${n} automation(s): remove it first.`],
  [re('Le nombre de valeurs a changé \\((\\d+) au lieu de (\\d+)\\) : relis le rapport\\.'), (a, b) => `The number of values changed (${a} instead of ${b}): review the report.`],
  [re('Certaines valeurs ne te sont pas visibles : purge impossible\\.'), () => 'Some values are not visible to you: purge not possible.'],
  [re('Référence introuvable \\(fiche, dossier ou option\\)\\.'), () => 'Reference not found (record, folder or option).'],
  // Filtres
  [re('Opérateur « (.+?) » invalide pour un champ (\\S+)\\.'), (o, t) => `Operator “${o}” is not valid for a ${t} field.`],
  [re('Valeur manquante pour « (.+?) »\\.'), (o) => `Missing value for “${o}”.`],
  [re('Date manquante pour « (.+?) »\\.'), (o) => `Missing date for “${o}”.`],
  [re('Aucune option choisie\\.'), () => 'No option selected.'],
  [re('Un champ du filtre n\'existe plus\\.'), () => 'A field in the filter no longer exists.'],
  [re('Champ inconnu dans le filtre\\.'), () => 'Unknown field in the filter.'],
  [re('Conditions invalides \\(25 au plus\\)\\.'), () => 'Invalid conditions (25 maximum).'],
  [re('Unité inconnue : (.+)'), (u) => `Unknown unit: ${u}`],
  [re('N hors bornes\\.'), () => 'N out of range.'],
  // Accès, requêtes
  [re('Permission refusée\\.'), () => 'Permission denied.'],
  [re('Non authentifié\\.'), () => 'Not authenticated.'],
  [re('Session expirée\\.'), () => 'Session expired.'],
  [re('Identifiant invalide\\.'), () => 'Invalid identifier.'],
  [re('(\\d+) fiches au plus\\.'), (n) => `${n} records maximum.`],
  [re('Action impossible\\.'), () => 'Action failed.'],
  [re('refusé'), () => 'rejected'],
  [re('champ personnalisé refusé'), () => 'custom field rejected'],
  [re(`Impossible d'enregistrer ${LIB}\\.`), (l) => `Unable to save ${q(l)}.`],
  [re('Impossible d(?:e |\')(.+)\\.'), (a) => {
    const action = ACTIONS[normApo(a)];
    return action ? `Unable to ${action}.` : 'Action failed.';
  }],
];

/** Traduit UN message (sans séparateur). */
function enAnglais(msg: string): string {
  const t = msg.trim();
  for (const [motif, rendu] of REGLES) {
    const m = motif.exec(t);
    if (m) return rendu(...m.slice(1));
  }
  return msg;
}

/**
 * Le message dans la langue de l'interface. Les refus groupés (« a · b »)
 * sont traduits morceau par morceau.
 */
export function messageChamps(msg: string, fr: boolean = interfaceEnFrancais()): string {
  if (fr || !msg) return msg;
  return msg.split(' · ').map(enAnglais).join(' · ');
}

/** Langue de l'interface, lue comme les PDF et utils (français par défaut). */
export function interfaceEnFrancais(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem('lume-language') !== 'en';
  } catch {
    return true;
  }
}
