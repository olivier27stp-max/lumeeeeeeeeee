/**
 * Batterie de l'agent de support — LES TARIFS, lus dans la page Tarifs elle-même.
 * ─────────────────────────────────────────────────────────────────────────
 * `src/pages/marketing/Pricing.tsx` est un composant React : on ne l'importe pas
 * (il tirerait React et ses styles), on en lit le TEXTE. Aucun prix n'est écrit
 * ici : si la page change, les attentes de la batterie changent avec elle — et
 * tests/lumi-support-jugement.test.ts dit ce que la page annonçait le jour où
 * la batterie a été écrite.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Prix { mensuel: number; utilisateur: number }
export interface Forfait {
  nom: string;
  slug: string;
  cad: Prix;
  usd: Prix;
  /** 0.10 = 10 %. */
  rabais_annuel: number;
  utilisateurs_inclus: number;
}
export type Fonction = 'lumi' | 'porte_a_porte' | 'textos' | 'api' | 'automatisations' | 'quickbooks';
export interface Tarifs {
  forfaits: Forfait[];
  /** Bureaux inclus, dans l'ordre des forfaits. */
  bureaux: number[];
  /** Indice du premier forfait qui inclut la fonction (0 = le premier forfait de la page). */
  premier_forfait: Record<Fonction, number>;
}

/** Libellé anglais (début) de la ligne du tableau comparatif qui porte chaque fonction. */
const LIGNES: Record<Fonction, string> = {
  lumi: 'Lumi, the AI assistant',
  porte_a_porte: 'Door-to-door:',
  textos: 'Two-way SMS with a dedicated number',
  api: 'Full API access',
  automatisations: 'Automations & quote/invoice follow-ups',
  quickbooks: 'QuickBooks export',
};
const LIGNE_BUREAUX = 'Offices included';

/** Coupe « a, { b, c }, d » aux virgules de premier niveau. */
function cellules(brut: string): string[] {
  const out: string[] = [];
  let profondeur = 0;
  let courant = '';
  for (const c of brut) {
    if (c === '{' || c === '(') profondeur += 1;
    if (c === '}' || c === ')') profondeur -= 1;
    if (c === ',' && profondeur === 0) { out.push(courant.trim()); courant = ''; continue; }
    courant += c;
  }
  if (courant.trim()) out.push(courant.trim());
  return out;
}

/** Lit les forfaits et le tableau comparatif dans le texte de Pricing.tsx. Lève si la page n'a plus la forme attendue. */
export function lireTarifs(source: string): Tarifs {
  const forfaits: Forfait[] = [];
  const motif = /name: '([^']+)',\s*slug: '([^']+)'[\s\S]*?prices: \{ CAD: \{ monthly: (\d+), extraUser: (\d+) \}, USD: \{ monthly: (\d+), extraUser: (\d+) \} \},\s*annualDiscount: ([\d.]+)[\s\S]*?seats: \{ users: (\d+) \}/g;
  for (const m of source.matchAll(motif)) {
    forfaits.push({
      nom: m[1], slug: m[2],
      cad: { mensuel: Number(m[3]), utilisateur: Number(m[4]) },
      usd: { mensuel: Number(m[5]), utilisateur: Number(m[6]) },
      rabais_annuel: Number(m[7]), utilisateurs_inclus: Number(m[8]),
    });
  }
  if (forfaits.length < 2) throw new Error(`Pricing.tsx : ${forfaits.length} forfait(s) lu(s) — la forme de la page a changé, relire lireTarifs.`);

  const lignes = new Map<string, string[]>();
  for (const m of source.matchAll(/label: \{ en: '((?:[^'\\]|\\.)*)', fr: '(?:[^'\\]|\\.)*' \}, cells: \[(.*)\] \}/g)) lignes.set(m[1], cellules(m[2]));
  const trouver = (debut: string): string[] => {
    const cle = [...lignes.keys()].find((k) => k.startsWith(debut));
    const c = cle ? lignes.get(cle) : undefined;
    if (!c || c.length !== forfaits.length) throw new Error(`Pricing.tsx : ligne « ${debut}… » introuvable ou incomplète dans le tableau comparatif.`);
    return c;
  };
  const premier = (debut: string): number => {
    const i = trouver(debut).findIndex((c) => c !== 'false');
    if (i < 0) throw new Error(`Pricing.tsx : aucun forfait n'inclut « ${debut}… ».`);
    return i;
  };
  const bureaux = trouver(LIGNE_BUREAUX).map((c) => {
    const n = /fr: '(\d+)'/.exec(c)?.[1];
    if (!n) throw new Error(`Pricing.tsx : nombre de bureaux illisible (${c}).`);
    return Number(n);
  });
  const premier_forfait = Object.fromEntries((Object.keys(LIGNES) as Fonction[]).map((f) => [f, premier(LIGNES[f])])) as Record<Fonction, number>;
  return { forfaits, bureaux, premier_forfait };
}

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const FICHIER_TARIFS = 'src/pages/marketing/Pricing.tsx';

/** Les tarifs de la page, lus sur le disque (aucun réseau, aucune variable d'environnement). */
export function chargerTarifs(): Tarifs {
  return lireTarifs(readFileSync(join(RACINE, FICHIER_TARIFS), 'utf8'));
}

export const forfait = (t: Tarifs, nom: string): Forfait => {
  const f = t.forfaits.find((x) => x.nom.toLowerCase() === nom.toLowerCase());
  if (!f) throw new Error(`forfait inconnu de la page Tarifs : ${nom}`);
  return f;
};

/** Prix annuel d'un forfait, comme la page le calcule : mensuel arrondi au dollar après rabais, puis × 12. */
export function annuel(mensuel: number, rabais: number): { par_mois: number; par_an: number } {
  const parMois = Math.round(mensuel * (1 - rabais));
  return { par_mois: parMois, par_an: parMois * 12 };
}

/**
 * Tous les montants (en cents) qu'une réponse juste peut citer : prix mensuel, prix d'un
 * utilisateur de plus, prix annuel par mois et par an, dans les deux devises de la page ;
 * et les additions simples (forfait + 1 à 10 utilisateurs de plus). Tout autre montant
 * dans une réponse sur les tarifs est un montant que la page ne donne pas.
 */
export function montantsPermis(t: Tarifs): Set<number> {
  const permis = new Set<number>();
  for (const f of t.forfaits) {
    for (const p of [f.cad, f.usd]) {
      const a = annuel(p.mensuel, f.rabais_annuel);
      for (const dollars of [p.mensuel, p.utilisateur, a.par_mois, a.par_an, p.mensuel * 12]) permis.add(dollars * 100);
      for (let k = 1; k <= 10; k += 1) permis.add((p.mensuel + k * p.utilisateur) * 100);
    }
  }
  return permis;
}

/** Les rabais annuels de la page, en pour cent. */
export const rabaisPermis = (t: Tarifs): number[] => [...new Set(t.forfaits.map((f) => Math.round(f.rabais_annuel * 100)))];
