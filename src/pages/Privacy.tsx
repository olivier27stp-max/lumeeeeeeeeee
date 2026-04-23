import { useTranslation } from '../i18n';
import { CURRENT_PRIVACY_POLICY_VERSION } from '../lib/consentApi';

/**
 * Privacy Policy — template text. MUST be reviewed by legal counsel before production.
 * Versioned by CURRENT_PRIVACY_POLICY_VERSION — bump on substantive change.
 */
export default function Privacy() {
  const { t } = useTranslation();
  const lastUpdated = '2026-04-21';

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14 prose prose-gray dark:prose-invert">
      <h1>{t.legal.privacyTitle}</h1>
      <p className="text-sm text-gray-500">
        {t.legal.version}: <code>{CURRENT_PRIVACY_POLICY_VERSION}</code>{' — '}
        {t.legal.lastUpdated}: {lastUpdated}
      </p>
      <blockquote className="border-l-4 border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
        ⚠️ {t.legal.templateDisclaimer}
      </blockquote>

      <h2>1. Who we are</h2>
      <p>
        Lume CRM is operated by <strong>William Hébert</strong> (sole proprietor / entreprise individuelle), Québec, Canada.
        Our data protection officer can be reached at <a href="mailto:willhebert30@gmail.com">willhebert30@gmail.com</a>.
      </p>

      <h2>2. Data we collect</h2>
      <ul>
        <li><strong>Account data:</strong> name, email, password (hashed), role, avatar, phone.</li>
        <li><strong>Customer data you enter:</strong> leads, clients, contacts (names, emails, phone numbers, addresses, notes).</li>
        <li><strong>Business data:</strong> jobs, invoices, payments, schedules, tasks, messages.</li>
        <li><strong>Technical data:</strong> IP address, browser user-agent, session cookies, audit logs (who did what, when).</li>
      </ul>

      <h2>3. Why we process your data (legal basis)</h2>
      <ul>
        <li><strong>Contract:</strong> operating the CRM for your organization.</li>
        <li><strong>Legal obligation:</strong> tax, accounting, consumer protection laws.</li>
        <li><strong>Consent:</strong> cookies (analytics, marketing), email/SMS marketing communications.</li>
        <li><strong>Legitimate interest:</strong> service security, fraud prevention, internal analytics.</li>
      </ul>

      <h2>4. Your rights (Québec Law 25, PIPEDA, GDPR)</h2>
      <p>You may, at any time:</p>
      <ul>
        <li>access your personal data (export in JSON)</li>
        <li>correct inaccurate data</li>
        <li>request erasure ("right to be forgotten")</li>
        <li>request data portability</li>
        <li>object to processing for marketing</li>
        <li>withdraw a previously given consent</li>
        <li>file a complaint with the <em>Commission d'accès à l'information du Québec</em>, the Office of the Privacy Commissioner of Canada, or your local supervisory authority.</li>
      </ul>
      <p>
        Exercise these rights from the <a href="/account/privacy">Privacy Center</a> or by email to{' '}
        <a href="mailto:willhebert30@gmail.com">willhebert30@gmail.com</a>. We respond within 30 days.
      </p>

      <h2>5. Data retention</h2>
      <ul>
        <li><strong>Active account data:</strong> kept for the duration of the service.</li>
        <li><strong>Inactive leads:</strong> anonymized after 24 months of inactivity.</li>
        <li><strong>Invoices & payments:</strong> kept 10 years (tax obligation).</li>
        <li><strong>Audit logs:</strong> kept 3 years, then purged automatically.</li>
        <li><strong>Marketing communications:</strong> kept as long as consent is active; deleted upon withdrawal.</li>
      </ul>

      <h2>6. Subprocessors</h2>
      <p>We share data with the following subprocessors, each bound by a Data Processing Agreement:</p>
      <ul>
        <li><strong>Supabase Inc.</strong> (database, authentication, storage) — hosted in the United States (AWS us-east-1).</li>
        <li><strong>Stripe Inc.</strong> (payment processing)</li>
        <li><strong>PayPal Holdings</strong> (alternative payment processing)</li>
        <li><strong>Twilio Inc.</strong> (SMS delivery)</li>
        <li><strong>Resend</strong> (transactional email delivery)</li>
        <li><strong>Google LLC</strong> (Maps / Geocoding / Gemini AI)</li>
        <li><strong>Upstash</strong> (optional rate-limiting cache)</li>
      </ul>
      <p>
        Full up-to-date list: <a href="/subprocessors">/subprocessors</a>. We notify you 30 days
        before adding a new subprocessor that receives personal data.
      </p>

      <h2>7. International data transfers</h2>
      <p>
        Our primary database is hosted in the United States. For data subjects in Québec, this
        transfer is subject to a Privacy Impact Assessment as required by Law 25, art. 17, which
        we keep on file and make available upon request.
      </p>

      <h2>8. Security</h2>
      <p>
        Data is encrypted at rest (AWS KMS / AES-256) and in transit (TLS 1.3). Access is gated
        by Row-Level Security in the database, role-based access control (RBAC), and optional
        two-factor authentication. Security incidents are handled per our Breach Response Plan.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        Material changes are announced in-product at least 30 days before taking effect. The
        version identifier above allows you to track which version you accepted.
      </p>

      <h2>10. Contact</h2>
      <p>
        <strong>William Hébert</strong> (responsable de la protection des renseignements personnels)<br />
        Québec, Canada<br />
        <a href="mailto:willhebert30@gmail.com">willhebert30@gmail.com</a><br />
        Astreinte incidents 24/7 : <a href="tel:+18198179526">+1 819-817-9526</a>
      </p>
    </div>
  );
}
