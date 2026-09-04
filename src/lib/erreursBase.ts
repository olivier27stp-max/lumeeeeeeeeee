/**
 * Traduit un refus de la base en une phrase que l'utilisateur comprend.
 *
 * Depuis la migration 20260904170000, chaque champ texte porte une
 * contrainte `<table>_<colonne>_len`. Quand elle refuse une écriture,
 * Postgres répond :
 *
 *     new row for relation "clients" violates check constraint "clients_notes_len"
 *
 * Exact, mais illisible dans un toast. On en tire le nom du champ et on
 * dit simplement que le texte est trop long. Toute autre erreur repart
 * telle quelle : ce module ne masque rien, il ne traduit que ce qu'il
 * reconnaît.
 */

/** Libellés des colonnes les plus courantes, pour ne pas afficher `first_name`. */
const LIBELLES: Record<string, string> = {
  first_name: 'Le prénom',
  last_name: 'Le nom',
  company: "Le nom d'entreprise",
  company_name: "Le nom d'entreprise",
  email: 'Le courriel',
  phone: 'Le téléphone',
  address: "L'adresse",
  billing_address: "L'adresse de facturation",
  property_address: "L'adresse",
  city: 'La ville',
  province: 'La province',
  postal_code: 'Le code postal',
  country: 'Le pays',
  title: 'Le titre',
  subject: 'Le sujet',
  name: 'Le nom',
  notes: 'La note',
  internal_notes: 'La note interne',
  description: 'La description',
  content: 'La note',
};

/** Code SQLSTATE d'une violation de contrainte CHECK. */
const VIOLATION_CHECK = '23514';

/**
 * Renvoie l'erreur telle quelle, ou une `Error` lisible si c'est un refus
 * de longueur. À appeler juste avant de relancer une erreur Supabase.
 */
export function erreurLisible(error: unknown): unknown {
  const e = error as { code?: string; message?: string } | null;
  if (!e || e.code !== VIOLATION_CHECK) return error;

  const m = /constraint "(\w+)_len"/.exec(e.message ?? '');
  if (!m) return error;

  // Le nom de table peut contenir des « _ » (team_members) : on reconnaît
  // la colonne par son suffixe plutôt qu'en coupant au premier tiret bas.
  // Le plus long gagne : `billing_address` avant `address`.
  const colonne = Object.keys(LIBELLES)
    .filter((c) => m[1].endsWith('_' + c))
    .sort((a, b) => b.length - a.length)[0];
  const libelle = colonne ? LIBELLES[colonne] : 'Un des champs';
  return new Error(`${libelle} est trop long.`);
}
