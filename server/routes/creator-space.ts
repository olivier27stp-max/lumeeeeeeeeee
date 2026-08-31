// Creator Space — espace interne plateforme (Overview / Logs / Engagement /
// Companies), réservé aux comptes de platformAdminIds (PLATFORM_OWNER_ID ∪
// PLATFORM_ADMIN_IDS), jamais aux admins de workspace client. Chaque handler
// se garde lui-même via requireCreatorSpace (aucune entrée dans
// ROUTE_PERMISSIONS : ces routes ne font pas partie du RBAC tenant).
// Lecture seule : aucun endpoint n'écrit quoi que ce soit. Les identifiants
// Stripe, adresses IP, user-agents et données de facturation confidentielles
// ne sortent jamais d'ici — voir tests/creator-space/route-guards.test.ts.
// Les journaux (Logs, Overview, Engagement compagnie) n'exposent AUCUN nom de
// personne d'un autre tenant : identifiants seulement — la révélation d'un
// nom passe par creator-space-audit.ts (raison requise, journalisée). Chaque
// consultation est consignée par creatorSpaceViewLogger (même fichier), via
// res.locals.creatorSpaceUserId posé par la garde ci-dessous.

import { Router } from 'express';
import type express from 'express';
import { requireAuthedClient, getServiceClient, buildSupabaseWithAuth } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { platformAdminIds } from '../lib/config';

const router = Router();

type Authed = NonNullable<Awaited<ReturnType<typeof requireAuthedClient>>>;
type Admin = ReturnType<typeof getServiceClient>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Garde plateforme : même pattern que la console des migrations assistées.
 *  Exportée pour creator-space-audit.ts (reveal-actor) — toute route qui
 *  l'utilise hérite du même contrôle platformAdminIds. */
export async function requireCreatorSpace(req: express.Request, res: express.Response): Promise<Authed | null> {
  if (platformAdminIds.size === 0) {
    res.status(503).json({ error: 'Creator Space non configuré.' });
    return null;
  }
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  if (!platformAdminIds.has(auth.user.id)) {
    res.status(403).json({ error: 'Accès refusé.' });
    return null;
  }
  // Identité pour le journal d'accès (creatorSpaceViewLogger) — posée
  // seulement une fois l'appartenance à platformAdminIds vérifiée.
  res.locals.creatorSpaceUserId = auth.user.id;
  return auth;
}

function cleanQ(raw: unknown): string {
  // Entrée de recherche : bornée et neutralisée (jamais interpolée dans un
  // filtre disjonctif PostgREST — la recherche se fait en mémoire).
  return typeof raw === 'string' ? raw.trim().slice(0, 120) : '';
}

function pageParam(raw: unknown): number {
  return Math.max(1, parseInt(String(raw ?? '1'), 10) || 1);
}

// Forme « billing sécuritaire » (même esprit que billing.ts sans
// financial.view_payments) : jamais d'identifiants Stripe ni de profil de
// facturation (adresse, courriel de facturation, identifiant client).
function safeSubscription(sub: any, plan: any | null) {
  if (!sub) return null;
  return {
    status: sub.status,
    interval: sub.interval,
    currency: sub.currency,
    amount_cents: sub.amount_cents,
    current_period_start: sub.current_period_start,
    current_period_end: sub.current_period_end,
    trial_end: sub.trial_end ?? null,
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: sub.canceled_at,
    created_at: sub.created_at,
    extra_seats: sub.extra_seats ?? 0,
    extra_offices: sub.extra_offices ?? 0,
    plan: plan ? { name: plan.name, name_fr: plan.name_fr, slug: plan.slug, seats_included: plan.seats_included, included_offices: plan.included_offices } : null,
  };
}

async function loadPlansById(admin: Admin): Promise<Map<string, any>> {
  const { data } = await admin.from('plans').select('id, name, name_fr, slug, seats_included, included_offices');
  return new Map((data ?? []).map((p: any) => [p.id, p]));
}

