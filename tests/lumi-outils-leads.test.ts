/**
 * Outils « prospects, demandes et dossier client » de Lumi
 * (server/lib/agent/tools-leads.ts).
 *
 * 1. Chaque déclaration respecte le sous-ensemble de schéma que validerArgs
 *    comprend (même boucle que tests/lumi-registre.test.ts).
 * 2. Chaque écriture prouve son filtre org / sa route / sa `note` française,
 *    contre un faux client Supabase qui enregistre la chaîne d'appels, ou un
 *    appelInterne simulé.
 * 3. REGISTRE / PERMISSIONS / TOPICS couvrent exactement les outils.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validerArgs } from '../server/lib/agent/validation-args';
import { PERMISSION_KEYS } from '../src/lib/permissions';

// appelInterne simulé (aucun serveur), executerIdempotent réduit à « exécute
// l'action » (aucune empreinte en base). Le reste du module reste réel.
vi.mock('../server/lib/agent/tools-etendus', async (importActual) => {
  const reel = await importActual<typeof import('../server/lib/agent/tools-etendus')>();
  return {
    ...reel,
    appelInterne: vi.fn(async () => ({ ok: true, status: 200, json: {} })),
    executerIdempotent: vi.fn(async (_ctx: unknown, _outil: string, _args: unknown, action: () => Promise<Record<string, any>>) => action()),
  };
});

import { appelInterne, AppelInterneIncertain, executerIdempotent } from '../server/lib/agent/tools-etendus';
import { OUTILS_LEADS, REGISTRE_LEADS, PERMISSIONS_LEADS, TOPICS_LEADS, versEtape } from '../server/lib/agent/tools-leads';

const ORG = 'org-1';
const USER = 'user-1';
const appel = appelInterne as unknown as ReturnType<typeof vi.fn>;

type Appel = { table: string; op: string; args: any[] };

/**
 * Faux client Supabase : chaque méthode de la chaîne est enregistrée ; la
 * réponse d'une table est soit un objet, soit une FILE (tableau) consommée
 * appel terminal après appel terminal (select puis insert, par exemple).
 */
function fauxClient(reponses: Record<string, any> = {}) {
  const appels: Appel[] = [];
  const reponse = (table: string) => {
    const r = reponses[table];
    if (Array.isArray(r)) return r.length > 1 ? r.shift() : r[0];
    return r ?? { data: null, error: null };
  };
  const from = vi.fn((table: string) => {
    const q: any = {};
    for (const m of ['select', 'update', 'insert', 'upsert', 'delete', 'eq', 'is', 'in', 'ilike', 'or', 'order', 'limit']) {
      q[m] = (...args: any[]) => { appels.push({ table, op: m, args }); return q; };
    }
    q.single = async () => { appels.push({ table, op: 'single', args: [] }); return reponse(table); };
    q.maybeSingle = async () => { appels.push({ table, op: 'maybeSingle', args: [] }); return reponse(table); };
    q.then = (res: any, rej: any) => Promise.resolve(reponse(table)).then(res, rej);
    return q;
  });
  const rpc = vi.fn(async (fn: string) => reponses[`rpc:${fn}`] ?? { data: null, error: null });
  return { client: { from, rpc } as any, appels, rpc };
}

const outil = (nom: string) => {
  const t = OUTILS_LEADS.find((o) => o.declaration.name === nom);
  if (!t?.handler) throw new Error(`outil ${nom} absent ou sans handler`);
  return t;
};
const ctxAvec = (client: any) => ({ client, orgId: ORG, userId: USER, accessToken: 'jeton' });
const filtreOrg = (appels: Appel[], table: string) =>
  appels.some((a) => a.table === table && a.op === 'eq' && a.args[0] === 'org_id' && a.args[1] === ORG);
const aFait = (appels: Appel[], table: string, op: string) => appels.filter((a) => a.table === table && a.op === op);

beforeEach(() => {
  appel.mockReset();
  appel.mockResolvedValue({ ok: true, status: 200, json: {} });
});

/* ── 1. Déclarations ─────────────────────────────────────────── */

describe('déclarations', () => {
  it('noms uniques, description anglaise, écritures = write + needsIdentity + handler', () => {
    const noms = OUTILS_LEADS.map((t) => t.declaration.name);
    expect(new Set(noms).size).toBe(noms.length);
    for (const t of OUTILS_LEADS) {
      expect(t.declaration.description.length, t.declaration.name).toBeGreaterThan(40);
      expect(typeof t.handler, t.declaration.name).toBe('function');
      if (t.kind === 'write') expect(t.needsIdentity, t.declaration.name).toBe(true);
      for (const [k, p] of Object.entries(t.declaration.parameters.properties)) {
        expect(['string', 'integer', 'number', 'boolean', 'array', 'object'], `${t.declaration.name}.${k}`).toContain((p as any).type);
        if ((p as any).enum) expect((p as any).type, `${t.declaration.name}.${k} enum`).toBe('string');
      }
    }
  });

  it('chaque déclaration accepte un exemple minimal conforme (sous-ensemble validerArgs)', () => {
    for (const t of OUTILS_LEADS) {
      const p: any = t.declaration.parameters ?? { type: 'object', properties: {} };
      const exemple: Record<string, unknown> = {};
      for (const k of p.required ?? []) {
        const s = p.properties?.[k] ?? {};
        exemple[k] = s.type === 'integer' || s.type === 'number' ? 1 : s.type === 'boolean' ? true : s.type === 'array' ? [] : s.type === 'object' ? {} : (s.enum?.[0] ?? 'x');
      }
      const r = validerArgs(p, exemple);
      expect(r.ok, `${t.declaration.name} : ${(r as any).erreur ?? ''}`).toBe(true);
    }
  });

  it('versEtape : canonique, ancien slug, anglais et français de l écran ; inconnu = erreur lisible', () => {
    expect(versEtape('quote_sent')).toBe('quote_sent');
    expect(versEtape('Devis envoyé')).toBe('quote_sent');
    expect(versEtape('follow_up_1')).toBe('no_response');
    expect(versEtape('Closed Won')).toBe('closed_won');
    expect(versEtape('gagné')).toBe('closed_won');
    expect(() => versEtape('en feu')).toThrow(/Étape inconnue/);
  });
});

