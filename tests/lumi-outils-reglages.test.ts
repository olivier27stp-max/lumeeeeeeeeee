/**
 * Lumi — outils de RÉGLAGES (server/lib/agent/tools-reglages.ts).
 *
 * Fige :
 * - les manifestes (registre des écritures, permissions, topics) couvrent
 *   EXACTEMENT les outils du module, sans doublon ni collision avec le
 *   registre existant ;
 * - chaque déclaration passe validerArgs avec un exemple minimal ;
 * - chaque écriture est soit filtrée par org_id = ctx.orgId (accès direct),
 *   soit passée par une route interne au bon chemin — et renvoie une note en
 *   français ;
 * - les gardes : 0 ligne touchée = « introuvable », identifiant non-UUID
 *   jamais injecté dans un chemin, refus de route traduit, erreur brute de la
 *   base jamais relayée, taxes réservées owner/admin.
 * Tout est simulé : aucune base, aucun serveur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/lib/supabase', () => ({
  getServiceClient: vi.fn(() => ({})),
  companyOrgIds: vi.fn(async () => ['org']),
  isOrgAdminOrOwner: vi.fn(async () => true),
}));
vi.mock('../server/lib/security', () => ({ logSecurityEvent: async () => {} }));
vi.mock('../server/lib/config', () => ({ twilioClient: null, getTwilioStatusCallbackUrl: () => '' }));
vi.mock('../server/lib/helpers', () => ({ normalizeE164: (s: string) => s, findOrCreateConversation: async () => null }));
vi.mock('../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => null, SmsNumberNotProvisionedError: class extends Error {}, SmsNotInPlanError: class extends Error {} }));
// executerIdempotent : on exécute l'action telle quelle (l'empreinte est testée
// dans lumi-registre) ; une erreur devient { error } comme en vrai. appelInterne
// devient un espion.
vi.mock('../server/lib/agent/tools-etendus', async (importOriginal) => {
  const o: any = await importOriginal();
  return {
    ...o,
    executerIdempotent: async (_ctx: any, _outil: string, _args: any, action: () => Promise<any>) => {
      try { return await action(); } catch (e: any) { return { error: String(e?.message || e) }; }
    },
    appelInterne: vi.fn(),
  };
});

import { validerArgs } from '../server/lib/agent/validation-args';
import { PERMISSION_KEYS } from '../src/lib/permissions';
import { TOPICS_PAR_ID } from '../server/lib/lumi/topics';
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';
import { REGISTRE_ECRITURES } from '../server/lib/agent/registre';
import { appelInterne, AppelInterneIncertain } from '../server/lib/agent/tools-etendus';
import { getServiceClient, isOrgAdminOrOwner } from '../server/lib/supabase';
import { OUTILS_REGLAGES, REGISTRE_REGLAGES, PERMISSIONS_REGLAGES, TOPICS_REGLAGES } from '../server/lib/agent/tools-reglages';

type Op = [string, ...any[]];
interface Appel { table: string; ops: Op[] }

/** Client Supabase factice qui ENREGISTRE la chaîne d'appels par table et répond ce qu'on a préparé. */
function clientEnregistreur(reponses: Record<string, { data?: any; error?: any; count?: number }> = {}) {
  const appels: Appel[] = [];
  const from = (table: string) => {
    const entree: Appel = { table, ops: [] };
    appels.push(entree);
    const rep = reponses[table] ?? { data: [{ id: 'x' }], error: null };
    const o: any = {};
    for (const m of ['select', 'eq', 'in', 'is', 'or', 'order', 'limit', 'update', 'insert', 'delete', 'gte', 'lte', 'neq']) {
      o[m] = (...a: any[]) => { entree.ops.push([m, ...a]); return o; };
    }
    o.maybeSingle = async () => ({ data: Array.isArray(rep.data) ? rep.data[0] ?? null : rep.data ?? null, error: rep.error ?? null });
    o.single = o.maybeSingle;
    o.then = (res: any, rej: any) => Promise.resolve({ data: rep.data ?? null, error: rep.error ?? null, count: rep.count ?? (Array.isArray(rep.data) ? rep.data.length : null) }).then(res, rej);
    return o;
  };
  return { client: { from } as any, appels };
}

