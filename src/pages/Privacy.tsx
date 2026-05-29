import React from 'react';
import { Link } from 'react-router-dom';
import { Mail, Phone, Shield, Clock, Globe, Database } from 'lucide-react';
import { useTranslation } from '../i18n';
import { CURRENT_PRIVACY_POLICY_VERSION } from '../lib/consentApi';
import { LEGAL_LABELS, SUBPROCESSORS, RETENTION } from '../content/legal';

/**
 * Privacy Policy — bilingual (FR/EN). Long-form content lives in src/content/legal.ts.
 * ⚠️ Template content — must be reviewed by legal counsel before production use.
 */

const LAST_UPDATED = '2026-04-21';
const DPO_EMAIL = 'willhebert30@gmail.com';
const INCIDENT_PHONE = '+1 819-817-9526';

const SECTIONS = {
  fr: [
    { id: 'qui-sommes-nous', label: '1. Qui sommes-nous' },
    { id: 'donnees-collectees', label: '2. Données que nous collectons' },
    { id: 'finalites', label: '3. Pourquoi nous traitons vos données' },
    { id: 'vos-droits', label: '4. Vos droits' },
    { id: 'conservation', label: '5. Conservation des données' },
    { id: 'sous-traitants', label: '6. Sous-traitants' },
    { id: 'transferts', label: '7. Transferts internationaux' },
    { id: 'securite', label: '8. Sécurité' },
    { id: 'cookies', label: '9. Cookies et traceurs' },
    { id: 'mineurs', label: '10. Protection des mineurs' },
    { id: 'modifications', label: '11. Modifications de cette politique' },
    { id: 'contact', label: '12. Nous contacter' },
  ],
  en: [
    { id: 'qui-sommes-nous', label: '1. Who we are' },
    { id: 'donnees-collectees', label: '2. Data we collect' },
    { id: 'finalites', label: '3. Why we process your data' },
    { id: 'vos-droits', label: '4. Your rights' },
    { id: 'conservation', label: '5. Data retention' },
    { id: 'sous-traitants', label: '6. Subprocessors' },
    { id: 'transferts', label: '7. International transfers' },
    { id: 'securite', label: '8. Security' },
    { id: 'cookies', label: '9. Cookies & trackers' },
    { id: 'mineurs', label: '10. Protection of minors' },
    { id: 'modifications', label: '11. Changes to this policy' },
    { id: 'contact', label: '12. Contact us' },
  ],
} as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-medium text-gray-900 mb-4">{title}</h2>
      <div className="space-y-4 text-[15px] text-gray-600 font-light leading-relaxed">{children}</div>
    </section>
  );
}

