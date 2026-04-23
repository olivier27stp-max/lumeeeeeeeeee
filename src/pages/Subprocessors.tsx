/**
 * Public subprocessor list (Law 25 art. 7, GDPR art. 28).
 * Route: /subprocessors
 */
export default function Subprocessors() {
  const lastUpdated = '2026-04-21';
  const version = 'subprocessors-2026-04-21';

  const rows = [
    { name: 'Supabase Inc.', role: 'Managed PostgreSQL, Auth, Storage, Realtime', data: 'All tenant data (identity, contact, business, audit logs)', region: 'AWS us-east-1 (USA)', dpa: 'https://supabase.com/dpa' },
    { name: 'Stripe Inc.', role: 'Payment processing (Stripe Connect)', data: 'Tokenized card data, email, amounts', region: 'Global (primary USA)', dpa: 'https://stripe.com/legal/dpa' },
    { name: 'PayPal Holdings', role: 'Alternative payment processing', data: 'Buyer email, amounts, order details', region: 'Global (USA / LU)', dpa: 'https://www.paypal.com/us/legalhub/privacy-full' },
    { name: 'Twilio Inc.', role: 'SMS + phone provisioning', data: 'Phone numbers, SMS content', region: 'USA', dpa: 'https://www.twilio.com/legal/data-protection-addendum' },
    { name: 'Resend', role: 'Transactional email', data: 'Recipient email, body, attachments', region: 'USA (AWS)', dpa: 'https://resend.com/legal/dpa' },
    { name: 'Google LLC (Maps)', role: 'Address geocoding', data: 'Postal addresses', region: 'Global', dpa: 'https://cloud.google.com/terms/data-processing-addendum' },
    { name: 'Google LLC (Gemini API)', role: 'AI assistant', data: 'Prompt text (PII redacted server-side)', region: 'Global', dpa: 'https://cloud.google.com/terms/data-processing-addendum' },
    { name: 'Upstash', role: 'Redis rate-limit cache (optional)', data: 'Hashed auth tokens and IPs (no PII)', region: 'Global', dpa: 'https://upstash.com/dpa' },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14 prose prose-gray dark:prose-invert">
      <h1>Subprocessors</h1>
      <p className="text-sm text-gray-500">Version: <code>{version}</code> — Last updated: {lastUpdated}</p>
      <p>
        Lume CRM engages the following subprocessors, each bound by a Data Processing Agreement.
        We notify customers at least 30 days before adding a new subprocessor that processes personal data.
      </p>

      <div className="not-prose overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 dark:border-gray-700 text-left">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Data processed</th>
              <th className="py-2 pr-4">Hosting</th>
              <th className="py-2">DPA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-200 dark:border-gray-800 align-top">
                <td className="py-2 pr-4 font-medium">{r.name}</td>
                <td className="py-2 pr-4">{r.role}</td>
                <td className="py-2 pr-4">{r.data}</td>
                <td className="py-2 pr-4">{r.region}</td>
                <td className="py-2">
                  {r.dpa.startsWith('http') ? (
                    <a href={r.dpa} target="_blank" rel="noopener noreferrer" className="underline">
                      Link
                    </a>
                  ) : (
                    <span className="text-gray-500">{r.dpa}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Questions</h2>
      <p>
        Contact <a href="mailto:willhebert30@gmail.com">willhebert30@gmail.com</a>.
      </p>
    </div>
  );
}