/* ── 2. Prospects ────────────────────────────────────────────── */

describe('prospects', () => {
  it('create_lead → POST /leads/create avec full_name, orgId ; note et statut français', async () => {
    appel.mockResolvedValue({ ok: true, status: 200, json: { lead_id: 'L1', lead: { id: 'L1', first_name: 'Marie', last_name: 'Tremblay' } } });
    const r = await outil('create_lead').handler!({ first_name: 'Marie', last_name: 'Tremblay', phone: '514', estimated_value: 350 }, ctxAvec(fauxClient().client));
    expect(appel).toHaveBeenCalledWith(expect.anything(), '/leads/create', expect.objectContaining({ full_name: 'Marie Tremblay', phone: '514', value: 350, orgId: ORG }));
    expect(r).toMatchObject({ created: true, lead: { id: 'L1', name: 'Marie Tremblay' }, statut: 'nouveau prospect' });
    expect(r.note).toMatch(/Prospect créé/);
    expect(executerIdempotent).toHaveBeenCalledWith(expect.anything(), 'create_lead', expect.anything(), expect.any(Function));
  });

  it('create_lead : courriel invalide refusé avant tout appel ; 403 → phrase française sans texte brut', async () => {
    await expect(outil('create_lead').handler!({ first_name: 'X', email: 'pas-un-courriel' }, ctxAvec(fauxClient().client))).rejects.toThrow('Adresse courriel invalide.');
    expect(appel).not.toHaveBeenCalled();
    appel.mockResolvedValue({ ok: false, status: 403, json: { error: 'Forbidden for this organization.' } });
    await expect(outil('create_lead').handler!({ first_name: 'X' }, ctxAvec(fauxClient().client))).rejects.toThrow(/Impossible de créer le prospect : les accès Lume/);
  });

  it('create_lead : réponse jamais revenue → résultat incertain RENVOYÉ (empreinte gardée, pas de doublon)', async () => {
    appel.mockRejectedValue(new AppelInterneIncertain('timeout'));
    const r = await outil('create_lead').handler!({ first_name: 'X' }, ctxAvec(fauxClient().client));
    expect(r).toMatchObject({ incertain: true });
    expect(r.note).toMatch(/PEUT-ÊTRE/);
  });

  it('update_lead → update clients filtré org + status=lead + deleted_at null ; company alimente aussi title', async () => {
    const f = fauxClient({ clients: { data: { first_name: 'Marie', last_name: 'Tremblay', email: 'm@x.ca', lead_status: 'no_response' }, error: null } });
    const r = await outil('update_lead').handler!({ lead_id: 'L1', email: 'm@x.ca', company: 'Résidences T' }, ctxAvec(f.client));
    expect(aFait(f.appels, 'clients', 'update')[0].args[0]).toMatchObject({ email: 'm@x.ca', company: 'Résidences T', title: 'Résidences T' });
    expect(filtreOrg(f.appels, 'clients')).toBe(true);
    expect(f.appels).toContainEqual({ table: 'clients', op: 'eq', args: ['status', 'lead'] });
    expect(f.appels).toContainEqual({ table: 'clients', op: 'is', args: ['deleted_at', null] });
    expect(r).toMatchObject({ updated: true, lead: { name: 'Marie Tremblay' }, statut: 'sans réponse', note: 'Fiche du prospect mise à jour.' });
  });

  it('update_lead : aucun champ → erreur ; prospect introuvable → conseil update_client', async () => {
    await expect(outil('update_lead').handler!({ lead_id: 'L1' }, ctxAvec(fauxClient().client))).rejects.toThrow('Aucun champ à modifier.');
    await expect(outil('update_lead').handler!({ lead_id: 'L1', phone: '1' }, ctxAvec(fauxClient().client))).rejects.toThrow(/update_client/);
  });

  it('update_lead_status → POST /leads/update-status avec l étape normalisée ; gagné = client actif', async () => {
    appel.mockResolvedValue({ ok: true, status: 200, json: { ok: true, changed: true } });
    const r = await outil('update_lead_status').handler!({ lead_id: 'L1', status: 'devis envoyé' }, ctxAvec(fauxClient().client));
    expect(appel).toHaveBeenCalledWith(expect.anything(), '/leads/update-status', { leadId: 'L1', status: 'quote_sent', orgId: ORG });
    expect(r).toMatchObject({ updated: true, changed: true, statut: 'devis envoyé' });
    expect(r.note).toContain('devis envoyé');

    const won = await outil('update_lead_status').handler!({ lead_id: 'L1', status: 'closed_won' }, ctxAvec(fauxClient().client));
    expect(won.note).toMatch(/client actif/);

    appel.mockResolvedValue({ ok: true, status: 200, json: { ok: true, changed: false } });
    const rien = await outil('update_lead_status').handler!({ lead_id: 'L1', status: 'no_response' }, ctxAvec(fauxClient().client));
    expect(rien).toMatchObject({ changed: false });
    expect(rien.note).toMatch(/déjà/);
  });

  it('update_lead_status : étape inconnue refusée avant tout appel', async () => {
    await expect(outil('update_lead_status').handler!({ lead_id: 'L1', status: 'bizarre' }, ctxAvec(fauxClient().client))).rejects.toThrow(/Étape inconnue/);
    expect(appel).not.toHaveBeenCalled();
  });

  it('delete_lead : vérifie le prospect DANS l org (la route ne filtre pas) puis POST /leads/soft-delete', async () => {
    const f = fauxClient({ clients: { data: { id: 'L1', first_name: 'Marie', last_name: 'Tremblay', lead_status: 'new_prospect' }, error: null } });
    const r = await outil('delete_lead').handler!({ lead_id: 'L1' }, ctxAvec(f.client));
    expect(filtreOrg(f.appels, 'clients')).toBe(true);
    expect(f.appels).toContainEqual({ table: 'clients', op: 'eq', args: ['status', 'lead'] });
    expect(appel).toHaveBeenCalledWith(expect.anything(), '/leads/soft-delete', { leadId: 'L1', orgId: ORG });
    expect(r).toMatchObject({ deleted: true, lead: { name: 'Marie Tremblay' } });
    expect(r.note).toMatch(/Prospect supprimé/);
  });

  it('delete_lead : hors org / déjà converti → aucune route appelée', async () => {
    await expect(outil('delete_lead').handler!({ lead_id: 'L1' }, ctxAvec(fauxClient().client))).rejects.toThrow(/Prospect introuvable/);
    expect(appel).not.toHaveBeenCalled();
  });

  it('convert_lead_to_job → POST /leads/convert-to-job ; job et note ; incertain renvoyé (pas de 2e job)', async () => {
    appel.mockResolvedValue({ ok: true, status: 200, json: { ok: true, job_id: 'J1', job_title: 'Lavage', client_id: 'C1' } });
    const r = await outil('convert_lead_to_job').handler!({ lead_id: 'L1', job_title: 'Lavage' }, ctxAvec(fauxClient().client));
    expect(appel).toHaveBeenCalledWith(expect.anything(), '/leads/convert-to-job', { leadId: 'L1', orgId: ORG, jobTitle: 'Lavage' });
    expect(r).toMatchObject({ converted: true, job: { id: 'J1', title: 'Lavage' }, client: { id: 'C1' }, statut: 'client actif' });
    expect(r.note).toMatch(/job créé en brouillon/);

    appel.mockRejectedValue(new AppelInterneIncertain('timeout'));
    const inc = await outil('convert_lead_to_job').handler!({ lead_id: 'L1' }, ctxAvec(fauxClient().client));
    expect(inc).toMatchObject({ incertain: true });
  });
});

