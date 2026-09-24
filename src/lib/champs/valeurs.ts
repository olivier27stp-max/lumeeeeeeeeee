/**
 * Valeurs des champs personnalisés : validation (avant écriture) et
 * formatage (affichage, variables de modèles). Partagé client/serveur.
 *
 * La base re-valide tout (trigger cf_valeur_avant_ecriture) ; ce module
 * existe pour répondre à l'utilisateur AVANT l'aller-retour, avec un message
 * clair, et pour produire les colonnes typées que la table attend.
 */
import type { ChampPerso, TypeChamp, ValeurChamp } from './types';
import { normaliserTelephone } from './filtres';

export class ErreurValeur extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurValeur';
  }
}

/** Colonnes typées de custom_field_values (hors options multiples). */
export interface ColonnesValeur {
  value_text: string | null;
  value_number: number | null;
  value_money_cents: number | null;
  value_currency: string | null;
  value_date: string | null;
  value_timestamp: string | null;
  value_option_id: string | null;
}

export interface ValeurPreparee {
  /** null = la valeur est vide → on supprime la ligne. */
  colonnes: ColonnesValeur | null;
  /** Liste multiple : ids d'options à poser. */
  options: string[];
}

const COLONNES_VIDES: ColonnesValeur = {
  value_text: null, value_number: null, value_money_cents: null, value_currency: null,
  value_date: null, value_timestamp: null, value_option_id: null,
};

