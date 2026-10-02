/**
 * Agent S — les statistiques, l'Historique et les Journaux restent JUSTES sur les deux formats :
 *   · l'ANCIEN moteur : plafond de fréquence écrit en échec, report et annulation sans ligne de
 *     journal (la tâche seule les porte), aucune trace d'un doublon ;
 *   · le moteur CORRIGÉ (un autre agent y travaille) : une ligne de journal avec un code
 *     (`result_data.saute_code`) pour chaque issue — plafond_frequence, hors_heures, rafale,
 *     condition_plus_valide, entite_supprimee, fiche_fusionnee, etape_retiree, regle_inactive,
 *     une_fois_par_client, doublon, sans_cible, avis_desactives, sans_lien_avis — et, sur une
 *     tâche annulée ou reportée, `action_config.motif_code`.
 *
 * Les lignes sont POSÉES en base (bureau B (d)) au format de chaque moteur : ce fichier ne prouve
 * pas ce que le moteur écrit (c'est le travail de l'agent du moteur), il prouve que la lecture ne
 * compte rien deux fois et ne perd rien, quel que soit le format.
 *
 * Lectures avec le jeton du propriétaire B (la RLS s'applique).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { demarrerMoteur } from '../../../automations-suite/harnais/moteur';
import { sessionDe, COMPTES } from '../../../automations-suite/harnais/bureau-test';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
let clientB: SupabaseClient;
const regles: Record<string, string> = {};
const MAINTENANT = Date.now();
const ilYA = (minutes: number) => new Date(MAINTENANT - minutes * 60_000).toISOString();

interface Ligne {
  regle: string; entite?: string; action?: string; succes?: boolean; erreur?: string | null; data?: Record<string, unknown> | null;
  tache?: string | null; quand?: string; evenement?: string; cle?: string | null;
}
const journal: Array<Record<string, unknown>> = [];
const file: Array<Record<string, unknown>> = [];

function ligne(l: Ligne): string {
  const entite = l.entite ?? randomUUID();
  journal.push({
    org_id: b.orgB, automation_rule_id: regles[l.regle], trigger_event: l.evenement ?? 'lead.created', entity_type: 'client', entity_id: entite,
    action_type: l.action ?? 'send_sms', action_config: { body: 'Bonjour.' }, result_success: l.succes ?? true,
    result_data: l.data === undefined ? { to: '+15145550199', body: 'Bonjour.' } : l.data, result_error: l.erreur ?? null,
    duration_ms: 12, scheduled_task_id: l.tache ?? null, created_at: l.quand ?? ilYA(60), execution_key: l.cle ?? null,
  });
  return entite;
}
const ignoree = (regle: string, code: string, plus: Partial<Ligne> = {}) =>
  ligne({ regle, data: { saute: `Phrase du moteur pour ${code}`, saute_code: code }, ...plus });

function tache(t: { regle: string; entite?: string; statut: string; config?: Record<string, unknown>; quand?: string; fin?: string | null; erreur?: string | null; etape?: string | null; contexte?: Record<string, unknown> | null; tentatives?: number }): { id: string; entite: string } {
  const id = randomUUID();
  const entite = t.entite ?? randomUUID();
  file.push({
    id, org_id: b.orgB, automation_rule_id: regles[t.regle], entity_type: 'client', entity_id: entite,
    action_config: { type: 'send_sms', config: { body: 'Bonjour.' }, ...(t.config ?? {}) },
    execute_at: new Date(MAINTENANT + 3_600_000).toISOString(), status: t.statut, execution_key: `qa-s:${id}`,
    attempts: t.tentatives ?? 0, last_error: t.erreur ?? null, created_at: t.quand ?? ilYA(60),
    completed_at: t.fin === undefined ? (['completed', 'failed', 'cancelled'].includes(t.statut) ? (t.quand ?? ilYA(60)) : null) : t.fin,
    step_id: t.etape ?? null, sequence_context: t.contexte ?? null,
  });
  return { id, entite };
}

beforeAll(async () => {
  b = await demarrerMoteur();
  const { jeton } = await sessionDe(b.admin, COMPTES.proprioB.email);
  const { buildSupabaseWithAuth } = await import('../../../../server/lib/supabase');
  clientB = buildSupabaseWithAuth(`Bearer ${jeton}`, b.orgB);

  await b.admin.from('automation_rules').delete().eq('org_id', b.orgB).like('name', '[QA-S format]%');
  for (const cle of ['ignorees', 'reports', 'annulations', 'echecs', 'parcours']) {
    const { data, error } = await b.admin.from('automation_rules').insert({
      org_id: b.orgB, name: `[QA-S format] ${cle}`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: false, is_preset: false,
      actions: [{ type: 'send_sms', config: { body: 'Bonjour.', type_envoi: 'transactionnel' } }],
      ...(cle === 'parcours' ? { steps: [
        { id: 'e1', type: 'action', nom: 'Premier courriel', action: { type: 'send_email', config: { subject: 'Bonjour', body: 'Bonjour.' } }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Suite.' } }, suivant: null },
      ] } : {}),
    }).select('id').single();
    if (error) throw new Error(error.message);
    regles[cle] = data.id as string;
  }

  // ── 1. Les envois IGNORÉS, anciens et nouveaux codes ──────────────────────
  ignoree('ignorees', 'plafond_frequence');
  ignoree('ignorees', 'plafond_frequence');
  // Ancien moteur : le plafond écrit comme un ÉCHEC, le numéro du client dans le texte.
  ligne({ regle: 'ignorees', succes: false, data: null, erreur: 'Frequency cap reached for +15145550123 (max 3 commercial messages / 24h) — skipped to avoid spamming' });
  // Un envoi parti, puis le même événement reçu une 2e fois 30 secondes après : UN déclenchement.
  const double = ligne({ regle: 'ignorees', quand: ilYA(50) });
  ignoree('ignorees', 'doublon', { entite: double, quand: new Date(Date.parse(ilYA(50)) + 30_000).toISOString() });
  ignoree('ignorees', 'sans_cible', { action: 'move_deal_stage' });
  ignoree('ignorees', 'avis_desactives', { action: 'request_review' });
  ignoree('ignorees', 'sans_lien_avis', { action: 'request_review' });
  // Écartés AVANT d'entrer : ignorés, pas déclenchés.
  ignoree('ignorees', 'une_fois_par_client', { action: 'conditions' });
  ignoree('ignorees', 'hors_ciblage', { action: 'conditions' });
  // Un code que le fichier des motifs ne connaît pas encore.
  ignoree('ignorees', 'code_de_demain');

  // ── 2. Les REPORTS ────────────────────────────────────────────────────────
  // Moteur corrigé : une ligne au premier report + la tâche en attente → UN report, pas deux.
  const r1 = tache({ regle: 'reports', statut: 'pending', config: { report_heures_calmes: true }, quand: ilYA(40) });
  ignoree('reports', 'hors_heures', { entite: r1.entite, quand: ilYA(40) });
  // Moteur corrigé, rafale : la tâche porte le code, la ligne porte la tâche.
  const r2 = tache({ regle: 'reports', statut: 'pending', config: { motif_code: 'rafale' }, quand: ilYA(39) });
  ignoree('reports', 'rafale', { entite: r2.entite, tache: r2.id, quand: ilYA(38), evenement: 'scheduled' });
  // Ancien moteur : aucune ligne, la tâche seule sait qu'elle a été reportée.
  tache({ regle: 'reports', statut: 'pending', config: { report_heures_calmes: true }, quand: ilYA(37) });
  // Ancien moteur, report déjà parti : la tâche est terminée, son envoi est au journal.
  const r4 = tache({ regle: 'reports', statut: 'completed', config: { report_heures_calmes: true }, quand: ilYA(600), fin: ilYA(30) });
  ligne({ regle: 'reports', entite: r4.entite, tache: r4.id, quand: ilYA(30), evenement: 'scheduled' });

  // ── 3. Les ANNULATIONS ────────────────────────────────────────────────────
  // Ancien moteur : la tâche annulée, un motif en phrase, aucune ligne.
  tache({ regle: 'annulations', statut: 'cancelled', erreur: 'Annulée : le client a répondu.', quand: ilYA(300), fin: ilYA(20) });
  // Moteur corrigé : tâche (code) + ligne (code, rattachée à la tâche) → UNE annulation.
  const a2 = tache({ regle: 'annulations', statut: 'cancelled', config: { motif_code: 'etape_retiree' }, quand: ilYA(300), fin: ilYA(19) });
  ignoree('annulations', 'etape_retiree', { entite: a2.entite, tache: a2.id, quand: ilYA(19), evenement: 'scheduled' });
  // Moteur corrigé, ligne NON rattachée à la tâche (même fiche, même minute) → UNE annulation.
  const a3 = tache({ regle: 'annulations', statut: 'cancelled', quand: ilYA(300), fin: ilYA(18) });
  ignoree('annulations', 'condition_plus_valide', { entite: a3.entite, quand: ilYA(18), evenement: 'scheduled' });
  const a4 = tache({ regle: 'annulations', statut: 'cancelled', config: { motif_code: 'entite_supprimee' }, quand: ilYA(300), fin: ilYA(17) });
  ignoree('annulations', 'entite_supprimee', { entite: a4.entite, tache: a4.id, quand: ilYA(17), evenement: 'scheduled' });

  // ── 4. Les ÉCHECS : définitifs, repris, interrompus ───────────────────────
  // Échec immédiat définitif (aucune reprise).
  ligne({ regle: 'echecs', succes: false, data: null, erreur: 'No recipient phone' });
  // Réservation du moteur : « en cours » depuis 1 minute (pas un résultat), et depuis 20 minutes (interrompue).
  ligne({ regle: 'echecs', succes: false, data: null, erreur: 'en cours', quand: ilYA(1) });
  ligne({ regle: 'echecs', succes: false, data: null, erreur: 'en cours', quand: ilYA(20) });
  // Une tâche menée au bout : 3 lignes en échec, UN échec.
  const e1 = tache({ regle: 'echecs', statut: 'failed', quand: ilYA(200), fin: ilYA(15), tentatives: 3, erreur: 'Twilio 30007' });
  for (const m of [100, 60, 15]) ligne({ regle: 'echecs', entite: e1.entite, tache: e1.id, succes: false, data: null, erreur: 'Twilio 30007', quand: ilYA(m), evenement: 'scheduled' });
  // Une tâche en échec puis réussie à la reprise : aucun échec, un envoi.
  const e2 = tache({ regle: 'echecs', statut: 'completed', quand: ilYA(200), fin: ilYA(14), tentatives: 2 });
  ligne({ regle: 'echecs', entite: e2.entite, tache: e2.id, succes: false, data: null, erreur: 'Twilio 20429', quand: ilYA(90), evenement: 'scheduled' });
  ligne({ regle: 'echecs', entite: e2.entite, tache: e2.id, quand: ilYA(14), evenement: 'scheduled' });
  // Un échec immédiat passager, sa reprise encore en file : pas (encore) un échec.
  const cle = `${regles.echecs}:${randomUUID()}:0`;
  const e3 = ligne({ regle: 'echecs', succes: false, data: null, erreur: 'Twilio 20429', quand: ilYA(5), cle: `${cle}@123` });
  file.push({
    id: randomUUID(), org_id: b.orgB, automation_rule_id: regles.echecs, entity_type: 'client', entity_id: e3,
    action_config: { type: 'send_sms', config: { body: 'Bonjour.' }, reprise_immediate: true, reprise_depuis: ilYA(6) },
    execute_at: new Date(MAINTENANT + 300_000).toISOString(), status: 'pending', execution_key: cle, attempts: 1,
    last_error: 'Twilio 20429 — reprise 1/4 dans 5 min', created_at: ilYA(5), completed_at: null, step_id: null, sequence_context: null,
  });

  // ── 5. Un PARCOURS : deux étapes, deux clients ────────────────────────────
  for (const etat of ['fini', 'en_route'] as const) {
    const p1 = tache({ regle: 'parcours', statut: 'completed', etape: 'e1', contexte: { franchies: 1 }, config: { type: 'send_email' }, quand: ilYA(500), fin: ilYA(499) });
    ligne({ regle: 'parcours', entite: p1.entite, tache: p1.id, action: 'send_email', data: { to: 'a@lume-qa.test', subject: 'Bonjour' }, quand: ilYA(499), evenement: 'scheduled' });
    const p2 = tache({ regle: 'parcours', entite: p1.entite, statut: etat === 'fini' ? 'completed' : 'pending', etape: 'e2', contexte: { franchies: 2 }, quand: ilYA(498), fin: etat === 'fini' ? ilYA(10) : null });
    if (etat === 'fini') ligne({ regle: 'parcours', entite: p1.entite, tache: p2.id, quand: ilYA(10), evenement: 'scheduled' });
  }

  const eFile = await b.admin.from('automation_scheduled_tasks').insert(file);
  if (eFile.error) throw new Error(`file : ${eFile.error.message}`);
  const eJournal = await b.admin.from('automation_execution_logs').insert(journal);
  if (eJournal.error) throw new Error(`journal : ${eJournal.error.message}`);
});

afterAll(async () => {
  const ids = Object.values(regles);
  if (!ids.length) return;
  await b.admin.from('automation_execution_logs').delete().in('automation_rule_id', ids);
  await b.admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', ids);
  await b.admin.from('automation_rules').delete().in('id', ids);
});

async function stats(cle: string) {
  const { calculerStatistiques } = await import('../../../../server/lib/automations-stats');
  const s = await calculerStatistiques(clientB, b.orgB, regles[cle], { jours: 7 });
  return s.par_regle[regles[cle]];
}

describe('S — les envois ignorés, anciens et nouveaux formats', () => {
  it('[S-F-01] le plafond de fréquence est IGNORÉ sous ses deux écritures (nouveau code, ancien « Frequency cap reached » en échec)', async () => {
    const s = await stats('ignorees');
    expect(s.ignorees_par_code.plafond_frequence).toBe(3);
    expect(s.ignorees_par_groupe.plafond).toBe(3);
    expect(s.echouees, 'aucun échec').toBe(0);
  });

  it('[S-F-02] un doublon tracé ne fait pas un 2e déclenchement ; les événements écartés à l’entrée ne sont pas des déclenchements', async () => {
    const s = await stats('ignorees');
    // 2 plafonds + 1 ancien plafond + 1 envoi (et son doublon) + sans_cible + avis_desactives + sans_lien_avis + code inconnu.
    expect(s.declenchees).toBe(8);
    expect(s.envoyees).toBe(1);
  });

  it('[S-F-03] chaque code tombe dans son groupe ; un code inconnu est « autre », jamais perdu', async () => {
    const s = await stats('ignorees');
    expect(s.ignorees).toBe(10);
    expect(s.ignorees_par_groupe).toEqual({ plafond: 3, doublon: 2, donnee_manquante: 3, hors_ciblage: 1, autre: 1 });
    expect(s.ignorees_par_code).toMatchObject({ doublon: 1, une_fois_par_client: 1, sans_cible: 1, avis_desactives: 1, sans_lien_avis: 1, hors_ciblage: 1, code_de_demain: 1 });
  });
});

describe('S — les reports : jamais comptés deux fois, jamais des envois ignorés', () => {
  it('[S-F-04] ligne + tâche (moteur corrigé) = UN report ; tâche seule (ancien moteur) = un report ; report déjà parti = un report ET un envoi', async () => {
    const s = await stats('reports');
    expect(s.reportees_par_code).toEqual({ hors_heures: 3, rafale: 1 });
    expect(s.reportees).toBe(4);
    expect({ ignorees: s.ignorees, echouees: s.echouees, envoyees: s.envoyees }).toEqual({ ignorees: 0, echouees: 0, envoyees: 1 });
    expect({ declenchees: s.declenchees, en_cours: s.en_cours }).toEqual({ declenchees: 4, en_cours: 3 });
  });
});

describe('S — les annulations : « condition plus valide »', () => {
  it('[S-F-05] tâche annulée sans ligne (ancien moteur), avec ligne rattachée, avec ligne non rattachée : UNE annulation chacune', async () => {
    const s = await stats('annulations');
    expect({ ignorees: s.ignorees, annulees: s.annulees }).toEqual({ ignorees: 4, annulees: 4 });
    expect(s.ignorees_par_groupe).toEqual({ condition_plus_valide: 4 });
    expect(s.ignorees_par_code).toEqual({ annulee: 1, etape_retiree: 1, condition_plus_valide: 1, entite_supprimee: 1 });
    expect(s.dernier_ignore?.issue).toBe('entite_supprimee');
  });

  it('[S-F-06] l’Historique dit la raison de chaque annulation, en français et en anglais', async () => {
    const { lirePassages } = await import('../../../../server/lib/automations-stats');
    const { resultatLisible } = await import('../../../../src/lib/automationIssues');
    const page = await lirePassages(clientB, b.orgB, { ruleId: regles.annulations, jours: 7 });
    expect(page.total).toBe(4);
    expect(page.passages.every((p) => p.resultat === 'annulee')).toBe(true);
    const phrases = (fr: boolean) => page.passages.map((p) => {
      const e = p.evenements.filter((x) => x.categorie === 'annulee').pop()!; // `!` : le résultat est « annulee », l'événement existe.
      return resultatLisible(e, fr);
    }).sort();
    // En français, la phrase du moteur (quand il en a écrit une) précise le libellé du code ;
    // l'ancienne tâche annulée sans code retrouve le sien par sa phrase (« Annulée : le client a répondu. »).
    expect(phrases(true)).toEqual([
      'Annulé : le client a répondu', 'Annulé : phrase du moteur pour condition_plus_valide',
      'Annulé : phrase du moteur pour entite_supprimee', 'Annulé : phrase du moteur pour etape_retiree',
    ].sort());
    expect(phrases(false)).toEqual([
      'Cancelled: the client replied', 'Cancelled: the record was deleted', 'Cancelled: the situation changed since it was triggered',
      'Cancelled: the step was removed from the workflow',
    ].sort());
  });
});

describe('S — les échecs : définitifs seulement', () => {
  it('[S-F-07] 1 échec immédiat + 1 réservation interrompue + 1 tâche menée au bout (3 lignes) = 3 ; repris ou encore en reprise = 0', async () => {
    const s = await stats('echecs');
    expect(s.echouees).toBe(3);
    expect(s.envoyees, 'l’envoi réussi à la reprise').toBe(1);
    // 6 entrées : échec immédiat, 2 réservations, 2 tâches, échec passager (sa reprise n'est pas une entrée).
    expect({ declenchees: s.declenchees, en_cours: s.en_cours }).toEqual({ declenchees: 6, en_cours: 1 });
  });

  it('[S-F-08] les Journaux montrent CHAQUE ligne, et le filtre « Échoués » les seuls échecs définitifs', async () => {
    const { lireJournal } = await import('../../../../server/lib/automations-stats');
    const tout = await lireJournal(clientB, b.orgB, { ruleId: regles.echecs, jours: 7 });
    // 9 lignes de journal + la reprise en file.
    expect(tout.total).toBe(10);
    const par = (statut: 'echoues' | 'tentatives' | 'en_cours' | 'reussis') => lireJournal(clientB, b.orgB, { ruleId: regles.echecs, jours: 7, statut }).then((p) => p.total);
    expect({ echoues: await par('echoues'), tentatives: await par('tentatives'), en_cours: await par('en_cours'), reussis: await par('reussis') })
      .toEqual({ echoues: 3, tentatives: 3, en_cours: 3, reussis: 1 });
    const issues = tout.lignes.map((l) => l.issue).sort();
    expect(issues).toEqual(['echec', 'echec', 'echec_repris', 'en_attente', 'en_cours', 'en_reprise', 'fait', 'interrompue', 'tentative', 'tentative']);
  });
});

describe('S — un parcours : une ligne d’Historique par client, les étapes par leur nom', () => {
  it('[S-F-09] deux clients = deux déclenchements et deux passages ; l’un est fini, l’autre attend son étape 2', async () => {
    const s = await stats('parcours');
    expect({ declenchees: s.declenchees, envoyees: s.envoyees, en_cours: s.en_cours }).toEqual({ declenchees: 2, envoyees: 3, en_cours: 1 });
    const { lirePassages } = await import('../../../../server/lib/automations-stats');
    const page = await lirePassages(clientB, b.orgB, { ruleId: regles.parcours, jours: 7 });
    expect(page.total).toBe(2);
    expect(page.passages.map((p) => p.resultat).sort()).toEqual(['en_cours', 'envoyee']);
    const enRoute = page.passages.find((p) => p.resultat === 'en_cours')!; // `!` : vérifié à la ligne du dessus.
    expect(enRoute.evenements.map((e) => [e.step_id, e.etape_position, e.etape_nom, e.issue])).toEqual([
      ['e1', 1, 'Premier courriel', 'fait'],
      ['e2', 2, null, 'en_attente'],
    ]);
    expect(enRoute.evenements[1].execute_at, 'la date prévue de l’étape à venir').toBeTruthy();
  });
});
