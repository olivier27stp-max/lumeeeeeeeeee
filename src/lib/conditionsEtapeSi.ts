/* ═══════════════════════════════════════════════════════════════
   LES CONDITIONS D'UNE ÉTAPE « SI… », EN TEXTE — une ligne par condition.

   Le panneau de l'étape les montre et les fait saisir en texte
   (« montant > 5000 »). Deux fonctions, l'une l'inverse de l'autre :
     · `texteDesConditions`  : l'objet `conditions` de la règle → le texte ;
     · `analyserConditions`  : le texte → l'objet `conditions`.

   LA RÈGLE (triage « déclencheurs », 05-etapes-controle:470 et :501) : ce
   que la zone ne sait pas LIRE ou ÉCRIRE n'est JAMAIS jeté en silence.
     · Une ligne tapée que l'analyse ne comprend pas (« montant 5000 », sans
       signe ; « statut = », sans valeur) est SIGNALÉE (`illisibles`) : le
       panneau retient l'enregistrement. Avant, elle était ignorée : la
       condition partait vide et le parcours suivait toujours « si oui ».
     · Une condition « est l'un de » / « n'est aucun de » (`in` / `not_in`,
       posée par Lumi ou un modèle) s'écrit et se relit en texte. Avant, la
       zone s'ouvrait vide, et le premier enregistrement l'effaçait.
     · Une condition que le texte ne peut pas porter fidèlement (opérateur
       inconnu, valeur vide, liste dont une valeur contient une virgule…)
       est CONSERVÉE telle quelle (`conditionsConservees`) et montrée en
       lecture seule.

   Les opérateurs sont ceux du moteur (`evaluateConditions`) et du schéma
   du serveur (`conditionsAutomatisation`) : eq, neq, gt, gte, lt, lte, in,
   not_in. `champs_perso` (conditions sur les champs personnalisés) a son
   propre éditeur : ce module ne le lit ni ne l'écrit.
   ═══════════════════════════════════════════════════════════════ */

export type ConditionsSi = Record<string, unknown>;

type Scalaire = string | number | boolean;

/** L'opérateur, tel qu'on l'écrit : `montant > 5000`. `>=` avant `>` : sinon `>` couperait `>=` en deux. */
const SIGNES: ReadonlyArray<readonly [string, string]> = [
  ['gte', '>='], ['lte', '<='], ['gt', '>'], ['lt', '<'], ['neq', '!='], ['eq', '='],
];

