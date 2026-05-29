import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { emailFrom, supportEmail } from '../lib/config';
import { validate, supportRequestSchema } from '../lib/validation';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

// Paid plans get priority handling ("Priority support" in pricing). Plan
// slugs in the DB: starter (Minimum), pro (Scale), autopilot (Autopilot).
const PRIORITY_PLANS = new Set(['pro', 'autopilot', 'enterprise']);

// First-response SLA we commit to, derived from the plan. Surfaced in the
// email so support knows the clock; not auto-enforced at this scale.
function slaForPlan(plan: string): string {
  if (plan === 'autopilot' || plan === 'enterprise') return '4 business hours';
  if (plan === 'pro') return '1 business day';
  return '2 business days';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── POST /support — Submit an in-app support request ───────────────
//
// Reads the tenant's active plan, derives a priority, and emails the
// support inbox. replyTo is set to the requesting user so a reply lands
// straight in the customer's inbox.
router.post('/support', validate(supportRequestSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    if (!isMailerConfigured()) {
      return res.status(503).json({ error: 'Support email is not configured. Please email ' + supportEmail + ' directly.' });
    }

    const { subject, message, category } = req.body as {
      subject: string;
      message: string;
      category?: string;
    };

    const admin = getServiceClient();

    // Plan + company name in parallel. Both are best-effort: a missing
    // subscription just means the tenant is treated as the lowest tier.
    const [subRes, companyRes] = await Promise.all([
      admin
        .from('subscriptions')
        .select('status, plan_id')
        .eq('org_id', auth.orgId)
        .in('status', ['active', 'trialing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('company_settings')
        .select('company_name')
        .eq('org_id', auth.orgId)
        .maybeSingle(),
    ]);

    // No FK between subscriptions.plan_id and plans, so resolve the plan in a
    // second step rather than via a PostgREST embed. No active sub → lowest tier.
    let planRow: { slug?: string; name?: string } | null = null;
    if (subRes.data?.plan_id) {
      const { data } = await admin
        .from('plans')
        .select('slug, name')
        .eq('id', subRes.data.plan_id)
        .maybeSingle();
      planRow = data;
    }
    const plan = (planRow?.slug || 'starter').toLowerCase();
    const isPriority = PRIORITY_PLANS.has(plan);
    const companyName = companyRes.data?.company_name || 'Unknown company';
    const userEmail = auth.user.email || null;
    const userName =
      (auth.user.user_metadata?.full_name as string | undefined) || userEmail || 'Unknown user';

    // Customer-facing plan name (e.g. "Scale"), falling back to a titled slug.
    const planLabel = planRow?.name || (plan.charAt(0).toUpperCase() + plan.slice(1));

    const priorityTag = isPriority ? 'PRIORITY' : 'Normal';
    const sla = slaForPlan(plan);

    const emailSubject = `[${priorityTag} · ${planLabel}] ${subject}`;

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a2e;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <tr><td style="background:${isPriority ? '#1a1a2e' : '#6b7280'};color:#fff;padding:14px 20px;font-weight:700;font-size:14px;">
            ${priorityTag} SUPPORT REQUEST · ${escapeHtml(planLabel)} plan
          </td></tr>
          <tr><td style="padding:20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;line-height:1.6;">
              <tr><td style="color:#6b7280;width:120px;">Company</td><td style="font-weight:600;">${escapeHtml(companyName)}</td></tr>
              <tr><td style="color:#6b7280;">From</td><td>${escapeHtml(userName)}${userEmail ? ` &lt;${escapeHtml(userEmail)}&gt;` : ''}</td></tr>
              <tr><td style="color:#6b7280;">Plan</td><td>${escapeHtml(planLabel)}</td></tr>
              <tr><td style="color:#6b7280;">Target reply</td><td>${escapeHtml(sla)}</td></tr>
              ${category ? `<tr><td style="color:#6b7280;">Category</td><td>${escapeHtml(category)}</td></tr>` : ''}
              <tr><td style="color:#6b7280;">Org ID</td><td style="font-family:monospace;font-size:11px;color:#9ca3af;">${escapeHtml(auth.orgId)}</td></tr>
            </table>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
            <div style="font-size:14px;font-weight:600;margin-bottom:8px;">${escapeHtml(subject)}</div>
            <div style="font-size:13px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(message)}</div>
          </td></tr>
        </table>
        <p style="font-size:11px;color:#9ca3af;margin-top:12px;">Reply to this email to respond directly to the customer.</p>
      </div>`;

    const result = await sendEmail({
      from: emailFrom,
      to: supportEmail,
      replyTo: userEmail || undefined,
      subject: emailSubject,
      html,
    });

    if (!result.sent) {
      console.error('[support] send failed:', result.error);
      return res.status(502).json({ error: 'Could not send your request right now. Please try again, or email ' + supportEmail + '.' });
    }

    return res.json({ ok: true, priority: isPriority ? 'priority' : 'normal', sla });
  } catch (err: any) {
    return sendSafeError(res, err, 'Could not send your support request.', '[support]');
  }
});

export default router;