/** Nom d'affichage des compagnies : company_settings.company_name > orgs.name. */
async function loadOrgDirectory(admin: Admin) {
  const [{ data: orgs, error: orgErr }, { data: settings, error: setErr }] = await Promise.all([
    admin.from('orgs').select('id, name, created_by, created_at, company_group_id, logo_url'),
    admin.from('company_settings').select('org_id, company_name, email'),
  ]);
  if (orgErr) throw orgErr;
  if (setErr) throw setErr;
  const settingsByOrg = new Map<string, any>((settings ?? []).map((s: any) => [s.org_id, s]));
  const rows = (orgs ?? []).map((o: any) => ({
    ...o,
    display_name: (settingsByOrg.get(o.id)?.company_name || '').trim() || o.name,
    contact_email: settingsByOrg.get(o.id)?.email || '',
  }));
  return { orgs: rows, displayNameById: new Map<string, string>(rows.map((o: any) => [o.id, o.display_name])) };
}

async function loadActorNames(admin: Admin, userIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return new Map();
  const [{ data: profiles }, { data: members }] = await Promise.all([
    admin.from('profiles').select('id, full_name').in('id', ids),
    admin.from('memberships').select('user_id, full_name').in('user_id', ids),
  ]);
  const names = new Map<string, string>();
  for (const m of members ?? []) if (m.full_name) names.set(m.user_id, m.full_name);
  for (const p of profiles ?? []) if (p.full_name) names.set(p.id, p.full_name);
  return names;
}

/** Engagement par compagnie — mêmes formules que l'ancien back-office :
 *  dernière activité = max(login, job créé, fallback création de l'org) ;
 *  ≤1 j high, ≤7 j medium, ≤30 j low, sinon inactive. */
async function computeWorkspaceEngagement(admin: Admin) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const { orgs } = await loadOrgDirectory(admin);
  const orgIds = orgs.map((o: any) => o.id);

  const [membershipsResult, recentJobsResult, recentLoginsResult] = await Promise.all([
    admin.from('memberships').select('org_id, user_id'),
    admin.from('jobs').select('org_id, created_at').is('deleted_at', null).gte('created_at', thirtyDaysAgo.toISOString()),
    admin.from('login_history').select('org_id, created_at').gte('created_at', thirtyDaysAgo.toISOString()),
  ]);

  const membersByOrg = new Map<string, number>();
  const allUserIds = new Set<string>();
  for (const m of membershipsResult.data ?? []) {
    membersByOrg.set(m.org_id, (membersByOrg.get(m.org_id) || 0) + 1);
    allUserIds.add(m.user_id);
  }

  const jobsByOrg = new Map<string, number>();
  const lastJobByOrg = new Map<string, string>();
  for (const j of recentJobsResult.data ?? []) {
    jobsByOrg.set(j.org_id, (jobsByOrg.get(j.org_id) || 0) + 1);
    const prev = lastJobByOrg.get(j.org_id);
    if (!prev || j.created_at > prev) lastJobByOrg.set(j.org_id, j.created_at);
  }

  const loginsByOrg = new Map<string, number>();
  const lastLoginByOrg = new Map<string, string>();
  for (const l of recentLoginsResult.data ?? []) {
    if (!l.org_id) continue;
    loginsByOrg.set(l.org_id, (loginsByOrg.get(l.org_id) || 0) + 1);
    const prev = lastLoginByOrg.get(l.org_id);
    if (!prev || l.created_at > prev) lastLoginByOrg.set(l.org_id, l.created_at);
  }

  const workspaces = orgs.map((o: any) => {
    const lastActivity = lastLoginByOrg.get(o.id) || lastJobByOrg.get(o.id) || o.created_at;
    const daysSinceActivity = Math.floor((now.getTime() - new Date(lastActivity).getTime()) / 86400000);
    let engagement: 'high' | 'medium' | 'low' | 'inactive' = 'inactive';
    if (daysSinceActivity <= 1) engagement = 'high';
    else if (daysSinceActivity <= 7) engagement = 'medium';
    else if (daysSinceActivity <= 30) engagement = 'low';
    return {
      id: o.id,
      name: o.display_name,
      created_at: o.created_at,
      member_count: membersByOrg.get(o.id) || 0,
      jobs_30d: jobsByOrg.get(o.id) || 0,
      logins_30d: loginsByOrg.get(o.id) || 0,
      last_activity: lastActivity,
      days_since_activity: daysSinceActivity,
      engagement,
    };
  });
  workspaces.sort((a: any, b: any) => a.days_since_activity - b.days_since_activity);

  return { workspaces, totalUsers: allUserIds.size };
}