/* ── 3. Demandes entrantes ───────────────────────────────────── */

describe('demandes entrantes', () => {
  it('process_request_submission : archive + planifie l évaluation, filtré org, deleted_at null', async () => {
    const f = fauxClient({ form_submissions: { data: { first_name: 'Paul', last_name: 'Roy', archived_at: '2026-09-16T10:00:00Z', assessment_start_at: '2026-09-20T13:00:00.000Z' }, error: null } });
    const r = await outil('process_request_submission').handler!({
      submission_id: 'S1', archived: true, assessment_start_at: '2026-09-20T09:00:00-04:00', assessment_end_at: '2026-09-20T10:00:00-04:00', assessment_instructions: 'Apporter l’échelle',
    }, ctxAvec(f.client));
    const patch = aFait(f.appels, 'form_submissions', 'update')[0].args[0];
    expect(patch).toMatchObject({ assessment_start_at: '2026-09-20T13:00:00.000Z', assessment_end_at: '2026-09-20T14:00:00.000Z', assessment_instructions: 'Apporter l’échelle' });
    expect(typeof patch.archived_at).toBe('string');
    expect(filtreOrg(f.appels, 'form_submissions')).toBe(true);
    expect(f.appels).toContainEqual({ table: 'form_submissions', op: 'is', args: ['deleted_at', null] });
    expect(r).toMatchObject({ updated: true, submission: { name: 'Paul Roy', archived: true } });
    expect(r.note).toMatch(/évaluation planifiée, demande archivée/);
  });

  it('process_request_submission : rien à modifier, date invalide, fin avant début → erreurs lisibles', async () => {
    const h = outil('process_request_submission').handler!;
    await expect(h({ submission_id: 'S1' }, ctxAvec(fauxClient().client))).rejects.toThrow(/Rien à modifier/);
    await expect(h({ submission_id: 'S1', assessment_start_at: 'demain' }, ctxAvec(fauxClient().client))).rejects.toThrow(/date\/heure invalide/);
    await expect(h({ submission_id: 'S1', assessment_start_at: '2026-09-20T10:00:00Z', assessment_end_at: '2026-09-20T09:00:00Z' }, ctxAvec(fauxClient().client))).rejects.toThrow(/après son début/);
  });

  it('delete_request_submission : deleted_at posé (jamais de delete), filtré org', async () => {
    const f = fauxClient({ form_submissions: { data: { id: 'S1', first_name: 'Paul', last_name: 'Roy' }, error: null } });
    const r = await outil('delete_request_submission').handler!({ submission_id: 'S1' }, ctxAvec(f.client));
    expect(aFait(f.appels, 'form_submissions', 'update')[0].args[0]).toHaveProperty('deleted_at');
    expect(aFait(f.appels, 'form_submissions', 'delete')).toHaveLength(0);
    expect(filtreOrg(f.appels, 'form_submissions')).toBe(true);
    expect(r).toMatchObject({ deleted: true, note: 'Demande supprimée.' });
  });
});

