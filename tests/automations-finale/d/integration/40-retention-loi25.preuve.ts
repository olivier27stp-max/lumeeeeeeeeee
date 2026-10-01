/**
 * Agent D — point 5 de la mission (rétention, Loi 25).
 *
 * Ce que les journaux gardent d'un client (numéro, adresse, corps du message), combien de
 * temps, et ce qu'il en reste quand le client exerce son droit à l'effacement.
 *
 * La base est lue directement (catalogue PostgreSQL) pour savoir ce qui est purgé : une purge
 * qu'on lancerait ici toucherait les données antidatées des autres agents de l'atelier.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { demarrerMoteur, attendre, journalDefinitif } from '../../../automations-suite/harnais/moteur';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
let sql: pg.Client;
const regles: string[] = [];

beforeAll(async () => {
  b = await demarrerMoteur();
  sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
  await sql.connect();
});

afterAll(async () => {
  if (regles.length) {
    await b.admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', regles);
    await b.admin.from('automation_execution_logs').delete().in('automation_rule_id', regles);
    await b.admin.from('automation_rules').delete().in('id', regles);
  }
  await sql?.end();
});

/** Les tables que la purge planifiée `run_retention_logs` vide, avec leur durée. */
async function tablesPurgees(): Promise<Record<string, string>> {
  const { rows } = await sql.query<{ def: string }>("select pg_get_functiondef('public.run_retention_logs'::regproc) as def");
  const durees: Record<string, string> = {};
  for (const m of rows[0].def.matchAll(/\['(\w+)',\s*'\w+',\s*'([^']+)'\]/g)) durees[m[1]] = m[2];
  return durees;
}

describe('D — rétention des journaux d’automatisation', () => {
  it('[D-RET-01] état des lieux : les journaux d’exécution sont purgés après 90 jours (fonction run_retention_logs)', async () => {
    expect((await tablesPurgees()).automation_execution_logs).toBe('90 days');
  });

  it('[D-07] la FILE (automation_scheduled_tasks) a une durée de conservation : ses tâches closes sont purgées', async () => {
    // Elle porte le gabarit du message, les métadonnées de l'événement et, dans last_error, le numéro du client.
    const durees = await tablesPurgees();
    const { rows } = await sql.query<{ n: string }>(
      "select count(*)::text as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ~ 'delete\\s+from\\s+(public\\.)?automation_scheduled_tasks'",
    );
    expect({ dans_la_purge_planifiee: 'automation_scheduled_tasks' in durees, autre_fonction_de_purge: Number(rows[0].n) > 0 },
      `tables purgées aujourd'hui : ${JSON.stringify(durees)}`).not.toEqual({ dans_la_purge_planifiee: false, autre_fonction_de_purge: false });
  });

  it('[D-07b] le bac à sable (envois_simules : destinataire, sujet, corps) a une durée de conservation', async () => {
    const durees = await tablesPurgees();
    const { rows } = await sql.query<{ n: string }>(
      "select count(*)::text as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ~ 'delete\\s+from\\s+(public\\.)?envois_simules'",
    );
    expect('envois_simules' in durees || Number(rows[0].n) > 0, `tables purgées aujourd'hui : ${JSON.stringify(durees)}`).toBe(true);
  });

  it('[D-RET-02] la fenêtre affichée (60 jours) est plus courte que la conservation (90 jours) : 30 jours de journaux gardés sans être consultables', async () => {
    const { FENETRE_JOURS } = await import('../../../../src/lib/automationJournauxApi');
    const conservation = Number.parseInt((await tablesPurgees()).automation_execution_logs, 10);
    // État des lieux, pas un défaut en soi : à trancher (afficher 90 jours, ou purger à 60).
    expect({ affiche: FENETRE_JOURS, conserve: conservation }).toEqual({ affiche: 60, conserve: 90 });
  });
});

describe('D — droit à l’effacement (Loi 25) : ce qu’il reste d’un client dans les journaux', () => {
  it('[D-08] après l’effacement d’un client, ni son numéro ni son adresse ne restent dans les journaux, la file et le bac à sable', async () => {
    const marque = Date.now().toString(36);
    const telephone = `+1${300 + Math.floor(Math.random() * 600)}55501${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
    const courriel = `efface-${marque}@lume-qa.test`;
    const { data: client, error: eClient } = await b.admin.from('clients').insert({
      org_id: b.orgA, created_by: b.users.proprioA, first_name: 'Jeu', last_name: `Efface ${marque}`, status: 'lead',
      phone: telephone, email: courriel, sms_consent_at: new Date().toISOString(), email_consent_at: new Date().toISOString(),
    }).select('id').single();
    if (eClient) throw new Error(eClient.message);
    const clientId = client.id as string;

    const { data: regle, error: eRegle } = await b.admin.from('automation_rules').insert({
      org_id: b.orgA, name: `[QA-D effacement] ${marque}`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: true, is_preset: false,
      actions: [
        { type: 'send_sms', config: { body: 'Bonjour [client_first_name] [client_last_name], merci.', type_envoi: 'transactionnel' } },
        { type: 'send_email', config: { subject: 'Votre demande', body: 'Bonjour [client_first_name] [client_last_name].', type_envoi: 'transactionnel' } },
      ],
    }).select('id').single();
    if (eRegle) throw new Error(eRegle.message);
    const ruleId = regle.id as string;
    regles.push(ruleId);

    await b.eventBus.emit('lead.created', { orgId: b.orgA, entityType: 'client', entityId: clientId, metadata: { source: 'manuel' } });
    const lignes = await attendre(
      async () => (await b.admin.from('automation_execution_logs').select('id, result_error, result_data').eq('automation_rule_id', ruleId)).data ?? [],
      (l) => l.length >= 2 && l.every((x) => journalDefinitif(x.result_error as string | null)), 45_000,
    );
    await b.admin.from('automation_rules').update({ is_active: false }).eq('id', ruleId);
    // Avant l'effacement : le journal porte bien les coordonnées (c'est ce que l'onglet Journaux affiche).
    expect(JSON.stringify(lignes)).toContain(telephone);
    expect(JSON.stringify(lignes)).toContain(courriel);

    // L'effacement, tel que le fait POST /api/dsr/erase/client/:id (rôle de service).
    const { error: eEfface } = await b.admin.rpc('anonymize_client', { p_client_id: clientId });
    if (eEfface) throw new Error(eEfface.message);
    const { data: fiche } = await b.admin.from('clients').select('first_name, phone, email').eq('id', clientId).single();
    expect(fiche).toMatchObject({ first_name: 'ANONYMIZED', phone: null, email: null });

    const reste: Record<string, number> = {};
    const contient = (lignesTable: unknown) => {
      const t = JSON.stringify(lignesTable ?? []);
      return (t.includes(telephone) ? 1 : 0) + (t.includes(courriel) ? 1 : 0);
    };
    reste.automation_execution_logs = contient((await b.admin.from('automation_execution_logs').select('result_data, result_error, action_config').eq('automation_rule_id', ruleId)).data);
    reste.automation_scheduled_tasks = contient((await b.admin.from('automation_scheduled_tasks').select('action_config, last_error, sequence_context').eq('automation_rule_id', ruleId)).data);
    reste.envois_simules = contient((await b.admin.from('envois_simules').select('destinataire, corps, sujet, meta').eq('org_id', b.orgA).or(`destinataire.eq.${telephone},destinataire.eq.${courriel}`)).data);
    expect(reste, 'coordonnées du client encore présentes après l’effacement (nombre de coordonnées retrouvées par table)').toEqual({
      automation_execution_logs: 0, automation_scheduled_tasks: 0, envois_simules: 0,
    });
  });
});
