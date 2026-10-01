/**
 * Agent D — point 4 de la mission (statistiques).
 *
 * 1. Fabrique le JEU CONNU par le vrai moteur (voir ../jeu-connu.ts).
 * 2. État des lieux : ce que le moteur ÉCRIT pour chaque issue (lignes, codes, motifs).
 * 3. La route de statistiques (`GET /api/automations/rules/stats`, ici sa fonction, avec le
 *    jeton du propriétaire A — la RLS s'applique) contre le jeu connu.
 * 4. Les preuves ROUGES des constats D-xx : ce qui devrait être compté ou tracé et ne l'est pas.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { demarrerMoteur } from '../../../automations-suite/harnais/moteur';
import { sessionDe, COMPTES } from '../../../automations-suite/harnais/bureau-test';
import { construireJeuConnu, veriteRegle, type Manifeste } from '../jeu-connu';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
let jeu: Manifeste;
let clientA: SupabaseClient;

beforeAll(async () => {
  b = await demarrerMoteur();
  jeu = await construireJeuConnu();
  const { jeton } = await sessionDe(b.admin, COMPTES.proprioA.email);
  const { buildSupabaseWithAuth } = await import('../../../../server/lib/supabase');
  clientA = buildSupabaseWithAuth(`Bearer ${jeton}`, b.orgA);
});

describe('D — état des lieux : ce que le moteur écrit pour chaque issue', () => {
  it('[D-EL-01] réussies : 6 lignes en succès, sans motif de saut', async () => {
    const v = await veriteRegle(b.admin, jeu.regles.S.id, 365);
    expect(v).toMatchObject({ lignes: 6, reussis: 6, sautes: 0, echecs: 0, taches: 0 });
  });

  it('[D-EL-02] fournisseur en panne : 3 échecs, et 3 reprises posées dans la file', async () => {
    const v = await veriteRegle(b.admin, jeu.regles.E.id, 365);
    expect(v).toMatchObject({ lignes: 3, echecs: 3, reussis: 0, taches_en_attente: 3 });
    expect(v.erreurs.every((e) => /panne/i.test(e)), v.erreurs.join(' | ')).toBe(true);
  });

  it('[D-EL-03] sauts : chaque motif a son code dans result_data.saute_code', async () => {
    const codes: Record<string, string> = {};
    for (const cle of ['T', 'D', 'C', 'N']) {
      const v = await veriteRegle(b.admin, jeu.regles[cle].id, 365);
      expect(v.sautes, `règle ${cle}`).toBe(jeu.regles[cle].clients.length);
      codes[cle] = Object.keys(v.codes).join(',');
    }
    expect(codes).toEqual({ T: 'sans_telephone', D: 'desabonne', C: 'sans_consentement', N: 'sans_courriel' });
  });

  it('[D-EL-04] conditions non remplies : une ligne « conditions » par événement, aucune action', async () => {
    const v = await veriteRegle(b.admin, jeu.regles.K.id, 365);
    expect(v).toMatchObject({ lignes: 3, ecartes: 3, reussis: 0, sautes: 0, echecs: 0 });
    expect(v.motifs.every((m) => m.startsWith('Conditions non remplies')), v.motifs.join(' | ')).toBe(true);
  });

  it('[D-EL-05] hors heures d’envoi : AUCUNE ligne de journal, une tâche en attente', async () => {
    const v = await veriteRegle(b.admin, jeu.regles.H.id, 365);
    expect(v).toMatchObject({ lignes: 0, taches: 1, taches_en_attente: 1 });
  });

  it('[D-EL-06] parcours : 2 courriels partis (étape e1), 2 textos en attente (étape e3)', async () => {
    const v = await veriteRegle(b.admin, jeu.regles.P.id, 365);
    expect(v).toMatchObject({ lignes: 2, reussis: 2, taches: 4, taches_en_attente: 2 });
  });
});

describe('D — la route de statistiques contre le jeu connu (fenêtre de 60 jours)', () => {
  it('[D-ST-01] chaque règle : déclenchées, en cours, envois, sautées, échecs = le jeu', async () => {
    const { calculerStatistiques } = await import('../../../../server/routes/automation-stats');
    const { par_regle } = await calculerStatistiques(clientA, b.orgA, null);
    const ecarts: string[] = [];
    for (const r of Object.values(jeu.regles)) {
      const lu = par_regle[r.id] ?? { declenches: 0, en_cours: 0, envoyes: 0, sautes: 0, echecs: 0 };
      for (const k of ['declenches', 'en_cours', 'envoyes', 'sautes', 'echecs'] as const) {
        if (lu[k] !== r.attendu.stats60[k]) ecarts.push(`${r.cle}.${k} : route ${lu[k]} ≠ jeu ${r.attendu.stats60[k]}`);
      }
    }
    expect(ecarts, ecarts.join('\n')).toEqual([]);
  });

  it('[D-ST-02] par étape du parcours : e1 = 2 réussis, e3 = 2 en attente', async () => {
    const { calculerStatistiques } = await import('../../../../server/routes/automation-stats');
    const { par_etape } = await calculerStatistiques(clientA, b.orgA, jeu.regles.P.id);
    expect(par_etape).toEqual({
      e1: { envoyes: 2, sautes: 0, echecs: 0, en_attente: 0 },
      e3: { envoyes: 0, sautes: 0, echecs: 0, en_attente: 2 },
    });
  });
});

describe('D — preuves des constats (rouges tant que le constat n’est pas corrigé)', () => {
  it('[D-03] un envoi retenu par le PLAFOND DE FRÉQUENCE est un envoi ignoré avec sa raison, pas un échec', async () => {
    const { data } = await b.admin.from('automation_execution_logs').select('result_success, result_error, result_data').eq('automation_rule_id', jeu.regles.F4.id);
    expect(data).toHaveLength(1);
    const l = data![0] as { result_success: boolean; result_error: string | null; result_data: Record<string, unknown> | null };
    // Aujourd'hui : result_success = false, result_error = « Frequency cap reached for +1… ».
    expect({ succes: l.result_success, code: l.result_data?.saute_code ?? null }, `ligne écrite : ${JSON.stringify(l)}`)
      .toEqual({ succes: true, code: 'plafond_frequence' });
  });

  it('[D-03b] le motif d’un envoi plafonné ne porte pas le numéro du client', async () => {
    const { data } = await b.admin.from('automation_execution_logs').select('result_error, result_data').eq('automation_rule_id', jeu.regles.F4.id);
    const texte = JSON.stringify(data);
    expect(texte).not.toMatch(/\+1\d{10}/);
  });

  it('[D-04] un DOUBLON écarté laisse une trace : l’événement est arrivé deux fois, la base doit le dire', async () => {
    const { data } = await b.admin.from('automation_execution_logs').select('result_success, result_data').eq('automation_rule_id', jeu.regles.X.id);
    const lignes = (data ?? []) as Array<{ result_success: boolean; result_data: Record<string, unknown> | null }>;
    // Un seul envoi : c'est voulu.
    expect(lignes.filter((l) => l.result_success && !l.result_data?.saute)).toHaveLength(1);
    // Mais le second passage n'existe nulle part (aujourd'hui : une seule ligne en tout).
    expect(lignes.filter((l) => l.result_data?.saute_code === 'doublon'), `lignes : ${JSON.stringify(lignes)}`).toHaveLength(1);
  });

  it('[D-05] un envoi REPORTÉ hors des heures d’envoi porte sa raison là où l’écran la lit (last_error de la tâche)', async () => {
    const { data } = await b.admin.from('automation_scheduled_tasks').select('status, last_error, action_config').eq('automation_rule_id', jeu.regles.H.id);
    expect(data).toHaveLength(1);
    const t = data![0] as { status: string; last_error: string | null; action_config: Record<string, unknown> };
    expect(t.status).toBe('pending');
    // Le moteur sait pourquoi (action_config.report_heures_calmes), mais l'Historique n'affiche que last_error.
    expect(t.action_config.report_heures_calmes).toBe(true);
    expect(String(t.last_error ?? ''), 'raison lisible du report').toMatch(/heures/i);
  });

  it('[D-06] « déclenchée » compte des DÉCLENCHEMENTS : le même client repassé deux fois compte deux fois', async () => {
    // Le doublon mis à part : un même prospect qui redéclenche une règle 10 jours plus tard est un 2e déclenchement.
    const s = jeu.regles.S;
    const client = s.clients[0].id;
    const { data: modele } = await b.admin.from('automation_execution_logs').select('*').eq('automation_rule_id', s.id).eq('entity_id', client).single();
    const { id: _id, created_at: _c, execution_key: _k, ...copie } = modele as Record<string, unknown>;
    const quand = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const { data: ajout, error } = await b.admin.from('automation_execution_logs').insert({ ...copie, created_at: quand, execution_key: null }).select('id').single();
    if (error) throw new Error(error.message);
    try {
      const { calculerStatistiques } = await import('../../../../server/routes/automation-stats');
      const { par_regle } = await calculerStatistiques(clientA, b.orgA, s.id);
      // 5 passages dans la fenêtre + ce 6e : la route en rend 5 (elle compte des fiches distinctes).
      expect(par_regle[s.id].envoyes).toBe(s.attendu.stats60.envoyes + 1);
      expect(par_regle[s.id].declenches, '« Total déclenché » après un 2e passage du même client').toBe(s.attendu.stats60.declenches + 1);
    } finally {
      await b.admin.from('automation_execution_logs').delete().eq('id', (ajout as { id: string }).id);
    }
  });
});
