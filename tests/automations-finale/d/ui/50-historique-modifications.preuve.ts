/**
 * Agent D, puis agent S — point 5 : « Historique des modifications de chaque automatisation :
 * qui a modifié quoi et quand (utilisateur ou Lumi) ».
 *
 * Ce qui est bâti (agent S) et prouvé ici, sur la pile locale :
 *   · la table `automation_rule_modifications` (migration proposée S-02) et sa RLS ;
 *   · `journaliserModification()` (server/lib/automations-modifications.ts) : qui, quoi, quand ;
 *   · la route `GET /api/automations/rules/modifications` (jeton de l'utilisateur) ;
 *   · l'écran : onglet Historique de l'éditeur › « Modifications ».
 *
 * Ce qui RESTE À BRANCHER par le coordinateur (hors de la zone de l'agent S) : l'appel de
 * `journaliserModification()` dans les routes de `server/routes/automation-rules.ts`. Tant qu'il
 * ne l'est pas, la preuve [D-20] — une modification faite par l'API laisse une trace d'elle-même
 * — reste ROUGE, exprès : les endroits exacts sont dans D:/lume-final/notes/S-corrections.md.
 */
import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { sessionComplete, admin, fermerNavigateur, ouvrirOnglet } from '../../../automations-suite/harnais/navigateur';
import { COMPTES } from '../../../automations-suite/harnais/bureau-test';

let sql: pg.Client;
let orgA: string;
let orgB: string;
let jetonA: string;
let proprioA: string;
let ruleId: string;
let debut: string;
const AVANT = 'Bonjour, merci de votre demande.';
const APRES_API = 'Bonjour, nous vous rappelons demain.';
const APRES_REST = 'Bonjour, nous vous rappelons lundi.';
const texto = (body: string) => [{ type: 'send_sms', config: { body, type_envoi: 'transactionnel' } }];
const propre = (t: string | null | undefined) => String(t ?? '').replace(/\s+/g, ' ').trim();