/** Les opérateurs de LISTE : ce qu'on écrit (les deux langues, les deux apostrophes sont lues). */
const LISTES: ReadonlyArray<{ op: 'in' | 'not_in'; fr: string; en: string; motif: RegExp }> = [
  { op: 'not_in', fr: 'n’est aucun de', en: 'is none of', motif: /\s(?:n[’']est aucun de|is none of)(?:\s|$)/i },
  { op: 'in', fr: 'est l’un de', en: 'is one of', motif: /\s(?:est l[’']un de|is one of)(?:\s|$)/i },
];

/** Un nombre pur (montant, quantité) reste un nombre dans une comparaison. */
const NOMBRE_SEUL = /^-?[0-9]+([.][0-9]+)?$/;

/**
 * Ce qu'une COMPARAISON (>, >=, <, <=) sait juger : un nombre pur ou une date
 * ISO — la règle du moteur (`versNombreComparable`, automationEngine.ts).
 * Toute autre valeur (« 1500$ », du texte) rend la comparaison impossible :
 * le moteur refuse alors la branche à chaque passage, sans un mot à l'écran.
 */
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/i;
function comparable(texte: string): boolean {
  if (NOMBRE_SEUL.test(texte)) return true;
  const iso = DATE_ISO.exec(texte);
  if (!iso) return false;
  const [a, m, j] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  const jour = new Date(Date.UTC(a, m - 1, j));
  return jour.getUTCFullYear() === a && jour.getUTCMonth() === m - 1 && jour.getUTCDate() === j;
}

const estScalaire = (v: unknown): v is Scalaire => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
/** Une valeur qui tient sur une ligne et se relit identique. */
const ecrivable = (v: unknown): v is Scalaire => estScalaire(v) && String(v).trim() !== '' && String(v) === String(v).trim() && !/[\r\n]/.test(String(v));
/** … et, dans une liste, sans virgule (le séparateur). */
const ecrivableEnListe = (v: unknown): v is Scalaire => ecrivable(v) && !String(v).includes(',');
/** Un nom de champ que la ligne peut porter : pas de signe, pas de mot d'opérateur, pas de retour de ligne. */
function cleEcrivable(cle: string): boolean {
  if (cle.trim() === '' || cle !== cle.trim() || /[\r\n]/.test(cle)) return false;
  if (SIGNES.some(([, signe]) => cle.includes(signe))) return false;
  return !LISTES.some((l) => l.motif.test(` ${cle} `));
}

interface Ligne { cle: string; op: string; valeur: unknown; texte: string }

/** Les lignes qu'on sait écrire, et les conditions à conserver telles quelles. */
function decomposer(conditions: ConditionsSi | null | undefined, fr: boolean): { lignes: Ligne[]; conservees: ConditionsSi } {
  const lignes: Ligne[] = [];
  const conservees: ConditionsSi = {};
  for (const [cle, v] of Object.entries(conditions ?? {})) {
    if (cle === 'champs_perso') continue;
    if (!cleEcrivable(cle)) { conservees[cle] = v; continue; }
    if (ecrivable(v)) {
      lignes.push({ cle, op: 'plat', valeur: v, texte: `${cle} = ${String(v)}` });
      continue;
    }
    if (v === null || typeof v !== 'object' || Array.isArray(v)) { conservees[cle] = v; continue; }
    const objet = v as Record<string, unknown>;
    const ops = Object.keys(objet);
    const connues = ops.length > 0 && ops.every((op) => {
      if (SIGNES.some(([o]) => o === op)) return ecrivable(objet[op]);
      if (op === 'in' || op === 'not_in') return Array.isArray(objet[op]) && (objet[op] as unknown[]).length > 0 && (objet[op] as unknown[]).every(ecrivableEnListe);
      return false;
    });
    if (!connues) { conservees[cle] = v; continue; }
    // Un intervalle (`{ gte, lt }`) s'écrit sur DEUX lignes : c'est ce qu'on
    // relit le mieux, et l'analyse les recolle sur la même clé.
    for (const [op, signe] of SIGNES) {
      if (op in objet) lignes.push({ cle, op, valeur: objet[op], texte: `${cle} ${signe} ${String(objet[op])}` });
    }
    for (const liste of LISTES) {
      if (liste.op in objet) {
        lignes.push({ cle, op: liste.op, valeur: objet[liste.op], texte: `${cle} ${fr ? liste.fr : liste.en} ${(objet[liste.op] as Scalaire[]).map(String).join(', ')}` });
      }
    }
  }
  return { lignes, conservees };
}

/** Les conditions d'une étape « si », en texte modifiable (une ligne par condition). */
export function texteDesConditions(conditions: ConditionsSi | null | undefined, fr = true): string {
  return decomposer(conditions, fr).lignes.map((l) => l.texte).join('\n');
}

/**
 * Les conditions que le texte ne peut pas porter : gardées telles quelles à
 * l'enregistrement, montrées en lecture seule. Jamais effacées.
 */
export function conditionsConservees(conditions: ConditionsSi | null | undefined): ConditionsSi {
  return decomposer(conditions, true).conservees;
}

export interface LigneIllisible { ligne: string; fr: string; en: string }
export interface AnalyseConditions {
  /** Ce que les lignes LISIBLES donnent (sans `champs_perso` ni les conditions conservées). */
  conditions: ConditionsSi;
  /** Les lignes que l'analyse ne comprend pas, avec ce qui leur manque. */
  illisibles: LigneIllisible[];
}

const SIGNES_DITS = '=, !=, >, >=, <, <=';

/**
 * Le texte saisi → l'objet `conditions`.
 *
 * `origine` : les conditions dont le texte est parti. Une ligne restée telle
 * quelle garde sa valeur D'ORIGINE (un nombre reste un nombre, une liste de
 * nombres aussi) : rouvrir et ajouter une ligne ne retype pas les autres.
 */
export function analyserConditions(texte: string, origine?: ConditionsSi | null): AnalyseConditions {
  const conditions: ConditionsSi = {};
  const illisibles: LigneIllisible[] = [];
  const dOrigine = new Map<string, unknown>();
  for (const l of [...decomposer(origine, true).lignes, ...decomposer(origine, false).lignes]) dOrigine.set(l.texte, l.valeur);
  /** Les opérateurs déjà posés par champ : deux fois le même sur un champ, la seconde ligne écraserait la première. */
  const poses = new Map<string, Set<string>>();

  for (const brute of texte.split('\n')) {
    const ligne = brute.trim();
    if (ligne === '') continue;
    const refuser = (fr: string, en: string) => { illisibles.push({ ligne, fr, en }); };

    const liste = LISTES
      .map((l) => ({ l, m: l.motif.exec(` ${ligne} `) }))
      .filter((x): x is { l: (typeof LISTES)[number]; m: RegExpExecArray } => x.m !== null)
      .sort((a, b) => a.m.index - b.m.index)[0];
    const signe = SIGNES
      .map(([op, s]) => ({ op, s, i: ligne.indexOf(s) }))
      .filter((x) => x.i >= 0)
      .sort((a, b) => (a.i - b.i) || (b.s.length - a.s.length))[0];

    let cle: string;
    let op: string;
    let reste: string;
    // Le mot d'opérateur compte s'il vient AVANT tout signe (« note est l'un de a=b, c »).
    if (liste && (!signe || liste.m.index - 1 < signe.i)) {
      // `motif` a été cherché dans « ␠ligne␠ » : l'index y est décalé d'un caractère.
      cle = ligne.slice(0, Math.max(0, liste.m.index)).trim();
      reste = ligne.slice(Math.max(0, liste.m.index - 1 + liste.m[0].length)).trim();
      op = liste.l.op;
    } else if (signe) {
      cle = ligne.slice(0, signe.i).trim();
      reste = ligne.slice(signe.i + signe.s.length).trim();
      op = signe.op;
    } else {
      refuser(
        `il manque un signe (${SIGNES_DITS}) ou « est l’un de » entre le champ et la valeur.`,
        `a sign (${SIGNES_DITS}) or “is one of” is missing between the field and the value.`,
      );
      continue;
    }
    if (!cle) { refuser('il manque le nom du champ avant le signe.', 'the field name is missing before the sign.'); continue; }
    if (!reste) { refuser('il manque la valeur.', 'the value is missing.'); continue; }

    let valeur: unknown;
    if (dOrigine.has(ligne)) {
      valeur = dOrigine.get(ligne);
    } else if (op === 'in' || op === 'not_in') {
      const valeurs = reste.split(',').map((v) => v.trim()).filter(Boolean);
      if (valeurs.length === 0) { refuser('il manque la liste des valeurs (séparées par des virgules).', 'the list of values (comma-separated) is missing.'); continue; }
      valeur = valeurs;
    } else if (op === 'eq') {
      // L'égalité reste écrite à plat, en texte : c'est la forme d'origine,
      // que portent toutes les règles existantes.
      valeur = reste;
    } else {
      if (op !== 'neq' && !comparable(reste)) {
        refuser(
          `une comparaison attend un nombre ou une date (AAAA-MM-JJ) : « ${reste} » n’est ni l’un ni l’autre.`,
          `a comparison needs a number or a date (YYYY-MM-DD): “${reste}” is neither.`,
        );
        continue;
      }
      // Un montant s'écrit en chiffres : on le garde en nombre pour que la
      // comparaison ne dépende pas d'une conversion plus loin.
      valeur = NOMBRE_SEUL.test(reste) ? Number(reste) : reste;
    }

    const dejaPoses = poses.get(cle) ?? new Set<string>();
    if (dejaPoses.has(op)) {
      refuser(
        `« ${cle} » a déjà une condition de ce type plus haut : une seule serait gardée.`,
        `“${cle}” already has a condition of this kind above: only one would be kept.`,
      );
      continue;
    }
    dejaPoses.add(op);
    poses.set(cle, dejaPoses);

    const existant = conditions[cle];
    if (existant === undefined) {
      conditions[cle] = op === 'eq' ? valeur : { [op]: valeur };
    } else if (existant !== null && typeof existant === 'object' && !Array.isArray(existant)) {
      conditions[cle] = { ...(existant as Record<string, unknown>), [op]: valeur };
    } else {
      // Une égalité à plat rejointe par une autre condition sur le même champ :
      // les DEUX sont gardées (avant, la seconde remplaçait la première).
      conditions[cle] = { eq: existant, [op]: valeur };
    }
  }
  return { conditions, illisibles };
}
