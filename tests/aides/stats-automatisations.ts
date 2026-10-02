/**
 * Aide des tests d'écran de la liste des automatisations.
 *
 * Depuis la mission du 2026-10-01, la liste lit TOUS ses chiffres (déclenchées, en cours, échecs,
 * envois ignorés) par une seule route : `chargerStatistiquesBureau` (src/lib/automationStatsApi).
 * Avant, elle en lisait deux : les échecs depuis le navigateur (`getRecentAutomationFailures`,
 * plafonné à 200 lignes) et les compteurs par `chargerStatistiques`.
 *
 * Les tests d'avant décrivent leurs données dans ces deux formes : `versStatistiques` les
 * assemble dans la forme d'aujourd'hui, pour que chaque test garde SES données et SON intention.
 */
import type { Statistiques, StatsRegle, Compteurs } from '../../src/lib/automationStatsApi';

/** Les compteurs d'une automatisation, tels que les tests d'avant les écrivaient. */
export interface AncienneStat {
  declenches?: number;
  en_cours?: number;
  envoyes?: number;
  sautes?: number;
  echecs?: number;
  dernier_saut?: string | null;
}

/** Une ligne d'échec, telle que `getRecentAutomationFailures` la rendait (la plus récente d'abord). */
export interface AncienEchec {
  automation_rule_id: string | null;
  action_type?: string;
  result_error: string | null;
  created_at?: string;
}

const vides = (): Compteurs => ({
  declenchees: 0, envoyees: 0, actions: 0, echouees: 0, ignorees: 0, annulees: 0, reportees: 0, en_cours: 0,
  ignorees_par_groupe: {}, ignorees_par_code: {}, reportees_par_code: {},
});

/** Une automatisation dans la forme d'aujourd'hui, à partir de quelques champs. */
export function statRegle(p: Partial<StatsRegle> = {}): StatsRegle {
  return { ...vides(), dernier_echec: null, dernier_ignore: null, ...p };
}

export function versStatistiques(
  ancien: { par_regle?: Record<string, AncienneStat>; texto_configure?: boolean | null } = {},
  echecs: AncienEchec[] = [],
  jours = 7,
): Statistiques {
  const par_regle: Record<string, StatsRegle> = {};
  for (const [id, a] of Object.entries(ancien.par_regle ?? {})) {
    par_regle[id] = statRegle({
      declenchees: a.declenches ?? 0,
      en_cours: a.en_cours ?? 0,
      envoyees: a.envoyes ?? 0,
      ignorees: a.sautes ?? 0,
      echouees: a.echecs ?? 0,
      dernier_ignore: a.dernier_saut
        ? { quand: '2026-09-27T10:00:00Z', action_type: 'send_sms', issue: 'deja_envoye', detail: a.dernier_saut }
        : null,
    });
  }
  // Les échecs : le compte par automatisation, et la cause du plus récent.
  const parRegle = new Map<string, AncienEchec[]>();
  for (const e of echecs) {
    if (!e.automation_rule_id) continue;
    parRegle.set(e.automation_rule_id, [...(parRegle.get(e.automation_rule_id) ?? []), e]);
  }
  for (const [id, liste] of parRegle) {
    par_regle[id] = {
      ...(par_regle[id] ?? statRegle()),
      echouees: liste.length,
      dernier_echec: { quand: liste[0].created_at ?? '2026-09-27T10:00:00Z', action_type: liste[0].action_type ?? 'send_sms', erreur: liste[0].result_error },
    };
  }
  const total = vides();
  for (const r of Object.values(par_regle)) {
    for (const k of ['declenchees', 'envoyees', 'actions', 'echouees', 'ignorees', 'annulees', 'reportees', 'en_cours'] as const) total[k] += r[k];
  }
  return {
    periode: { jours, fuseau: 'America/Montreal', depuis: '2026-09-25T04:00:00.000Z', premier_jour: '2026-09-25', dernier_jour: '2026-10-01' },
    par_regle,
    total,
    par_jour: [],
    texto_configure: ancien.texto_configure === undefined ? true : ancien.texto_configure,
  };
}
