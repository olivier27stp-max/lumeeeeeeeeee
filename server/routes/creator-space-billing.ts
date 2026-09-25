// Creator Space — Billing : tableau de bord des abonnements de la plateforme.
//
// Volontairement HORS de creator-space.ts pour préserver son invariant
// « lecture seule / zéro identifiant Stripe » (verrouillé par
// tests/creator-space/route-guards.test.ts). Ici aussi tout est en lecture,
// sauf la journalisation (security_events) de l'ouverture d'un lien Stripe.
//
// CE QUE CE TABLEAU RÉPOND, AVEC PRÉCISION
//   · qui renouvelle bientôt (7 / 30 j) et pour combien ;
//   · qui est en impayé, depuis quand, et quand tombe la suspension
//     (même calcul que /billing/current : past_due_since + JOURS_DE_GRACE) ;
//   · qui est suspendu (dunning-engine : status canceled + past_due_since) ;
//   · qui a programmé son départ, et pour quelle date (cancel_at > période) ;
//   · où en est chaque plan à versements (x/3 encaissés, prochain versement,
//     fin d'engagement) ;
//   · les anomalies qui signalent un trou dans la chaîne Stripe → webhook →
//     base (période échue sans renouvellement, abonnement actif sans
//     abonnement Stripe, impayé sans date, engagement rompu) ;
//   · le dernier courriel de facturation parti, la dernière note interne,
//     l'engagement du workspace et le contact du propriétaire — pour savoir
//     QUI appeler et si ça vaut la peine.
//
// Tous les chiffres sont dérivés des tables réelles ; rien n'est estimé.
// Aucun identifiant Stripe ne sort dans /watch : le seul endroit qui en
// manipule un est /stripe-link, qui renvoie une URL de tableau de bord Stripe
// aux ~2 comptes platformAdminIds, et journalise chaque ouverture.

import { Router } from 'express';
import { requireCreatorSpace, loadOrgDirectory, loadActorNames, computeWorkspaceEngagement } from './creator-space';
import { getServiceClient, companyOrgIds } from '../lib/supabase';
import { JOURS_DE_GRACE } from '../lib/subscription-email';
import { logSecurityEvent } from '../lib/security';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOUR_MS = 86_400_000;
/** Fenêtre de rétention des abonnements annulés dans le tableau (churn récent). */
const JOURS_CHURN = 60;

const COLONNES_BASE =
  'id, org_id, plan_id, status, interval, currency, amount_cents, current_period_start, current_period_end, ' +
  'cancel_at_period_end, canceled_at, created_at, past_due_since, payment_confirmed_at, ' +
  'cancellation_feedback, cancellation_comment, scheduled_plan_id, scheduled_at, stripe_subscription_id';
/** Colonnes de la migration 20260927140000 (versements + cancel_at). */
const COLONNES_VERSEMENTS = 'cancel_at, installments_count, installments_paid, installment_amount_cents, commitment_end';

/**
 * Lit les abonnements avec les colonnes de versements, et se replie sur les
 * colonnes de base si la migration n'est pas encore appliquée : PostgREST
 * rejette TOUTE la requête pour une seule colonne inconnue, et le tableau
 * de bord doit rester utilisable entre le déploiement et l'application
 * manuelle de la migration. Le repli est signalé dans la réponse.
 */
async function lireAbonnements(admin: ReturnType<typeof getServiceClient>): Promise<{ rows: any[]; versements_disponibles: boolean }> {
  const complet = await admin
    .from('subscriptions')
    .select(`${COLONNES_BASE}, ${COLONNES_VERSEMENTS}`)
    .order('created_at', { ascending: false });
  if (!complet.error) return { rows: (complet.data ?? []) as any[], versements_disponibles: true };

  const base = await admin
    .from('subscriptions')
    .select(COLONNES_BASE)
    .order('created_at', { ascending: false });
  if (base.error) throw base.error;
  console.warn('[creator-space/billing/watch] colonnes de versements absentes (migration 20260927140000 non appliquée) :', complet.error.message);
  return { rows: (base.data ?? []) as any[], versements_disponibles: false };
}

export type AlerteCode =
  | 'period_expired'
  | 'no_stripe'
  | 'past_due_no_date'
  | 'grace_elapsed'
  | 'commitment_breach';

export type Situation =
  | 'suspended'
  | 'past_due'
  | 'anomaly'
  | 'installment_due'
  | 'renewing_7d'
  | 'cancel_scheduled'
  | 'trial_ending'
  | 'renewing_30d'
  | 'churned'
  | 'ok';

/** Ordre d'urgence : plus petit = plus pressant. Sert au tri par défaut. */
const PRIORITE: Record<Situation, number> = {
  suspended: 0,
  past_due: 1,
  anomaly: 2,
  installment_due: 3,
  renewing_7d: 4,
  cancel_scheduled: 5,
  trial_ending: 6,
  renewing_30d: 7,
  churned: 8,
  ok: 9,
};

