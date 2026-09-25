/**
 * Conditions de champs personnalisés → filtres PostgREST pour une LISTE
 * paginée (clients, jobs, devis).
 *
 * Une condition devient une jointure sur custom_field_values :
 *   · présence (« est », « contient », « > »…) : `cfN:custom_field_values!inner(id)`
 *     + les filtres sur `cfN.*` → seules les fiches qui ont une telle valeur restent ;
 *   · absence (« est vide », « n'est pas », « ne contient pas », « ≠ »,
 *     « n'est aucun de ») : jointure GAUCHE sur la version positive puis
 *     `cfN is null` (anti-jointure) → une fiche SANS valeur les satisfait,
 *     comme dans le moteur SQL (cf_condition_sql) et le moteur en mémoire.
 * La pagination, le tri et le total restent ceux de la base : rien ne se
 * filtre dans le navigateur. La RLS des valeurs s'applique dans la jointure.
 *
 * Mêmes sémantiques que src/lib/champs/filtres.ts ; les dates relatives sont
 * calculées dans le fuseau de l'entreprise (heure murale), puis converties en
 * instants pour un champ date + heure. tests/champs-perso-filtres-liste.test.ts.
 */
import type { ChampPerso } from './types';
import {
  familleDuType, heureMurale, normaliserTelephone, normaliserTexte, retirerDuree, OPERATEURS_PAR_FAMILLE,
  type Condition,
} from './filtres';

/** Le sous-ensemble du constructeur PostgREST dont on se sert. */
export interface Filtrable<Q> {
  eq(col: string, v: unknown): Q;
  in(col: string, v: readonly unknown[]): Q;
  gt(col: string, v: unknown): Q;
  gte(col: string, v: unknown): Q;
  lt(col: string, v: unknown): Q;
  lte(col: string, v: unknown): Q;
  like(col: string, v: string): Q;
  is(col: string, v: null): Q;
}

export interface FiltreListe {
  /** À ajouter à la projection : `, cf0:custom_field_values!inner(id), …` (vide sans condition). */
  select: string;
  /** Pose les filtres sur la requête. */
  appliquer<Q extends Filtrable<Q>>(q: Q): Q;
  /** Nombre de conditions effectivement compilées. */
  taille: number;
}

export const FILTRE_VIDE: FiltreListe = { select: '', appliquer: (q) => q, taille: 0 };

const ABSENCES = new Set(['is_empty', 'is_not', 'not_contains', 'neq', 'none_of']);

type Op = { col: string; f: 'eq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'like'; v: unknown };

/** Instant (ISO) d'une heure murale 'AAAA-MM-JJTHH:MM:SS' dans le fuseau. */
export function instantDepuisMur(mur: string, fuseau: string): string {
  const [d, h = '00:00:00'] = mur.split('T');
  const [a, m, j] = d.split('-').map(Number);
  const [hh, mi, ss] = h.split(':').map(Number);
  const cible = Date.UTC(a, m - 1, j, hh, mi, ss);
  let t = cible;
  // Deux passes suffisent (le décalage change au plus une fois autour d'un changement d'heure).
  for (let i = 0; i < 2; i++) {
    const vu = heureMurale(new Date(t), fuseau);
    const [vd, vh] = vu.split('T');
    const [va, vm, vj] = vd.split('-').map(Number);
    const [vhh, vmi, vss] = vh.split(':').map(Number);
    t += cible - Date.UTC(va, vm - 1, vj, vhh, vmi, vss);
  }
  return new Date(t).toISOString();
}

const jourSuivant = (jour: string) => {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j + 1)).toISOString().slice(0, 10);
};