const OUTIL = Object.fromEntries(OUTILS_REGLAGES.map((t) => [t.declaration.name, t]));
const ECRITURES = OUTILS_REGLAGES.filter((t) => t.kind === 'write').map((t) => t.declaration.name);
const TOUS = OUTILS_REGLAGES.map((t) => t.declaration.name);
const UUID = '11111111-2222-4333-8444-555555555555';
const estFrancais = (s: unknown) => typeof s === 'string' && s.length > 0 && /[àâçéèêëîïôûùü]/.test(s);

/** Chaque accès à `table` porte eq('org_id','org'), in('org_id', [... 'org' ...]) ou insère org_id: 'org'. */
function filtreOrg(appels: Appel[], table: string): boolean {
  const acces = appels.filter((a) => a.table === table);
  return acces.length > 0 && acces.every((a) => a.ops.some(([m, k, v]) =>
    (m === 'eq' && k === 'org_id' && v === 'org')
    || (m === 'in' && k === 'org_id' && Array.isArray(v) && v.includes('org'))
    || (m === 'insert' && k && typeof k === 'object' && k.org_id === 'org')));
}

async function executer(nom: string, args: Record<string, any>, reponses: Record<string, any> = {}) {
  const { client, appels } = clientEnregistreur(reponses);
  const r = await OUTIL[nom].handler!(args, { client, orgId: 'org', userId: 'u', accessToken: 'jeton' });
  return { r, appels };
}

beforeEach(() => {
  vi.mocked(appelInterne).mockReset();
  vi.mocked(appelInterne).mockResolvedValue({ ok: true, status: 200, json: { id: UUID, name: 'Merci', config: { id: UUID }, group: { name: 'Quebec' }, config_count: 2 } });
  vi.mocked(isOrgAdminOrOwner).mockResolvedValue(true);
  vi.mocked(getServiceClient).mockReturnValue({} as any);
});