/** Org ids du même company_group (bureaux d'une même compagnie). */
async function groupOrgIds(admin: Admin, orgId: string): Promise<string[]> {
  const { data: org } = await admin.from('orgs').select('id, company_group_id').eq('id', orgId).maybeSingle();
  if (!org) return [];
  if (!org.company_group_id) return [org.id];
  const { data: siblings } = await admin.from('orgs').select('id').eq('company_group_id', org.company_group_id);
  return (siblings ?? []).map((s: any) => s.id);
}

// ── Sonde d'identité douce pour le gate frontend — ne 401 jamais. ─────────
router.get('/creator-space/check', async (req, res) => {
  try {
    if (platformAdminIds.size === 0) return res.json({ isCreator: false });
    const client = buildSupabaseWithAuth(req.header('authorization'));
    const { data } = await client.auth.getUser();
    return res.json({ isCreator: !!data?.user?.id && platformAdminIds.has(data.user.id) });
  } catch {
    return res.json({ isCreator: false });
  }
});

// ── Overview ──────────────────────────────────────────────────────────────
router.get('/creator-space/overview', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

    const [{ workspaces, totalUsers }, subsResult, recentEventsResult] = await Promise.all([
      computeWorkspaceEngagement(admin),
      admin.from('subscriptions').select('org_id, status').in('status', ['active', 'trialing', 'past_due']),
      admin
        .from('audit_events')
        .select('id, org_id, actor_id, action, entity_type, created_at')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    const displayNames = new Map(workspaces.map((w: any) => [w.id, w.name]));

    const subs = subsResult.data ?? [];
    return res.json({
      totals: {
        companies: workspaces.length,
        users: totalUsers,
        active_companies_7d: workspaces.filter((w: any) => w.days_since_activity <= 7).length,
        active_companies_30d: workspaces.filter((w: any) => w.days_since_activity <= 30).length,
        inactive_companies_30d: workspaces.filter((w: any) => w.days_since_activity > 30).length,
        new_companies_30d: workspaces.filter((w: any) => w.created_at >= thirtyDaysAgo.toISOString()).length,
        subscriptions_active: subs.filter((s: any) => s.status === 'active' || s.status === 'trialing').length,
        subscriptions_past_due: subs.filter((s: any) => s.status === 'past_due').length,
      },
      // Jamais de nom de personne ici : identifiant seulement (Loi 25 —
      // révélation via reveal-actor, journalisée avec raison).
      recent_events: (recentEventsResult.data ?? []).map((e: any) => ({
        id: e.id,
        org_id: e.org_id,
        org_name: displayNames.get(e.org_id) ?? null,
        actor_id: e.actor_id ?? null,
        action: e.action,
        entity_type: e.entity_type,
        created_at: e.created_at,
      })),
    });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de charger l’aperçu.', '[creator-space/overview]');
  }
});

