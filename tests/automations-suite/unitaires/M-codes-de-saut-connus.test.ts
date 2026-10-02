/**
 * Le moteur et la liste des issues restent D'ACCORD (mission finale, consigne
 * du coordinateur, point 6).
 *
 * Chaque issue d'une exécution a un code stable, écrit par le moteur dans
 * `result_data.saute_code` (journal) ou `action_config.motif_code` (tâche
 * annulée ou reportée). Les écrans, les statistiques et Lumi le lisent dans
 * UNE liste : `src/lib/automationMotifs.ts`. Un code écrit par le moteur et
 * absent de cette liste s'affiche « Raison inconnue » et tombe dans « Autre ».
 *
 * Ce test lit le CODE du moteur et de ses actions, relève chaque code écrit
 * en toutes lettres, et vérifie qu'il est connu — ou qu'il figure dans la
 * liste « à ajouter » ci-dessous, celle du rapport de la mission
 * (notes/M-corrections.md), le temps que le coordinateur l'ajoute à MOTIFS.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MOTIFS } from '../../../src/lib/automationMotifs';

const RACINE = resolve(__dirname, '../../..');

/**
 * Codes que le moteur écrit et que `MOTIFS` ne connaît pas encore, avec le
 * libellé voulu. À retirer d'ici quand ils y sont.
 */
export const A_AJOUTER: ReadonlyArray<{ code: string; categorie: 'ignoree' | 'reportee' | 'annulee'; groupe: string; fr: string; en: string }> = [
  { code: 'parcours_vide', categorie: 'ignoree', groupe: 'autre', fr: 'Le parcours ne contient aucune étape', en: 'The workflow has no steps' },
  { code: 'anterieur_activation', categorie: 'ignoree', groupe: 'hors_ciblage', fr: 'Situation déjà en cours avant l’activation de l’automatisation', en: 'Already the case before the automation was turned on' },
  { code: 'rendez_vous_deplace', categorie: 'reportee', groupe: 'condition_plus_valide', fr: 'Rendez-vous déplacé : le rappel suit la nouvelle date', en: 'Appointment moved: the reminder follows the new date' },
];

/** Les fichiers du moteur qui écrivent une issue. */
function fichiersDuMoteur(): string[] {
  const lib = join(RACINE, 'server/lib');
  const sous = (dossier: string): string[] => readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    return statSync(chemin).isDirectory() ? sous(chemin) : /\.ts$/.test(nom) ? [chemin] : [];
  });
  return [
    ...['automationEngine.ts', 'sortie-parcours.ts', 'automations-activation.ts', 'automationSequences.ts', 'rappels-dates.ts',
      'client-inactif.ts', 'pipelineEvenements.ts', 'evenementsBase.ts', 'eventBus.ts', 'scheduler.ts',
      'automations-fuseau-org.ts', 'automations-pause-org.ts'].map((f) => join(lib, f)),
    join(RACINE, 'server/routes/cron.ts'),
    join(RACINE, 'server/routes/reminders-cron.ts'),
    ...sous(join(lib, 'actions')),
  ];
}

/** Les fichiers où `code: '…'` désigne TOUJOURS une issue de tâche (IssueTache, Arret). */
const FICHIERS_A_ISSUES = /(automationEngine|sortie-parcours)\.ts$/;

/** Les codes écrits en toutes lettres dans UNE source. */
function codesDe(source: string, fichierAIssues: boolean): string[] {
  const codes: string[] = [];
  // 1. Écrit tel quel dans le journal ou sur la tâche.
  for (const m of source.matchAll(/\b(?:saute_code|motif_code)\s*:\s*'([a-z0-9_]+)'/g)) codes.push(m[1]);
  // 2. Les unions de codes : tout ce que `saute(…, code)` et `arret.code` peuvent valoir.
  for (const union of source.matchAll(/export type (?:CodeSaut|CodeArret)\s*=([^;]+);/g)) {
    for (const m of union[1].matchAll(/'([a-z0-9_]+)'/g)) codes.push(m[1]);
  }
  // 3. Les issues de tâche du moteur : `{ code: '…', motif: … }`.
  if (fichierAIssues) {
    for (const m of source.matchAll(/\bcode\s*:\s*'([a-z0-9_]+)'/g)) codes.push(m[1]);
  }
  return codes;
}

/** Chaque code écrit par le moteur, avec l'endroit où il l'est. */
function codesEcrits(): Map<string, string[]> {
  const vus = new Map<string, string[]>();
  for (const chemin of fichiersDuMoteur()) {
    const court = chemin.slice(RACINE.length + 1).replace(/\\/g, '/');
    for (const code of codesDe(readFileSync(chemin, 'utf8'), FICHIERS_A_ISSUES.test(chemin))) {
      vus.set(code, [...(vus.get(code) ?? []), court]);
    }
  }
  return vus;
}

const connus = new Set(MOTIFS.map((m) => m.code));
const aAjouter = new Set(A_AJOUTER.map((m) => m.code));

describe('codes d’issue : le moteur n’écrit que des codes connus', () => {
  const ecrits = codesEcrits();

  it('le relevé trouve bien les codes du moteur (témoin)', () => {
    expect(ecrits.size).toBeGreaterThanOrEqual(25);
    for (const code of ['conditions', 'hors_heures', 'rafale', 'plafond_frequence', 'sans_cible', 'etape_retiree', 'entite_supprimee', 'condition_plus_valide', 'une_fois_par_client', 'deja_envoye']) {
      expect([...ecrits.keys()], `« ${code} » n’est plus relevé`).toContain(code);
    }
  });

  it('chaque code écrit est dans MOTIFS (src/lib/automationMotifs.ts) ou dans la liste « à ajouter » du rapport', () => {
    const inconnus = [...ecrits.entries()]
      .filter(([code]) => !connus.has(code) && !aAjouter.has(code))
      .map(([code, ou]) => `${code} (${[...new Set(ou)].join(', ')})`);
    expect(inconnus, 'codes écrits par le moteur et inconnus de la liste des issues').toEqual([]);
  });

  it('la liste « à ajouter » ne porte que des codes réellement écrits, avec un libellé français et anglais', () => {
    for (const m of A_AJOUTER) {
      expect([...ecrits.keys()], `« ${m.code} » n’est écrit nulle part : à retirer de la liste`).toContain(m.code);
      expect(m.fr.trim().length).toBeGreaterThan(5);
      expect(m.en.trim().length).toBeGreaterThan(5);
    }
  });

  it('un code inventé serait attrapé, sous chacune de ses écritures (le filet n’est pas aveugle)', () => {
    const inconnu = (source: string, issues = false) => codesDe(source, issues).filter((c) => !connus.has(c) && !aAjouter.has(c));
    expect(inconnu("result_data: { saute: 'x', saute_code: 'code_invente' }")).toEqual(['code_invente']);
    expect(inconnu("action_config: { ...c, motif_code: 'code_invente' }")).toEqual(['code_invente']);
    expect(inconnu("export type CodeSaut =\n  | 'desabonne'\n  | 'code_invente';")).toEqual(['code_invente']);
    expect(inconnu("arreterTache(supabase, task, { code: 'code_invente', motif: 'x' })", true)).toEqual(['code_invente']);
  });
});