const ALERTE_LIBELLE: Record<AlerteCode, string> = {
  period_expired: 'Période échue sans renouvellement reçu',
  no_stripe: 'Actif sans abonnement Stripe (aucun renouvellement automatique)',
  past_due_no_date: 'Impayé sans date de départ (grâce non datée)',
  grace_elapsed: 'Grâce écoulée, suspension pas encore appliquée',
  commitment_breach: 'Annulation programmée avant la fin de l’engagement',
};

function joursEntre(fromMs: number, toIso: string | null | undefined): number | null {
  if (!toIso) return null;
  const t = new Date(toIso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - fromMs) / JOUR_MS);
}

function ajouterCents(cible: Record<string, number>, devise: string, cents: number) {
  const d = (devise || 'CAD').toUpperCase();
  cible[d] = (cible[d] || 0) + Math.max(0, Math.round(cents || 0));
}

// ── Tableau de bord ───────────────────────────────────────────────────────
router.get('/creator-space/billing/watch', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const maintenant = Date.now();
    const depuisChurn = new Date(maintenant - JOURS_CHURN * JOUR_MS).toISOString();

    const [abonnements, plansResult, { orgs }, { workspaces }, receiptsResult, notesResult] = await Promise.all([
      lireAbonnements(admin),
      admin.from('plans').select('id, name, name_fr, slug'),
      loadOrgDirectory(admin),
      computeWorkspaceEngagement(admin),
      // Dernier courriel de facturation par org (reçus, impayé, relance, suspension…).
      admin
        .from('billing_receipt_log')
        .select('org_id, email_type, status, sent_at, created_at')
        .order('created_at', { ascending: false })
        .limit(2000),
      admin
        .from('creator_space_notes')
        .select('org_id, author_id, body, created_at')
        .order('created_at', { ascending: false })
        .limit(2000),
    ]);
    const plansById = new Map<string, any>((plansResult.data ?? []).map((p: any) => [p.id, p]));
    const orgById = new Map<string, any>(orgs.map((o: any) => [o.id, o]));
    const engagementByOrg = new Map<string, any>(workspaces.map((w: any) => [w.id, w]));

    // Un seul abonnement par org : le plus récent (le checkout annule les
    // précédents, mais leurs lignes restent).
    const parOrg = new Map<string, any>();
    for (const s of abonnements.rows) {
      if (!parOrg.has(s.org_id)) parOrg.set(s.org_id, s);
    }

    const dernierCourriel = new Map<string, any>();
    for (const r of receiptsResult.data ?? []) {
      if (!dernierCourriel.has(r.org_id)) dernierCourriel.set(r.org_id, r);
    }
    const derniereNote = new Map<string, any>();
    for (const n of notesResult.data ?? []) {
      if (!derniereNote.has(n.org_id)) derniereNote.set(n.org_id, n);
    }
    const auteurs = await loadActorNames(admin, Array.from(derniereNote.values()).map((n: any) => n.author_id));
    const proprietaires = await loadActorNames(
      admin,
      Array.from(parOrg.keys()).map((id) => orgById.get(id)?.created_by).filter(Boolean),
    );

    const summary = {
      active: 0,
      trialing: 0,
      past_due: 0,
      suspended: 0,
      cancel_scheduled: 0,
      renewing_7d: 0,
      renewing_30d: 0,
      installments_active: 0,
      installments_due_30d: 0,
      trial_ending_7d: 0,
      anomalies: 0,
      churned_30d: 0,
      due_7d_cents: {} as Record<string, number>,
      due_30d_cents: {} as Record<string, number>,
      mrr_cents: {} as Record<string, number>,
    };

    const rows: any[] = [];
    for (const s of parOrg.values()) {
      const estSuspendu = s.status === 'canceled' && !!s.past_due_since;
      const annuleRecent = s.status === 'canceled' && !!s.canceled_at && s.canceled_at >= depuisChurn;
      const vivant = s.status === 'active' || s.status === 'trialing' || s.status === 'past_due' || s.status === 'incomplete';
      if (!vivant && !estSuspendu && !annuleRecent) continue;

      const org = orgById.get(s.org_id);
      const eng = engagementByOrg.get(s.org_id);
      const plan = plansById.get(s.plan_id);
      const versements = s.installments_count ? Number(s.installments_count) : null;

      // ── Grâce d'impayé : même formule que /billing/current ──
      let grace: { expire_le: string; jours_restants: number; actif: boolean } | null = null;
      if (s.status === 'past_due') {
        const depuis = s.past_due_since ? new Date(s.past_due_since).getTime() : maintenant;
        const fin = depuis + JOURS_DE_GRACE * JOUR_MS;
        grace = {
          expire_le: new Date(fin).toISOString(),
          jours_restants: Math.max(0, Math.ceil((fin - maintenant) / JOUR_MS)),
          actif: fin > maintenant,
        };
      }

      // ── Prochaine charge : ce que Stripe va tenter d'encaisser, et quand ──
      const annulationLe: string | null = s.cancel_at_period_end ? (s.cancel_at || s.current_period_end || null) : null;
      const chargeSuivante =
        (s.status === 'active' || s.status === 'trialing' || s.status === 'past_due')
        && !(s.cancel_at_period_end && !s.cancel_at) // annulation à la fin de la période : plus rien à encaisser
          ? s.current_period_end
          : null;
      const chargeCents = chargeSuivante
        ? (versements ? Number(s.installment_amount_cents || 0) : Number(s.amount_cents || 0))
        : 0;
      const joursAvantCharge = joursEntre(maintenant, chargeSuivante);
      const joursAvantPeriode = joursEntre(maintenant, s.current_period_end);

      // ── Anomalies : la chaîne Stripe → webhook → base a un trou ──
      const alertes: AlerteCode[] = [];
      if ((s.status === 'active' || s.status === 'trialing') && joursAvantPeriode != null && joursAvantPeriode < -1) alertes.push('period_expired');
      if (s.status === 'active' && !s.stripe_subscription_id) alertes.push('no_stripe');
      if (s.status === 'past_due' && !s.past_due_since) alertes.push('past_due_no_date');
      if (s.status === 'past_due' && grace && !grace.actif) alertes.push('grace_elapsed');
      if (versements && s.cancel_at_period_end && s.commitment_end && annulationLe && annulationLe < s.commitment_end) alertes.push('commitment_breach');

      // ── Situation (une seule, la plus pressante) ──
      let situation: Situation = 'ok';
      if (estSuspendu) situation = 'suspended';
      else if (s.status === 'past_due') situation = 'past_due';
      else if (alertes.length) situation = 'anomaly';
      else if (versements && joursAvantCharge != null && joursAvantCharge <= 7) situation = 'installment_due';
      else if (s.status === 'active' && joursAvantCharge != null && joursAvantCharge <= 7) situation = 'renewing_7d';
      else if (s.cancel_at_period_end) situation = 'cancel_scheduled';
      else if (s.status === 'trialing' && joursAvantPeriode != null && joursAvantPeriode <= 7) situation = 'trial_ending';
      else if (s.status === 'active' && joursAvantCharge != null && joursAvantCharge <= 30) situation = 'renewing_30d';
      else if (s.status === 'canceled') situation = 'churned';

      // ── Compteurs ──
      if (s.status === 'active') summary.active++;
      if (s.status === 'trialing') summary.trialing++;
      if (s.status === 'past_due') summary.past_due++;
      if (estSuspendu) summary.suspended++;
      if (s.cancel_at_period_end && vivant) summary.cancel_scheduled++;
      if (versements && vivant) summary.installments_active++;
      if (alertes.length) summary.anomalies++;
      if (annuleRecent && !estSuspendu && s.canceled_at >= new Date(maintenant - 30 * JOUR_MS).toISOString()) summary.churned_30d++;
      if (s.status === 'trialing' && joursAvantPeriode != null && joursAvantPeriode <= 7) summary.trial_ending_7d++;
      if (chargeSuivante && joursAvantCharge != null && joursAvantCharge >= -1) {
        if (joursAvantCharge <= 7) {
          if (!versements) summary.renewing_7d++;
          ajouterCents(summary.due_7d_cents, s.currency, chargeCents);
        }
        if (joursAvantCharge <= 30) {
          if (versements) summary.installments_due_30d++;
          else summary.renewing_30d++;
          ajouterCents(summary.due_30d_cents, s.currency, chargeCents);
        }
      }
      if (s.status === 'active' || s.status === 'past_due') {
        // MRR normalisé : mensuel tel quel, annuel / 12 (versements inclus : le
        // montant de la ligne est le prix annuel complet).
        const mensuel = s.interval === 'yearly' ? Number(s.amount_cents || 0) / 12 : Number(s.amount_cents || 0);
        ajouterCents(summary.mrr_cents, s.currency, mensuel);
      }

      const courriel = dernierCourriel.get(s.org_id);
      const note = derniereNote.get(s.org_id);

      rows.push({
        org_id: s.org_id,
        org_name: org?.display_name ?? 'Compagnie inconnue',
        owner_name: (org?.created_by && proprietaires.get(org.created_by)) || null,
        contact_email: org?.contact_email || null,
        member_count: eng?.member_count ?? 0,
        last_activity: eng?.last_activity ?? null,
        days_since_activity: eng?.days_since_activity ?? null,
        engagement: eng?.engagement ?? 'inactive',

        plan_name: plan?.name_fr || plan?.name || null,
        plan_slug: plan?.slug || null,
        status: s.status,
        interval: s.interval,
        currency: s.currency || 'CAD',
        amount_cents: Number(s.amount_cents || 0),
        customer_since: s.created_at,
        payment_confirmed_at: s.payment_confirmed_at ?? null,
        current_period_end: s.current_period_end ?? null,
        days_to_period_end: joursAvantPeriode,

        situation,
        priority: PRIORITE[situation],
        next_charge_at: chargeSuivante,
        next_charge_cents: chargeCents,
        days_to_next_charge: joursAvantCharge,

        past_due_since: s.past_due_since ?? null,
        grace,
        suspended: estSuspendu,
        canceled_at: s.canceled_at ?? null,
        cancel_at_period_end: !!s.cancel_at_period_end,
        cancel_effective_at: annulationLe,
        cancellation_feedback: s.cancellation_feedback ?? null,
        cancellation_comment: s.cancellation_comment ? String(s.cancellation_comment).slice(0, 300) : null,
        scheduled_plan_name: s.scheduled_plan_id ? (plansById.get(s.scheduled_plan_id)?.name_fr || plansById.get(s.scheduled_plan_id)?.name || null) : null,
        scheduled_at: s.scheduled_at ?? null,

        installments: versements
          ? {
              count: versements,
              paid: Number(s.installments_paid || 0),
              amount_cents: Number(s.installment_amount_cents || 0),
              next_at: chargeSuivante,
              commitment_end: s.commitment_end ?? null,
              days_to_commitment_end: joursEntre(maintenant, s.commitment_end),
            }
          : null,

        alerts: alertes.map((code) => ({ code, label: ALERTE_LIBELLE[code] })),
        has_stripe_subscription: !!s.stripe_subscription_id,

        last_email: courriel
          ? { type: courriel.email_type, status: courriel.status, at: courriel.sent_at ?? courriel.created_at }
          : null,
        last_note: note
          ? { at: note.created_at, author_name: auteurs.get(note.author_id) ?? null, excerpt: String(note.body || '').slice(0, 140) }
          : null,
      });
    }

    rows.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const da = a.next_charge_at ? new Date(a.next_charge_at).getTime() : Number.MAX_SAFE_INTEGER;
      const db = b.next_charge_at ? new Date(b.next_charge_at).getTime() : Number.MAX_SAFE_INTEGER;
      return da - db;
    });

    return res.json({
      generated_at: new Date(maintenant).toISOString(),
      grace_days: JOURS_DE_GRACE,
      churn_window_days: JOURS_CHURN,
      installments_available: abonnements.versements_disponibles,
      summary,
      rows,
    });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de charger le tableau de bord de facturation.', '[creator-space/billing/watch]');
  }
});

