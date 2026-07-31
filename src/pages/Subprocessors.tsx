import { useTranslation } from '../i18n';

/**
 * Public subprocessor list (Law 25 art. 7, GDPR art. 28).
 * Route: /subprocessors
 */
export default function Subprocessors() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const lastUpdated = '2026-04-21';
  const version = 'subprocessors-2026-04-21';

  const rows = [
    {
      name: 'Supabase Inc.',
      role: fr ? 'PostgreSQL géré, Auth, Stockage, Temps réel' : 'Managed PostgreSQL, Auth, Storage, Realtime',
      data: fr ? 'Toutes les données des locataires (identité, contact, affaires, journaux d\'audit)' : 'All tenant data (identity, contact, business, audit logs)',
      region: fr ? 'AWS us-east-1 (É.-U.)' : 'AWS us-east-1 (USA)',
      dpa: 'https://supabase.com/dpa',
    },
    {
      name: 'Stripe Inc.',
      role: fr ? 'Traitement des paiements (Stripe Connect)' : 'Payment processing (Stripe Connect)',
      data: fr ? 'Données de carte tokenisées, courriel, montants' : 'Tokenized card data, email, amounts',
      region: fr ? 'Mondial (principalement É.-U.)' : 'Global (primary USA)',
      dpa: 'https://stripe.com/legal/dpa',
    },
    {
      name: 'PayPal Holdings',
      role: fr ? 'Traitement de paiement alternatif' : 'Alternative payment processing',
      data: fr ? 'Courriel de l\'acheteur, montants, détails de commande' : 'Buyer email, amounts, order details',
      region: fr ? 'Mondial (É.-U. / LU)' : 'Global (USA / LU)',
      dpa: 'https://www.paypal.com/us/legalhub/privacy-full',
    },
    {
      name: 'Twilio Inc.',
      role: fr ? 'SMS + attribution de numéros de téléphone' : 'SMS + phone provisioning',
      data: fr ? 'Numéros de téléphone, contenu des SMS' : 'Phone numbers, SMS content',
      region: fr ? 'É.-U.' : 'USA',
      dpa: 'https://www.twilio.com/legal/data-protection-addendum',
    },
    {
      name: 'Resend',
      role: fr ? 'Courriels transactionnels' : 'Transactional email',
      data: fr ? 'Courriel du destinataire, corps du message, pièces jointes' : 'Recipient email, body, attachments',
      region: fr ? 'É.-U. (AWS)' : 'USA (AWS)',
      dpa: 'https://resend.com/legal/dpa',
    },
    {
      name: 'Google LLC (Maps)',
      role: fr ? 'Géocodage d\'adresses' : 'Address geocoding',
      data: fr ? 'Adresses postales' : 'Postal addresses',
      region: fr ? 'Mondial' : 'Global',
      dpa: 'https://cloud.google.com/terms/data-processing-addendum',
    },
    {
      name: 'Google LLC (Gemini API)',
      role: fr ? 'Assistant IA' : 'AI assistant',
      data: fr ? 'Texte des requêtes (renseignements personnels caviardés côté serveur)' : 'Prompt text (PII redacted server-side)',
      region: fr ? 'Mondial' : 'Global',
      dpa: 'https://cloud.google.com/terms/data-processing-addendum',
    },
    {
      name: 'Upstash',
      role: fr ? 'Cache Redis pour la limitation de débit (optionnel)' : 'Redis rate-limit cache (optional)',
      data: fr ? 'Jetons d\'authentification et IP hachés (aucun renseignement personnel)' : 'Hashed auth tokens and IPs (no PII)',
      region: fr ? 'Mondial' : 'Global',
      dpa: 'https://upstash.com/dpa',
    },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14 prose prose-gray dark:prose-invert">
      <h1>{fr ? 'Sous-traitants' : 'Subprocessors'}</h1>
      <p className="text-sm text-gray-500">
        {fr ? 'Version :' : 'Version:'} <code>{version}</code> — {fr ? 'Dernière mise à jour :' : 'Last updated:'} {lastUpdated}
      </p>
      <p>
        {fr
          ? 'Lume CRM fait appel aux sous-traitants suivants, chacun lié par une entente de traitement des données (DPA). Nous avisons nos clients au moins 30 jours avant d\'ajouter un nouveau sous-traitant qui traite des renseignements personnels.'
          : 'Lume CRM engages the following subprocessors, each bound by a Data Processing Agreement. We notify customers at least 30 days before adding a new subprocessor that processes personal data.'}
      </p>

      <div className="not-prose overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 dark:border-gray-700 text-left">
              <th className="py-2 pr-4">{fr ? 'Nom' : 'Name'}</th>
              <th className="py-2 pr-4">{fr ? 'Rôle' : 'Role'}</th>
              <th className="py-2 pr-4">{fr ? 'Données traitées' : 'Data processed'}</th>
              <th className="py-2 pr-4">{fr ? 'Hébergement' : 'Hosting'}</th>
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
                      {fr ? 'Lien' : 'Link'}
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

      <h2>{fr ? 'Questions' : 'Questions'}</h2>
      <p>
        {fr ? 'Écrivez à ' : 'Contact '}<a href="mailto:willhebert30@gmail.com">willhebert30@gmail.com</a>.
      </p>
    </div>
  );
}