/* ── 4. Client ───────────────────────────────────────────────── */

describe('delete_client', () => {
  it('vérifie la fiche dans l org puis POST /clients/soft-delete ; cascade résumée en français', async () => {
    const f = fauxClient({ clients: { data: { id: 'C1', first_name: 'Marie', last_name: 'Tremblay' }, error: null } });
    appel.mockResolvedValue({ ok: true, status: 200, json: { ok: true, client: 1, jobs: 3, pipeline_deals: 1, other_rows: 2 } });
    const r = await outil('delete_client').handler!({ client_id: 'C1' }, ctxAvec(f.client));
    expect(filtreOrg(f.appels, 'clients')).toBe(true);
    expect(appel).toHaveBeenCalledWith(expect.anything(), '/clients/soft-delete', { clientId: 'C1' });
    expect(r).toMatchObject({ deleted: true, client: { name: 'Marie Tremblay' }, cascade: { jobs: 3, pipeline_deals: 1, quotes_and_invoices: 2 } });
    expect(r.note).toBe('Client supprimé avec 3 job(s) et 2 devis/facture(s) liés.');
  });

  it('client hors org → aucune route appelée ; 404 de la route → phrase française', async () => {
    await expect(outil('delete_client').handler!({ client_id: 'C9' }, ctxAvec(fauxClient().client))).rejects.toThrow(/Client introuvable/);
    expect(appel).not.toHaveBeenCalled();
    const f = fauxClient({ clients: { data: { id: 'C1' }, error: null } });
    appel.mockResolvedValue({ ok: false, status: 404, json: { error: 'Client not found or already deleted.' } });
    await expect(outil('delete_client').handler!({ client_id: 'C1' }, ctxAvec(f.client))).rejects.toThrow(/introuvable — peut-être déjà supprimé/);
  });
});

/* ── 5. Propriétés ───────────────────────────────────────────── */

describe('propriétés', () => {
  it('list_properties : filtré org, adresses de service puis facturation séparée', async () => {
    const f = fauxClient({ properties: { data: [
      { id: 'P1', kind: 'service', name: 'Maison', address: '1 rue A', is_primary: true },
      { id: 'P2', kind: 'billing', name: 'Adresse de facturation', address: '2 rue B', is_primary: false },
    ], error: null } });
    const r = await outil('list_properties').handler!({ client_id: 'C1' }, ctxAvec(f.client));
    expect(filtreOrg(f.appels, 'properties')).toBe(true);
    expect(r).toMatchObject({ count: 1, properties: [{ id: 'P1', name: 'Maison', primary: true }], billing_address: { id: 'P2', address: '2 rue B' } });
  });

  it('create_property : client vérifié dans l org, 1re adresse de service = principale, org_id inséré', async () => {
    const f = fauxClient({
      clients: { data: { id: 'C1' }, error: null },
      properties: [
        { data: [], error: null },                                                    // liste existante (vide)
        { data: { id: 'P1', name: 'Chalet', address: '9 ch. du Lac', city: 'Sutton', is_primary: true, kind: 'service' }, error: null }, // insert
      ],
    });
    const r = await outil('create_property').handler!({ client_id: 'C1', name: 'Chalet', address: '9 ch. du Lac', city: 'Sutton' }, ctxAvec(f.client));
    expect(filtreOrg(f.appels, 'clients')).toBe(true);
    expect(aFait(f.appels, 'properties', 'insert')[0].args[0]).toMatchObject({ org_id: ORG, client_id: 'C1', kind: 'service', name: 'Chalet', address: '9 ch. du Lac', city: 'Sutton', is_primary: true });
    expect(r).toMatchObject({ created: true, property: { id: 'P1', name: 'Chalet', primary: true } });
    expect(r.note).toMatch(/adresse principale/);
  });

  it('create_property kind=billing : jamais principale ; refus si une adresse de facturation existe déjà', async () => {
    const f = fauxClient({ clients: { data: { id: 'C1' }, error: null }, properties: { data: { id: 'P2' }, error: null } });
    await expect(outil('create_property').handler!({ client_id: 'C1', name: 'Facturation', kind: 'billing' }, ctxAvec(f.client))).rejects.toThrow(/déjà une adresse de facturation/);
    expect(aFait(f.appels, 'properties', 'insert')).toHaveLength(0);
  });

  it('update_property / delete_property : filtrés org + deleted_at null ; suppression douce', async () => {
    const fu = fauxClient({ properties: { data: { name: 'Maison', address: '1 rue A', city: 'Laval', is_primary: true }, error: null } });
    const u = await outil('update_property').handler!({ property_id: 'P1', city: 'Laval', is_primary: true }, ctxAvec(fu.client));
    expect(aFait(fu.appels, 'properties', 'update')[0].args[0]).toEqual({ city: 'Laval', is_primary: true });
    expect(filtreOrg(fu.appels, 'properties')).toBe(true);
    expect(fu.appels).toContainEqual({ table: 'properties', op: 'is', args: ['deleted_at', null] });
    expect(u).toMatchObject({ updated: true, property: { city: 'Laval', primary: true }, note: 'Adresse mise à jour.' });

    const fd = fauxClient({ properties: { data: { id: 'P1', name: 'Maison', address: '1 rue A', kind: 'service' }, error: null } });
    const d = await outil('delete_property').handler!({ property_id: 'P1' }, ctxAvec(fd.client));
    expect(aFait(fd.appels, 'properties', 'update')[0].args[0]).toHaveProperty('deleted_at');
    expect(aFait(fd.appels, 'properties', 'delete')).toHaveLength(0);
    expect(filtreOrg(fd.appels, 'properties')).toBe(true);
    expect(d).toMatchObject({ deleted: true, note: 'Propriété supprimée.' });
  });
});

