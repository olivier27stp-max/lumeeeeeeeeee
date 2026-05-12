// Branded invitation email — pulls company_settings (logo, primary color, name)
// for the inviting org so recipients see THEIR brand, not generic Lume styling.

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  sales_rep: 'Sales Representative',
  technician: 'Technician',
};

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidHexColor(v: string | null | undefined): boolean {
  return !!v && /^#[0-9a-fA-F]{6}$/.test(v);
}

function isValidHttpsUrl(v: string | null | undefined): boolean {
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}

export interface InvitationEmailInput {
  orgName: string;
  role: string;
  inviteLink: string;
  inviterName?: string | null;
  branding?: {
    logo_url?: string | null;
    primary_color?: string | null;
    company_name?: string | null;
    website?: string | null;
  } | null;
}

export function renderInvitationEmail(input: InvitationEmailInput): { subject: string; html: string; text: string } {
  const orgName = escapeHtml(input.orgName);
  const roleHuman = ROLE_LABELS[input.role] || input.role;
  const roleEsc = escapeHtml(roleHuman);
  const link = encodeURI(input.inviteLink);
  const inviter = input.inviterName ? escapeHtml(input.inviterName) : null;

  const brand = input.branding || {};
  const accent = isValidHexColor(brand.primary_color) ? brand.primary_color! : '#1F5F4F';
  const logo = isValidHttpsUrl(brand.logo_url) ? brand.logo_url! : null;
  const displayName = escapeHtml(brand.company_name || input.orgName);
  const website = isValidHttpsUrl(brand.website) ? brand.website! : null;

  const subject = `You've been invited to join ${input.orgName} on Lume CRM`;

  const headerBlock = logo
    ? `<img src="${escapeHtml(logo)}" alt="${displayName}" style="max-height: 48px; max-width: 200px; display: block; margin: 0 auto 24px;" />`
    : `<div style="font-size: 22px; font-weight: 700; color: ${accent}; text-align: center; margin-bottom: 24px;">${displayName}</div>`;

  const inviterLine = inviter
    ? `<p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 12px;">${inviter} has invited you.</p>`
    : '';

  const footerWebsite = website
    ? `<a href="${escapeHtml(website)}" style="color:${accent};text-decoration:none;">${escapeHtml(displayName)}</a>`
    : displayName;

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background-color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px;">
    <div style="background-color:#ffffff;border-radius:16px;padding:40px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
      ${headerBlock}
      <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;color:#111;text-align:center;">You're invited to join ${orgName}</h1>
      ${inviterLine}
      <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 28px;">
        You've been invited as a <strong>${roleEsc}</strong>. Click the button below to set up your account.
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${link}" style="display:inline-block;padding:14px 32px;background-color:${accent};color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">
          Accept Invitation
        </a>
      </div>
      <p style="font-size:12px;color:#999;line-height:1.6;margin:24px 0 0;text-align:center;">
        This invitation expires in 48 hours.<br />
        If you didn't expect this email, you can safely ignore it.
      </p>
    </div>
    <p style="font-size:11px;color:#999;text-align:center;margin-top:16px;">
      Sent by ${footerWebsite} via Lume CRM
    </p>
  </div>
</body></html>`;

  const text = `You've been invited to join ${input.orgName} on Lume CRM as a ${roleHuman}.

${inviter ? inviter + ' has invited you.\n\n' : ''}Accept your invitation: ${input.inviteLink}

This link expires in 48 hours.`;

  return { subject, html, text };
}