const RE_COURRIEL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function nombre(brut: unknown, libelle: string): number {
  const n = typeof brut === 'number' ? brut : Number(String(brut).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new ErreurValeur(`« ${libelle} » attend un nombre.`);
  return n;
}

/**
 * Valide `brut` pour le champ et renvoie les colonnes à écrire.
 * Montant : `brut` est en CENTS (entier), comme partout dans Lume.
 */
export function preparerValeur(champ: Pick<ChampPerso, 'label' | 'field_type' | 'config' | 'options'>, brut: unknown): ValeurPreparee {
  const vide = brut === null || brut === undefined || (typeof brut === 'string' && brut.trim() === '')
    || (Array.isArray(brut) && brut.length === 0);
  if (vide) return { colonnes: null, options: [] };
  const c: ColonnesValeur = { ...COLONNES_VIDES };
  const libelle = champ.label;
  const actives = new Set(champ.options.filter((o) => !o.archived_at).map((o) => o.id));
  const toutes = new Set(champ.options.map((o) => o.id));

  switch (champ.field_type) {
    case 'single_line': {
      const t = String(brut).trim();
      if (/\n/.test(t)) throw new ErreurValeur(`« ${libelle} » tient sur une ligne.`);
      if (t.length > 500) throw new ErreurValeur(`« ${libelle} » : 500 caractères au plus.`);
      c.value_text = t;
      break;
    }
    case 'multi_line': {
      const t = String(brut).trim();
      if (t.length > 5000) throw new ErreurValeur(`« ${libelle} » : 5000 caractères au plus.`);
      c.value_text = t;
      break;
    }
    case 'email': {
      const t = String(brut).trim();
      if (!RE_COURRIEL.test(t)) throw new ErreurValeur(`« ${libelle} » attend une adresse courriel valide.`);
      c.value_text = t;
      break;
    }
    case 'phone': {
      const e164 = normaliserTelephone(String(brut));
      if (!e164) throw new ErreurValeur(`« ${libelle} » attend un numéro de téléphone valide.`);
      c.value_text = e164;
      break;
    }
    case 'number': {
      let n = nombre(brut, libelle);
      const dec = champ.config.decimals;
      if (dec != null) n = Math.round(n * 10 ** dec) / 10 ** dec;
      if (champ.config.min != null && n < champ.config.min) throw new ErreurValeur(`« ${libelle} » doit être au moins ${champ.config.min}.`);
      if (champ.config.max != null && n > champ.config.max) throw new ErreurValeur(`« ${libelle} » doit être au plus ${champ.config.max}.`);
      c.value_number = n;
      break;
    }
    case 'monetary': {
      const n = nombre(brut, libelle);
      if (!Number.isInteger(n)) throw new ErreurValeur(`« ${libelle} » : le montant s’exprime en cents (entier).`);
      if (Math.abs(n) > 1e13) throw new ErreurValeur(`« ${libelle} » : montant hors bornes.`);
      c.value_money_cents = n;
      c.value_currency = (champ.config.currency || 'CAD').toUpperCase();
      break;
    }
    case 'date': {
      const t = String(brut).trim();
      if (champ.config.include_time) {
        const d = new Date(t);
        if (Number.isNaN(d.getTime())) throw new ErreurValeur(`« ${libelle} » attend une date et une heure.`);
        c.value_timestamp = d.toISOString();
      } else {
        if (!RE_DATE.test(t) || Number.isNaN(Date.parse(t))) throw new ErreurValeur(`« ${libelle} » attend une date AAAA-MM-JJ.`);
        c.value_date = t;
      }
      break;
    }
    case 'dropdown_single': {
      const id = String(Array.isArray(brut) ? brut[0] : brut);
      // Une option archivée reste lisible sur les fiches, mais ne se CHOISIT plus.
      if (!actives.has(id)) {
        throw new ErreurValeur(toutes.has(id)
          ? `« ${libelle} » : cette option a été retirée de la liste.`
          : `« ${libelle} » attend une option de la liste.`);
      }
      c.value_option_id = id;
      break;
    }
    case 'dropdown_multi': {
      const ids = [...new Set((Array.isArray(brut) ? brut : [brut]).map(String))];
      for (const id of ids) {
        if (!actives.has(id)) throw new ErreurValeur(`« ${libelle} » attend des options de la liste.`);
      }
      return { colonnes: { ...COLONNES_VIDES }, options: ids };
    }
  }
  return { colonnes: c, options: [] };
}

/** Ligne de custom_field_values (+ ses options multiples) → ValeurChamp. */
export function lireValeur(
  type: TypeChamp,
  ligne: Partial<ColonnesValeur>,
  optionsMultiples: string[] = [],
): ValeurChamp {
  switch (type) {
    case 'number': return ligne.value_number == null ? null : Number(ligne.value_number);
    case 'monetary': return ligne.value_money_cents == null ? null : Number(ligne.value_money_cents);
    case 'date': return ligne.value_timestamp ?? ligne.value_date ?? null;
    case 'dropdown_single': return ligne.value_option_id ?? null;
    case 'dropdown_multi': return optionsMultiples.length ? optionsMultiples : null;
    default: return ligne.value_text ?? null;
  }
}

/**
 * Valeur lisible par un humain — affichage et variables de modèles.
 *   montant → « 1 250,00 $ » (fr) / « $1,250.00 » (en)
 *   date → « 24 septembre 2026 » / « September 24, 2026 »
 */
export function formaterValeur(
  champ: Pick<ChampPerso, 'field_type' | 'config' | 'options'>,
  valeur: ValeurChamp,
  langue: 'fr' | 'en' = 'fr',
  fuseau = 'America/Toronto',
): string {
  if (valeur === null || valeur === undefined || valeur === '' || (Array.isArray(valeur) && valeur.length === 0)) return '';
  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';
  const libelleOption = (id: string) => champ.options.find((o) => o.id === id)?.label ?? '';
  switch (champ.field_type) {
    case 'monetary':
      return new Intl.NumberFormat(locale, { style: 'currency', currency: champ.config.currency || 'CAD' })
        .format(Number(valeur) / 100);
    case 'number':
      return new Intl.NumberFormat(locale, {
        maximumFractionDigits: champ.config.decimals ?? 6,
        minimumFractionDigits: champ.config.decimals ?? 0,
      }).format(Number(valeur));
    case 'date': {
      const texte = String(valeur);
      if (champ.config.include_time || texte.length > 10) {
        return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: fuseau }).format(new Date(texte));
      }
      // Date seule : jour civil, jamais décalé par un fuseau.
      const [a, m, j] = texte.slice(0, 10).split('-').map(Number);
      return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(a, m - 1, j)));
    }
    case 'dropdown_single':
      return libelleOption(String(valeur));
    case 'dropdown_multi':
      return (Array.isArray(valeur) ? valeur : [valeur]).map((id) => libelleOption(String(id))).filter(Boolean).join(', ');
    case 'phone': {
      const t = String(valeur);
      const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(t);
      return m ? `(${m[1]}) ${m[2]}-${m[3]}` : t;
    }
    default:
      return String(valeur);
  }
}

/** Slug d'un libellé — miroir de cf_slug() (prévisualisation de la clé). */
export function slugCle(libelle: string): string {
  const s = libelle
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[_0-9]+|_+$/g, '');
  return (s || 'champ').slice(0, 50);
}