describe('manifestes : les trois exports couvrent exactement les outils du module', () => {
  it('32 outils, noms uniques, aucune collision avec le registre existant', () => {
    // 32 depuis create_automation_from_text (Lumi sait créer une automatisation).
    expect(TOUS.length).toBe(32);
    expect(new Set(TOUS).size).toBe(TOUS.length);
    // Intégrés dans AGENT_TOOLS via outils-domaines.ts : chacun est enregistré une fois, sous son nom.
    for (const n of TOUS) expect(TOOLS_BY_NAME[n]?.declaration.name, `${n} absent de TOOLS_BY_NAME`).toBe(n);
    // … et chaque écriture est dans REGISTRE_ECRITURES avec les attributs du manifeste (fusion par outils-domaines.ts).
    for (const n of ECRITURES) expect(REGISTRE_ECRITURES[n], `${n} absent de REGISTRE_ECRITURES`).toMatchObject(REGISTRE_REGLAGES[n]);
  });
  it('REGISTRE_REGLAGES = exactement les écritures ; un envoi ou une suppression dure n est jamais réversible', () => {
    expect(Object.keys(REGISTRE_REGLAGES).sort()).toEqual([...ECRITURES].sort());
    for (const [n, a] of Object.entries(REGISTRE_REGLAGES)) if (a.vers_client) expect(a.reversible, n).toBe(false);
    for (const n of ['delete_email_template', 'delete_tax_config', 'delete_goal', 'delete_scheduled_report', 'send_scheduled_report_now']) expect(REGISTRE_REGLAGES[n].reversible, n).toBe(false);
    // Les taxes touchent toutes les factures ; les automatisations, ce que reçoivent les clients.
    for (const n of ['setup_taxes', 'create_tax_config', 'update_tax_config', 'delete_tax_config', 'set_default_tax_group', 'toggle_automation_rule', 'update_automation_message', 'update_automation_sms_body', 'set_automation_language']) {
      expect(REGISTRE_REGLAGES[n].sensible, n).toBe(true);
    }
  });
  it('PERMISSIONS_REGLAGES = tous les outils, avec une clé réelle de la page Rôles', () => {
    expect(Object.keys(PERMISSIONS_REGLAGES).sort()).toEqual([...TOUS].sort());
    for (const [n, p] of Object.entries(PERMISSIONS_REGLAGES)) {
      expect((PERMISSION_KEYS as readonly string[]).includes(p.cle), `${n} → ${p.cle}`).toBe(true);
      expect(p.capacite.length).toBeGreaterThan(3);
    }
    expect(PERMISSIONS_REGLAGES.setup_taxes.cle).toBe('settings.update');
    expect(PERMISSIONS_REGLAGES.toggle_automation_rule.cle).toBe('automations.update');
    expect(PERMISSIONS_REGLAGES.mark_conversation_read.cle).toBe('messages.read');
  });
  it('TOPICS_REGLAGES : chaque outil exactement une fois, sur des topics existants', () => {
    const cites: string[] = [];
    for (const [id, outils] of Object.entries(TOPICS_REGLAGES)) {
      expect(TOPICS_PAR_ID.has(id as any), `topic inconnu : ${id}`).toBe(true);
      cites.push(...(outils || []));
    }
    expect(cites.sort()).toEqual([...TOUS].sort());
  });
  it('les écritures exigent l identité et ont un handler ; les descriptions sont en anglais ASCII', () => {
    for (const t of OUTILS_REGLAGES) {
      expect(typeof t.handler, t.declaration.name).toBe('function');
      if (t.kind === 'write') expect(t.needsIdentity, t.declaration.name).toBe(true);
      expect(t.declaration.description, t.declaration.name).toMatch(/^[\x20-\x7E]+$/);
    }
  });
  it('chaque déclaration accepte un exemple minimal conforme (sous-ensemble de validerArgs)', () => {
    for (const t of OUTILS_REGLAGES) {
      const p: any = t.declaration.parameters;
      const exemple: Record<string, unknown> = {};
      for (const k of p.required ?? []) {
        const s = p.properties?.[k] ?? {};
        exemple[k] = s.type === 'integer' || s.type === 'number' ? 1 : s.type === 'boolean' ? true : s.type === 'array' ? [] : s.type === 'object' ? {} : (s.enum?.[0] ?? 'x');
      }
      const r = validerArgs(p, exemple);
      expect(r.ok, `${t.declaration.name} : ${(r as any).erreur ?? ''}`).toBe(true);
    }
  });
});