/* ── 6. Notes ────────────────────────────────────────────────── */

describe('notes', () => {
  it('list_notes : filtré org + entité ; pièces jointes comptées, jamais listées', async () => {
    const f = fauxClient({ specific_notes: { data: [{ id: 'N1', text: 'Chien méchant', tags: [], files: [{ name: 'a.jpg' }], created_at: 't' }], error: null } });
    const r = await outil('list_notes').handler!({ entity_type: 'client', entity_id: 'C1' }, ctxAvec(f.client));
    expect(filtreOrg(f.appels, 'specific_notes')).toBe(true);
    expect(f.appels).toContainEqual({ table: 'specific_notes', op: 'eq', args: ['entity_type', 'client'] });
    expect(r).toMatchObject({ count: 1, notes: [{ id: 'N1', text: 'Chien méchant', attachments: 1 }] });
  });

  it('update_note : texte remplacé, filtré org ; delete_note : DELETE (pas de deleted_at sur specific_notes), filtré org', async () => {
    const fu = fauxClient({ specific_notes: { data: { id: 'N1', updated_at: 't2' }, error: null } });
    const u = await outil('update_note').handler!({ note_id: 'N1', text: 'Chien gentil' }, ctxAvec(fu.client));
    expect(aFait(fu.appels, 'specific_notes', 'update')[0].args[0]).toEqual({ text: 'Chien gentil' });
    expect(filtreOrg(fu.appels, 'specific_notes')).toBe(true);
    expect(u).toMatchObject({ updated: true, note: 'Note modifiée.' });

    const fd = fauxClient({ specific_notes: { data: { id: 'N1' }, error: null } });
    const d = await outil('delete_note').handler!({ note_id: 'N1' }, ctxAvec(fd.client));
    expect(aFait(fd.appels, 'specific_notes', 'delete')).toHaveLength(1);
    expect(filtreOrg(fd.appels, 'specific_notes')).toBe(true);
    expect(d).toMatchObject({ deleted: true, note: 'Note supprimée définitivement.' });
  });
});

/* ── 7. Champs personnalisés ─────────────────────────────────── */