// ── Logs (journaux existants : audit / activité / sécurité) ───────────────
router.get('/creator-space/logs', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const source = ['audit', 'activity', 'security'].includes(String(req.query.source)) ? String(req.query.source) : 'audit';
    const org = typeof req.query.org === 'string' && UUID_RE.test(req.query.org) ? req.query.org : '';
    const q = cleanQ(req.query.q).toLowerCase();
    const page = pageParam(req.query.page);
    const PAGE_SIZE = 30;
    // Colonnes explicitement whitelistées : jamais d'adresses IP, de
    // user-agents, d'anciennes/nouvelles valeurs ni de détails bruts.
    const SELECTS: Record<string, string> = {
      audit: 'id, org_id, actor_id, action, entity_type, entity_id, created_at, metadata',
      activity: 'id, org_id, actor_id, event_type, entity_type, entity_id, created_at, metadata',
      security: 'id, org_id, user_id, event_type, severity, source, resolved, created_at',
    };
    const TABLES: Record<string, string> = { audit: 'audit_events', activity: 'activity_log', security: 'security_events' };

    let query = admin
      .from(TABLES[source])
      .select(SELECTS[source], { count: 'exact' })
      .order('created_at', { ascending: false });
    if (org) query = query.eq('org_id', org);
    if (q) {
      // Recherche sur le type d'événement / action, entrée neutralisée
      const col = source === 'audit' ? 'action' : 'event_type';
      query = query.ilike(col, `%${q.replace(/[%_,()]/g, '')}%`);
    }
    const { data, error, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (error) throw error;

    const rows = (data ?? []) as any[];
    const { displayNameById } = await loadOrgDirectory(admin);

    return res.json({
      // Jamais de nom de personne : actor_id seulement — le nom se révèle via
      // reveal-actor (raison requise, journalisée).
      data: rows.map((r) => ({
        ...r,
        org_name: (r.org_id && displayNameById.get(r.org_id)) ?? null,
        actor_id: r.actor_id ?? r.user_id ?? null,
      })),
      total: count ?? rows.length,
      page,
      page_size: PAGE_SIZE,
      source,
    });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de charger les journaux.', '[creator-space/logs]');
  }
});

// ── Company Engagement ────────────────────────────────────────────────────
router.get('/creator-space/engagement', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const level = ['high', 'medium', 'low', 'inactive'].includes(String(req.query.level)) ? String(req.query.level) : '';
    const page = pageParam(req.query.page);
    const PAGE_SIZE = 25;

    const { workspaces } = await computeWorkspaceEngagement(admin);
    const counts = {
      all: workspaces.length,
      high: workspaces.filter((w: any) => w.engagement === 'high').length,
      medium: workspaces.filter((w: any) => w.engagement === 'medium').length,
      low: workspaces.filter((w: any) => w.engagement === 'low').length,
      inactive: workspaces.filter((w: any) => w.engagement === 'inactive').length,
    };
    const filtered = level ? workspaces.filter((w: any) => w.engagement === level) : workspaces;
    return res.json({
      data: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      total: filtered.length,
      page,
      page_size: PAGE_SIZE,
      counts,
    });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de charger l’engagement.', '[creator-space/engagement]');
  }
});