describe('écritures directes : filtrées par org_id = ctx.orgId, note en français', () => {
  const cas: Array<[string, Record<string, any>, string[], Record<string, any>?]> = [
    ['mark_conversation_read', { conversation_id: 'c1' }, ['conversations'], { conversations: { data: [{ id: 'c1', client_name: 'Marie' }] } }],
    ['update_email_template', { template_id: 't1', subject: 'Nouvel objet' }, ['email_templates'], { email_templates: { data: [{ id: 't1', name: 'Merci' }] } }],
    ['delete_email_template', { template_id: 't1' }, ['email_templates'], { email_templates: { data: [{ id: 't1', name: 'Merci' }] } }],
    ['toggle_automation_rule', { rule_id: 'r1', is_active: false }, ['automation_rules'], { automation_rules: { data: [{ id: 'r1', name: 'Avis', is_active: false }] } }],
    ['update_automation_message', { rule_id: 'r1', action_type: 'send_sms', body: 'Merci !' }, ['automation_rules'], { automation_rules: { data: [{ id: 'r1', name: 'Avis', actions: [{ type: 'send_sms', config: { body: 'ancien' } }] }] } }],
    ['update_automation_sms_body', { rule_id: 'r1', body: 'Merci !' }, ['automation_rules'], { automation_rules: { data: [{ id: 'r1', name: 'Avis', actions: [{ type: 'send_sms', config: { body: 'ancien' } }] }] } }],
    ['set_automation_language', { language: 'en' }, ['company_settings'], { company_settings: { data: [{ org_id: 'org' }] } }],
    ['update_tax_config', { tax_id: 'x1', rate: 9.975 }, ['tax_configs'], { tax_configs: { data: [{ id: 'x1', name: 'TVQ', rate: 9.975, is_active: true }] } }],
    ['delete_tax_config', { tax_id: 'x1' }, ['tax_configs'], { tax_configs: { data: [{ id: 'x1', name: 'TVQ' }] } }],
    ['set_default_tax_group', { group_id: 'g1' }, ['tax_groups', 'company_settings'], { tax_groups: { data: [{ id: 'g1', name: 'Québec' }] }, company_settings: { data: [] } }],
    ['create_service', { name: 'Lavage', price_cents: 12500 }, ['predefined_services'], { predefined_services: { data: [{ id: 's1', name: 'Lavage', default_price_cents: 12500 }] } }],
    ['update_service', { service_id: 's1', price_cents: 15000 }, ['predefined_services'], { predefined_services: { data: [{ id: 's1', name: 'Lavage', default_price_cents: 15000, pricing_unit: 'flat', item_type: 'service' }] } }],
    ['archive_service', { service_id: 's1' }, ['predefined_services'], { predefined_services: { data: [{ id: 's1', name: 'Lavage' }] } }],
    ['set_goal', { metric: 'revenue', target_value: 5000000, start_date: '2026-09-01', end_date: '2026-09-30' }, ['goals'], { goals: { data: [{ id: 'g1' }] } }],
    ['update_scheduled_report', { report_id: 'p1', enabled: false }, ['scheduled_reports'], { scheduled_reports: { data: [{ id: 'p1', recipient_email: 'a@b.ca', frequency: 'weekly', enabled: false }] } }],
    ['delete_scheduled_report', { report_id: 'p1' }, ['scheduled_reports'], { scheduled_reports: { data: [{ id: 'p1', recipient_email: 'a@b.ca' }] } }],
    ['delete_notification', { notification_id: 'n1' }, ['notifications'], { notifications: { data: [{ id: 'n1' }] } }],
  ];
  for (const [nom, args, tables, reponses] of cas) {
    it(nom, async () => {
      const { r, appels } = await executer(nom, args, reponses);
      expect(r.error, JSON.stringify(r)).toBeUndefined();
      for (const t of tables) expect(filtreOrg(appels, t), `${nom} : accès à ${t} sans filtre org`).toBe(true);
      expect(estFrancais(r.note), `${nom} : note = ${r.note}`).toBe(true);
      expect(vi.mocked(appelInterne)).not.toHaveBeenCalled();
    });
  }

  it('les insertions portent org_id = ctx.orgId dans la charge utile', async () => {
    const a = await executer('create_service', { name: 'Lavage', price_cents: 12500 }, { predefined_services: { data: [{ id: 's1', name: 'Lavage', default_price_cents: 12500 }] } });
    expect(a.appels[0].ops.find(([m]) => m === 'insert')![1]).toMatchObject({ org_id: 'org', name: 'Lavage', default_price_cents: 12500, taxable: true, item_type: 'service' });
    const g = await executer('set_goal', { metric: 'jobs', target_value: 40, start_date: '2026-09-01', end_date: '2026-09-30' }, { goals: { data: [{ id: 'g1' }] } });
    expect(g.appels[0].ops.find(([m]) => m === 'insert')![1]).toMatchObject({ org_id: 'org', created_by: 'u', metric: 'jobs', target_value: 40, period: 'monthly' });
    expect(g.r.target).toBe(40);
  });

  it('update_automation_message réécrit seulement l action visée et laisse les autres intactes', async () => {
    const regle = { id: 'r1', name: 'Avis', actions: [{ type: 'send_sms', config: { body: 'ancien' } }, { type: 'send_email', config: { body: 'ancien courriel', subject: 'Objet' } }, { type: 'create_task' }] };
    const { r, appels } = await executer('update_automation_message', { rule_id: 'r1', action_type: 'send_email', body: 'Nouveau', subject: 'Nouvel objet' }, { automation_rules: { data: [regle] } });
    expect(r.error).toBeUndefined();
    const maj = appels[1].ops.find(([m]) => m === 'update')![1];
    expect(maj.actions).toEqual([
      { type: 'send_sms', config: { body: 'ancien' } },
      { type: 'send_email', config: { body: 'Nouveau', subject: 'Nouvel objet' } },
      { type: 'create_task' },
    ]);
    const sans = await executer('update_automation_message', { rule_id: 'r1', action_type: 'send_email', body: 'x' }, { automation_rules: { data: [{ id: 'r1', name: 'Avis', actions: [{ type: 'create_task' }] }] } });
    expect(sans.r.error).toMatch(/n’envoie pas de courriel/);
  });

  it('delete_goal : visibilité prouvée à l identité (org_id) AVANT la suppression service filtrée par org_id ; introuvable = rien', async () => {
    const service = clientEnregistreur({ goals: { data: null } });
    vi.mocked(getServiceClient).mockReturnValue(service.client);
    const ok = await executer('delete_goal', { goal_id: 'g1' }, { goals: { data: [{ id: 'g1', metric: 'revenue' }] } });
    expect(ok.r).toMatchObject({ deleted: true, metrique: 'revenus' });
    expect(filtreOrg(ok.appels, 'goals')).toBe(true);
    expect(filtreOrg(service.appels, 'goals')).toBe(true);
    expect(service.appels[0].ops[0][0]).toBe('delete');

    const service2 = clientEnregistreur();
    vi.mocked(getServiceClient).mockReturnValue(service2.client);
    const ko = await executer('delete_goal', { goal_id: 'g9' }, { goals: { data: [] } });
    expect(ko.r.error).toMatch(/introuvable/);
    expect(service2.appels).toEqual([]);
  });

  it('0 ligne touchée (RLS ou id inconnu) = « introuvable », jamais un faux succès', async () => {
    for (const [nom, args] of [
      ['mark_conversation_read', { conversation_id: 'zz' }],
      ['toggle_automation_rule', { rule_id: 'zz', is_active: true }],
      ['archive_service', { service_id: 'zz' }],
      ['delete_scheduled_report', { report_id: 'zz' }],
    ] as Array<[string, Record<string, any>]>) {
      const { r } = await executer(nom, args, { conversations: { data: [] }, automation_rules: { data: [] }, predefined_services: { data: [] }, scheduled_reports: { data: [] } });
      expect(r.error, nom).toMatch(/introuvable/);
    }
    const langue = await executer('set_automation_language', { language: 'fr' }, { company_settings: { data: [] } });
    expect(langue.r.error).toMatch(/propriétaire ou un administrateur/);
  });

  it('les écritures directes de taxes sont réservées owner/admin, comme les routes', async () => {
    vi.mocked(isOrgAdminOrOwner).mockResolvedValue(false);
    for (const [nom, args] of [
      ['update_tax_config', { tax_id: 'x1', rate: 5 }],
      ['delete_tax_config', { tax_id: 'x1' }],
      ['set_default_tax_group', { group_id: 'g1' }],
    ] as Array<[string, Record<string, any>]>) {
      const { r, appels } = await executer(nom, args);
      expect(r.error, nom).toMatch(/propriétaire ou un administrateur/);
      expect(appels, nom).toEqual([]);
    }
  });

  it('rien à modifier / valeurs hors bornes = refus en mots simples, sans toucher la base', async () => {
    expect((await executer('update_email_template', { template_id: 't1' })).r.error).toMatch(/Rien à modifier/);
    expect((await executer('update_tax_config', { tax_id: 'x1', rate: 250 })).r.error).toMatch(/entre 0 et 100/);
    expect((await executer('set_goal', { metric: 'revenue', target_value: 10, start_date: '2026-09-30', end_date: '2026-09-01' })).r.error).toMatch(/date de fin/);
    expect((await executer('update_scheduled_report', { report_id: 'p1', day_of_week: 9 })).r.error).toMatch(/0 \(dimanche\) à 6/);
    const { appels } = await executer('update_service', { service_id: 's1', price_cents: -5 });
    expect(appels).toEqual([]);
  });
});