// Les anciens tests figeaient l'écriture `upsert onConflict column_id,record_id`
// — qui échouait en vrai à chaque appel (index remplacé en 2026-07) : ils
// prouvaient une erreur. Ceux-ci prouvent le contrat de l'outil branché sur
// customFieldsService (server/lib/champs/service.ts), sans rien d'autre de
// faux que le client Supabase.
describe('champs personnalisés', () => {
  const ETAGE = { id: 'K1', object_type: 'client', key: 'etage', label: 'Étage', field_type: 'number', config: {}, is_required: false, archived_at: null };
  const SUIVI = { id: 'K2', object_type: 'client', key: 'suivi', label: 'Suivi', field_type: 'dropdown_single', config: {}, is_required: false, archived_at: null };
  const PRIX = { id: 'K3', object_type: 'deal', key: 'prix_cible', label: 'Prix cible', field_type: 'monetary', config: { currency: 'CAD' }, is_required: false, archived_at: null };
  const OPT = { data: [{ id: 'O1', field_id: 'K2', label: 'Fait', color: null, position: 0, archived_at: null }], error: null };

  it('list_custom_fields : champs de l org, types dans le vocabulaire d origine, valeurs de la fiche si record_id', async () => {
    const f = fauxClient({
      custom_fields: { data: [ETAGE, SUIVI], error: null },
      custom_field_options: OPT,
      custom_field_folders: { data: [], error: null },
      custom_field_values: { data: [{ id: 'V1', field_id: 'K1', client_id: 'C1', version: 1, updated_at: 'x', value_number: 3 }], error: null },
    });
    const r = await outil('list_custom_fields').handler!({ entity: 'clients', record_id: 'C1' }, ctxAvec(f.client));
    expect(filtreOrg(f.appels, 'custom_fields')).toBe(true);
    expect(filtreOrg(f.appels, 'custom_field_values')).toBe(true);
    expect(r).toMatchObject({ entity: 'clients', count: 2, fields: [
      { id: 'K1', name: 'Étage', type: 'number', value: 3, options: null },
      { id: 'K2', name: 'Suivi', type: 'dropdown', options: ['Fait'], value: null },
    ] });
  });

  it('list_custom_fields : les deals et devis sont désormais couverts', async () => {
    const f = fauxClient({ custom_fields: { data: [PRIX], error: null }, custom_field_folders: { data: [], error: null } });
    const r = await outil('list_custom_fields').handler!({ entity: 'deals' }, ctxAvec(f.client));
    expect(f.appels.some((a) => a.table === 'custom_fields' && a.op === 'eq' && a.args[0] === 'object_type' && a.args[1] === 'deal')).toBe(true);
    expect(r).toMatchObject({ entity: 'deals', fields: [{ id: 'K3', type: 'currency' }] });
  });

  it('set_custom_field : passe par cf_ecrire_valeur (atomique, idempotent), montant en dollars → cents', async () => {
    const f = fauxClient({
      custom_fields: { data: [PRIX], error: null },
      custom_field_folders: { data: [], error: null },
      'rpc:cf_ecrire_valeur': { data: { changed: true, conflict: false, version: 1, old: null }, error: null },
      custom_field_values: { data: [{ id: 'V1', field_id: 'K3', deal_id: 'D1', version: 1, updated_at: 'x', value_money_cents: 125000 }], error: null },
    });
    const r = await outil('set_custom_field').handler!({ field_id: 'K3', record_id: 'D1', value: '1250' }, ctxAvec(f.client));
    const appelRpc = (f.rpc.mock.calls as unknown as any[][]).find((c: any[]) => c[0] === 'cf_ecrire_valeur');
    expect(appelRpc?.[1]).toMatchObject({ p_field: 'K3', p_entity: 'D1', p_cols: { value_money_cents: 125000, value_currency: 'CAD' } });
    expect(filtreOrg(f.appels, 'custom_fields')).toBe(true);
    expect(aFait(f.appels, 'custom_column_values', 'upsert')).toHaveLength(0);
    expect(r).toMatchObject({ updated: true, field: 'Prix cible', value: 1250, note: '« Prix cible » enregistré.' });
  });

  it('set_custom_field : option hors liste refusée avec la liste ; valeur vide = vidé', async () => {
    const base = { custom_fields: { data: [SUIVI], error: null }, custom_field_options: OPT, custom_field_folders: { data: [], error: null } };
    await expect(outil('set_custom_field').handler!({ field_id: 'K2', record_id: 'C1', value: 'Peut-être' }, ctxAvec(fauxClient(base).client)))
      .rejects.toThrow(/n’accepte que : Fait/);
    const f = fauxClient({ ...base, 'rpc:cf_ecrire_valeur': { data: { changed: true, conflict: false, version: null, old: null }, error: null }, custom_field_values: { data: [], error: null } });
    const r = await outil('set_custom_field').handler!({ field_id: 'K2', record_id: 'C1', value: '' }, ctxAvec(f.client));
    expect((f.rpc.mock.calls as unknown as any[][]).find((c: any[]) => c[0] === 'cf_ecrire_valeur')?.[1]).toMatchObject({ p_cols: null });
    expect(r.note).toBe('« Suivi » vidé.');
  });

  it('set_custom_field : un refus de validation remonte en phrase claire', async () => {
    const COURRIEL = { ...ETAGE, id: 'K4', label: 'Courriel facturation', field_type: 'email' };
    const f = fauxClient({ custom_fields: { data: [COURRIEL], error: null }, custom_field_folders: { data: [], error: null } });
    await expect(outil('set_custom_field').handler!({ field_id: 'K4', record_id: 'C1', value: 'pas-un-courriel' }, ctxAvec(f.client)))
      .rejects.toThrow(/attend une adresse courriel valide/);
  });
});

/* ── 8. Pipeline ─────────────────────────────────────────────── */