// ── Companies : liste + recherche ─────────────────────────────────────────
router.get('/creator-space/companies', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const q = cleanQ(req.query.q).toLowerCase();
    const page = pageParam(req.query.page);
    const PAGE_SIZE = 25;

    const [{ orgs }, membershipsResult, subsResult, plansById] = await Promise.all([
      loadOrgDirectory(admin),
      admin.from('memberships').select('org_id'),
      admin.from('subscriptions').select('org_id, plan_id, status, interval, current_period_end').order('created_at', { ascending: false }),
      loadPlansById(admin),
    ]);

    const membersByOrg = new Map<string, number>();
    for (const m of membershipsResult.data ?? []) membersByOrg.set(m.org_id, (membersByOrg.get(m.org_id) || 0) + 1);

    // L'abonnement vit sur UN bureau du groupe : résolution directe, puis via
    // le company_group_id du bureau porteur.
    const subByOrg = new Map<string, any>();
    for (const s of subsResult.data ?? []) if (!subByOrg.has(s.org_id)) subByOrg.set(s.org_id, s);
    const groupByOrg = new Map<string, string>(orgs.filter((o: any) => o.company_group_id).map((o: any) => [o.id, o.company_group_id]));
    const subByGroup = new Map<string, any>();
    for (const [orgId, sub] of subByOrg) {
      const g = groupByOrg.get(orgId);
      if (g && !subByGroup.has(g)) subByGroup.set(g, sub);
    }

    const ownerIds = orgs.map((o: any) => o.created_by).filter(Boolean);
    const ownerNames = await loadActorNames(admin, ownerIds);

    let rows = orgs.map((o: any) => {
      const sub = subByOrg.get(o.id) ?? (o.company_group_id ? subByGroup.get(o.company_group_id) : null) ?? null;
      const plan = sub ? plansById.get(sub.plan_id) : null;
      return {
        id: o.id,
        name: o.display_name,
        org_name: o.name,
        logo_url: o.logo_url,
        company_group_id: o.company_group_id,
        created_at: o.created_at,
        owner_id: o.created_by,
        owner_name: (o.created_by && ownerNames.get(o.created_by)) || null,
        contact_email: o.contact_email || null,
        member_count: membersByOrg.get(o.id) || 0,
        subscription_status: sub?.status ?? null,
        plan_name: plan?.name ?? null,
        plan_slug: plan?.slug ?? null,
      };
    });

    if (q) {
      rows = rows.filter((r: any) =>
        r.id === q ||
        (r.company_group_id ?? '') === q ||
        r.name.toLowerCase().includes(q) ||
        r.org_name.toLowerCase().includes(q) ||
        (r.owner_name ?? '').toLowerCase().includes(q) ||
        (r.contact_email ?? '').toLowerCase().includes(q));
    }
    rows.sort((a: any, b: any) => a.name.localeCompare(b.name, 'fr'));

    return res.json({
      data: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      total: rows.length,
      page,
      page_size: PAGE_SIZE,
    });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de charger les compagnies.', '[creator-space/companies]');
  }
});

// ── Panneau compagnie : en-tête ───────────────────────────────────────────
router.get('/creator-space/companies/:orgId', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const { orgId } = req.params;
    if (!UUID_RE.test(orgId)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const admin = getServiceClient();

    const { data: org, error } = await admin
      .from('orgs')
      .select('id, name, created_by, created_at, company_group_id, logo_url')
      .eq('id', orgId)
      .maybeSingle();
    if (error) throw error;
    if (!org) return res.status(404).json({ error: 'Compagnie introuvable.' });

    const [{ data: settings }, memberCountResult, plansById] = await Promise.all([
      admin.from('company_settings').select('company_name, email, phone, website, city, province, country, industry, timezone, currency').eq('org_id', orgId).maybeSingle(),
      admin.from('memberships').select('user_id', { count: 'exact', head: true }).eq('org_id', orgId),
      loadPlansById(admin),
    ]);

    // Bureaux du même groupe + abonnement porté par l'un d'eux
    const ids = await groupOrgIds(admin, orgId);
    const [{ data: siblings }, { data: subs }] = await Promise.all([
      admin.from('orgs').select('id, name, created_at').in('id', ids),
      admin
        .from('subscriptions')
        .select('org_id, plan_id, status, interval, currency, amount_cents, current_period_start, current_period_end, trial_end, cancel_at_period_end, canceled_at, created_at, extra_seats, extra_offices')
        .in('org_id', ids)
        .order('created_at', { ascending: false })
        .limit(1),
    ]);

    let owner: { id: string; name: string | null; email: string | null } | null = null;
    if (org.created_by) {
      const names = await loadActorNames(admin, [org.created_by]);
      let email: string | null = null;
      try {
        const { data: authUser } = await admin.auth.admin.getUserById(org.created_by);
        email = authUser?.user?.email ?? null;
      } catch {
        email = null;
      }
      owner = { id: org.created_by, name: names.get(org.created_by) ?? null, email };
    }

    const sub = subs?.[0] ?? null;
    return res.json({
      id: org.id,
      name: (settings?.company_name || '').trim() || org.name,
      org_name: org.name,
      logo_url: org.logo_url,
      company_group_id: org.company_group_id,
      created_at: org.created_at,
      owner,
      contact: settings
        ? { email: settings.email || null, phone: settings.phone || null, website: settings.website || null, city: settings.city || null, province: settings.province || null, country: settings.country || null, industry: settings.industry || null, timezone: settings.timezone || null }
        : null,
      member_count: memberCountResult.count ?? 0,
      offices: (siblings ?? []).map((s: any) => ({ id: s.id, name: s.name, created_at: s.created_at, is_current: s.id === orgId })),
      subscription: safeSubscription(sub, sub ? plansById.get(sub.plan_id) : null),
    });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de charger la compagnie.', '[creator-space/company]');
  }
});

