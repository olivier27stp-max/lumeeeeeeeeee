/**
 * Outils Lumi « terrain » (server/lib/agent/tools-terrain.ts) : jobs, visites,
 * calendrier, listes de vérification, étiquettes, contrats, disponibilités,
 * tâches.
 * ─────────────────────────────────────────────────────────────────
 * - chaque déclaration passe validerArgs avec un exemple minimal (même boucle
 *   que tests/lumi-registre.test.ts) ;
 * - chaque écriture exige l'identité et passe par le VRAI executerIdempotent
 *   (seul appelInterne est remplacé) ;
 * - chaque accès à la base filtre org_id = ctx.orgId (ou porte org_id dans
 *   l'insert, ou p_org_id dans la RPC) ; les envois partent vers la BONNE route ;
 * - chaque résultat porte une note en français, jamais un texte brut de la
 *   base ; un envoi incertain garde son empreinte (pas de doublon) ;
 * - les manifestes (registre, permissions, topics) couvrent exactement les
 *   outils du module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validerArgs } from '../server/lib/agent/validation-args';
import { PERMISSION_KEYS } from '../src/lib/permissions';

const { appelInterneMock, adminFactice } = vi.hoisted(() => {
  const appelInterneMock = vi.fn();
  // Client service_role vu par executerIdempotent : on journalise les
  // opérations sur agent_actions pour prouver ce qu'il advient de l'empreinte.
  const journalAdmin: Array<[string, any[]]> = [];
  const adminFactice = {
    journal: journalAdmin,
    from(table: string) {
      const q: any = {};
      for (const m of ['insert', 'select', 'update', 'delete', 'eq']) {
        q[m] = (...a: any[]) => { journalAdmin.push([`${table}.${m}`, a]); return q; };
      }
      q.maybeSingle = async () => ({ data: { id: 'act-1', resultat: null }, error: null });
      q.then = (res: any) => res({ data: null, error: null });
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  return { appelInterneMock, adminFactice };
});

vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => adminFactice, companyOrgIds: async () => [] }));
vi.mock('../server/lib/security', () => ({ logSecurityEvent: () => {} }));
vi.mock('../server/lib/config', () => ({ twilioClient: null, getTwilioStatusCallbackUrl: () => '' }));
vi.mock('../server/lib/helpers', () => ({ normalizeE164: (s: string) => s, findOrCreateConversation: async () => null }));
vi.mock('../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => null, SmsNumberNotProvisionedError: class extends Error {}, SmsNotInPlanError: class extends Error {} }));
vi.mock('../server/lib/lumi/version-org', () => ({ invaliderOrg: async () => {}, versionOrg: async () => 0 }));
vi.mock('../server/lib/agent/tools-etendus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/lib/agent/tools-etendus')>();
  return { ...actual, appelInterne: (...a: any[]) => appelInterneMock(...a) };
});

import {
  OUTILS_TERRAIN, REGISTRE_TERRAIN, PERMISSIONS_TERRAIN, TOPICS_TERRAIN,
} from '../server/lib/agent/tools-terrain';
import { AppelInterneIncertain } from '../server/lib/agent/tools-etendus';

const PAR_NOM = Object.fromEntries(OUTILS_TERRAIN.map((t) => [t.declaration.name, t]));
const NOMS = OUTILS_TERRAIN.map((t) => t.declaration.name);
const ECRITURES = OUTILS_TERRAIN.filter((t) => t.kind === 'write').map((t) => t.declaration.name);

const ORG = '11111111-1111-4111-8111-111111111111';
const AUTRE_ORG = '99999999-9999-4999-8999-999999999999';
const USER = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';
const ID = '44444444-4444-4444-8444-444444444444';
const ID2 = '55555555-5555-4555-8555-555555555555';

/* ── Client Supabase factice : chaîne enregistrée, réponse par table ─────── */

type Op = [string, any[]];
interface Appel { table: string; ops: Op[] }
type Reponse = { data?: any; error?: any; count?: number | null };
type Repondeur = (a: Appel) => Reponse | undefined;

const a = (appel: Appel, m: string) => appel.ops.some(([op]) => op === m);
const arg = (appel: Appel, m: string): any[] | undefined => appel.ops.find(([op]) => op === m)?.[1];
const filtreOrg = (appel: Appel) => appel.ops.some(([op, args]) => op === 'eq' && args[0] === 'org_id' && args[1] === ORG);