describe('pipeline (le vrai : deals, pipelines_ventes, pipeline_stages)', () => {
  const PIPELINE = { id: 'P1', name: 'Ventes', is_default: true, position: 1 };
  const ETAPES = [
    { id: 'E1', name_fr: 'Nouveau', name_en: 'New', kind: 'open', position: 1 },
    { id: 'E2', name_fr: 'Soumission envoyée', name_en: 'Quote sent', kind: 'open', position: 2 },
    { id: 'E3', name_fr: 'Gagné', name_en: 'Won', kind: 'won', position: 3 },
    { id: 'E4', name_fr: 'Perdu', name_en: 'Lost', kind: 'lost', position: 4 },
  ];
  const DEAL = { id: 'D1', title: null, stage_id: 'E1', pipeline_id: 'P1', client_id: 'C1', assigned_user_id: 'U9', source: 'manuel', expected_close_date: '2026-11-01', stage_entered_at: '2026-09-28T12:00:00Z', last_activity_at: '2026-09-30T12:00:00Z', lost_reason: null, client: { first_name: 'Marie', last_name: 'Tremblay', company: null, display_as_company: false } };

  it('plus aucun outil du pipeline ne lit l’ancien tableau pipeline_deals', async () => {
    for (const [nom, args] of [['list_deals', {}], ['update_deal_stage', { deal_id: 'D1', stage: 'Gagné' }], ['delete_deal', { deal_id: 'D1' }]] as const) {
      const f = fauxClient({ pipelines_ventes: { data: [PIPELINE], error: null }, pipeline_stages: { data: ETAPES, error: null }, deals: [{ data: DEAL, error: null }, { data: [{ id: 'D1' }], error: null }] });
      await outil(nom).handler!(args, ctxAvec(f.client)).catch(() => null);
      expect(f.appels.some((x) => x.table === 'pipeline_deals'), nom).toBe(false);
      expect(f.rpc.mock.calls.some(([fn]) => fn === 'set_deal_stage'), nom).toBe(false);
    }
    expect(appel).not.toHaveBeenCalledWith(expect.anything(), '/deals/soft-delete', expect.anything());
  });

  it('list_deals : les étapes de l’entreprise avec leur compte, les deals avec client, étape, vendeur et montant masquable', async () => {
    const f = fauxClient({
      pipelines_ventes: { data: [PIPELINE], error: null },
      pipeline_stages: { data: ETAPES, error: null },
      deals: [{ data: [DEAL], error: null, count: 1 }, { data: [{ stage_id: 'E1' }, { stage_id: 'E1' }, { stage_id: 'E3' }], error: null }],
      team_members: { data: [{ user_id: 'U9', first_name: 'Karim', last_name: 'Haddad' }], error: null },
      'rpc:pipeline_montants': { data: [{ deal_id: 'D1', cents: 35000, provenance: 'devis' }], error: null },
    });
    const r: any = await outil('list_deals').handler!({}, ctxAvec(f.client));
    for (const t of ['pipelines_ventes', 'pipeline_stages', 'deals']) expect(filtreOrg(f.appels, t), t).toBe(true);
    expect(r.pipeline).toBe('Ventes');
    expect(r.etapes).toEqual([
      { stage_id: 'E1', nom: 'Nouveau', name_en: 'New', nature: 'ouvert', deals: 2 },
      { stage_id: 'E2', nom: 'Soumission envoyée', name_en: 'Quote sent', nature: 'ouvert', deals: 0 },
      { stage_id: 'E3', nom: 'Gagné', name_en: 'Won', nature: 'gagné', deals: 1 },
      { stage_id: 'E4', nom: 'Perdu', name_en: 'Lost', nature: 'perdu', deals: 0 },
    ]);
    expect(r.deals[0]).toMatchObject({ id: 'D1', title: 'Marie Tremblay', client: 'Marie Tremblay', etape: 'Nouveau', nature: 'ouvert', amount_cents: 35000, vendeur: 'Karim Haddad', expected_close_date: '2026-11-01' });
    expect(outil('list_deals').needsIdentity).toBe(true);
  });

  it('list_deals : filtre par nom d’étape, ou par nature (« gagné ») ; étape inconnue = la liste des vraies étapes', async () => {
    const base = { pipelines_ventes: { data: [PIPELINE], error: null }, pipeline_stages: { data: ETAPES, error: null } };
    const f = fauxClient({ ...base, deals: { data: [], error: null, count: 0 } });
    await outil('list_deals').handler!({ stage: 'soumission envoyee' }, ctxAvec(f.client));
    expect(f.appels).toContainEqual({ table: 'deals', op: 'in', args: ['stage_id', ['E2']] });
    const g = fauxClient({ ...base, deals: { data: [], error: null, count: 0 } });
    await outil('list_deals').handler!({ stage: 'gagné' }, ctxAvec(g.client));
    expect(g.appels).toContainEqual({ table: 'deals', op: 'in', args: ['stage_id', ['E3']] });
    const h = fauxClient({ ...base });
    const r: any = await outil('list_deals').handler!({ stage: 'négociation' }, ctxAvec(h.client));
    expect(r.error).toMatch(/Aucune étape « négociation ».*« Nouveau », « Soumission envoyée », « Gagné », « Perdu »/);
  });

  it('list_deals : une entreprise sans pipeline le dit, sans erreur', async () => {
    const f = fauxClient({ pipelines_ventes: { data: [], error: null } });
    const r: any = await outil('list_deals').handler!({}, ctxAvec(f.client));
    expect(r).toMatchObject({ total_matching: 0, deals: [] });
    expect(r.note).toMatch(/pas encore de pipeline/);
  });

  it('update_deal_stage : déplace par NOM d’étape, comme l’écran (mise à jour de deals dans l’org) ; même étape = rien', async () => {
    const f = fauxClient({ pipeline_stages: { data: ETAPES, error: null }, deals: [{ data: DEAL, error: null }, { data: [{ id: 'D1' }], error: null }] });
    const r: any = await outil('update_deal_stage').handler!({ deal_id: 'D1', stage: 'Soumission envoyée' }, ctxAvec(f.client));
    expect(filtreOrg(f.appels, 'deals')).toBe(true);
    expect(aFait(f.appels, 'deals', 'update')[0].args[0]).toEqual({ stage_id: 'E2' });
    expect(r).toMatchObject({ updated: true, changed: true, de: 'Nouveau', etape: 'Soumission envoyée' });
    expect(r.note).toMatch(/déplacé de « Nouveau » à « Soumission envoyée »/);

    const f2 = fauxClient({ pipeline_stages: { data: ETAPES, error: null }, deals: { data: DEAL, error: null } });
    const rien: any = await outil('update_deal_stage').handler!({ deal_id: 'D1', stage: 'Nouveau' }, ctxAvec(f2.client));
    expect(rien).toMatchObject({ updated: true, changed: false });
    expect(aFait(f2.appels, 'deals', 'update')).toEqual([]);
  });

  it('update_deal_stage : une étape de perte exige la raison ; avec la raison, elle est écrite', async () => {
    const f = fauxClient({ pipeline_stages: { data: ETAPES, error: null }, deals: { data: DEAL, error: null } });
    await expect(outil('update_deal_stage').handler!({ deal_id: 'D1', stage: 'Perdu' }, ctxAvec(f.client))).rejects.toThrow(/étape de perte.*lost_reason/s);
    expect(aFait(f.appels, 'deals', 'update')).toEqual([]);
    const g = fauxClient({ pipeline_stages: { data: ETAPES, error: null }, deals: [{ data: DEAL, error: null }, { data: [{ id: 'D1' }], error: null }] });
    await outil('update_deal_stage').handler!({ deal_id: 'D1', stage: 'Perdu', lost_reason: 'Trop cher' }, ctxAvec(g.client));
    expect(aFait(g.appels, 'deals', 'update')[0].args[0]).toEqual({ stage_id: 'E4', lost_reason: 'Trop cher' });
  });

  it('update_deal_stage : étape inconnue ou ambiguë = refus qui nomme les vraies étapes ; RLS qui refuse = pas de faux « c’est fait »', async () => {
    const f = fauxClient({ pipeline_stages: { data: ETAPES, error: null }, deals: { data: DEAL, error: null } });
    await expect(outil('update_deal_stage').handler!({ deal_id: 'D1', stage: 'closed_won_xyz' }, ctxAvec(f.client))).rejects.toThrow(/Aucune étape/);
    // Deux étapes « gagnées » dont aucune ne s'appelle « gagné » : la nature seule ne suffit pas à trancher.
    const double = [...ETAPES.filter((e) => e.id !== 'E3'), { id: 'E3', name_fr: 'Conclu', name_en: 'Closed', kind: 'won', position: 3 }, { id: 'E5', name_fr: 'Conclu récurrent', name_en: 'Closed recurring', kind: 'won', position: 5 }];
    const g = fauxClient({ pipeline_stages: { data: double, error: null }, deals: { data: DEAL, error: null } });
    await expect(outil('update_deal_stage').handler!({ deal_id: 'D1', stage: 'gagné' }, ctxAvec(g.client))).rejects.toThrow(/plusieurs étapes/);
    const h = fauxClient({ pipeline_stages: { data: ETAPES, error: null }, deals: [{ data: DEAL, error: null }, { data: [], error: null }] });
    await expect(outil('update_deal_stage').handler!({ deal_id: 'D1', stage: 'Gagné' }, ctxAvec(h.client))).rejects.toThrow(/n’a pas été déplacé/);
  });

  it('delete_deal : abandonne le deal par la fonction de l’app, avec la raison ; la fiche du client n’est pas touchée', async () => {
    const f = fauxClient({ pipeline_stages: { data: ETAPES, error: null }, deals: { data: DEAL, error: null } });
    const r: any = await outil('delete_deal').handler!({ deal_id: 'D1', reason: 'ne répond plus' }, ctxAvec(f.client));
    expect(filtreOrg(f.appels, 'deals')).toBe(true);
    expect(f.rpc).toHaveBeenCalledWith('pipeline_abandonner_deal', { p_deal_id: 'D1', p_raison: 'ne répond plus' });
    expect(r).toMatchObject({ deleted: true, abandonne: true, deal: { title: 'Marie Tremblay' } });
    expect(r.note).toMatch(/abandonné.*fiche du client n’est pas touchée/s);
    expect(aFait(f.appels, 'clients', 'update')).toEqual([]);
    expect(appel).not.toHaveBeenCalled();
  });

  it('delete_deal : un deal d’une autre entreprise est introuvable, rien n’est appelé', async () => {
    const f = fauxClient({ deals: { data: null, error: null } });
    await expect(outil('delete_deal').handler!({ deal_id: 'D9' }, ctxAvec(f.client))).rejects.toThrow(/introuvable/);
    expect(f.rpc).not.toHaveBeenCalledWith('pipeline_abandonner_deal', expect.anything());
  });
});