// ── Onglet Users ──────────────────────────────────────────────────────────
router.get('/creator-space/companies/:orgId/users', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const { orgId } = req.params;
    if (!UUID_RE.test(orgId)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const admin = getServiceClient();

    const { data: members, error } = await admin
      .from('memberships')
      .select('user_id, role, scope, status, created_at, full_name, avatar_url')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;

    const rows = members ?? [];
    const profileNames = await loadActorNames(admin, rows.map((m: any) => m.user_id));
    // Courriel + dernière connexion : depuis Supabase Auth (source exacte),
    // borné pour rester raisonnable sur les grosses équipes.
    const authInfo = new Map<string, { email: string | null; last_sign_in_at: string | null }>();
    await Promise.all(
      rows.slice(0, 100).map(async (m: any) => {
        try {
          const { data } = await admin.auth.admin.getUserById(m.user_id);
          authInfo.set(m.user_id, { email: data?.user?.email ?? null, last_sign_in_at: data?.user?.last_sign_in_at ?? null });
        } catch {
          /* utilisateur auth introuvable — on affiche la ligne sans courriel */
        }
      }),
    );

    return res.json({
      data: rows.map((m: any) => ({
        user_id: m.user_id,
        name: m.full_name || profileNames.get(m.user_id) || null,
        avatar_url: m.avatar_url,
        email: authInfo.get(m.user_id)?.email ?? null,
        role: m.role,
        scope: m.scope,
        status: m.status,
        created_at: m.created_at,
        last_sign_in_at: authInfo.get(m.user_id)?.last_sign_in_at ?? null,
      })),
    });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de charger les utilisateurs.', '[creator-space/users]');
  }
});

// ── Onglet Billing ────────────────────────────────────────────────────────
router.get('/creator-space/companies/:orgId/billing', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const { orgId } = req.params;
    if (!UUID_RE.test(orgId)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const admin = getServiceClient();

    const ids = await groupOrgIds(admin, orgId);
    if (!ids.length) return res.status(404).json({ error: 'Compagnie introuvable.' });

    const [plansById, subsResult, receiptsResult] = await Promise.all([
      loadPlansById(admin),
      admin
        .from('subscriptions')
        .select('org_id, plan_id, status, interval, currency, amount_cents, current_period_start, current_period_end, trial_end, cancel_at_period_end, canceled_at, created_at, extra_seats, extra_offices')
        .in('org_id', ids)
        .order('created_at', { ascending: false }),
      admin
        .from('billing_receipt_log')
        .select('id, email_type, status, amount_cents, currency, plan_name, sent_at, created_at')
        .in('org_id', ids)
        .order('created_at', { ascending: false })
        .limit(8),
    ]);
    if (subsResult.error) throw subsResult.error;

    const subs = subsResult.data ?? [];
    return res.json({
      current: safeSubscription(subs[0] ?? null, subs[0] ? plansById.get(subs[0].plan_id) : null),
      history: subs.slice(1, 6).map((s: any) => safeSubscription(s, plansById.get(s.plan_id))),
      receipts: receiptsResult.data ?? [],
    });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de charger la facturation.', '[creator-space/billing]');
  }
});