const clientDe = (jeton: string, bureau: string) => createClient(process.env.VITE_SUPABASE_URL ?? '', process.env.VITE_SUPABASE_ANON_KEY ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${jeton}`, 'x-lume-org': bureau } },
});

beforeAll(async () => {
  orgA = inject('uiOrgA');
  orgB = inject('uiOrgB');
  const session = await sessionComplete(COMPTES.proprioA.email);
  jetonA = session.access_token;
  proprioA = session.user.id;
  sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
  await sql.connect();
  const { data, error } = await admin.from('automation_rules').insert({
    org_id: orgA, name: `[QA-D modif] ${Date.now().toString(36)}`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0,
    is_active: false, is_preset: false, actions: texto(AVANT),
  }).select('id').single();
  if (error) throw new Error(error.message);
  ruleId = data.id as string;
  debut = new Date(Date.now() - 2000).toISOString();
});

afterAll(async () => {
  // La règle emporte son historique (clé étrangère en cascade).
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

describe('D — historique des modifications : la trace laissée par l’application', () => {
  it('[D-EL-30] les deux chemins modifient bien la règle (API, puis PostgREST)', async () => {
    const parApi = await fetch(`${inject('uiApi')}/api/automations/rules/${ruleId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${jetonA}`, 'x-org-id': orgA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: texto(APRES_API) }),
    });
    expect(parApi.status, await parApi.clone().text()).toBe(200);
    const apresApi = await admin.from('automation_rules').select('actions').eq('id', ruleId).single();
    expect(JSON.stringify(apresApi.data?.actions)).toContain(APRES_API);

    const parRest = await clientDe(jetonA, orgA).from('automation_rules').update({ actions: texto(APRES_REST) }).eq('id', ruleId).select('id');
    expect(parRest.data ?? [], parRest.error?.message).toHaveLength(1);
    const apresRest = await admin.from('automation_rules').select('actions').eq('id', ruleId).single();
    expect(JSON.stringify(apresRest.data?.actions)).toContain(APRES_REST);
  });

  it('[D-20] À BRANCHER — une modification faite par l’API laisse d’elle-même une trace : qui (propriétaire A), quoi (ancien et nouveau texte), quand', async () => {
    const trouvees = await traces();
    // Rouge tant que `journaliserModification()` n'est pas appelée par server/routes/automation-rules.ts
    // (PATCH /automations/rules/:id) — voir notes/S-corrections.md, « où brancher ».
    expect(trouvees.map((t) => t.table), `tables portant une trace de la règle depuis la modification : ${JSON.stringify(trouvees)}`)
      .toContain('automation_rule_modifications');
    const { rows } = await sql.query<{ texte: string }>(
      'select to_jsonb(t)::text as texte from public.automation_rule_modifications t where t.created_at >= $1 and t.rule_id = $2', [debut, ruleId],
    );
    const tout = rows.map((r) => r.texte).join('\n');
    expect(tout, 'auteur de la modification').toContain(proprioA);
    expect(tout, 'ancien texte').toContain(AVANT);
    expect(tout, 'nouveau texte').toContain(APRES_API);
  });
});

describe('S — historique des modifications : la fonction, la table, la route, l’écran', () => {
  let ligne: { id: string } | null = null;

  it('[D-20a] `journaliserModification()` écrit qui, quoi (avant / après, les seuls champs changés) et quand, avec un résumé en deux langues', async () => {
    const { journaliserModification } = await import('../../../../server/lib/automations-modifications');
    const avant = { name: 'Relance', actions: texto(AVANT), is_active: false, delay_seconds: 0 };
    const apres = { name: 'Relance', actions: texto(APRES_REST), is_active: false, delay_seconds: 0 };
    ligne = await journaliserModification({ orgId: orgA, ruleId, auteurId: proprioA, origine: 'utilisateur', avant, apres }, admin);
    expect(ligne, 'une ligne a été écrite').not.toBeNull();
    // Lumi, à la demande du même utilisateur ; puis une publication.
    await journaliserModification({ orgId: orgA, ruleId, auteurId: proprioA, origine: 'lumi', avant: { ...apres, delay_seconds: 3 * 86_400 }, apres: { ...apres, delay_seconds: 5 * 86_400 } }, admin);
    await journaliserModification({ orgId: orgA, ruleId, auteurId: proprioA, origine: 'utilisateur', avant: apres, apres: { ...apres, is_active: true } }, admin);
    // Rien n'a changé : rien n'est écrit.
    expect(await journaliserModification({ orgId: orgA, ruleId, auteurId: proprioA, origine: 'utilisateur', avant: apres, apres }, admin)).toBeNull();

    const { rows } = await sql.query('select * from public.automation_rule_modifications where rule_id = $1 order by created_at', [ruleId]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      org_id: orgA, rule_id: ruleId, auteur_id: proprioA, origine: 'utilisateur', action: 'modification', champs: ['actions'],
      resume_fr: 'a changé le texte du texto de l’action', resume_en: 'changed the text message of the action',
    });
    expect(rows[0].auteur_nom, 'le nom de l’auteur au moment du geste').toBeTruthy();
    expect(JSON.stringify(rows[0].avant)).toContain(AVANT);
    expect(JSON.stringify(rows[0].apres)).toContain(APRES_REST);
    expect(Object.keys(rows[0].avant)).toEqual(['actions']);
    expect(new Date(rows[0].created_at).getTime()).toBeGreaterThan(Date.parse(debut));
    expect(rows[1]).toMatchObject({ origine: 'lumi', resume_fr: 'a changé le délai de 3 jours à 5 jours' });
    expect(rows[2]).toMatchObject({ action: 'publication', resume_fr: 'a publié' });
  });

  it('[D-20c] isolation : le propriétaire du bureau A lit ; ni le bureau B, ni un membre sans « Voir les automatisations », ni une session en écriture', async () => {
    const lecture = (c: ReturnType<typeof clientDe>) => c.from('automation_rule_modifications').select('id').eq('rule_id', ruleId);
    expect((await lecture(clientDe(jetonA, orgA))).data).toHaveLength(3);

    const jetonB = (await sessionComplete(COMPTES.proprioB.email)).access_token;
    expect((await lecture(clientDe(jetonB, orgB))).data ?? []).toEqual([]);
    expect((await lecture(clientDe(jetonB, orgA))).data ?? [], 'B se déclarant dans A').toEqual([]);
    const jetonTech = (await sessionComplete(COMPTES.techA.email)).access_token;
    expect((await lecture(clientDe(jetonTech, orgA))).data ?? [], 'technicien de A, sans le droit').toEqual([]);

    // Aucune écriture par une session : ni le propriétaire, ni personne.
    const a = clientDe(jetonA, orgA);
    const insertion = await a.from('automation_rule_modifications').insert({
      org_id: orgA, rule_id: ruleId, origine: 'utilisateur', action: 'modification', resume_fr: 'faux', resume_en: 'fake',
    });
    expect(insertion.error, 'insertion par une session').not.toBeNull();
    await a.from('automation_rule_modifications').update({ resume_fr: 'réécrit' }).eq('rule_id', ruleId);
    await a.from('automation_rule_modifications').delete().eq('rule_id', ruleId);
    const { rows } = await sql.query('select resume_fr from public.automation_rule_modifications where rule_id = $1', [ruleId]);
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.resume_fr === 'réécrit')).toBe(false);
    // Sans session du tout.
    const anonyme = createClient(process.env.VITE_SUPABASE_URL ?? '', process.env.VITE_SUPABASE_ANON_KEY ?? '', { auth: { persistSession: false } });
    expect((await anonyme.from('automation_rule_modifications').select('id').limit(1)).data ?? []).toEqual([]);
  });

  it('[D-20d] la route rend les modifications au propriétaire A, la plus récente d’abord — et rien au bureau B', async () => {
    const lire = async (jeton: string, bureau: string) => fetch(`${inject('uiApi')}/api/automations/rules/modifications?rule_id=${ruleId}`, {
      headers: { Authorization: `Bearer ${jeton}`, 'x-org-id': bureau },
    });
    const r = await lire(jetonA, orgA);
    expect(r.status).toBe(200);
    const page = await r.json() as { total: number; lignes: Array<{ resume_fr: string; origine: string }> };
    expect(page.total).toBe(3);
    expect(page.lignes.map((l) => l.resume_fr)).toEqual(['a publié', 'a changé le délai de 3 jours à 5 jours', 'a changé le texte du texto de l’action']);
    const jetonB = (await sessionComplete(COMPTES.proprioB.email)).access_token;
    const b = await lire(jetonB, orgB);
    expect(b.status).toBe(200);
    expect((await b.json() as { total: number }).total).toBe(0);
    expect((await lire(jetonB, orgA)).status, 'B demandant le bureau A').toBe(403);
    const tech = await lire((await sessionComplete(COMPTES.techA.email)).access_token, orgA);
    expect(tech.status, 'technicien de A, sans le droit').toBe(403);
  });

  it('[D-20b] l’éditeur offre un écran où lire ces modifications : Historique › Modifications', async () => {
    for (const langue of ['fr', 'en'] as const) {
      const o = await ouvrirOnglet({ langue });
      try {
        const frn = langue === 'fr';
        await o.page.goto(`${o.base}/automations/${ruleId}`);
        await o.page.getByRole('tab', { name: frn ? 'Historique' : 'Enrollment history', exact: true }).click();
        await o.page.getByRole('tab', { name: frn ? 'Modifications' : 'Changes', exact: true }).click();
        await o.page.locator('.section-card ul li').first().waitFor();
        const lignes = (await o.page.locator('.section-card ul li').allInnerTexts()).map(propre);
        expect(lignes).toHaveLength(3);
        if (frn) {
          expect(lignes[0]).toMatch(/^A publié Modifié par .+ · /);
          expect(lignes[1]).toMatch(/^A changé le délai de 3 jours à 5 jours Modifié par Lumi, à la demande de .+ · /);
          expect(lignes[2]).toMatch(/^A changé le texte du texto de l’action Modifié par /);
          // L'avant et l'après : le texte qui partait, et celui qui part.
          await o.page.locator('.section-card ul li').nth(2).getByRole('button', { name: 'Voir l’avant et l’après' }).click();
          const detail = propre(await o.page.locator('.section-card ul li').nth(2).innerText());
          expect(detail).toContain(`Actions — avant 1. Texto : « ${AVANT} »`);
          expect(detail).toContain(`Actions — après 1. Texto : « ${APRES_REST} »`);
        } else {
          expect(lignes[0]).toMatch(/^Published Changed by .+ · /);
          expect(lignes[1]).toMatch(/^Changed the delay from 3 days to 5 days Changed by Lumi, at .+’s request · /);
          expect(lignes.join(' ')).not.toMatch(/a publié|a changé/);
        }
      } finally {
        await o.fermer();
      }
    }
  });
});
