import React from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { useTranslation } from '../i18n';
import { CURRENT_TOS_VERSION } from '../lib/consentApi';
import { LEGAL_LABELS } from '../content/legal';

/**
 * Terms of Service — bilingual (FR/EN).
 * ⚠️ Template content — must be reviewed by legal counsel before production use.
 */

const LAST_UPDATED = '2026-04-21';
const CONTACT_EMAIL = 'willhebert30@gmail.com';

const SECTIONS = {
  fr: [
    { id: 'accord', label: '1. Acceptation' },
    { id: 'service', label: '2. Le service' },
    { id: 'compte', label: '3. Votre compte' },
    { id: 'usage', label: '4. Utilisation acceptable' },
    { id: 'donnees', label: '5. Vos données' },
    { id: 'paiement', label: '6. Paiement' },
    { id: 'disponibilite', label: '7. Disponibilité' },
    { id: 'resiliation', label: '8. Résiliation' },
    { id: 'responsabilite', label: '9. Responsabilité' },
    { id: 'droit', label: '10. Droit applicable' },
    { id: 'modifications', label: '11. Modifications' },
    { id: 'contact', label: '12. Contact' },
  ],
  en: [
    { id: 'accord', label: '1. Agreement' },
    { id: 'service', label: '2. The service' },
    { id: 'compte', label: '3. Your account' },
    { id: 'usage', label: '4. Acceptable use' },
    { id: 'donnees', label: '5. Your data' },
    { id: 'paiement', label: '6. Payment' },
    { id: 'disponibilite', label: '7. Availability' },
    { id: 'resiliation', label: '8. Termination' },
    { id: 'responsabilite', label: '9. Liability' },
    { id: 'droit', label: '10. Governing law' },
    { id: 'modifications', label: '11. Changes' },
    { id: 'contact', label: '12. Contact' },
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

export default function Terms() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const L = LEGAL_LABELS[language];
  const sections = SECTIONS[language];

  return (
    <div className="min-h-screen bg-[#F8F9FA]">
      {/* Header band */}
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <Link to="/" className="text-[10px] uppercase tracking-widest text-gray-400 hover:text-black transition-colors">
            {L.backToHome}
          </Link>
          <h1 className="text-4xl font-extralight tracking-wide mt-6 text-gray-900">
            {fr ? "Conditions d'utilisation" : 'Terms of Service'}
          </h1>
          <p className="mt-3 text-sm text-gray-500 font-light max-w-2xl">
            {fr
              ? "Ces conditions régissent votre utilisation de Lume CRM. En créant un compte, vous acceptez les termes ci-dessous."
              : 'These terms govern your use of Lume CRM. By creating an account, you agree to the terms below.'}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-400">
            <span>{L.version} : <span className="font-mono text-gray-600">{CURRENT_TOS_VERSION}</span></span>
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
          <Section id="accord" title={sections[0].label}>
            <p>
              {fr
                ? "En créant un compte ou en utilisant Lume CRM (le « Service »), vous acceptez les présentes conditions. Si vous acceptez au nom d'une organisation, vous déclarez avoir le pouvoir de l'engager."
                : 'By creating an account or using Lume CRM (the "Service"), you agree to these Terms. If you are accepting on behalf of an organization, you represent that you have authority to bind that organization.'}
            </p>
          </Section>

          <Section id="service" title={sections[1].label}>
            <p>
              {fr
                ? "Lume CRM fournit une plateforme de gestion de la relation client (CRM) multi-locataire incluant le suivi des prospects, la gestion du pipeline, la planification, la facturation, les paiements, la messagerie et des flux assistés par IA."
                : 'Lume CRM provides a multi-tenant customer relationship management platform including lead tracking, pipeline management, scheduling, invoicing, payments, messaging, and AI-assisted workflows.'}
            </p>
          </Section>

          <Section id="compte" title={sections[2].label}>
            <ul className="space-y-2 list-disc pl-5 marker:text-gray-300">
              {(fr
                ? [
                    'Vous êtes responsable de la confidentialité de vos identifiants.',
                    'Vous devez nous signaler sans délai tout accès non autorisé.',
                    "L'authentification à deux facteurs est fortement recommandée pour les comptes administrateurs.",
                  ]
                : [
                    'You are responsible for keeping your credentials confidential.',
                    'You must notify us without delay of any unauthorized access.',
                    'Two-factor authentication is strongly recommended for admin accounts.',
                  ]
              ).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </Section>

          <Section id="usage" title={sections[3].label}>
            <p>{fr ? 'Vous vous engagez à ne pas :' : 'You agree not to:'}</p>
            <ul className="space-y-2 list-disc pl-5 marker:text-gray-300">
              {(fr
                ? [
                    'utiliser le Service à des fins illégales ;',
                    "importer des données personnelles que vous n'êtes pas autorisé à traiter ;",
                    "tenter d'accéder aux données d'un autre locataire ou de contourner les contrôles de sécurité ;",
                    'faire de la rétro-ingénierie, revendre ou rebrander le Service sans accord écrit ;',
                    'envoyer du pourriel ou enfreindre les lois anti-pourriel (LCAP / CASL).',
                  ]
                : [
                    'use the Service for unlawful activity;',
                    'import personal data you are not authorized to process;',
                    "attempt to access another tenant's data or bypass security controls;",
                    'reverse-engineer, resell, or white-label the Service without a written agreement;',
                    'send spam or violate anti-spam laws (CAN-SPAM, CASL).',
                  ]
              ).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </Section>

          <Section id="donnees" title={sections[4].label}>
            <p>
              {fr ? (
                <>Vous conservez la propriété des données que vous saisissez. Nous les traitons en votre nom à titre de sous-traitant et appliquons les garanties décrites dans notre <Link to="/privacy" className="text-black underline hover:text-gray-600">Politique de confidentialité</Link>. Une entente de traitement des données (DPA) est disponible sur demande pour les clients entreprise.</>
              ) : (
                <>You retain ownership of the data you input. We process it on your behalf as a data processor and apply the safeguards described in our <Link to="/privacy" className="text-black underline hover:text-gray-600">Privacy Policy</Link>. A Data Processing Agreement (DPA) is available on request for enterprise customers.</>
              )}
            </p>
          </Section>

          <Section id="paiement" title={sections[5].label}>
            <p>
              {fr
                ? "Les frais sont facturés mensuellement ou annuellement, à l'avance, et ne sont pas remboursables sauf lorsque la loi l'exige. Un paiement en retard peut entraîner une suspension après 14 jours."
                : 'Fees are billed monthly or annually, in advance, and are non-refundable except where required by law. Late payment may result in suspension after 14 days.'}
            </p>
          </Section>

          <Section id="disponibilite" title={sections[6].label}>
            <p>
              {fr
                ? "Nous visons une disponibilité mensuelle de 99,5 %. La maintenance planifiée est annoncée au moins 48 heures à l'avance lorsque possible."
                : 'We target 99.5% monthly uptime. Scheduled maintenance is announced at least 48 hours in advance when possible.'}
            </p>
          </Section>

          <Section id="resiliation" title={sections[7].label}>
            <p>
              {fr
                ? "Vous pouvez fermer votre compte à tout moment. À la résiliation, nous conservons des registres anonymisés tel qu'exigé par la loi (fiscalité, audit) et supprimons ou anonymisons les données personnelles dans un délai de 90 jours, sauf si une conservation plus longue est légalement obligatoire."
                : 'You may close your account at any time. On termination, we retain anonymized records as required by law (tax, audit) and delete or anonymize personal data within 90 days unless a longer retention is legally mandated.'}
            </p>
          </Section>

          <Section id="responsabilite" title={sections[8].label}>
            <p>
              {fr
                ? "Dans la mesure maximale permise par la loi, notre responsabilité globale est limitée aux frais que vous avez payés au cours des 12 mois précédant la réclamation. Nous ne sommes pas responsables des dommages indirects, accessoires ou consécutifs."
                : 'To the maximum extent permitted by law, our aggregate liability is limited to the fees you paid in the 12 months preceding the claim. We are not liable for indirect, incidental, or consequential damages.'}
            </p>
          </Section>

          <Section id="droit" title={sections[9].label}>
            <p>
              {fr
                ? "Les présentes conditions sont régies par les lois du Québec et les lois applicables du Canada. Tout litige sera porté devant les tribunaux du district de Montréal."
                : 'These Terms are governed by the laws of Québec and the applicable laws of Canada. Any dispute shall be brought before the courts of the district of Montréal.'}
            </p>
          </Section>

          <Section id="modifications" title={sections[10].label}>
            <p>
              {fr
                ? "Toute modification importante est annoncée dans l'application au moins 30 jours avant son entrée en vigueur."
                : 'Material changes are announced in-product at least 30 days before taking effect.'}
            </p>
          </Section>

          <Section id="contact" title={sections[11].label}>
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <a href={`mailto:${CONTACT_EMAIL}`} className="flex items-center gap-2 text-sm text-gray-700 hover:text-black transition-colors">
                <Mail size={16} className="text-gray-400" />
                {CONTACT_EMAIL}
              </a>
            </div>
          </Section>

          <p className="text-xs text-gray-400 pt-4 border-t border-gray-200">
            {L.version} : <span className="font-mono">{CURRENT_TOS_VERSION}</span> — {L.lastUpdated} : {LAST_UPDATED}.
          </p>
        </div>
      </div>
    </div>
  );
}