// ── Lien vers le tableau de bord Stripe ────────────────────────────────────
// Renvoie l'URL (jamais l'identifiant seul) de l'abonnement Stripe du
// workspace, ou de son client Stripe à défaut. Chaque ouverture est
// journalisée : c'est la seule sortie d'identifiant Stripe du Creator Space.
router.get('/creator-space/billing/:orgId/stripe-link', async (req, res) => {
  try {
    const auth = await requireCreatorSpace(req, res);
    if (!auth) return;
    const { orgId } = req.params;
    if (!UUID_RE.test(orgId)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const admin = getServiceClient();

    const ids = await companyOrgIds(admin, orgId);
    const { data: sub, error } = await admin
      .from('subscriptions')
      .select('id, org_id, stripe_subscription_id, stripe_customer_id')
      .in('org_id', ids.length ? ids : [orgId])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    const cle = String(process.env.STRIPE_SECRET_KEY || '');
    const base = cle.startsWith('sk_test_') ? 'https://dashboard.stripe.com/test' : 'https://dashboard.stripe.com';
    let url: string | null = null;
    let kind: 'subscription' | 'customer' | null = null;
    if (sub?.stripe_subscription_id) {
      url = `${base}/subscriptions/${encodeURIComponent(sub.stripe_subscription_id)}`;
      kind = 'subscription';
    } else if (sub?.stripe_customer_id) {
      url = `${base}/customers/${encodeURIComponent(sub.stripe_customer_id)}`;
      kind = 'customer';
    }
    if (!url) return res.status(404).json({ error: 'Aucun abonnement Stripe pour ce workspace.' });

    logSecurityEvent({
      event_type: 'creator_space_stripe_link',
      severity: 'info',
      source: 'creator-space',
      user_id: auth.user.id,
      org_id: orgId,
      details: { kind, subscription_id: sub?.id ?? null },
    });

    return res.json({ url, kind });
  } catch (err) {
    return sendSafeError(res, err, 'Impossible de résoudre le lien Stripe.', '[creator-space/billing/stripe-link]');
  }
});

export default router;