export default function Privacy() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const L = LEGAL_LABELS[language];
  const sections = SECTIONS[language];
  const subprocessors = SUBPROCESSORS[language];
  const retention = RETENTION[language];

  return (
    <div className="min-h-screen bg-[#F8F9FA]">
      {/* Header band */}
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <Link to="/" className="text-[10px] uppercase tracking-widest text-gray-400 hover:text-black transition-colors">
            {L.backToHome}
          </Link>
          <h1 className="text-4xl font-extralight tracking-wide mt-6 text-gray-900">
            {fr ? 'Politique de confidentialité' : 'Privacy Policy'}
          </h1>
          <p className="mt-3 text-sm text-gray-500 font-light max-w-2xl">
            {fr
              ? "Cette politique explique quelles données personnelles Lume CRM collecte, pourquoi, comment elles sont protégées, et quels sont vos droits. Elle est conçue pour respecter la Loi 25 du Québec, la LPRPDE (PIPEDA) et le RGPD (GDPR)."
              : 'This policy explains what personal data Lume CRM collects, why, how it is protected, and what your rights are. It is designed to comply with Québec Law 25, PIPEDA, and the GDPR.'}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-400">
            <span>{L.version} : <span className="font-mono text-gray-600">{CURRENT_PRIVACY_POLICY_VERSION}</span></span>
            <span>{L.lastUpdated} : <span className="text-gray-600">{LAST_UPDATED}</span></span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-12">
        {/* Sticky table of contents */}
        <aside className="hidden lg:block">
          <nav className="sticky top-12 space-y-1">
            <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-3">{L.toc}</p>
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block text-[13px] text-gray-500 hover:text-black transition-colors py-1 leading-snug"
              >
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="space-y-12">
          <Section id="qui-sommes-nous" title={sections[0].label}>
            {fr ? (
              <>
                <p>
                  Lume CRM est exploité par <strong className="font-medium text-gray-800">William Hébert</strong> (entreprise
                  individuelle / propriétaire unique), établi au Québec, Canada. Nous sommes le responsable du traitement de
                  vos renseignements personnels au sens de la Loi 25.
                </p>
                <p>
                  Notre responsable de la protection des renseignements personnels (RPRP / DPO) peut être joint à l'adresse{' '}
                  <a href={`mailto:${DPO_EMAIL}`} className="text-black underline hover:text-gray-600">{DPO_EMAIL}</a>.
                </p>
              </>
            ) : (
              <>
                <p>
                  Lume CRM is operated by <strong className="font-medium text-gray-800">William Hébert</strong> (sole
                  proprietor), based in Québec, Canada. We are the controller of your personal data under Law 25.
                </p>
                <p>
                  Our Data Protection Officer (DPO) can be reached at{' '}
                  <a href={`mailto:${DPO_EMAIL}`} className="text-black underline hover:text-gray-600">{DPO_EMAIL}</a>.
                </p>
              </>
            )}
          </Section>

          <Section id="donnees-collectees" title={sections[1].label}>
            <p>{fr ? 'Nous collectons et traitons les catégories de données suivantes :' : 'We collect and process the following categories of data:'}</p>
            <ul className="space-y-3 list-none pl-0">
              {(fr
                ? [
                    ['Données de compte', 'nom, courriel, mot de passe (haché), rôle, photo de profil, numéro de téléphone.'],
                    ['Données clients que vous saisissez', 'prospects, clients, contacts (noms, courriels, numéros de téléphone, adresses, notes).'],
                    ["Données d'affaires", 'jobs, factures, paiements, horaires, tâches, messages.'],
                    ['Données techniques', "adresse IP, agent utilisateur (navigateur), témoins de session (cookies), journaux d'audit (qui a fait quoi, et quand)."],
                  ]
                : [
                    ['Account data', 'name, email, password (hashed), role, avatar, phone number.'],
                    ['Customer data you enter', 'leads, clients, contacts (names, emails, phone numbers, addresses, notes).'],
                    ['Business data', 'jobs, invoices, payments, schedules, tasks, messages.'],
                    ['Technical data', 'IP address, browser user-agent, session cookies, audit logs (who did what, when).'],
                  ]
              ).map(([k, v]) => (
                <li key={k} className="flex gap-3">
                  <Database className="text-gray-400 shrink-0 mt-0.5" size={18} />
                  <span><strong className="font-medium text-gray-800">{k}</strong> — {v}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="finalites" title={sections[2].label}>
            <p>{fr ? 'Nous ne traitons vos données que lorsque nous avons une base légale pour le faire :' : 'We only process your data when we have a legal basis to do so:'}</p>
            <ul className="space-y-2 list-disc pl-5 marker:text-gray-300">
              {(fr
                ? [
                    ['Exécution du contrat', 'faire fonctionner le CRM pour votre organisation.'],
                    ['Obligation légale', 'fiscalité, comptabilité, lois sur la protection du consommateur.'],
                    ['Consentement', 'témoins (analytics, marketing), communications marketing par courriel ou SMS.'],
                    ['Intérêt légitime', 'sécurité du service, prévention de la fraude, analyses internes.'],
                  ]
                : [
                    ['Contract', 'operating the CRM for your organization.'],
                    ['Legal obligation', 'tax, accounting, consumer protection laws.'],
                    ['Consent', 'cookies (analytics, marketing), email/SMS marketing communications.'],
                    ['Legitimate interest', 'service security, fraud prevention, internal analytics.'],
                  ]
              ).map(([k, v]) => (
                <li key={k}><strong className="font-medium text-gray-800">{k}</strong> — {v}</li>
              ))}
            </ul>
          </Section>

          <Section id="vos-droits" title={sections[3].label}>
            <p>{fr ? 'À tout moment, vous pouvez :' : 'At any time, you may:'}</p>
            <ul className="space-y-2 list-disc pl-5 marker:text-gray-300">
              {(fr
                ? [
                    'accéder à vos renseignements personnels (export au format JSON) ;',
                    'corriger des données inexactes ;',
                    "demander l'effacement (« droit à l'oubli ») ;",
                    'demander la portabilité de vos données ;',
                    'vous opposer au traitement à des fins de marketing ;',
                    'retirer un consentement préalablement accordé ;',
                  ]
                : [
                    'access your personal data (export as JSON);',
                    'correct inaccurate data;',
                    'request erasure ("right to be forgotten");',
                    'request data portability;',
                    'object to processing for marketing;',
                    'withdraw a previously given consent;',
                  ]
              ).map((item) => (
                <li key={item}>{item}</li>
              ))}
              <li>
                {fr ? (
                  <>porter plainte auprès de la <strong className="font-medium text-gray-800">Commission d'accès à l'information du Québec</strong>, du <strong className="font-medium text-gray-800">Commissariat à la protection de la vie privée du Canada</strong>, ou de votre autorité de contrôle locale.</>
                ) : (
                  <>file a complaint with the <strong className="font-medium text-gray-800">Commission d'accès à l'information du Québec</strong>, the <strong className="font-medium text-gray-800">Office of the Privacy Commissioner of Canada</strong>, or your local supervisory authority.</>
                )}
              </li>
            </ul>
            <p>
              {fr ? (
                <>Vous pouvez exercer ces droits depuis le{' '}<Link to="/account/privacy" className="text-black underline hover:text-gray-600">Centre de confidentialité</Link>{' '}de votre compte, ou par courriel à{' '}<a href={`mailto:${DPO_EMAIL}`} className="text-black underline hover:text-gray-600">{DPO_EMAIL}</a>. Nous répondons dans un délai de <strong className="font-medium text-gray-800">30 jours</strong>.</>
              ) : (
                <>You can exercise these rights from the{' '}<Link to="/account/privacy" className="text-black underline hover:text-gray-600">Privacy Center</Link>{' '}in your account, or by email at{' '}<a href={`mailto:${DPO_EMAIL}`} className="text-black underline hover:text-gray-600">{DPO_EMAIL}</a>. We respond within <strong className="font-medium text-gray-800">30 days</strong>.</>
              )}
            </p>
          </Section>

          <Section id="conservation" title={sections[4].label}>
            <p>{fr ? 'Nous ne conservons vos données que le temps nécessaire :' : 'We only keep your data for as long as necessary:'}</p>
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <div className="grid grid-cols-1 divide-y divide-gray-100 text-sm">
                {retention.map((row) => (
                  <div key={row.label} className="grid grid-cols-1 sm:grid-cols-[230px_1fr] gap-1 sm:gap-4 px-5 py-4 bg-white">
                    <span className="font-medium text-gray-800">{row.label}</span>
                    <span className="text-gray-600 font-light">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section id="sous-traitants" title={sections[5].label}>
            <p>
              {fr
                ? 'Nous partageons des données avec les sous-traitants ci-dessous, chacun étant lié par une entente de traitement des données (Data Processing Agreement) :'
                : 'We share data with the subprocessors below, each bound by a Data Processing Agreement:'}
            </p>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-400">
                    <th className="px-5 py-3 font-medium">{fr ? 'Sous-traitant' : 'Subprocessor'}</th>
                    <th className="px-5 py-3 font-medium">{fr ? 'Finalité' : 'Purpose'}</th>
                    <th className="px-5 py-3 font-medium">{fr ? 'Localisation' : 'Location'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {subprocessors.map((sp) => (
                    <tr key={sp.name} className="bg-white">
                      <td className="px-5 py-3 font-medium text-gray-800 whitespace-nowrap">{sp.name}</td>
                      <td className="px-5 py-3 text-gray-600 font-light">{sp.purpose}</td>
                      <td className="px-5 py-3 text-gray-500 font-light whitespace-nowrap">{sp.location}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-gray-500">
              {fr ? (
                <>Liste complète et à jour : <Link to="/subprocessors" className="text-black underline hover:text-gray-600">/subprocessors</Link>. Nous vous informons <strong className="font-medium text-gray-700">30 jours à l'avance</strong> avant d'ajouter un nouveau sous-traitant qui reçoit des renseignements personnels.</>
              ) : (
                <>Full, up-to-date list: <Link to="/subprocessors" className="text-black underline hover:text-gray-600">/subprocessors</Link>. We notify you <strong className="font-medium text-gray-700">30 days in advance</strong> before adding a new subprocessor that receives personal data.</>
              )}
            </p>
          </Section>

          <Section id="transferts" title={sections[6].label}>
            <div className="flex gap-3 rounded-xl border border-gray-200 bg-white p-5">
              <Globe className="text-gray-400 shrink-0 mt-0.5" size={20} />
              <p className="text-gray-600 font-light text-[15px] leading-relaxed">
                {fr ? (
                  <>Notre base de données principale est hébergée aux États-Unis. Pour les personnes situées au Québec, ce transfert fait l'objet d'une <strong className="font-medium text-gray-800">évaluation des facteurs relatifs à la vie privée (EFVP)</strong> exigée par l'article 17 de la Loi 25. Nous conservons cette évaluation et la rendons disponible sur demande.</>
                ) : (
                  <>Our primary database is hosted in the United States. For data subjects in Québec, this transfer is subject to a <strong className="font-medium text-gray-800">Privacy Impact Assessment</strong> as required by Law 25, art. 17, which we keep on file and make available upon request.</>
                )}
              </p>
            </div>
          </Section>

          <Section id="securite" title={sections[7].label}>
            <div className="flex gap-3 rounded-xl border border-gray-200 bg-white p-5">
              <Shield className="text-gray-400 shrink-0 mt-0.5" size={20} />
              <p className="text-gray-600 font-light text-[15px] leading-relaxed">
                {fr ? (
                  <>Les données sont chiffrées au repos (AWS KMS / AES-256) et en transit (TLS 1.3). L'accès est contrôlé par la sécurité au niveau des lignes (Row-Level Security), le contrôle d'accès basé sur les rôles (RBAC) et l'authentification à deux facteurs (optionnelle). Les incidents de sécurité sont gérés conformément à notre plan de réponse aux violations.</>
                ) : (
                  <>Data is encrypted at rest (AWS KMS / AES-256) and in transit (TLS 1.3). Access is gated by Row-Level Security, role-based access control (RBAC), and optional two-factor authentication. Security incidents are handled per our Breach Response Plan.</>
                )}
              </p>
            </div>
          </Section>

          <Section id="cookies" title={sections[8].label}>
            <p>
              {fr
                ? "Nous utilisons des témoins de session strictement nécessaires au fonctionnement du service (authentification, sécurité). Les témoins d'analyse et de marketing ne sont déposés qu'avec votre consentement, que vous pouvez retirer à tout moment depuis le Centre de confidentialité."
                : 'We use session cookies that are strictly necessary for the service to function (authentication, security). Analytics and marketing cookies are only set with your consent, which you can withdraw at any time from the Privacy Center.'}
            </p>
          </Section>

          <Section id="mineurs" title={sections[9].label}>
            <p>
              {fr
                ? "Lume CRM est un outil professionnel destiné aux entreprises. Le service n'est pas destiné aux personnes de moins de 16 ans et nous ne collectons pas sciemment de renseignements personnels les concernant. Si vous pensez qu'un mineur nous a transmis des données, contactez-nous afin que nous les supprimions."
                : 'Lume CRM is a professional tool for businesses. The service is not intended for individuals under 16, and we do not knowingly collect personal data about them. If you believe a minor has provided us with data, contact us so we can delete it.'}
            </p>
          </Section>

          <Section id="modifications" title={sections[10].label}>
            <div className="flex gap-3 rounded-xl border border-gray-200 bg-white p-5">
              <Clock className="text-gray-400 shrink-0 mt-0.5" size={20} />
              <p className="text-gray-600 font-light text-[15px] leading-relaxed">
                {fr ? (
                  <>Toute modification importante est annoncée dans l'application au moins <strong className="font-medium text-gray-800">30 jours</strong> avant son entrée en vigueur. L'identifiant de version affiché en haut de cette page vous permet de savoir quelle version vous avez acceptée.</>
                ) : (
                  <>Any material change is announced in-product at least <strong className="font-medium text-gray-800">30 days</strong> before it takes effect. The version identifier shown at the top of this page lets you track which version you accepted.</>
                )}
              </p>
            </div>
          </Section>

          <Section id="contact" title={sections[11].label}>
            <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
              <div>
                <p className="font-medium text-gray-900">William Hébert</p>
                <p className="text-sm text-gray-500 font-light">
                  {fr ? 'Responsable de la protection des renseignements personnels' : 'Data Protection Officer'}
                </p>
                <p className="text-sm text-gray-500 font-light">Québec, Canada</p>
              </div>
              <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
                <a href={`mailto:${DPO_EMAIL}`} className="flex items-center gap-2 text-sm text-gray-700 hover:text-black transition-colors">
                  <Mail size={16} className="text-gray-400" />
                  {DPO_EMAIL}
                </a>
                <a href={`tel:${INCIDENT_PHONE.replace(/[\s-]/g, '')}`} className="flex items-center gap-2 text-sm text-gray-700 hover:text-black transition-colors">
                  <Phone size={16} className="text-gray-400" />
                  {fr ? 'Astreinte incidents 24/7 : ' : '24/7 incident hotline: '}{INCIDENT_PHONE}
                </a>
              </div>
            </div>
          </Section>

          <p className="text-xs text-gray-400 pt-4 border-t border-gray-200">
            {L.version} : <span className="font-mono">{CURRENT_PRIVACY_POLICY_VERSION}</span> — {L.lastUpdated} : {LAST_UPDATED}.
          </p>
        </div>
      </div>
    </div>
  );
}
