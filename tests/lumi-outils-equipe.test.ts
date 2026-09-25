/**
 * Outils ÉQUIPE de Lumi (server/lib/agent/tools-equipe.ts) :
 * - chaque déclaration passe validerArgs avec un exemple minimal ;
 * - chaque écriture par ROUTE appelle le bon chemin avec le bon corps, au nom
 *   de l'utilisateur, et répond avec une note en français ;
 * - chaque écriture DIRECTE en base porte `org_id = ctx.orgId` sur chaque
 *   requête ;
 * - les manifestes (registre, permissions, topic) couvrent exactement les outils.
 * Tout est simulé : aucune base, aucune route réelle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../server/lib/agent/tools-etendus', async (importActual) => {
  const orig = await importActual<typeof import('../server/lib/agent/tools-etendus')>();
  return {
    ...orig,
    appelInterne: vi.fn(),
    // L'idempotence (empreinte en base) est testée ailleurs : ici l'action tourne directement.
    executerIdempotent: vi.fn(async (_ctx: unknown, _outil: string, _args: unknown, action: () => Promise<Record<string, any>>) => action()),
  };
});

import { appelInterne, executerIdempotent, AppelInterneIncertain } from '../server/lib/agent/tools-etendus';
import { OUTILS_EQUIPE, REGISTRE_EQUIPE, PERMISSIONS_EQUIPE, TOPICS_EQUIPE } from '../server/lib/agent/tools-equipe';
import { validerArgs } from '../server/lib/agent/validation-args';
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';
import { PERMISSION_KEYS, ROLE_PRESETS } from '../src/lib/permissions';
import { computePayPeriod, DEFAULT_PAYROLL_SETTINGS } from '../server/lib/payroll';

const lu = (p: string) => readFileSync(resolve(__dirname, '..', ...p.split('/')), 'utf8');

const ORG = 'org-1';
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const I1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const E1 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const MEMBRE_U1 = { user_id: U1, role: 'technician', status: 'active', full_name: 'Marc Roy', permissions: { ...ROLE_PRESETS.technician }, team_id: null };

// ── Client Supabase factice : chaîne enregistreuse, réponse par table ──
type Op = [string, unknown[]];
interface Appel { table: string; ops: Op[] }
type Reponse = { data?: any; error?: any } | any[] | Record<string, any> | null;
type Repondeur = (table: string, ops: Op[]) => Reponse;

const METHODES = ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'is', 'not', 'in', 'gte', 'lte', 'ilike', 'order', 'limit', 'maybeSingle', 'single'];

function clientFactice(repondre: Repondeur) {
  const appels: Appel[] = [];
  const from = (table: string) => {
    const appel: Appel = { table, ops: [] };
    appels.push(appel);
    const chaine: any = {};
    for (const m of METHODES) chaine[m] = (...a: unknown[]) => { appel.ops.push([m, a]); return chaine; };
    chaine.then = (ok: any, ko: any) => Promise.resolve().then(() => {
      const r = repondre(table, appel.ops);
      const enveloppe = r && typeof r === 'object' && !Array.isArray(r) && ('data' in r || 'error' in r);
      return enveloppe ? r : { data: r ?? null, error: null };
    }).then(ok, ko);
    return chaine;
  };
  return { client: { from } as any, appels };
}

const verbe = (a: Appel) => a.ops[0]?.[0];
const eqDe = (ops: Op[], col: string) => ops.find(([m, a]) => m === 'eq' && a[0] === col)?.[1][1];
const filtreOrg = (a: Appel) => a.ops.some(([m, args]) => m === 'eq' && args[0] === 'org_id' && args[1] === ORG);
const ecritures = (appels: Appel[]) => appels.filter((a) => ['insert', 'update', 'delete', 'upsert'].includes(String(verbe(a))));

interface Etat {
  roleDemandeur?: string;
  membre?: any;
  entreeActive?: any;
  entrees?: any[];
  doublonEquipe?: boolean;
  teamMembers?: any[];
  modele?: any;
}

function repondeur(etat: Etat = {}): Repondeur {
  return (table, ops) => {
    const v = ops[0]?.[0];
    switch (table) {
      case 'memberships':
        if (v === 'update') return { data: null, error: null };
        if (eqDe(ops, 'user_id') === ME) return { role: etat.roleDemandeur ?? 'owner' };
        if (eqDe(ops, 'user_id') === U1) return 'membre' in etat ? etat.membre : MEMBRE_U1;
        return [
          { user_id: U1, full_name: 'Marc Roy', team_id: T1, status: 'active' },
          { user_id: U2, full_name: 'Zoé Lambert', team_id: T1, status: 'suspended' },
        ];
      case 'payroll_settings':
        return v === 'upsert' ? { data: null, error: null } : null; // null = défauts de l'app
      case 'role_templates':
        return etat.modele ?? null;
      case 'teams': {
        if (v === 'insert') { const charge: any = ops[0][1][0]; return { id: T1, name: charge.name, color_hex: charge.color_hex }; }
        if (v === 'update') return ops.some(([m]) => m === 'select') ? { id: T1, name: 'Alpha', color_hex: '#3B82F6', is_active: false } : { data: null, error: null };
        if (ops.some(([m]) => m === 'ilike')) return etat.doublonEquipe ? [{ id: T1 }] : [];
        if (eqDe(ops, 'id') === T1) return { id: T1, name: 'Alpha' };
        return [{ id: T1, name: 'Alpha', color_hex: '#3B82F6', description: null, is_active: true }];
      }
      case 'time_entries':
        if (v === 'update') return { data: null, error: null };
        if (ops.some(([m, a]) => m === 'is' && a[0] === 'punch_out')) {
          return 'entreeActive' in etat ? etat.entreeActive : { id: E1, date: '2026-09-16', punch_in: '08:00:00', breaks: [] };
        }
        return etat.entrees ?? [];
      case 'team_members':
        if (v === 'select') return 'teamMembers' in etat ? etat.teamMembers : [{ id: 'tm-1', hourly_rate_cents: 2000 }];
        return { data: null, error: null };
      case 'invitations':
        return [{ id: I1, email: 'marc@exemple.ca', role: 'technician', status: 'pending', expires_at: '2099-01-01T00:00:00Z', created_at: '2026-09-16T00:00:00Z' }];
      case 'jobs':
      case 'schedule_events':
      case 'team_assignments':
        return { data: null, error: null };
    }
    return null;
  };
}

function outil(nom: string) {
  const t = OUTILS_EQUIPE.find((o) => o.declaration.name === nom);
  if (!t || typeof t.handler !== 'function') throw new Error(`outil absent ou sans handler : ${nom}`);
  return t;
}

/** Comme la garde : validerArgs PUIS handler. Renvoie aussi les appels du client factice. */
async function executer(nom: string, args: Record<string, any>, etat: Etat = {}) {
  const t = outil(nom);
  const validation = validerArgs(t.declaration.parameters, args);
  if (!validation.ok) throw new Error(`args invalides pour ${nom} : ${validation.erreur}`);
  const { client, appels } = clientFactice(repondeur(etat));
  const ctx = { client, orgId: ORG, userId: ME, accessToken: 'jeton' };
  const resultat = await t.handler!(validation.args, ctx); // handler vérifié par outil()
  return { resultat, appels, ctx };
}