function clientFactice(reponses: Record<string, Repondeur> = {}) {
  const appels: Appel[] = [];
  const rpcs: Array<{ fn: string; args: any }> = [];
  const client = {
    from(table: string) {
      const appel: Appel = { table, ops: [] };
      appels.push(appel);
      const rep = () => ({ data: null, error: null, ...(reponses[table]?.(appel) ?? {}) });
      const q: any = {};
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'is', 'not', 'ilike', 'order', 'limit', 'gte', 'lte', 'lt', 'gt']) {
        q[m] = (...args: any[]) => { appel.ops.push([m, args]); return q; };
      }
      q.single = async () => { appel.ops.push(['single', []]); return rep(); };
      q.maybeSingle = async () => { appel.ops.push(['maybeSingle', []]); return rep(); };
      q.then = (res: any, rej?: any) => Promise.resolve(rep()).then(res, rej);
      return q;
    },
    rpc: async (fn: string, args: any) => {
      rpcs.push({ fn, args });
      return reponses[`rpc:${fn}`]?.({ table: fn, ops: [] }) ?? { data: null, error: null };
    },
  };
  return { client, appels, rpcs };
}

const JOB_ROW = { id: JOB, job_number: 'J-0012', title: 'Lavage de vitres', client_id: ID, total_cents: 10_000, billing_split: false };
const ITEMS = [{ id: 'i1', label: 'Vitres avant', type: 'checkbox', required: true }, { id: 'i2', label: 'Photo finale', type: 'photo' }];

/** Réponses par défaut : un job, une équipe, une liste, un contrat… tout dans l'org. */
const REPONSES_DEFAUT: Record<string, Repondeur> = {
  jobs: () => ({ data: JOB_ROW }),
  teams: (ap) => ({ data: a(ap, 'in') ? [{ id: ID, name: 'Équipe A' }] : { id: ID, name: 'Équipe A' } }),
  schedule_events: (ap) => (a(ap, 'update') ? { data: null } : { data: [{ id: ID, start_at: '2026-10-01T13:00:00.000Z' }] }),
  job_recurrence_rules: (ap) => (a(ap, 'insert')
    ? { data: { id: ID2, next_run_at: '2026-10-01T05:00:00.000Z' } }
    : a(ap, 'update') ? { data: { id: ID, job_id: JOB, occurrences_created: 3 } } : { data: null }),
  job_templates: () => ({ data: { id: ID, title: 'Grand ménage' } }),
  checklist_templates: (ap) => ({ data: a(ap, 'insert') ? { id: ID, name: 'Fin de chantier' } : { id: ID, name: 'Fin de chantier', is_active: true, items: ITEMS } }),
  job_checklists: (ap) => (a(ap, 'update')
    ? { data: { id: ID, template_id: null, items: ITEMS, responses: { i1: true }, completed_at: null } }
    : a(ap, 'insert') ? { data: { id: ID } }
      : a(ap, 'delete') ? { data: { id: ID } }
        : { data: { id: ID, items: ITEMS, responses: {} } }),
  job_tags: (ap) => (a(ap, 'insert') ? { data: { id: ID, name: 'Urgent', color_hex: '#ff0000' } }
    : a(ap, 'in') ? { data: [{ id: ID, name: 'Urgent' }, { id: ID2, name: 'VIP' }] } : { data: null }),
  job_billing_milestones: (ap) => (a(ap, 'order')
    ? { data: [{ id: ID, position: 0, label: 'Dépôt', percent: 50, amount_cents: 5000, due_date: null }] }
    : a(ap, 'select') && !a(ap, 'update') && !a(ap, 'insert') && !a(ap, 'delete')
      ? { data: a(ap, 'maybeSingle') ? { id: ID, label: 'Dépôt' } : [{ id: ID }] }
      : { data: null }),
  quotes: () => ({ data: null }),
  job_agreements: (ap) => ({ data: a(ap, 'insert') ? { id: ID, status: 'draft' } : { id: ID, status: 'draft', job_id: JOB } }),
  team_availability: (ap) => ({ data: a(ap, 'insert') ? (Array.isArray(arg(ap, 'insert')?.[0]) ? [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }] : { id: ID }) : { id: ID, weekday: 1, start_minute: 480, end_minute: 1020 } }),
  tasks: (ap) => (a(ap, 'in')
    ? { data: [{ id: ID }, { id: ID2 }] }
    : a(ap, 'insert') ? { data: { id: ID2, title: 'Rappeler le client (copie)', priority: 'high', due_date: '2026-10-02' } }
      : a(ap, 'update') ? { data: { id: ID, title: 'Rappeler le client', scheduled_at: '2026-10-01T13:00:00.000Z', duration_minutes: 30, status: 'open' } }
        : { data: { title: 'Rappeler le client', description: null, priority: 'high', type: 'Client', due_date: '2026-10-02', linked_entity_type: 'job', linked_entity_id: JOB, linked_person_type: null, linked_person_id: null, assignee_user_id: USER, team_id: null, job_id: JOB } }),
};

function ctxFactice(reponses: Record<string, Repondeur> = {}, extra: Record<string, any> = {}) {
  const fake = clientFactice({ ...REPONSES_DEFAUT, ...reponses });
  return { ...fake, ctx: { client: fake.client as any, orgId: ORG, userId: USER, accessToken: 'jeton', ...extra } };
}

