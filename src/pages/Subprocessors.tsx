import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { LEGAL_LABELS } from '../content/legal';

/**
 * Liste publique des sous-traitants (Loi 25 art. 7, RGPD art. 28).
 * Route : /subprocessors
 *
 * ⚠️ Contenu de type modèle — à faire relire par un conseiller juridique avant
 * un lancement client. Source de vérité : docs/legal/subprocessor_list.md.
 */
export default function Subprocessors() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const L = LEGAL_LABELS[language];
  const lastUpdated = '2026-04-22';
  const version = 'subprocessors-2026-04-22';

  const rows = [
    {
      name: 'Supabase Inc.',
      role: fr ? 'PostgreSQL géré, authentification, stockage, temps réel' : 'Managed PostgreSQL, Auth, Storage, Realtime',
      data: fr ? "Toutes les données des organisations (identité, contact, affaires, journaux d'audit)" : 'All tenant data (identity, contact, business, audit logs)',
      region: fr ? 'AWS us-east-1 (É.-U.)' : 'AWS us-east-1 (USA)',
      dpa: 'https://supabase.com/dpa',
    },
    {
      name: 'Railway Corp.',
      role: fr ? "Hébergement de l'application (API Node.js, tâches en arrière-plan)" : 'Application hosting (Node.js API, background jobs)',
      data: fr ? "Données de requête/réponse éphémères, journaux applicatifs, secrets d'environnement" : 'Ephemeral request/response data, application logs, environment secrets',
      region: fr ? 'GCP us-west1 (Oregon, É.-U.)' : 'GCP us-west1 (Oregon, USA)',
      dpa: 'https://railway.com/legal/dpa',
    },
    {
      name: 'Stripe Inc.',
      role: fr ? 'Traitement des paiements carte et bancaires (Stripe Connect)' : 'Card & bank payment processing (Stripe Connect)',
      data: fr ? "Données de carte tokenisées, courriel, montants, identité d'entreprise pour Connect" : 'Tokenized card data, email, amounts, business identity for Connect',
      region: fr ? 'Mondial (principalement É.-U.)' : 'Global (primary USA)',
      dpa: 'https://stripe.com/legal/dpa',
    },
    {
      name: 'PayPal Holdings',
      role: fr ? 'Traitement de paiement alternatif' : 'Alternative payment processing',
      data: fr ? "Courriel de l'acheteur, montants, détails de commande" : 'Buyer email, amounts, order details',
      region: fr ? 'Mondial (É.-U. et Luxembourg)' : 'Global (USA & Luxembourg)',
      dpa: 'https://www.paypal.com/us/legalhub/privacy-full',
    },
    {
      name: 'Twilio Inc.',
      role: fr ? 'SMS entrants/sortants, attribution de numéros de téléphone' : 'Inbound/outbound SMS, phone number provisioning',
      data: fr ? 'Numéros de téléphone, contenu des SMS' : 'Phone numbers, SMS content',
      region: fr ? 'É.-U.' : 'USA',
      dpa: 'https://www.twilio.com/legal/data-protection-addendum',
    },
    {
      name: fr ? 'Fournisseur SMTP sortant (Resend ou SMTP)' : 'Outbound email provider (Resend or SMTP)',
      role: fr ? 'Envoi des courriels transactionnels' : 'Transactional email delivery',
      data: fr ? 'Courriel du destinataire, corps du message, pièces jointes' : 'Recipient email address, email content, attachments',
      region: fr ? 'Selon le fournisseur configuré' : 'Depends on configured provider',
      dpa: 'https://resend.com/legal/dpa',
    },
    {
      name: 'Google LLC (Maps Platform)',
      role: fr ? "Géocodage des adresses de chantiers" : 'Address geocoding for job sites',
      data: fr ? 'Adresses postales' : 'Postal addresses',
      region: fr ? 'Mondial' : 'Global',
      dpa: 'https://cloud.google.com/terms/data-processing-addendum',
    },
    {
      name: 'Google LLC (Gemini API)',
      role: fr ? 'Assistant IA, génération de contenu' : 'AI assistant, content generation',
      data: fr ? 'Texte des requêtes (renseignements personnels caviardés côté serveur)' : 'Prompt text (PII redacted server-side)',
      region: fr ? 'Mondial' : 'Global',
      dpa: 'https://cloud.google.com/terms/data-processing-addendum',
    },
    {
      name: 'Upstash Inc.',
      role: fr ? 'Cache Redis pour la limitation de débit (optionnel)' : 'Redis rate-limit cache (optional)',
      data: fr ? "Suffixes de jetons d'authentification et IP hachés (aucun renseignement personnel)" : 'Auth-token suffix hashes, IP hashes (no PII)',
      region: fr ? 'Mondial' : 'Global',
      dpa: 'https://upstash.com/dpa',
    },
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FA]">
      {/* Bande d'en-tête (même design que Confidentialité / Conditions) */}
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <Link to="/" className="text-[10px] uppercase tracking-widest text-gray-400 hover:text-black transition-colors">
            {L.backToHome}
          </Link>
          <h1 className="text-4xl font-extralight tracking-wide mt-6 text-gray-900">
            {fr ? 'Sous-traitants' : 'Subprocessors'}
          </h1>
          <p className="mt-3 text-sm text-gray-500 font-light max-w-2xl">
            {fr
              ? "Lume CRM fait appel aux sous-traitants ci-dessous pour fournir le service. Chacun est lié par une entente de traitement des données (DPA) et soumis à des obligations équivalentes de protection des renseignements personnels. Nous avisons nos clients au moins 30 jours avant d'ajouter un nouveau sous-traitant qui traite des renseignements personnels."
              : 'Lume CRM engages the subprocessors below to deliver the service. Each is bound by a Data Processing Agreement (DPA) and subject to equivalent data-protection obligations. We notify customers at least 30 days before adding a new subprocessor that processes personal data.'}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-400">
            <span>{L.version} : <span className="font-mono text-gray-600">{version}</span></span>
            <span>{L.lastUpdated} : <span className="text-gray-600">{lastUpdated}</span></span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12 space-y-12">
        {/* Tableau des sous-traitants */}
        <section>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wider text-gray-400">
                  <th className="py-3 px-4 font-medium">{fr ? 'Nom' : 'Name'}</th>
                  <th className="py-3 px-4 font-medium">{fr ? 'Rôle' : 'Role'}</th>
                  <th className="py-3 px-4 font-medium">{fr ? 'Données traitées' : 'Data processed'}</th>
                  <th className="py-3 px-4 font-medium">{fr ? 'Hébergement' : 'Hosting'}</th>
                  <th className="py-3 px-4 font-medium">DPA</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0 align-top">
                    <td className="py-3 px-4 font-medium text-gray-900 whitespace-nowrap">{r.name}</td>
                    <td className="py-3 px-4 text-gray-600 font-light">{r.role}</td>
                    <td className="py-3 px-4 text-gray-600 font-light">{r.data}</td>
                    <td className="py-3 px-4 text-gray-600 font-light whitespace-nowrap">{r.region}</td>
                    <td className="py-3 px-4">
                      <a href={r.dpa} target="_blank" rel="noopener noreferrer" className="text-gray-500 underline hover:text-black transition-colors">
                        {fr ? 'Lien' : 'Link'}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Transferts internationaux */}
        <section>
          <h2 className="text-xl font-medium text-gray-900 mb-4">
            {fr ? 'Transferts internationaux de données' : 'International data transfers'}
          </h2>
          <div className="space-y-4 text-[15px] text-gray-600 font-light leading-relaxed">
            <p>
              {fr
                ? "Le stockage principal des données est situé dans AWS us-east-1 (États-Unis, Supabase) et le serveur applicatif s'exécute sur GCP us-west1 (États-Unis, Railway). Pour les personnes concernées au Québec, une évaluation des facteurs relatifs à la vie privée (Loi 25, art. 17) couvre ces transferts. Pour les personnes concernées dans l'UE, les transferts sont encadrés par des clauses contractuelles types."
                : 'Primary data storage is in AWS us-east-1 (USA, Supabase) and the application server runs on GCP us-west1 (USA, Railway). For Québec data subjects, a Privacy Impact Assessment (Law 25 art. 17) covers these transfers. For EU data subjects, transfers are covered by Standard Contractual Clauses.'}
            </p>
          </div>
        </section>

        {/* Notifications aux clients */}
        <section>
          <h2 className="text-xl font-medium text-gray-900 mb-4">
            {fr ? 'Avis aux clients' : 'Customer notifications'}
          </h2>
          <div className="space-y-4 text-[15px] text-gray-600 font-light leading-relaxed">
            <p>
              {fr
                ? "Toute modification de cette liste est annoncée par courriel au contact de facturation de chaque organisation au moins 30 jours avant sa prise d'effet. Un client peut s'opposer par écrit à l'ajout d'un nouveau sous-traitant ; nous en discuterons de bonne foi et, à défaut d'entente, le client pourra résilier la portion du service concernée."
                : 'Changes to this list are announced by email to the billing contact of each organization at least 30 days before taking effect. Customers may object to a new subprocessor in writing; we will discuss in good faith and, if no agreement is reached, the customer may terminate the affected portions of the service.'}
            </p>
          </div>
        </section>

        {/* Questions */}
        <section>
          <h2 className="text-xl font-medium text-gray-900 mb-4">Questions</h2>
          <div className="rounded-xl border border-gray-200 bg-white p-5 text-[15px] text-gray-600 font-light leading-relaxed">
            <p>
              {fr ? 'Pour toute question sur les sous-traitants, écrivez à ' : 'For questions about subprocessors, contact '}
              <a href="mailto:willhebert30@gmail.com" className="text-gray-900 underline hover:text-black">willhebert30@gmail.com</a>.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