// ── Onglet Permissions (lecture seule) ────────────────────────────────────
router.get('/creator-space/companies/:orgId/permissions', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const { orgId } = req.params;
    if (!UUID_RE.test(orgId)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const admin = getServiceClient();

    const { data: members, error } = await admin
      .from('memberships')
      .select('user_id, role, scope, status, permissions, permissions_custom, full_name')
      .eq('org_id', orgId)
      .order('role', { ascending: true })
      .limit(200);
    if (error) throw error;

    const rows = members ?? [];
    const names = await loadActorNames(admin, rows.map((m: any) => m.user_id));
    const roleCounts: Record<string, number> = {};
    for (const m of rows) roleCounts[m.role] = (roleCounts[m.role] || 0) + 1;

    return res.json({
      role_counts: roleCounts,
      data: rows.map((m: any) => ({
        user_id: m.user_id,
        name: m.full_name || names.get(m.user_id) || null,
        role: m.role,
        scope: m.scope,
        status: m.status,
        permissions_custom: !!m.permissions_custom,
        overrides: Object.entries((m.permissions ?? {}) as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'boolean')
          .map(([key, value]) => ({ key, value: !!value })),
      })),
    });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de charger les permissions.', '[creator-space/permissions]');
  }
});

// ── Onglet Engagement (par compagnie) ─────────────────────────────────────
router.get('/creator-space/companies/:orgId/engagement', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const { orgId } = req.params;
    if (!UUID_RE.test(orgId)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const admin = getServiceClient();

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

    const [logins, jobs30, recentActivity, clientsCount, jobsCount, quotesCount, invoicesCount] = await Promise.all([
      admin.from('login_history').select('user_id, created_at').eq('org_id', orgId).gte('created_at', thirtyDaysAgo).order('created_at', { ascending: false }).limit(500),
      admin.from('jobs').select('id, created_at', { count: 'exact' }).eq('org_id', orgId).is('deleted_at', null).gte('created_at', thirtyDaysAgo).order('created_at', { ascending: false }).limit(1),
      admin.from('activity_log').select('id, event_type, entity_type, actor_id, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(15),
      admin.from('clients').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null),
      admin.from('jobs').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null),
      admin.from('quotes').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null),
      admin.from('invoices').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null),
    ]);

    const loginRows = logins.data ?? [];
    const lastLogin = loginRows[0]?.created_at ?? null;
    const lastJob = jobs30.data?.[0]?.created_at ?? null;
    const lastActivityLog = recentActivity.data?.[0]?.created_at ?? null;
    const lastActivity = [lastLogin, lastJob, lastActivityLog].filter(Boolean).sort().pop() ?? null;

    return res.json({
      last_activity: lastActivity,
      logins_30d: loginRows.length,
      active_users_30d: new Set(loginRows.map((l: any) => l.user_id)).size,
      jobs_30d: jobs30.count ?? 0,
      totals: {
        clients: clientsCount.count ?? 0,
        jobs: jobsCount.count ?? 0,
        quotes: quotesCount.count ?? 0,
        invoices: invoicesCount.count ?? 0,
      },
      // Identifiant seulement, jamais de nom (révélation via reveal-actor).
      recent_activity: (recentActivity.data ?? []).map((a: any) => ({
        id: a.id,
        event_type: a.event_type,
        entity_type: a.entity_type,
        actor_id: a.actor_id ?? null,
        created_at: a.created_at,
      })),
      // Limites connues des signaux (voir sync_auth_telemetry) : seules les
      // connexions réussies sont captées, attribuées au premier bureau.
      caveats: ['logins_partial_attribution'],
    });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de charger l’engagement.', '[creator-space/company-engagement]');
  }
});

export default router;
