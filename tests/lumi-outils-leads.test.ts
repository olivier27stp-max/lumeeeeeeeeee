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
    for (const m of ['select', 'update', 'insert', 'upsert', 'delete', 'eq', 'is', 'in', 'ilike', 'order', 'limit']) {
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

describe('champs personnalisés', () => {
  it('list_custom_fields : colonnes de l org avec options ; valeurs de la fiche si record_id', async () => {
    const f = fauxClient({
      custom_columns: { data: [{ id: 'K1', name: 'Étage', col_type: 'number', config: {} }, { id: 'K2', name: 'Suivi', col_type: 'status', config: { statuses: [{ value: 'Done', color: 'x' }] } }], error: null },
      custom_column_values: { data: [{ column_id: 'K1', value_number: 3 }], error: null },
    });
    const r = await outil('list_custom_fields').handler!({ entity: 'clients', record_id: 'C1' }, ctxAvec(f.client));
    expect(filtreOrg(f.appels, 'custom_columns')).toBe(true);
    expect(filtreOrg(f.appels, 'custom_column_values')).toBe(true);
    expect(r).toMatchObject({ entity: 'clients', count: 2, fields: [{ id: 'K1', type: 'number', value: 3, options: null }, { id: 'K2', options: ['Done'], value: null }] });
  });

  it('set_custom_field : colonne lue dans l org, valeur typée, upsert org_id + onConflict column_id,record_id', async () => {
    const f = fauxClient({ custom_columns: { data: { id: 'K1', name: 'Étage', col_type: 'number', config: {} }, error: null }, custom_column_values: { error: null } });
    const r = await outil('set_custom_field').handler!({ field_id: 'K1', record_id: 'C1', value: '3' }, ctxAvec(f.client));
    expect(filtreOrg(f.appels, 'custom_columns')).toBe(true);
    const up = aFait(f.appels, 'custom_column_values', 'upsert')[0];
    expect(up.args[0]).toMatchObject({ org_id: ORG, column_id: 'K1', record_id: 'C1', value_number: 3, value_text: null });
    expect(up.args[1]).toEqual({ onConflict: 'column_id,record_id' });
    expect(r).toMatchObject({ updated: true, field: 'Étage', value: 3, note: '« Étage » enregistré.' });
  });

  it('set_custom_field : option hors liste refusée ; valeur vide = vidé', async () => {
    const col = { data: { id: 'K2', name: 'Suivi', col_type: 'status', config: { statuses: [{ value: 'Done', color: 'x' }] } }, error: null };
    await expect(outil('set_custom_field').handler!({ field_id: 'K2', record_id: 'C1', value: 'Peut-être' }, ctxAvec(fauxClient({ custom_columns: col }).client))).rejects.toThrow(/n’accepte que : Done/);
    const f = fauxClient({ custom_columns: col, custom_column_values: { error: null } });
    const r = await outil('set_custom_field').handler!({ field_id: 'K2', record_id: 'C1', value: '' }, ctxAvec(f.client));
    expect(aFait(f.appels, 'custom_column_values', 'upsert')[0].args[0]).toMatchObject({ value_text: null });
    expect(r.note).toBe('« Suivi » vidé.');
  });
});

/* ── 8. Pipeline ─────────────────────────────────────────────── */

describe('pipeline', () => {
  it('list_deals : filtré org, étape normalisée, statut traduit, montant sous un nom masquable (_amount)', async () => {
    const f = fauxClient({ pipeline_deals: { data: [{ id: 'D1', title: 'Vitres', stage: 'quote_sent', value: 350, lead: { first_name: 'Marie', last_name: 'Tremblay' } }], error: null, count: 1 } });
    const r = await outil('list_deals').handler!({ stage: 'devis envoyé' }, ctxAvec(f.client));
    expect(filtreOrg(f.appels, 'pipeline_deals')).toBe(true);
    expect(f.appels).toContainEqual({ table: 'pipeline_deals', op: 'eq', args: ['stage', 'quote_sent'] });
    expect(r).toMatchObject({ total_matching: 1, deals: [{ id: 'D1', prospect: 'Marie Tremblay', statut: 'devis envoyé', value_amount: 350 }] });
    expect(outil('list_deals').needsIdentity).toBe(true);
  });

  it('update_deal_stage : carte lue dans l org, RPC set_deal_stage, événement signalé ; même étape = rien', async () => {
    const f = fauxClient({ pipeline_deals: { data: { id: 'D1', title: 'Vitres', stage: 'no_response', lead_id: 'L1', job_id: null }, error: null } });
    const r = await outil('update_deal_stage').handler!({ deal_id: 'D1', stage: 'gagné' }, ctxAvec(f.client));
    expect(filtreOrg(f.appels, 'pipeline_deals')).toBe(true);
    expect(f.rpc).toHaveBeenCalledWith('set_deal_stage', { p_deal_id: 'D1', p_stage: 'closed_won' });
    expect(appel).toHaveBeenCalledWith(expect.anything(), '/automations/events/deal-stage-changed', { dealId: 'D1', leadId: 'L1', oldStage: 'no_response', newStage: 'closed_won' });
    expect(r).toMatchObject({ updated: true, changed: true, deal: { title: 'Vitres' }, statut: 'gagné' });
    expect(r.note).toBe('Carte déplacée à l’étape « gagné ».');

    const f2 = fauxClient({ pipeline_deals: { data: { id: 'D1', title: 'Vitres', stage: 'closed_won' }, error: null } });
    const rien = await outil('update_deal_stage').handler!({ deal_id: 'D1', stage: 'closed_won' }, ctxAvec(f2.client));
    expect(rien).toMatchObject({ changed: false });
    expect(f2.rpc).not.toHaveBeenCalled();
  });

  it('update_deal_stage : automatisations injoignables = avertissement dans la note, jamais une erreur', async () => {
    const f = fauxClient({ pipeline_deals: { data: { id: 'D1', title: 'Vitres', stage: 'no_response' }, error: null } });
    appel.mockResolvedValue({ ok: false, status: 500, json: {} });
    const r = await outil('update_deal_stage').handler!({ deal_id: 'D1', stage: 'closed_lost' }, ctxAvec(f.client));
    expect(r).toMatchObject({ updated: true, statut: 'perdu' });
    expect(r.note).toMatch(/automatisations non déclenchées/);
  });

  it('delete_deal : carte vérifiée dans l org puis POST /deals/soft-delete (alsoDeleteLead relayé)', async () => {
    const f = fauxClient({ pipeline_deals: { data: { id: 'D1', title: 'Vitres' }, error: null } });
    appel.mockResolvedValue({ ok: true, status: 200, json: { ok: true, deal_deleted: true, lead_deleted: true } });
    const r = await outil('delete_deal').handler!({ deal_id: 'D1', also_delete_lead: true }, ctxAvec(f.client));
    expect(filtreOrg(f.appels, 'pipeline_deals')).toBe(true);
    expect(appel).toHaveBeenCalledWith(expect.anything(), '/deals/soft-delete', { dealId: 'D1', alsoDeleteLead: true });
    expect(r).toMatchObject({ deleted: true, lead_deleted: true, note: 'Carte retirée du pipeline et prospect supprimé.' });
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