const routeOk = (json: Record<string, any> = {}) => vi.mocked(appelInterne).mockResolvedValue({ ok: true, status: 200, json });
const NOTE_FR = /[éèêàçô]/;

beforeEach(() => {
  vi.mocked(appelInterne).mockReset();
  vi.mocked(executerIdempotent).mockClear();
});

const NOMS = OUTILS_EQUIPE.map((t) => t.declaration.name);
const ECRITURES = OUTILS_EQUIPE.filter((t) => t.kind === 'write').map((t) => t.declaration.name);

// ─────────────────────────────────────────────────────────────────

describe('déclarations des outils équipe', () => {
  it('24 outils, noms uniques, aucun ne collisionne avec un outil existant', () => {
    expect(NOMS).toHaveLength(24);
    expect(new Set(NOMS).size).toBe(NOMS.length);
    // Intégrés dans AGENT_TOOLS via outils-domaines.ts : chacun est enregistré une fois, sous son nom.
    for (const n of NOMS) expect(TOOLS_BY_NAME[n]?.declaration.name, n).toBe(n);
  });

  it('chaque déclaration accepte un exemple minimal conforme (sous-ensemble de validerArgs)', () => {
    for (const t of OUTILS_EQUIPE) {
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

  it('les écritures exigent l identité et tournent dans executerIdempotent sous leur propre nom ; descriptions en anglais', () => {
    const src = lu('server/lib/agent/tools-equipe.ts');
    for (const t of OUTILS_EQUIPE) {
      expect(typeof t.handler, t.declaration.name).toBe('function');
      expect(t.declaration.description, t.declaration.name).not.toMatch(NOTE_FR);
      if (t.kind === 'write') {
        expect(t.needsIdentity, t.declaration.name).toBe(true);
        expect(src, t.declaration.name).toContain(`executerIdempotent(ctx, '${t.declaration.name}', args`);
      }
    }
    expect(ECRITURES).toHaveLength(22);
  });

  it('exclut volontairement la conformité (déconnexion forcée, MFA, effacement) et l effacement définitif', () => {
    const src = lu('server/lib/agent/tools-equipe.ts');
    // Le module NOMME l'exclusion dans son en-tête ; ce qui compte, c'est qu'il n'importe ni n'appelle rien de la conformité.
    expect(src).not.toMatch(/from ['"][^'"]*team-compliance/);
    expect(src).not.toMatch(/\/team\/(force-logout|mfa-required|request-delete)/);
    expect(src).not.toContain('/invitations/delete-member');
    for (const n of NOMS) expect(n).not.toMatch(/logout|mfa|delete_member|request_delete/);
  });
});

describe('manifestes : registre, permissions, topic', () => {
  it('REGISTRE_EQUIPE couvre exactement les écritures ; un effet vers le client ne serait jamais réversible', () => {
    expect(Object.keys(REGISTRE_EQUIPE).sort()).toEqual([...ECRITURES].sort());
    for (const [n, a] of Object.entries(REGISTRE_EQUIPE)) {
      expect(typeof a.sensible, n).toBe('boolean');
      expect(typeof a.reversible, n).toBe('boolean');
      if (a.vers_client) expect(a.reversible, n).toBe(false);
    }
    // Inviter, changer un rôle, retirer, la paie et les permissions passent par la carte de confirmation.
    for (const n of ['invite_member', 'update_member_role', 'remove_member', 'set_hourly_rate', 'add_payroll_adjustment', 'mark_payroll_period_paid', 'update_role_preset', 'set_member_permissions', 'delete_team']) {
      expect(REGISTRE_EQUIPE[n].sensible, n).toBe(true);
    }
    expect(REGISTRE_EQUIPE.remove_member.reversible).toBe(true);        // suspension, reactivate_member existe
    expect(REGISTRE_EQUIPE.mark_payroll_period_paid.reversible).toBe(true); // unmark existe
    expect(REGISTRE_EQUIPE.delete_team.reversible).toBe(false);
  });

  it('PERMISSIONS_EQUIPE couvre exactement les outils, avec des clés de la page Rôles', () => {
    expect(Object.keys(PERMISSIONS_EQUIPE).sort()).toEqual([...NOMS].sort());
    for (const [n, p] of Object.entries(PERMISSIONS_EQUIPE)) {
      expect((PERMISSION_KEYS as readonly string[]).includes(p.cle), `${n} → ${p.cle}`).toBe(true);
      expect(p.capacite.length, n).toBeGreaterThan(3);
    }
    // Un technicien pointe (timesheets.update) mais n'invite pas ; la paie reste derrière financial.view_reports.
    expect(ROLE_PRESETS.technician[PERMISSIONS_EQUIPE.punch_in.cle]).toBe(true);
    expect(ROLE_PRESETS.technician[PERMISSIONS_EQUIPE.invite_member.cle]).toBe(false);
    expect(ROLE_PRESETS.technician[PERMISSIONS_EQUIPE.add_payroll_adjustment.cle]).toBe(false);
    expect(ROLE_PRESETS.sales_rep[PERMISSIONS_EQUIPE.set_hourly_rate.cle]).toBe(false);
  });

  it('TOPICS_EQUIPE.equipe liste chaque outil une fois, et rien d autre', () => {
    expect(Object.keys(TOPICS_EQUIPE)).toEqual(['equipe']);
    expect([...(TOPICS_EQUIPE.equipe ?? [])].sort()).toEqual([...NOMS].sort());
    expect(new Set(TOPICS_EQUIPE.equipe).size).toBe(NOMS.length);
  });
});

// ─────────────────────────────────────────────────────────────────

describe('écritures par route : bon chemin, bon corps, note en français, aucune écriture directe', () => {
  const periode = computePayPeriod(DEFAULT_PAYROLL_SETTINGS, '2026-09-16');
  const CAS: Array<{ outil: string; args: Record<string, any>; chemin: string; corps: Record<string, any>; json?: Record<string, any>; etat?: Etat }> = [
    { outil: 'invite_member', args: { email: 'Marc@Exemple.ca', role: 'technician', team_id: T1 }, chemin: '/invitations/send', corps: { email: 'marc@exemple.ca', role: 'technician', team_id: T1 }, json: { invitation: { id: I1 }, email_sent: true } },
    { outil: 'resend_invitation', args: { invitation_id: I1 }, chemin: '/invitations/resend', corps: { invitationId: I1 } },
    { outil: 'revoke_invitation', args: { invitation_id: I1 }, chemin: '/invitations/revoke', corps: { invitationId: I1 } },
    { outil: 'update_member_role', args: { user_id: U1, role: 'admin' }, chemin: '/invitations/update-role', corps: { memberId: U1, role: 'admin' } },
    // Sans `role` : le rôle courant est relu en base et renvoyé tel quel (la route l'exige).
    { outil: 'update_member_role', args: { user_id: U1, clear_team: true }, chemin: '/invitations/update-role', corps: { memberId: U1, role: 'technician', team_id: null } },
    { outil: 'remove_member', args: { user_id: U1 }, chemin: '/invitations/remove-member', corps: { userId: U1 } },
    { outil: 'reactivate_member', args: { user_id: U1 }, chemin: '/invitations/reactivate-member', corps: { userId: U1 }, etat: { membre: { ...MEMBRE_U1, status: 'suspended' } } },
    { outil: 'punch_in', args: { notes: 'chantier Nord' }, chemin: '/timesheets/punch-in', corps: { job_id: null, team_id: null, notes: 'chantier Nord' }, json: { entry: { id: E1, date: '2026-09-16', punch_in: '08:00:00' } } },
    { outil: 'punch_out', args: {}, chemin: '/timesheets/punch-out', corps: {}, json: { entry: { id: E1 } } },
    // Sans entry_id : l'entrée ouverte de l'utilisateur est retrouvée en base.
    { outil: 'start_break', args: {}, chemin: '/timesheets/break/start', corps: { entry_id: E1 } },
    { outil: 'end_break', args: { entry_id: E1 }, chemin: '/timesheets/break/end', corps: { entry_id: E1 } },
    // Période calculée depuis les réglages de l'org (défauts ici) autour de period_ref.
    { outil: 'add_payroll_adjustment', args: { user_id: U1, amount_cents: -5000, note: 'outil perdu', period_ref: '2026-09-16' }, chemin: '/payroll/adjustments', corps: { user_id: U1, period_start: periode.start, period_end: periode.end, amount_cents: -5000, note: 'outil perdu' }, json: { id: 'adj-1' } },
    { outil: 'mark_payroll_period_paid', args: { user_id: U1, note: 'virement 42' }, chemin: '/payroll/mark-paid', corps: { user_id: U1, note: 'virement 42' }, json: { user_id: U1, total_cents: 123456, paid_at: '2026-09-16T12:00:00Z' } },
    { outil: 'unmark_payroll_period_paid', args: { user_id: U1, period_ref: '2026-09-16' }, chemin: '/payroll/unmark-paid', corps: { user_id: U1, ref: '2026-09-16' } },
    // Carte COMPLÈTE envoyée (la route remplace tout) : le préréglage + le seul changement demandé.
    { outil: 'update_role_preset', args: { role: 'technician', permissions: { 'timesheets.update': false } }, chemin: '/roles/update-preset', corps: { role: 'technician', permissions: { ...ROLE_PRESETS.technician, 'timesheets.update': false } }, json: { affected_members: 3 } },
    { outil: 'set_member_permissions', args: { user_id: U1, permissions: { 'jobs.create': true } }, chemin: '/roles/member-permissions', corps: { user_id: U1, permissions: { ...ROLE_PRESETS.technician, 'jobs.create': true } }, json: { permissions: { ...ROLE_PRESETS.technician, 'jobs.create': true } } },
    { outil: 'reset_member_permissions', args: { user_id: U1 }, chemin: '/roles/member-permissions/reset', corps: { user_id: U1 }, json: { template_found: true } },
  ];

  for (const cas of CAS) {
    it(`${cas.outil} → POST /api${cas.chemin}`, async () => {
      routeOk(cas.json);
      const { resultat, appels, ctx } = await executer(cas.outil, cas.args, cas.etat);
      expect(appelInterne).toHaveBeenCalledTimes(1);
      expect(appelInterne).toHaveBeenCalledWith(ctx, cas.chemin, cas.corps);
      expect(executerIdempotent).toHaveBeenCalledWith(ctx, cas.outil, expect.any(Object), expect.any(Function));
      expect(resultat.error).toBeUndefined();
      expect(resultat.note).toMatch(NOTE_FR);
      // Le client de l'utilisateur ne sert qu'à LIRE (rôle, membre, réglages) : la route écrit.
      expect(ecritures(appels)).toEqual([]);
      for (const a of appels) expect(filtreOrg(a), `${cas.outil} lit ${a.table} sans org_id`).toBe(true);
    });
  }

  it('invite_member sans courriel parti : renvoie le lien et le dit', async () => {
    routeOk({ invitation: { id: I1 }, email_sent: false, email_skipped_reason: 'smtp absent', invite_link: 'https://lume/invite/abc' });
    const { resultat } = await executer('invite_member', { email: 'marc@exemple.ca', role: 'sales_rep' });
    expect(resultat).toMatchObject({ invited: true, email_sent: false, invite_link: 'https://lume/invite/abc', role: 'représentant' });
    expect(resultat.note).toContain('transmets le lien');
  });

  it('les identifiants du modèle ne sont jamais renvoyés bruts en cas de succès partiel : le résultat reste petit', async () => {
    routeOk({ entry: { id: E1, date: '2026-09-16', punch_in: '08:00:00', punch_out: '16:30:00', breaks: [{ start: '12:00:00', end: '12:30:00' }], org_id: ORG, employee_id: ME, notes: null } });
    const { resultat } = await executer('punch_out', { entry_id: E1 });
    expect(Object.keys(resultat).sort()).toEqual(['date', 'entry_id', 'note', 'punch_in', 'punch_out', 'punched_out']);
  });
});

describe('refus de route et réponse jamais revenue', () => {
  it('403 → phrase « Ton rôle dans Lume » (jamais le JSON brut), empreinte libérée par le throw', async () => {
    vi.mocked(appelInterne).mockResolvedValue({ ok: false, status: 403, json: { error: 'Only admins or owners can send invitations.' } });
    await expect(executer('invite_member', { email: 'a@b.ca', role: 'technician' })).rejects.toThrow(/Ton rôle dans Lume ne permet pas l'invitation de a@b\.ca/);
  });

  it('plafond de sièges et membre non suspendu sont traduits depuis le code de la route', async () => {
    vi.mocked(appelInterne).mockResolvedValue({ ok: false, status: 403, json: { error: 'Seat limit reached (3 used).', code: 'seat_limit_reached', capacity: 3 } });
    await expect(executer('reactivate_member', { user_id: U1 })).rejects.toThrow(/Plafond de sièges atteint \(3 utilisés\)/);
    vi.mocked(appelInterne).mockResolvedValue({ ok: false, status: 400, json: { error: 'Member is not suspended.', code: 'not_suspended' } });
    await expect(executer('reactivate_member', { user_id: U1 })).rejects.toThrow(/pas suspendu/);
  });

  it('404 et 409 gardent un message d exploitant', async () => {
    vi.mocked(appelInterne).mockResolvedValue({ ok: false, status: 404, json: { error: 'Invitation not found.' } });
    await expect(executer('revoke_invitation', { invitation_id: I1 })).rejects.toThrow(/Introuvable dans cette entreprise/);
    vi.mocked(appelInterne).mockResolvedValue({ ok: false, status: 409, json: { error: 'Already punched in' } });
    await expect(executer('punch_in', {})).rejects.toThrow(/le pointage d.entrée : Already punched in/);
  });

  it('timeout (AppelInterneIncertain) → résultat « incertain » SANS lever : l empreinte est gardée, pas de doublon', async () => {
    vi.mocked(appelInterne).mockRejectedValue(new AppelInterneIncertain('timeout'));
    const { resultat } = await executer('add_payroll_adjustment', { user_id: U1, amount_cents: 2500 });
    expect(resultat.incertain).toBe(true);
    expect(resultat.note).toMatch(/PEUT-ÊTRE fait/);
    expect(appelInterne).toHaveBeenCalledTimes(1);
  });

  it('une autre erreur d appel interne (session absente) remonte telle quelle', async () => {
    vi.mocked(appelInterne).mockRejectedValue(new Error('Cette action exige votre session Lume — reconnectez le connecteur dans Claude.'));
    await expect(executer('punch_in', {})).rejects.toThrow(/session Lume/);
  });
});

// ─────────────────────────────────────────────────────────────────

describe('écritures directes en base : org_id sur chaque requête', () => {
  it('create_team : vérifie le doublon puis insère avec org_id = ctx.orgId', async () => {
    const { resultat, appels } = await executer('create_team', { name: ' Alpha ', color_hex: '#FF0000', description: 'Crew du nord' });
    const [doublon, insertion] = appels;
    expect(doublon.table).toBe('teams');
    expect(filtreOrg(doublon)).toBe(true);
    expect(doublon.ops).toContainEqual(['is', ['deleted_at', null]]);
    expect(insertion.table).toBe('teams');
    expect(insertion.ops[0]).toEqual(['insert', [{ org_id: ORG, name: 'Alpha', color_hex: '#FF0000', description: 'Crew du nord', is_active: true }]]);
    expect(resultat).toMatchObject({ created: true, team_id: T1, name: 'Alpha' });
    expect(resultat.note).toMatch(NOTE_FR);
    expect(appelInterne).not.toHaveBeenCalled();
  });

  it('create_team : doublon de nom refusé, couleur invalide refusée', async () => {
    await expect(executer('create_team', { name: 'Alpha' }, { doublonEquipe: true })).rejects.toThrow(/existe déjà/);
    await expect(executer('create_team', { name: 'Beta', color_hex: 'rouge' })).rejects.toThrow(/#RRGGBB/);
  });

  it('update_team : update filtré sur id + org_id + non supprimée ; rien à changer → refus', async () => {
    const { resultat, appels } = await executer('update_team', { team_id: T1, is_active: false, description: '' });
    const maj = appels[0];
    expect(maj.table).toBe('teams');
    expect(maj.ops[0][0]).toBe('update');
    expect((maj.ops[0][1][0] as any)).toMatchObject({ is_active: false, description: null });
    expect(maj.ops).toContainEqual(['eq', ['id', T1]]);
    expect(filtreOrg(maj)).toBe(true);
    expect(maj.ops).toContainEqual(['is', ['deleted_at', null]]);
    expect(resultat).toMatchObject({ updated: true, active: false });
    await expect(executer('update_team', { team_id: T1 })).rejects.toThrow(/Rien à changer/);
  });

  it('delete_team : même séquence que l écran (teams, jobs, schedule_events, memberships, team_assignments), org_id partout', async () => {
    const { resultat, appels } = await executer('delete_team', { team_id: T1 });
    expect(appels.map((a) => `${a.table}:${verbe(a)}`)).toEqual([
      'teams:select', 'teams:update', 'jobs:update', 'schedule_events:update', 'memberships:update', 'team_assignments:delete',
    ]);
    for (const a of appels) {
      expect(filtreOrg(a), `${a.table} sans org_id`).toBe(true);
      if (a.table !== 'teams') expect(a.ops).toContainEqual(['eq', ['team_id', T1]]);
    }
    expect((appels[1].ops[0][1][0] as any).deleted_at).toBeTruthy();
    expect(resultat).toMatchObject({ deleted: true, name: 'Alpha' });
  });

  it('set_hourly_rate : membre vérifié dans l org, update de team_members filtré org_id, ancien taux rapporté', async () => {
    const { resultat, appels } = await executer('set_hourly_rate', { user_id: U1, hourly_rate_cents: 2500 });
    expect(appels.map((a) => `${a.table}:${verbe(a)}`)).toEqual(['memberships:select', 'team_members:select', 'team_members:update']);
    for (const a of appels) expect(filtreOrg(a), a.table).toBe(true);
    expect(appels[0].ops).toContainEqual(['eq', ['user_id', U1]]);
    expect((appels[2].ops[0][1][0] as any).hourly_rate_cents).toBe(2500);
    expect(resultat).toMatchObject({ hourly_rate_cents: 2500, previous_hourly_rate_cents: 2000, name: 'Marc Roy' });
    expect(resultat.note).toMatch(/25,00/);
    expect(resultat.note).toMatch(/20,00/);
  });

  it('set_hourly_rate : fiche team_members absente → création avec org_id et le nom de la membership ; bornes', async () => {
    const { appels } = await executer('set_hourly_rate', { user_id: U1, hourly_rate_cents: 3000 }, { teamMembers: [] });
    const insertion = appels[2];
    expect(insertion.table).toBe('team_members');
    expect(insertion.ops[0]).toEqual(['insert', [{ org_id: ORG, user_id: U1, email: '', first_name: 'Marc', last_name: 'Roy', phone: '', hourly_rate_cents: 3000 }]]);
    await expect(executer('set_hourly_rate', { user_id: U1, hourly_rate_cents: -1 })).rejects.toThrow(/entre 0 et/);
    await expect(executer('set_hourly_rate', { user_id: U1, hourly_rate_cents: 999999 })).rejects.toThrow(/entre 0 et/);
    await expect(executer('set_hourly_rate', { user_id: U1, hourly_rate_cents: 100 }, { membre: null })).rejects.toThrow(/introuvable dans cette entreprise/);
  });

  it('approve_timesheet : admin seulement ; approuve les entrées fermées non approuvées, marqueur de l écran + approved_by', async () => {
    const entrees = [
      { id: E1, date: '2026-09-14', notes: 'matin', punch_out: '16:00:00' },
      { id: I1, date: '2026-09-15', notes: '[APPROVED] déjà', punch_out: '16:00:00' },
      { id: T1, date: '2026-09-16', notes: null, punch_out: null },
    ];
    const { resultat, appels } = await executer('approve_timesheet', { user_id: U1, from: '2026-09-14', to: '2026-09-20' }, { entrees });
    expect(appels.map((a) => `${a.table}:${verbe(a)}`)).toEqual(['memberships:select', 'memberships:select', 'time_entries:select', 'time_entries:update']);
    for (const a of appels) expect(filtreOrg(a), a.table).toBe(true);
    const lecture = appels[2];
    expect(lecture.ops).toContainEqual(['eq', ['employee_id', U1]]);
    expect(lecture.ops).toContainEqual(['gte', ['date', '2026-09-14']]);
    expect(lecture.ops).toContainEqual(['lte', ['date', '2026-09-20']]);
    const maj = appels[3];
    expect((maj.ops[0][1][0] as any)).toMatchObject({ notes: '[APPROVED] matin', approved_by: ME });
    expect(maj.ops).toContainEqual(['eq', ['id', E1]]);
    expect(resultat).toMatchObject({ approved_count: 1, already_approved: 1, still_open: 1, dates: ['2026-09-14'] });
    expect(resultat.note).toMatch(/1 entrée\(s\) de Marc Roy approuvée/);
  });

  it('approve_timesheet : un technicien est refusé avant toute lecture des heures ; rien à approuver reste lisible', async () => {
    const refus = executer('approve_timesheet', { user_id: U1, from: '2026-09-14', to: '2026-09-20' }, { roleDemandeur: 'technician', entrees: [{ id: E1, date: '2026-09-14', notes: null, punch_out: '16:00:00' }] });
    await expect(refus).rejects.toThrow(/réservé aux administrateurs et propriétaires/);
    const { resultat, appels } = await executer('approve_timesheet', { user_id: U1, from: '2026-09-14', to: '2026-09-20' }, { entrees: [] });
    expect(ecritures(appels)).toEqual([]);
    expect(resultat).toMatchObject({ approved_count: 0 });
    expect(resultat.note).toMatch(/Aucune entrée de temps/);
    await expect(executer('approve_timesheet', { user_id: U1, from: '2026-09-21', to: '2026-09-20' })).rejects.toThrow(/from doit précéder to/);
  });

  it('update_payroll_settings : admin seulement, fusion avec les réglages courants, upsert avec org_id', async () => {
    const { resultat, appels } = await executer('update_payroll_settings', { pay_period_type: 'weekly', pay_day_offset: 3 });
    expect(appels.map((a) => `${a.table}:${verbe(a)}`)).toEqual(['memberships:select', 'payroll_settings:select', 'payroll_settings:upsert']);
    expect(filtreOrg(appels[1])).toBe(true);
    const [charge, options] = appels[2].ops[0][1] as [Record<string, any>, Record<string, any>];
    expect(charge).toMatchObject({ org_id: ORG, pay_period_type: 'weekly', pay_day_offset: 3, anchor_date: DEFAULT_PAYROLL_SETTINGS.anchor_date, timezone: DEFAULT_PAYROLL_SETTINGS.timezone, created_by: ME });
    expect(options).toEqual({ onConflict: 'org_id' });
    expect(resultat.settings).toEqual({ pay_period_type: 'weekly', anchor_date: DEFAULT_PAYROLL_SETTINGS.anchor_date, pay_day_offset: 3, timezone: DEFAULT_PAYROLL_SETTINGS.timezone });
    expect(resultat.current_period.start).toBeTruthy();
    expect(resultat.note).toMatch(/Réglages de paie enregistrés/);
    await expect(executer('update_payroll_settings', { pay_period_type: 'weekly' }, { roleDemandeur: 'sales_rep' })).rejects.toThrow(/réservé aux administrateurs/);
    await expect(executer('update_payroll_settings', {})).rejects.toThrow(/Rien à changer/);
    await expect(executer('update_payroll_settings', { timezone: 'Mars/Olympus' })).rejects.toThrow(/fuseau IANA/);
    await expect(executer('update_payroll_settings', { pay_day_offset: 40 })).rejects.toThrow(/entre 0 et 31/);
  });
});

describe('lectures', () => {
  it('list_teams : équipes non supprimées de l org, membres actifs regroupés par équipe', async () => {
    const { resultat, appels } = await executer('list_teams', {});
    expect(appels.map((a) => a.table)).toEqual(['teams', 'memberships']);
    for (const a of appels) expect(filtreOrg(a)).toBe(true);
    expect(appels[0].ops).toContainEqual(['is', ['deleted_at', null]]);
    expect(resultat).toEqual({ count: 1, teams: [{ id: T1, name: 'Alpha', color_hex: '#3B82F6', description: null, active: true, members: ['Marc Roy'] }] });
  });

  it('list_invitations : en attente par défaut, statuts traduits', async () => {
    const { resultat, appels } = await executer('list_invitations', {});
    expect(filtreOrg(appels[0])).toBe(true);
    expect(appels[0].ops).toContainEqual(['eq', ['status', 'pending']]);
    expect(resultat.invitations[0]).toMatchObject({ id: I1, email: 'marc@exemple.ca', role: 'technicien', statut: 'en attente' });
    const tout = await executer('list_invitations', { status: 'all' });
    expect(tout.appels[0].ops.some(([m, a]) => m === 'eq' && a[0] === 'status')).toBe(false);
  });
});

describe('validation métier avant tout appel', () => {
  it('courriel invalide, rôle owner, identifiant non uuid', async () => {
    await expect(executer('invite_member', { email: 'pas-un-courriel', role: 'technician' })).rejects.toThrow(/adresse courriel/);
    expect(validerArgs(outil('invite_member').declaration.parameters, { email: 'a@b.ca', role: 'owner' }).ok).toBe(false);
    await expect(executer('remove_member', { user_id: 'marc' })).rejects.toThrow(/identifiant valide/);
    expect(appelInterne).not.toHaveBeenCalled();
  });

  it('remove_member : soi-même refusé ; déjà suspendu → rien à refaire, sans appel', async () => {
    await expect(executer('remove_member', { user_id: ME })).rejects.toThrow(/toi-même/);
    routeOk();
    const { resultat } = await executer('remove_member', { user_id: U1 }, { membre: { ...MEMBRE_U1, status: 'suspended' } });
    expect(resultat).toMatchObject({ removed: true });
    expect(resultat.note).toMatch(/déjà suspendu/);
    expect(appelInterne).not.toHaveBeenCalled();
  });

  it('update_member_role : rien à changer, ou team_id et clear_team ensemble → refus', async () => {
    await expect(executer('update_member_role', { user_id: U1 })).rejects.toThrow(/Rien à changer/);
    await expect(executer('update_member_role', { user_id: U1, team_id: T1, clear_team: true })).rejects.toThrow(/excluent/);
    expect(appelInterne).not.toHaveBeenCalled();
  });

  it('add_payroll_adjustment : montant nul ou trop grand, période à moitié donnée', async () => {
    await expect(executer('add_payroll_adjustment', { user_id: U1, amount_cents: 0 })).rejects.toThrow(/non nul/);
    await expect(executer('add_payroll_adjustment', { user_id: U1, amount_cents: 20_000_000 })).rejects.toThrow(/100 000/);
    await expect(executer('add_payroll_adjustment', { user_id: U1, amount_cents: 100, period_start: '2026-09-01' })).rejects.toThrow(/vont ensemble/);
    await expect(executer('add_payroll_adjustment', { user_id: U1, amount_cents: 100, period_start: '2026-09-10', period_end: '2026-09-01' })).rejects.toThrow(/précéder/);
    expect(appelInterne).not.toHaveBeenCalled();
  });

  it('permissions : clé inconnue refusée, valeur non booléenne refusée, aucun changement effectif → pas d appel', async () => {
    await expect(executer('update_role_preset', { role: 'technician', permissions: { 'jobs.fly': true } })).rejects.toThrow(/Permission\(s\) inconnue\(s\) : jobs\.fly/);
    await expect(executer('set_member_permissions', { user_id: U1, permissions: { 'jobs.read': 'oui' } })).rejects.toThrow(/vrai ou faux/);
    await expect(executer('set_member_permissions', { user_id: U1, permissions: {} })).rejects.toThrow(/au moins une clé/);
    const { resultat } = await executer('update_role_preset', { role: 'technician', permissions: { 'jobs.read': true } });
    expect(resultat).toMatchObject({ updated: false });
    const perso = await executer('set_member_permissions', { user_id: U1, permissions: { 'clients.read': true } });
    expect(perso.resultat).toMatchObject({ updated: false });
    expect(appelInterne).not.toHaveBeenCalled();
  });

  it('update_role_preset part du modèle de l org quand il existe ; set_member_permissions rapporte ce que la route a blanchi', async () => {
    routeOk({ affected_members: 1 });
    const modele = { permissions: { ...ROLE_PRESETS.technician, 'jobs.create': true } };
    await executer('update_role_preset', { role: 'technician', permissions: { 'gps.read': false } }, { modele });
    expect(appelInterne).toHaveBeenCalledWith(expect.anything(), '/roles/update-preset', { role: 'technician', permissions: { ...modele.permissions, 'gps.read': false } });

    routeOk({ permissions: { ...ROLE_PRESETS.technician, 'financial.view_pricing': false } });
    const { resultat } = await executer('set_member_permissions', { user_id: U1, permissions: { 'financial.view_pricing': true } });
    expect(resultat).toMatchObject({ updated: true, refused: ['financial.view_pricing'], changes: [] });
    expect(resultat.note).toMatch(/un technicien ne peut pas voir les montants/);
  });

  it('le propriétaire n a ni permissions à ajuster ni à réinitialiser', async () => {
    const proprio = { ...MEMBRE_U1, role: 'owner', full_name: 'Rafba' };
    await expect(executer('set_member_permissions', { user_id: U1, permissions: { 'jobs.read': false } }, { membre: proprio })).rejects.toThrow(/propriétaire a toujours tous les accès/);
    await expect(executer('reset_member_permissions', { user_id: U1 }, { membre: proprio })).rejects.toThrow(/propriétaire/);
    expect(appelInterne).not.toHaveBeenCalled();
  });

  it('start_break / end_break sans pointage ouvert : refus lisible, sans appel de route', async () => {
    await expect(executer('start_break', {}, { entreeActive: null })).rejects.toThrow(/d.abord pointer/);
    await expect(executer('end_break', {}, { entreeActive: null })).rejects.toThrow(/aucune pause à terminer/);
    expect(appelInterne).not.toHaveBeenCalled();
  });
});