/** Échappe % _ \ pour un LIKE (motif « contient »). */
const echapperLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Prédicat POSITIF d'une condition, en filtres sur l'alias. */
function predicat(champ: ChampPerso, c: Condition, alias: string, fuseau: string, maintenant: Date): Op[] {
  const famille = familleDuType(champ.field_type);
  const op = c.op;
  if (op === 'is_empty' || op === 'is_not_empty') return [];

  if (famille === 'texte') {
    const val = champ.field_type === 'phone'
      ? normaliserTelephone(String(c.value ?? '')) ?? normaliserTexte(c.value)
      : normaliserTexte(c.value);
    if (op === 'is' || op === 'is_not') return [{ col: `${alias}.value_normalized`, f: 'eq', v: val }];
    return [{ col: `${alias}.value_normalized`, f: 'like', v: `%${echapperLike(val)}%` }];
  }

  if (famille === 'nombre') {
    const col = `${alias}.${champ.field_type === 'monetary' ? 'value_money_cents' : 'value_number'}`;
    const a = Number(c.value);
    if (!Number.isFinite(a)) throw new Error(`Valeur manquante pour « ${op} ».`);
    if (op === 'eq' || op === 'neq') return [{ col, f: 'eq', v: a }];
    if (op === 'gt') return [{ col, f: 'gt', v: a }];
    if (op === 'lt') return [{ col, f: 'lt', v: a }];
    const b = Number(c.value2);
    if (!Number.isFinite(b)) throw new Error('Valeur manquante pour « between ».');
    return [{ col, f: 'gte', v: Math.min(a, b) }, { col, f: 'lte', v: Math.max(a, b) }];
  }

  if (famille === 'liste') {
    const ids = (Array.isArray(c.value) ? c.value : [c.value]).filter((x) => x != null && x !== '').map(String);
    if (ids.length === 0) throw new Error('Aucune option choisie.');
    return champ.field_type === 'dropdown_multi'
      ? [{ col: `${alias}.o.option_id`, f: 'in', v: ids }]
      : [{ col: `${alias}.value_option_id`, f: 'in', v: ids }];
  }

  // Dates : bornes en heure murale locale, puis colonne date (jour civil) ou instant.
  const avecHeure = !!champ.config.include_time;
  const col = `${alias}.${avecHeure ? 'value_timestamp' : 'value_date'}`;
  const mur = heureMurale(maintenant, fuseau);
  const aujourdhui = mur.slice(0, 10);
  const n = Math.max(0, Math.floor(Number(c.n ?? 0)));
  const borne = retirerDuree(avecHeure ? mur : `${aujourdhui}T00:00:00`, n, c.unit ?? 'days');
  const debutJour = (jour: string) => (avecHeure ? instantDepuisMur(`${jour}T00:00:00`, fuseau) : jour);
  // Un intervalle de jours [de, a] inclus : date seule → gte/lte ; instant → [de 0 h, lendemain de a 0 h).
  const jours = (de: string, a: string): Op[] => (avecHeure
    ? [{ col, f: 'gte', v: debutJour(de) }, { col, f: 'lt', v: debutJour(jourSuivant(a)) }]
    : [{ col, f: 'gte', v: de }, { col, f: 'lte', v: a }]);
  const exigerDate = (x: unknown) => {
    if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(x)) throw new Error(`Date manquante pour « ${op} ».`);
    return x.slice(0, 10);
  };
  switch (op) {
    case 'today': return jours(aujourdhui, aujourdhui);
    case 'yesterday': {
      const hier = retirerDuree(`${aujourdhui}T00:00:00`, 1, 'days').slice(0, 10);
      return jours(hier, hier);
    }
    case 'in_last': return avecHeure
      ? [{ col, f: 'gte', v: instantDepuisMur(borne, fuseau) }, { col, f: 'lte', v: maintenant.toISOString() }]
      : [{ col, f: 'gte', v: borne.slice(0, 10) }, { col, f: 'lte', v: aujourdhui }];
    case 'more_than_ago': return [{ col, f: 'lt', v: avecHeure ? instantDepuisMur(borne, fuseau) : borne.slice(0, 10) }];
    case 'less_than_ago': return [{ col, f: 'gte', v: avecHeure ? instantDepuisMur(borne, fuseau) : borne.slice(0, 10) }];
    case 'before': return [{ col, f: 'lt', v: debutJour(exigerDate(c.value)) }];
    case 'after': {
      const d = exigerDate(c.value);
      return avecHeure ? [{ col, f: 'gte', v: debutJour(jourSuivant(d)) }] : [{ col, f: 'gt', v: d }];
    }
    case 'between': {
      const a = exigerDate(c.value);
      const b = exigerDate(c.value2);
      return jours(a < b ? a : b, a < b ? b : a);
    }
  }
  return [];
}

/**
 * Compile des conditions (complètes) pour une liste. Une condition dont le
 * champ n'existe plus, ou dont l'opérateur ne va pas avec le type, lève :
 * mieux vaut une erreur visible qu'un filtre silencieusement ignoré.
 */
export function compilerFiltresListe(
  conditions: Condition[], champs: ChampPerso[], fuseau: string, maintenant: Date = new Date(),
): FiltreListe {
  if (conditions.length === 0) return FILTRE_VIDE;
  const morceaux: string[] = [];
  const etapes: Array<{ alias: string; champ: ChampPerso; ops: Op[]; absence: boolean }> = [];
  conditions.forEach((c, i) => {
    const champ = champs.find((x) => x.id === c.field_id);
    if (!champ) throw new Error('Un champ du filtre n’existe plus.');
    if (!OPERATEURS_PAR_FAMILLE[familleDuType(champ.field_type)].includes(c.op)) {
      throw new Error(`Opérateur « ${c.op} » invalide pour un champ ${champ.field_type}.`);
    }
    const alias = `cf${i}`;
    const absence = ABSENCES.has(c.op);
    const ops = predicat(champ, c, alias, fuseau, maintenant);
    const multi = champ.field_type === 'dropdown_multi' && ops.some((o) => o.col.startsWith(`${alias}.o.`));
    const embed = multi ? 'id,o:custom_field_value_options!inner(option_id)' : 'id';
    morceaux.push(`${alias}:custom_field_values${absence ? '' : '!inner'}(${embed})`);
    etapes.push({ alias, champ, ops, absence });
  });
  return {
    select: `, ${morceaux.join(', ')}`,
    taille: etapes.length,
    appliquer<Q extends Filtrable<Q>>(q0: Q): Q {
      let q = q0;
      for (const e of etapes) {
        q = q.eq(`${e.alias}.field_id`, e.champ.id);
        for (const o of e.ops) {
          q = o.f === 'in' ? q.in(o.col, o.v as unknown[]) : o.f === 'like' ? q.like(o.col, String(o.v)) : q[o.f](o.col, o.v);
        }
        if (e.absence) q = q.is(e.alias, null);
      }
      return q;
    },
  };
}
