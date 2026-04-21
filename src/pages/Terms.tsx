import { useTranslation } from '../i18n';
import { CURRENT_TOS_VERSION } from '../lib/consentApi';

/**
 * Terms of Service — template. MUST be reviewed by legal counsel before production.
 */
export default function Terms() {
  const { t } = useTranslation();
  const lastUpdated = '2026-04-21';

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14 prose prose-gray dark:prose-invert">
      <h1>{t.legal.termsTitle}</h1>
      <p className="text-sm text-gray-500">
        {t.legal.version}: <code>{CURRENT_TOS_VERSION}</code>{' — '}
        {t.legal.lastUpdated}: {lastUpdated}
      </p>
      <blockquote className="border-l-4 border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
        ⚠️ {t.legal.templateDisclaimer}
      </blockquote>

      <h2>1. Agreement</h2>
      <p>
        By creating an account or using Lume CRM (the "Service"), you agree to these Terms. If
        you are accepting on behalf of an organization, you represent that you have authority
        to bind that organization.
      </p>

      <h2>2. The service</h2>
      <p>
        Lume CRM provides a multi-tenant customer relationship management platform with features
        including lead tracking, pipeline management, scheduling, invoicing, payments, messaging,
        and AI-assisted workflows.
      </p>

      <h2>3. Your account</h2>
      <ul>
        <li>You are responsible for keeping your credentials confidential.</li>
        <li>You must notify us without delay of any unauthorized access.</li>
        <li>Two-factor authentication is strongly recommended for admin accounts.</li>
      </ul>

      <h2>4. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the Service for unlawful activity;</li>
        <li>import personal data you are not authorized to process;</li>
        <li>attempt to access another tenant's data or bypass security controls;</li>
        <li>reverse-engineer, resell, or white-label the Service without a written agreement;</li>
        <li>send spam or violate anti-spam laws (CAN-SPAM, CASL).</li>
      </ul>

      <h2>5. Your data</h2>
      <p>
        You retain ownership of the data you input. We process it on your behalf as a data
        processor and apply the safeguards described in our <a href="/privacy">Privacy Policy</a>.
        A Data Processing Agreement (DPA) is available on request for enterprise customers.
      </p>

      <h2>6. Payment</h2>
      <p>
        Fees are billed monthly or annually, in advance, and are non-refundable except where
        required by law. Late payment may result in suspension after 14 days.
      </p>

      <h2>7. Availability</h2>
      <p>
        We target 99.5% monthly uptime. Scheduled maintenance is announced at least 48 hours in
        advance when possible.
      </p>

      <h2>8. Termination</h2>
      <p>
        You may close your account at any time. On termination, we retain anonymized records
        as required by law (tax, audit) and delete or anonymize personal data within 90 days
        unless a longer retention is legally mandated.
      </p>

      <h2>9. Liability</h2>
      <p>
        To the maximum extent permitted by law, our aggregate liability is limited to the fees
        you paid in the 12 months preceding the claim. We are not liable for indirect, incidental,
        or consequential damages.
      </p>

      <h2>10. Governing law</h2>
      <p>
        These Terms are governed by the laws of Québec and the applicable laws of Canada. Any
        dispute shall be brought before the courts of the district of Montréal.
      </p>

      <h2>11. Changes</h2>
      <p>
        Material changes are announced in-product at least 30 days before taking effect.
      </p>

      <h2>12. Contact</h2>
      <p>
        <a href="mailto:legal@lumecrm.ca">legal@lumecrm.ca</a>
      </p>
    </div>
  );
}