async function executer(nom: string, args: Record<string, any>, reponses: Record<string, Repondeur> = {}, extra: Record<string, any> = {}) {
  const outil = PAR_NOM[nom];
  if (!outil?.handler) throw new Error(`outil ${nom} sans handler`);
  const f = ctxFactice(reponses, extra);
  const result = await outil.handler(args, f.ctx);
  return { result, appels: f.appels, rpcs: f.rpcs };
}

/** Toute opération sur une table de l'org est bornée à l'org : filtre eq(org_id) ou org_id dans chaque ligne insérée. */
function verifierBornageOrg(appels: Appel[], nom: string) {
  expect(appels.length, `${nom} : aucun accès à la base`).toBeGreaterThan(0);
  for (const ap of appels) {
    if (a(ap, 'insert')) {
      const charge = arg(ap, 'insert')?.[0];
      const lignes = Array.isArray(charge) ? charge : [charge];
      for (const l of lignes) expect(l?.org_id, `${nom} : insert ${ap.table} sans org_id`).toBe(ORG);
    } else {
      expect(filtreOrg(ap), `${nom} : ${ap.table} (${ap.ops.map(([m]) => m).join('.')}) sans filtre org_id`).toBe(true);
    }
  }
}

const NOTE_FR = /[àâéèêçîôû]|\b(le|la|les|du|des|au|est|rien|job|tâche)\b/i;

beforeEach(() => {
  appelInterneMock.mockReset();
  appelInterneMock.mockResolvedValue({ ok: true, status: 200, json: { ok: true } });
  adminFactice.journal.length = 0;
});

/* ══════════════════════════════════════════════════════════════ */

describe('déclarations', () => {
  it('noms uniques, descriptions en anglais, écritures à identité avec handler', () => {
    expect(new Set(NOMS).size).toBe(NOMS.length);
    for (const t of OUTILS_TERRAIN) {
      expect(t.declaration.description, t.declaration.name).toMatch(/^[A-Z]/);
      expect(t.declaration.description).not.toMatch(/[éèàç]/);
      expect(typeof t.handler, t.declaration.name).toBe('function');
      expect(t.needsIdentity, t.declaration.name).toBe(true);
    }
  });

  it('chaque déclaration accepte un exemple minimal conforme (boucle de lumi-registre)', () => {
    for (const [name, t] of Object.entries(PAR_NOM)) {
      const p: any = t.declaration.parameters ?? { type: 'object', properties: {} };
      const exemple: Record<string, unknown> = {};
      for (const k of p.required ?? []) {
        const s = p.properties?.[k] ?? {};
        exemple[k] = s.type === 'integer' || s.type === 'number' ? 1 : s.type === 'boolean' ? true : s.type === 'array' ? [] : s.type === 'object' ? {} : (s.enum?.[0] ?? 'x');
      }
      const r = validerArgs(p, exemple);
      expect(r.ok, `${name} : ${(r as any).erreur ?? ''}`).toBe(true);
    }
  });

  it('couvre les actions demandées', () => {
    for (const n of [
      'delete_job', 'list_recurrence_rules', 'create_recurrence_rule', 'deactivate_recurrence_rule', 'create_job_template',
      'unschedule_job', 'schedule_job',
      'list_job_checklists', 'create_job_checklist', 'update_job_checklist', 'delete_job_checklist',
      'list_checklist_templates', 'create_checklist_template', 'update_checklist_template', 'delete_checklist_template',
      'list_job_tags', 'create_job_tag', 'set_job_tags',
      'save_job_billing_milestones', 'create_invoice_for_visit', 'create_invoice_for_milestone',
      'list_job_agreements', 'create_job_agreement', 'send_agreement_email', 'send_agreement_sms',
      'list_availability', 'create_availability', 'delete_availability', 'set_default_availability',
      'reschedule_task', 'duplicate_task', 'bulk_update_task_status', 'bulk_delete_tasks',
    ]) expect(PAR_NOM[n], n).toBeDefined();
  });
});