/* ── 9. Registres ────────────────────────────────────────────── */

describe('registres', () => {
  const noms = OUTILS_LEADS.map((t) => t.declaration.name).sort();
  const ecritures = OUTILS_LEADS.filter((t) => t.kind === 'write').map((t) => t.declaration.name).sort();

  it('REGISTRE_LEADS couvre exactement les écritures ; suppressions irréversibles et sensibles', () => {
    expect(Object.keys(REGISTRE_LEADS).sort()).toEqual(ecritures);
    for (const n of ecritures.filter((n) => n.startsWith('delete_'))) expect(REGISTRE_LEADS[n], n).toMatchObject({ sensible: true, reversible: false });
    for (const [n, a] of Object.entries(REGISTRE_LEADS)) expect(a.vers_client, `${n} n'atteint pas le client`).toBe(false);
  });

  it('PERMISSIONS_LEADS couvre exactement les outils, avec des clés de la page Rôles et une capacité française', () => {
    expect(Object.keys(PERMISSIONS_LEADS).sort()).toEqual(noms);
    for (const [n, p] of Object.entries(PERMISSIONS_LEADS)) {
      expect(PERMISSION_KEYS as readonly string[], `${n} → ${p.cle}`).toContain(p.cle);
      expect(p.capacite, n).toMatch(/^(la|le|l’)/);
    }
    for (const n of ecritures.filter((n) => n.startsWith('delete_'))) expect(PERMISSIONS_LEADS[n].cle, n).toMatch(/\.(delete|update|read)$/);
    expect(PERMISSIONS_LEADS.delete_client.cle).toBe('clients.delete');
    expect(PERMISSIONS_LEADS.delete_lead.cle).toBe('leads.delete');
  });

  it('TOPICS_LEADS cite chaque outil exactement une fois', () => {
    const cites = Object.values(TOPICS_LEADS).flat().sort();
    expect(cites).toEqual(noms);
    expect(TOPICS_LEADS.clients).toEqual(expect.arrayContaining(noms));
  });
});