describe('écritures par route interne : bon chemin, refus traduits, note en français', () => {
  const cas: Array<[string, Record<string, any>, string | RegExp]> = [
    ['create_email_template', { name: 'Merci', type: 'generic', subject: 'Merci', body: 'Bonjour {{client_name}}' }, '/email-templates'],
    ['set_default_email_template', { template_id: UUID }, `/email-templates/${UUID}/set-default`],
    ['duplicate_email_template', { template_id: UUID }, `/email-templates/${UUID}/duplicate`],
    ['setup_taxes', { preset_key: 'qc' }, '/taxes/setup'],
    ['create_tax_config', { name: 'TVQ', rate: 9.975 }, '/taxes/config'],
    ['create_scheduled_report', { recipient_email: 'Boss@Exemple.ca', frequency: 'monthly', day_of_month: 1 }, '/scheduled-reports'],
    ['send_scheduled_report_now', { report_id: UUID }, `/scheduled-reports/${UUID}/send-now`],
    ['mark_notifications_read', {}, '/notifications/read'],
  ];
  for (const [nom, args, chemin] of cas) {
    it(nom, async () => {
      const { r, appels } = await executer(nom, args);
      expect(r.error, JSON.stringify(r)).toBeUndefined();
      expect(vi.mocked(appelInterne)).toHaveBeenCalledTimes(1);
      const [ctx, cheminAppele] = vi.mocked(appelInterne).mock.calls[0];
      expect(ctx.orgId).toBe('org');
      expect(cheminAppele).toEqual(chemin);
      expect(estFrancais(r.note), `${nom} : note = ${r.note}`).toBe(true);
      expect(appels).toEqual([]);
    });
  }

  it('les charges utiles reprennent le contrat des routes (preset en majuscules, courriel normalisé, ids en liste)', async () => {
    await executer('setup_taxes', { preset_key: 'qc' });
    expect(vi.mocked(appelInterne).mock.calls[0][2]).toEqual({ preset_key: 'QC', make_default: true });
    await executer('create_scheduled_report', { recipient_email: 'Boss@Exemple.ca', frequency: 'monthly', day_of_month: 1 });
    expect(vi.mocked(appelInterne).mock.calls[1][2]).toEqual({ recipient_email: 'boss@exemple.ca', frequency: 'monthly', day_of_month: 1 });
    await executer('mark_notifications_read', { ids: ['n1', 'n2'] });
    expect(vi.mocked(appelInterne).mock.calls[2][2]).toEqual({ ids: ['n1', 'n2'] });
    await executer('mark_notifications_read', {});
    expect(vi.mocked(appelInterne).mock.calls[3][2]).toEqual({});
    await executer('create_email_template', { name: 'Merci', type: 'generic', subject: 'S', body: 'B' });
    expect(vi.mocked(appelInterne).mock.calls[4][2]).toMatchObject({ variables: [], is_active: true, is_default: false });
  });

  it('un identifiant qui n est pas un UUID n est jamais injecté dans un chemin', async () => {
    for (const [nom, args] of [
      ['set_default_email_template', { template_id: '../autre' }],
      ['duplicate_email_template', { template_id: 'x' }],
      ['send_scheduled_report_now', { report_id: 'x/y' }],
    ] as Array<[string, Record<string, any>]>) {
      const { r } = await executer(nom, args);
      expect(r.error, nom).toMatch(/identifiant valide/);
    }
    expect(vi.mocked(appelInterne)).not.toHaveBeenCalled();
  });

  it('les refus de route deviennent des phrases d exploitant (409 région déjà là, 403 admin, 404 introuvable, 400 code inconnu)', async () => {
    vi.mocked(appelInterne).mockResolvedValueOnce({ ok: false, status: 409, json: { error: 'This tax region is already configured.' } });
    expect((await executer('setup_taxes', { preset_key: 'QC' })).r.error).toMatch(/déjà configurée/);
    vi.mocked(appelInterne).mockResolvedValueOnce({ ok: false, status: 403, json: {} });
    expect((await executer('create_tax_config', { name: 'X', rate: 1 })).r.error).toMatch(/propriétaire ou un administrateur/);
    vi.mocked(appelInterne).mockResolvedValueOnce({ ok: false, status: 404, json: {} });
    expect((await executer('set_default_email_template', { template_id: UUID })).r.error).toMatch(/introuvable/);
    vi.mocked(appelInterne).mockResolvedValueOnce({ ok: false, status: 400, json: {} });
    expect((await executer('setup_taxes', { preset_key: 'ZZ' })).r.error).toMatch(/Code de région inconnu/);
  });

  it('send_scheduled_report_now : réponse jamais revenue = « peut-être parti », sans lever (l empreinte reste)', async () => {
    vi.mocked(appelInterne).mockRejectedValueOnce(new AppelInterneIncertain('timeout'));
    const { r } = await executer('send_scheduled_report_now', { report_id: UUID });
    expect(r).toMatchObject({ incertain: true, sent: null });
    expect(r.note).toMatch(/peut-être été envoyé/);
  });
});