describe('manifestes : registre, permissions, topics', () => {
  it('REGISTRE_TERRAIN couvre exactement les écritures ; envoi = irréversible + vers le client ; suppression = irréversible', () => {
    expect(Object.keys(REGISTRE_TERRAIN).sort()).toEqual([...ECRITURES].sort());
    for (const [n, at] of Object.entries(REGISTRE_TERRAIN)) {
      if (at.vers_client) expect(at.reversible, n).toBe(false);
      if (/^(delete_|bulk_delete)/.test(n)) expect(at, n).toMatchObject({ sensible: true, reversible: false });
    }
    expect(REGISTRE_TERRAIN.send_agreement_email).toEqual({ sensible: true, reversible: false, vers_client: true });
    expect(REGISTRE_TERRAIN.send_agreement_sms).toEqual({ sensible: true, reversible: false, vers_client: true });
    expect(REGISTRE_TERRAIN.create_invoice_for_visit.sensible).toBe(true);
    expect(REGISTRE_TERRAIN.save_job_billing_milestones.sensible).toBe(true);
  });

  it('PERMISSIONS_TERRAIN couvre exactement les outils, avec des clés de la page Rôles et une capacité en français', () => {
    expect(Object.keys(PERMISSIONS_TERRAIN).sort()).toEqual([...NOMS].sort());
    for (const [n, p] of Object.entries(PERMISSIONS_TERRAIN)) {
      expect((PERMISSION_KEYS as readonly string[]).includes(p.cle), `${n} : clé ${p.cle}`).toBe(true);
      expect(p.capacite, n).toMatch(/^(la|le|les|l’|l')/i);
    }
    expect(PERMISSIONS_TERRAIN.delete_job.cle).toBe('jobs.delete');
    expect(PERMISSIONS_TERRAIN.schedule_job.cle).toBe('calendar.update');
    expect(PERMISSIONS_TERRAIN.create_invoice_for_milestone.cle).toBe('invoices.create');
  });

  it('TOPICS_TERRAIN : chaque outil dans exactement un topic, les tâches en équipe, le reste en planification', () => {
    const tous = Object.values(TOPICS_TERRAIN).flat();
    expect([...tous].sort()).toEqual([...NOMS].sort());
    expect(new Set(tous).size).toBe(tous.length);
    expect(TOPICS_TERRAIN.equipe).toEqual(['reschedule_task', 'duplicate_task', 'bulk_update_task_status', 'bulk_delete_tasks']);
    expect(Object.keys(TOPICS_TERRAIN).sort()).toEqual(['equipe', 'planification']);
  });
});

describe('écritures : bornage org + note française (client factice, appelInterne remplacé)', () => {
  const CAS: Array<{ nom: string; args: Record<string, any>; reponses?: Record<string, Repondeur>; verifier?: (r: { result: any; appels: Appel[]; rpcs: any[] }) => void }> = [
    {
      nom: 'delete_job', args: { job_id: JOB },
      verifier: ({ result, rpcs }) => {
        expect(rpcs[0]).toEqual({ fn: 'soft_delete_job', args: { p_org_id: ORG, p_job_id: JOB } });
        expect(result).toMatchObject({ deleted: true, job: { job_number: 'J-0012' } });
        expect(appelInterneMock.mock.calls[0][1]).toBe('/commissions/void-for-job');
      },
    },
    {
      nom: 'create_recurrence_rule', args: { job_id: JOB, frequency: 'weekly', start_date: '2099-01-05', day_of_week: [1, 3] },
      verifier: ({ result, appels }) => {
        const ins = appels.find((ap) => ap.table === 'job_recurrence_rules' && a(ap, 'insert'))!;
        expect(arg(ins, 'insert')![0]).toMatchObject({ org_id: ORG, job_id: JOB, frequency: 'weekly', interval_days: 7, day_of_week: [1, 3], start_date: '2099-01-05', next_run_at: '2099-01-05T05:00:00.000Z', is_active: true });
        expect(result).toMatchObject({ created: true, rule_id: ID2, frequence: 'chaque semaine' });
      },
    },
    {
      nom: 'deactivate_recurrence_rule', args: { rule_id: ID },
      verifier: ({ result, appels }) => {
        expect(arg(appels[0], 'update')![0]).toMatchObject({ is_active: false });
        expect(result).toMatchObject({ deactivated: true, occurrences_created: 3 });
      },
    },
    {
      nom: 'create_job_template', args: { title: 'Grand ménage', line_items: [{ name: 'Vitres', qty: -2, unit_price_cents: 4500 }], tags: ['printemps'] },
      verifier: ({ result, appels }) => {
        expect(arg(appels[0], 'insert')![0]).toMatchObject({ org_id: ORG, created_by: USER, job_type: 'one_off', line_items: [{ name: 'Vitres', qty: 1, unit_price_cents: 4500 }], tags: ['printemps'] });
        expect(result).toMatchObject({ created: true, template_id: ID });
      },
    },
    {
      nom: 'schedule_job', args: { job_id: JOB, start_at: '2026-10-01T13:00:00Z', team_id: ID },
      reponses: { 'rpc:rpc_schedule_job': () => ({ data: { event: { id: ID2, start_at: '2026-10-01T13:00:00.000Z', end_at: '2026-10-01T14:00:00.000Z' } } }) },
      verifier: ({ result, rpcs }) => {
        expect(rpcs[0].fn).toBe('rpc_schedule_job');
        expect(rpcs[0].args).toMatchObject({ p_job_id: JOB, p_start_at: '2026-10-01T13:00:00.000Z', p_end_at: '2026-10-01T14:00:00.000Z', p_team_id: ID });
        expect(appelInterneMock.mock.calls[0][1]).toBe('/automations/events/appointment-created');
        expect(result).toMatchObject({ scheduled: true, visit: { end_at: '2026-10-01T14:00:00.000Z' } });
      },
    },
    {
      nom: 'unschedule_job', args: { job_id: JOB },
      verifier: ({ result, rpcs }) => {
        expect(rpcs[0]).toEqual({ fn: 'rpc_unschedule_job', args: { p_job_id: JOB, p_event_id: null } });
        expect(appelInterneMock.mock.calls[0][1]).toBe('/automations/events/appointment-cancelled');
        expect(result).toMatchObject({ unscheduled: true, visites_retirees: 1 });
      },
    },
    {
      nom: 'create_job_checklist', args: { job_id: JOB, template_id: ID },
      verifier: ({ result, appels }) => {
        const ins = appels.find((ap) => ap.table === 'job_checklists')!;
        expect(arg(ins, 'insert')![0]).toMatchObject({ org_id: ORG, job_id: JOB, template_id: ID, items: ITEMS, responses: {} });
        expect(result).toMatchObject({ created: true, items_count: 2 });
      },
    },
    {
      nom: 'update_job_checklist', args: { job_id: JOB, checklist_id: ID, responses: { i1: true } },
      verifier: ({ result, appels }) => {
        const maj = appels.find((ap) => ap.table === 'job_checklists' && a(ap, 'update'))!;
        expect(arg(maj, 'update')![0]).toMatchObject({ responses: { i1: true } });
        expect(result).toMatchObject({ updated: true, checklist: { statut: 'en cours', items_done: 1, items_count: 2 } });
      },
    },
    {
      nom: 'delete_job_checklist', args: { job_id: JOB, checklist_id: ID },
      verifier: ({ result, appels }) => { expect(a(appels[0], 'delete')).toBe(true); expect(result.deleted).toBe(true); },
    },
    {
      nom: 'create_checklist_template', args: { name: 'Fin de chantier', items: [{ label: 'Balayer' }] },
      verifier: ({ result, appels }) => {
        expect(arg(appels[0], 'insert')![0]).toMatchObject({ org_id: ORG, name: 'Fin de chantier', items: [{ id: 'item-1', type: 'checkbox', label: 'Balayer', required: false }], is_active: true });
        expect(result).toMatchObject({ created: true, template_id: ID });
      },
    },
    {
      nom: 'update_checklist_template', args: { template_id: ID, name: 'Fin de chantier v2' },
      verifier: ({ result, appels }) => { expect(arg(appels[0], 'update')![0]).toMatchObject({ name: 'Fin de chantier v2' }); expect(result.updated).toBe(true); },
    },
    {
      nom: 'delete_checklist_template', args: { template_id: ID },
      verifier: ({ result, appels }) => { expect(arg(appels[0], 'update')![0]).toMatchObject({ is_active: false }); expect(result.deleted).toBe(true); },
    },
    {
      nom: 'create_job_tag', args: { name: 'Urgent', color_hex: '#FF0000' },
      verifier: ({ result, appels }) => {
        const ins = appels.find((ap) => a(ap, 'insert'))!;
        expect(arg(ins, 'insert')![0]).toEqual({ org_id: ORG, name: 'Urgent', color_hex: '#FF0000' });
        expect(result).toMatchObject({ created: true, tag: { name: 'Urgent' } });
      },
    },
    {
      nom: 'set_job_tags', args: { job_id: JOB, tag_ids: [ID, ID2] },
      verifier: ({ result, appels }) => {
        const maj = appels.find((ap) => ap.table === 'jobs' && a(ap, 'update'))!;
        expect(arg(maj, 'update')![0]).toMatchObject({ tag_ids: [ID, ID2] });
        expect(result).toMatchObject({ updated: true, tags: ['Urgent', 'VIP'] });
      },
    },
    {
      nom: 'save_job_billing_milestones', args: { job_id: JOB, milestones: [{ id: ID, label: 'Dépôt', amount_cents: 5000, percent: 50 }, { label: 'Fin', amount_cents: 5000 }], billing_split: true },
      verifier: ({ result, appels }) => {
        const jalons = appels.filter((ap) => ap.table === 'job_billing_milestones');
        expect(jalons.some((ap) => a(ap, 'update') && arg(ap, 'update')![0].label === 'Dépôt')).toBe(true);
        expect(jalons.some((ap) => a(ap, 'insert') && arg(ap, 'insert')![0].label === 'Fin')).toBe(true);
        expect(jalons.some((ap) => a(ap, 'delete'))).toBe(false);
        const split = appels.find((ap) => ap.table === 'jobs' && a(ap, 'update'))!;
        expect(arg(split, 'update')![0]).toMatchObject({ billing_split: true });
        expect(result).toMatchObject({ saved: true, billing_split: true });
      },
    },
    {
      nom: 'create_invoice_for_visit', args: { job_id: JOB, visit_id: ID },
      reponses: {},
      verifier: ({ result }) => {
        expect(appelInterneMock.mock.calls[0][1]).toBe('/invoices/from-job');
        expect(appelInterneMock.mock.calls[0][2]).toEqual({ jobId: JOB, visitId: ID, sendNow: false });
        expect(result).toMatchObject({ created: true, invoice_id: ID2, statut: 'brouillon' });
      },
    },
    {
      nom: 'create_invoice_for_milestone', args: { job_id: JOB, milestone_id: ID },
      verifier: ({ result }) => {
        expect(appelInterneMock.mock.calls[0][1]).toBe('/invoices/from-job');
        expect(appelInterneMock.mock.calls[0][2]).toEqual({ jobId: JOB, milestoneId: ID, sendNow: false });
        expect(result).toMatchObject({ created: true, milestone: { label: 'Dépôt' }, statut: 'brouillon' });
      },
    },
    {
      nom: 'create_job_agreement', args: { job_id: JOB },
      verifier: ({ result, appels }) => {
        const ins = appels.find((ap) => ap.table === 'job_agreements')!;
        expect(arg(ins, 'insert')![0]).toMatchObject({ org_id: ORG, job_id: JOB, client_id: ID, require_signature: true, status: 'draft' });
        expect(String(arg(ins, 'insert')![0].terms)).toContain('Garantie (7 jours)');
        expect(result).toMatchObject({ created: true, agreement_id: ID, statut: 'brouillon' });
      },
    },
    {
      nom: 'send_agreement_email', args: { agreement_id: ID },
      verifier: ({ result }) => {
        expect(appelInterneMock.mock.calls[0][1]).toBe('/emails/send-agreement');
        expect(appelInterneMock.mock.calls[0][2]).toEqual({ agreementId: ID });
        expect(result).toMatchObject({ sent: true, channel: 'email', statut: 'envoyé' });
      },
    },
    {
      nom: 'send_agreement_sms', args: { agreement_id: ID },
      verifier: ({ result }) => {
        expect(appelInterneMock.mock.calls[0][1]).toBe('/agreements/send-sms');
        expect(result).toMatchObject({ sent: true, channel: 'sms' });
      },
    },
    {
      nom: 'create_availability', args: { team_id: ID, weekday: 1, start_time: '08:30', end_time: '17:00' },
      verifier: ({ result, appels }) => {
        const dispo = appels.filter((ap) => ap.table === 'team_availability');
        expect(arg(dispo[0], 'update')![0]).toHaveProperty('deleted_at'); // dédoublonnage (même équipe, jour, début)
        expect(arg(dispo[1], 'insert')![0]).toEqual({ org_id: ORG, team_id: ID, weekday: 1, start_minute: 510, end_minute: 1020, timezone: 'America/Toronto' });
        expect(result.note).toContain('lundi de 08:30 à 17:00');
      },
    },
    {
      nom: 'delete_availability', args: { availability_id: ID },
      verifier: ({ result, appels }) => { expect(arg(appels[0], 'update')![0]).toHaveProperty('deleted_at'); expect(result.deleted).toBe(true); },
    },
    {
      nom: 'set_default_availability', args: { team_id: ID },
      verifier: ({ result, appels }) => {
        const ins = appels.find((ap) => ap.table === 'team_availability' && a(ap, 'insert'))!;
        const lignes = arg(ins, 'insert')![0];
        expect(lignes.map((l: any) => l.weekday)).toEqual([1, 2, 3, 4, 5]);
        expect(lignes[0]).toMatchObject({ org_id: ORG, team_id: ID, start_minute: 480, end_minute: 1020 });
        expect(result).toMatchObject({ reset: true, windows_count: 5 });
      },
    },
    {
      nom: 'reschedule_task', args: { task_id: ID, scheduled_at: '2026-10-01T13:00:00Z', duration_minutes: 30 },
      verifier: ({ result, appels }) => {
        expect(arg(appels[0], 'update')![0]).toMatchObject({ scheduled_at: '2026-10-01T13:00:00.000Z', duration_minutes: 30 });
        expect(result).toMatchObject({ rescheduled: true, task: { statut: 'à faire' } });
      },
    },
    {
      nom: 'duplicate_task', args: { task_id: ID },
      verifier: ({ result, appels }) => {
        const ins = appels.find((ap) => a(ap, 'insert'))!;
        expect(arg(ins, 'insert')![0]).toMatchObject({ org_id: ORG, created_by: USER, title: 'Rappeler le client (copie)', status: 'open', priority: 'high', linked_entity_id: JOB, assignee_user_id: USER });
        expect(result).toMatchObject({ created: true, task: { priorite: 'haute', statut: 'à faire' } });
      },
    },
    {
      nom: 'bulk_update_task_status', args: { task_ids: [ID, ID2, ID], status: 'done' },
      verifier: ({ result, appels }) => {
        expect(arg(appels[0], 'in')).toEqual(['id', [ID, ID2]]);
        expect(arg(appels[0], 'update')![0]).toMatchObject({ status: 'done' });
        expect(arg(appels[0], 'update')![0].completed_at).toBeTruthy();
        expect(result).toMatchObject({ updated_count: 2, requested_count: 2, statut: 'terminée' });
      },
    },
    {
      nom: 'bulk_delete_tasks', args: { task_ids: [ID, ID2] },
      verifier: ({ result, appels }) => {
        expect(arg(appels[0], 'in')).toEqual(['id', [ID, ID2]]);
        expect(arg(appels[0], 'update')![0]).toHaveProperty('deleted_at');
        expect(result).toMatchObject({ deleted_count: 2 });
      },
    },
  ];

  it('les cas couvrent toutes les écritures du module', () => {
    expect(CAS.map((c) => c.nom).sort()).toEqual([...ECRITURES].sort());
  });

  for (const cas of CAS) {
    it(cas.nom, async () => {
      appelInterneMock.mockImplementation(async (_ctx: any, chemin: string) => (
        chemin === '/invoices/from-job'
          ? { ok: true, status: 200, json: { invoice_id: ID2, already_exists: false, status: 'draft', invoice: { id: ID2, invoice_number: 'F-0007' } } }
          : { ok: true, status: 200, json: { ok: true } }
      ));
      const r = await executer(cas.nom, cas.args, cas.reponses);
      expect(r.result.error, `${cas.nom} : ${r.result.error}`).toBeUndefined();
      expect(typeof r.result.note, `${cas.nom} : note manquante`).toBe('string');
      expect(r.result.note, cas.nom).toMatch(NOTE_FR);
      verifierBornageOrg(r.appels, cas.nom);
      for (const ap of r.appels) expect(ap.ops.some(([, args]) => args.includes(AUTRE_ORG)), `${cas.nom} : ${ap.table} touche une autre org`).toBe(false);
      cas.verifier?.(r);
      // Empreinte posée avant l'action, résultat mémorisé après (vrai executerIdempotent).
      expect(adminFactice.journal[0][0]).toBe('agent_actions.insert');
      expect(adminFactice.journal.some(([op]) => op === 'agent_actions.update')).toBe(true);
      expect(adminFactice.journal.some(([op]) => op === 'agent_actions.delete')).toBe(false);
    });
  }
});

describe('erreurs et garde-fous', () => {
  it('un envoi de contrat sans réponse de la route est INCERTAIN : résultat rendu, empreinte gardée (pas de doublon à la retentative)', async () => {
    appelInterneMock.mockRejectedValue(new AppelInterneIncertain('timeout'));
    const { result } = await executer('send_agreement_email', { agreement_id: ID });
    expect(result).toMatchObject({ incertain: true, sent: null });
    expect(result.note).toMatch(/PEUT-ÊTRE été envoyé/);
    expect(adminFactice.journal.some(([op]) => op === 'agent_actions.update')).toBe(true);
    expect(adminFactice.journal.some(([op]) => op === 'agent_actions.delete')).toBe(false);
  });

  it('une route qui refuse remonte son message et libère l’empreinte', async () => {
    appelInterneMock.mockResolvedValue({ ok: false, status: 400, json: { error: 'Client has no email address.' } });
    const { result } = await executer('send_agreement_email', { agreement_id: ID });
    expect(result).toEqual({ error: 'Client has no email address.' });
    expect(adminFactice.journal.some(([op]) => op === 'agent_actions.delete')).toBe(true);
  });

  it('jamais de texte brut de Postgres : une contrainte unique devient une phrase d’exploitant', async () => {
    const { result } = await executer('create_job_tag', { name: 'Urgent' }, {
      job_tags: (ap) => (a(ap, 'insert') ? { error: { code: '23505', message: 'duplicate key value violates unique constraint "job_tags_org_name"' } } : { data: null }),
    });
    expect(result.error).toBe('Ça existe déjà — pas besoin de le recréer.');
    expect(JSON.stringify(result)).not.toMatch(/constraint|violates/);
  });

  it('refus métier en français : job d’une autre org introuvable, étiquette inconnue, job issu d’un devis, liste vide', async () => {
    const introuvable = await executer('delete_job', { job_id: JOB }, { jobs: () => ({ data: null }) });
    expect(introuvable.result.error).toMatch(/Job introuvable/);
    expect(introuvable.rpcs).toHaveLength(0);

    const etiquette = await executer('set_job_tags', { job_id: JOB, tag_ids: [ID, AUTRE_ORG] }, { job_tags: () => ({ data: [{ id: ID, name: 'Urgent' }] }) });
    expect(etiquette.result.error).toMatch(/introuvables dans cette entreprise/);
    expect(etiquette.appels.some((ap) => ap.table === 'jobs' && a(ap, 'update'))).toBe(false);

    const devis = await executer('create_job_agreement', { job_id: JOB }, { quotes: () => ({ data: { id: ID2 } }) });
    expect(devis.result.error).toMatch(/soumission associée/);
    expect(devis.appels.some((ap) => ap.table === 'job_agreements')).toBe(false);

    const lot = await executer('bulk_delete_tasks', { task_ids: [] });
    expect(lot.result.error).toMatch(/Aucune tâche indiquée/);
    expect(lot.appels).toHaveLength(0);

    const coche = await executer('update_job_checklist', { job_id: JOB, checklist_id: ID, responses: { inconnu: true } });
    expect(coche.result.error).toMatch(/Élément\(s\) inconnu\(s\)/);
  });

  it('une deuxième règle de récurrence active sur le même job est refusée', async () => {
    const { result, appels } = await executer('create_recurrence_rule', { job_id: JOB, frequency: 'daily', start_date: '2099-01-01' }, {
      job_recurrence_rules: (ap) => (a(ap, 'insert') ? { data: { id: ID2 } } : { data: { id: ID } }),
    });
    expect(result.error).toMatch(/déjà une règle de récurrence active/);
    expect(appels.some((ap) => ap.table === 'job_recurrence_rules' && a(ap, 'insert'))).toBe(false);
  });

  it('mode à blanc : rien n’est écrit, pas même l’empreinte', async () => {
    const { result, appels, rpcs } = await executer('delete_job', { job_id: JOB }, {}, { dryRun: true });
    expect(result).toMatchObject({ dry_run: true, outil: 'delete_job' });
    expect(appels).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
    expect(adminFactice.journal).toHaveLength(0);
  });
});

describe('lectures : filtre org et présentation en français', () => {
  it('list_availability : bornée à l’org, jours et heures lisibles', async () => {
    const { result, appels } = await executer('list_availability', {}, {
      team_availability_active: () => ({ data: [{ id: ID, team_id: ID2, weekday: 1, start_minute: 480, end_minute: 1020, timezone: 'America/Toronto' }] }),
      teams: () => ({ data: [{ id: ID2, name: 'Équipe A' }] }),
    });
    expect(filtreOrg(appels[0])).toBe(true);
    expect(result.availability[0]).toMatchObject({ team: 'Équipe A', jour: 'lundi', start_time: '08:00', end_time: '17:00' });
  });

  it('list_job_agreements / list_recurrence_rules / list_job_tags / list_job_checklists / list_checklist_templates : statuts traduits, tout filtré org', async () => {
    const contrats = await executer('list_job_agreements', { job_id: JOB }, { job_agreements: () => ({ data: [{ id: ID, status: 'sent', require_signature: true, sent_at: '2026-09-01', signed_at: null, signer_name: null, created_at: '2026-09-01' }] }) });
    expect(contrats.result.agreements[0].statut).toBe('envoyé');
    const regles = await executer('list_recurrence_rules', { job_id: JOB }, { job_recurrence_rules: () => ({ data: [{ id: ID, job_id: JOB, frequency: 'biweekly', is_active: true }], count: 1 }), jobs: () => ({ data: [JOB_ROW] }) });
    expect(regles.result.rules[0]).toMatchObject({ frequence: 'aux deux semaines', statut: 'active', job_number: 'J-0012' });
    const tags = await executer('list_job_tags', {}, { job_tags: () => ({ data: [{ id: ID, name: 'Urgent', color_hex: '#ff0000' }] }) });
    expect(tags.result.tags).toHaveLength(1);
    const listes = await executer('list_job_checklists', { job_id: JOB }, { job_checklists: () => ({ data: [{ id: ID, template_id: null, items: ITEMS, responses: { i1: true }, completed_at: null }] }) });
    expect(listes.result.checklists[0]).toMatchObject({ statut: 'en cours', items_done: 1, items_count: 2 });
    const gabarits = await executer('list_checklist_templates', {}, { checklist_templates: () => ({ data: [{ id: ID, name: 'Fin', items: ITEMS, is_active: false }] }) });
    expect(gabarits.result.templates[0]).toMatchObject({ statut: 'désactivé', items_count: 2 });
    for (const r of [contrats, regles, tags, listes, gabarits]) for (const ap of r.appels) expect(filtreOrg(ap), ap.table).toBe(true);
  });

  it('une lecture qui échoue renvoie une phrase générique, jamais l’erreur brute', async () => {
    const { result } = await executer('list_job_tags', {}, { job_tags: () => ({ error: { code: '42P01', message: 'relation "job_tags" does not exist' } }) });
    expect(result.error).toMatch(/La consultation a échoué/);
    expect(result.error).not.toMatch(/relation|job_tags/);
  });
});
