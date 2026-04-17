/**
 * Lume CRM — Payment Receipt Email Template
 *
 * Premium, clean, black/white/grey design.
 * Inline CSS for maximum email client compatibility.
 * Mobile responsive via max-width + fluid layout.
 */

export interface ReceiptTemplateData {
  companyName: string;
  planName: string;
  billingPeriod: string; // e.g. "Monthly" or "Yearly"
  amountPaid: string; // formatted, e.g. "$29.00"
  currency: string;
  taxes: string | null; // e.g. "$3.77" or null if no tax
  total: string; // e.g. "$32.77"
  paymentDate: string; // e.g. "April 17, 2026"
  billingEmail: string;
  transactionId: string; // Stripe payment intent or checkout session ID
  dashboardUrl: string;
  billingUrl: string;
  supportEmail?: string;
}

export function renderPaymentReceiptEmail(data: ReceiptTemplateData): string {
  const supportEmail = data.supportEmail || 'support@lumecrm.com';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Confirmed — Lume</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">

  <!-- Wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 40px 16px;">

        <!-- Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 24px 40px; text-align: center; border-bottom: 1px solid #f0f0f0;">
              <div style="font-size: 28px; font-weight: 200; letter-spacing: 6px; color: #111111; margin-bottom: 20px;">LUME</div>
              <div style="width: 48px; height: 48px; background-color: #111111; border-radius: 50%; margin: 0 auto 16px auto; line-height: 48px; text-align: center;">
                <span style="color: #ffffff; font-size: 20px;">&#10003;</span>
              </div>
              <h1 style="font-size: 20px; font-weight: 600; color: #111111; margin: 0 0 8px 0; letter-spacing: -0.2px;">Payment confirmed</h1>
              <p style="font-size: 14px; color: #666666; margin: 0; line-height: 1.5;">Thank you for your payment. Your subscription is now active.</p>
            </td>
          </tr>

          <!-- Receipt Details -->
          <tr>
            <td style="padding: 32px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

                <!-- Plan -->
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5;">
                    <span style="font-size: 13px; color: #999999; text-transform: uppercase; letter-spacing: 0.5px;">Plan</span>
                  </td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5; text-align: right;">
                    <span style="font-size: 14px; color: #111111; font-weight: 500;">${escapeHtml(data.planName)}</span>
                  </td>
                </tr>

                <!-- Billing Period -->
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5;">
                    <span style="font-size: 13px; color: #999999; text-transform: uppercase; letter-spacing: 0.5px;">Billing period</span>
                  </td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5; text-align: right;">
                    <span style="font-size: 14px; color: #111111;">${escapeHtml(data.billingPeriod)}</span>
                  </td>
                </tr>

                <!-- Amount -->
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5;">
                    <span style="font-size: 13px; color: #999999; text-transform: uppercase; letter-spacing: 0.5px;">Amount paid</span>
                  </td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5; text-align: right;">
                    <span style="font-size: 14px; color: #111111;">${escapeHtml(data.amountPaid)} ${escapeHtml(data.currency)}</span>
                  </td>
                </tr>

                ${data.taxes ? `
                <!-- Taxes -->
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5;">
                    <span style="font-size: 13px; color: #999999; text-transform: uppercase; letter-spacing: 0.5px;">Taxes</span>
                  </td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5; text-align: right;">
                    <span style="font-size: 14px; color: #111111;">${escapeHtml(data.taxes)}</span>
                  </td>
                </tr>
                ` : ''}

                <!-- Total -->
                <tr>
                  <td style="padding: 12px 0; border-bottom: 2px solid #111111;">
                    <span style="font-size: 13px; color: #111111; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Total</span>
                  </td>
                  <td style="padding: 12px 0; border-bottom: 2px solid #111111; text-align: right;">
                    <span style="font-size: 16px; color: #111111; font-weight: 700;">${escapeHtml(data.total)} ${escapeHtml(data.currency)}</span>
                  </td>
                </tr>

                <!-- Payment Date -->
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5;">
                    <span style="font-size: 13px; color: #999999; text-transform: uppercase; letter-spacing: 0.5px;">Payment date</span>
                  </td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5; text-align: right;">
                    <span style="font-size: 14px; color: #111111;">${escapeHtml(data.paymentDate)}</span>
                  </td>
                </tr>

                <!-- Billing Email -->
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5;">
                    <span style="font-size: 13px; color: #999999; text-transform: uppercase; letter-spacing: 0.5px;">Billing email</span>
                  </td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5; text-align: right;">
                    <span style="font-size: 14px; color: #111111;">${escapeHtml(data.billingEmail)}</span>
                  </td>
                </tr>

                <!-- Company -->
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5;">
                    <span style="font-size: 13px; color: #999999; text-transform: uppercase; letter-spacing: 0.5px;">Company</span>
                  </td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5; text-align: right;">
                    <span style="font-size: 14px; color: #111111;">${escapeHtml(data.companyName)}</span>
                  </td>
                </tr>

                <!-- Transaction ID -->
                <tr>
                  <td style="padding: 10px 0;">
                    <span style="font-size: 13px; color: #999999; text-transform: uppercase; letter-spacing: 0.5px;">Transaction ID</span>
                  </td>
                  <td style="padding: 10px 0; text-align: right;">
                    <span style="font-size: 12px; color: #999999; font-family: 'SF Mono', 'Fira Code', monospace;">${escapeHtml(data.transactionId)}</span>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 8px 40px 32px 40px; text-align: center;">
              <a href="${escapeHtml(data.dashboardUrl)}" style="display: inline-block; padding: 14px 32px; background-color: #111111; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
                Go to dashboard
              </a>
              <div style="margin-top: 12px;">
                <a href="${escapeHtml(data.billingUrl)}" style="font-size: 13px; color: #666666; text-decoration: underline;">
                  View billing settings
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #fafafa; border-top: 1px solid #f0f0f0; text-align: center;">
              <p style="font-size: 12px; color: #999999; margin: 0 0 4px 0; line-height: 1.5;">
                Lume CRM &middot; This is an automated payment receipt.
              </p>
              <p style="font-size: 12px; color: #999999; margin: 0; line-height: 1.5;">
                Questions? Contact us at <a href="mailto:${escapeHtml(supportEmail)}" style="color: #666666;">${escapeHtml(supportEmail)}</a>
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