describe('lectures : filtrées par org, petites, jamais d erreur brute', () => {
  it('list_email_templates, get_tax_config, list_goals, list_scheduled_reports, list_notifications filtrent par org_id', async () => {
    for (const [nom, tables] of [
      ['list_email_templates', ['email_templates']],
      ['get_tax_config', ['tax_configs', 'tax_groups']],
      ['list_goals', ['goals']],
      ['list_scheduled_reports', ['scheduled_reports']],
      ['list_notifications', ['notifications']],
    ] as Array<[string, string[]]>) {
      const { r, appels } = await executer(nom, {}, { tax_groups: { data: [] } });
      expect(r.error, nom).toBeUndefined();
      for (const t of tables) expect(filtreOrg(appels, t), `${nom} : ${t}`).toBe(true);
    }
  });
  it('list_notifications ne lit que les siennes ou celles de toute l org, non écartées', async () => {
    const { appels } = await executer('list_notifications', { unread_only: true, limit: 500 });
    const ops = appels[0].ops;
    expect(ops).toContainEqual(['or', 'user_id.is.null,user_id.eq.u']);
    expect(ops).toContainEqual(['is', 'dismissed_at', null]);
    expect(ops).toContainEqual(['is', 'read_at', null]);
    expect(ops).toContainEqual(['limit', 50]);
  });
  it('get_tax_config nomme le groupe par défaut et ses taxes, en français', async () => {
    const { r } = await executer('get_tax_config', {}, {
      tax_configs: { data: [{ id: 'a', name: 'TPS', rate: '5.0000', is_active: true }, { id: 'b', name: 'TVQ', rate: '9.9750', is_active: true }] },
      tax_groups: { data: [{ id: 'g', name: 'Québec', region: 'QC', is_default: true, is_active: true }] },
      tax_group_items: { data: [{ tax_group_id: 'g', tax_config_id: 'a' }, { tax_group_id: 'g', tax_config_id: 'b' }] },
    });
    expect(r.default_group).toBe('Québec');
    expect(r.groups[0].taxes).toEqual(['TPS 5 %', 'TVQ 9.975 %']);
    expect(r.note).toContain('s’applique par défaut');
  });
  it('une erreur de la base devient un message générique, sans le texte brut', async () => {
    const { r } = await executer('list_goals', {}, { goals: { error: { message: 'relation "goals" does not exist', code: '42P01' } } });
    expect(r.error).toMatch(/consultation a échoué/);
    expect(JSON.stringify(r)).not.toMatch(/relation|42P01/);
  });
});
