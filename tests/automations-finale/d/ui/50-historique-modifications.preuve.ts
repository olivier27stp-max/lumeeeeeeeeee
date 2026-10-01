/**
 * Agent D — point 5 : « Historique des modifications de chaque automatisation : qui a modifié
 * quoi et quand (utilisateur ou Lumi) ».
 *
 * On modifie une automatisation par les DEUX chemins qu'emprunte l'application :
 *   · l'API Express (PATCH /api/automations/rules/:id — l'éditeur) ;
 *   · PostgREST directement (c'est ce que fait la liste pour le texte d'un message,
 *     src/lib/automationRulesApi.ts → updateRuleMessage).
 * Puis on cherche une trace de la modification, partout où elle pourrait être.
 */
import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { sessionComplete, admin, fermerNavigateur, ouvrirOnglet } from '../../../automations-suite/harnais/navigateur';
import { COMPTES } from '../../../automations-suite/harnais/bureau-test';

let sql: pg.Client;
let orgA: string;
let jetonA: string;
let proprioA: string;
let ruleId: string;
let debut: string;
const AVANT = 'Bonjour, merci de votre demande.';
const APRES_API = 'Bonjour, nous vous rappelons demain.';
const APRES_REST = 'Bonjour, nous vous rappelons lundi.';

beforeAll(async () => {
  orgA = inject('uiOrgA');
  const session = await sessionComplete(COMPTES.proprioA.email);
  jetonA = session.access_token;
  proprioA = session.user.id;
  sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
  await sql.connect();
  const { data, error } = await admin.from('automation_rules').insert({
    org_id: orgA, name: `[QA-D modif] ${Date.now().toString(36)}`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0,
    is_active: false, is_preset: false, actions: [{ type: 'send_sms', config: { body: AVANT, type_envoi: 'transactionnel' } }],
  }).select('id').single();
  if (error) throw new Error(error.message);
  ruleId = data.id as string;
  debut = new Date(Date.now() - 2000).toISOString();
});

afterAll(async () => {
  if (ruleId) await admin.from('automation_rules').delete().eq('id', ruleId);
  await sql?.end();
  await fermerNavigateur();
});

/** Toute ligne, dans toute table de la base, écrite depuis `debut` et qui cite la règle. */
async function traces(): Promise<Array<{ table: string; n: number }>> {
  const { rows: tables } = await sql.query<{ table_name: string }>(
    `select c.table_name from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'created_at'
        and c.table_name not in ('automation_rules')`,
  );
  const trouvees: Array<{ table: string; n: number }> = [];
  for (const { table_name } of tables) {
    const { rows } = await sql.query<{ n: string }>(
      `select count(*)::text as n from public."${table_name}" t where t.created_at >= $1 and to_jsonb(t)::text like $2`,
      [debut, `%${ruleId}%`],
    );
    if (Number(rows[0].n) > 0) trouvees.push({ table: table_name, n: Number(rows[0].n) });
  }
  return trouvees;
}

describe('D — historique des modifications d’une automatisation', () => {
  it('[D-EL-30] les deux chemins modifient bien la règle (API, puis PostgREST)', async () => {
    const parApi = await fetch(`${inject('uiApi')}/api/automations/rules/${ruleId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${jetonA}`, 'x-org-id': orgA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: [{ type: 'send_sms', config: { body: APRES_API, type_envoi: 'transactionnel' } }] }),
    });
    expect(parApi.status, await parApi.clone().text()).toBe(200);
    const apresApi = await admin.from('automation_rules').select('actions').eq('id', ruleId).single();
    expect(JSON.stringify(apresApi.data?.actions)).toContain(APRES_API);

    const rest = createClient(process.env.VITE_SUPABASE_URL ?? '', process.env.VITE_SUPABASE_ANON_KEY ?? '', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jetonA}`, 'x-lume-org': orgA } },
    });
    const parRest = await rest.from('automation_rules')
      .update({ actions: [{ type: 'send_sms', config: { body: APRES_REST, type_envoi: 'transactionnel' } }] })
      .eq('id', ruleId).select('id');
    expect(parRest.data ?? [], parRest.error?.message).toHaveLength(1);
    const apresRest = await admin.from('automation_rules').select('actions').eq('id', ruleId).single();
    expect(JSON.stringify(apresRest.data?.actions)).toContain(APRES_REST);
  });

  it('[D-20] chaque modification laisse une trace : qui (propriétaire A), quoi (ancien et nouveau texte), quand', async () => {
    const trouvees = await traces();
    // Aujourd'hui : aucune table ne garde quoi que ce soit — seul automation_rules.updated_at bouge.
    expect(trouvees.length, `tables portant une trace de la règle depuis la modification : ${JSON.stringify(trouvees)}`).toBeGreaterThan(0);
    const { rows } = await sql.query<{ texte: string }>(
      `select to_jsonb(t)::text as texte from public."${trouvees[0].table}" t where t.created_at >= $1 and to_jsonb(t)::text like $2`,
      [debut, `%${ruleId}%`],
    );
    const tout = rows.map((r) => r.texte).join('\n');
    expect(tout, 'auteur de la modification').toContain(proprioA);
    expect(tout, 'ancien texte').toContain(AVANT);
    expect(tout, 'nouveau texte').toContain(APRES_REST);
  });

  it('[D-20b] l’éditeur offre un écran où lire ces modifications', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      await o.page.goto(`${o.base}/automations/${ruleId}`);
      await o.page.getByRole('tab', { name: 'Journaux', exact: true }).waitFor();
      const onglets = (await o.page.getByRole('tab').allInnerTexts()).map((t) => t.trim());
      const corps = (await o.page.locator('body').innerText()).replace(/\s+/g, ' ');
      expect(onglets.some((t) => /modification|versions?|activité/i.test(t)) || /modifié(e)? par/i.test(corps),
        `onglets de l'éditeur : ${onglets.join(', ')}`).toBe(true);
    } finally {
      await o.fermer();
    }
  });
});
