/**
 * Bandeau « données importées pas encore activées ».
 *
 * Après un import de données (migration assistée), le bureau reste en
 * « communications gelées » tant que l'accompagnateur Lume n'a pas cliqué
 * « Activer le compte » dans la console des migrations : aucun courriel, SMS ni
 * automatisation ne part vers les clients importés. Sans ce bandeau, l'équipe
 * du bureau croyait ses automatisations en panne (2026-09-25).
 *
 * Source de vérité : org_features (feature = communications_gelees, enabled = true),
 * la même ligne que lit la garde d'envoi côté serveur. Lecture directe sous RLS,
 * rafraîchie chaque minute et au retour sur l'onglet : le bandeau disparaît seul
 * après l'activation.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useCompany } from '../contexts/CompanyContext';
import { useTranslation } from '../i18n';
import Modal from './ui/Modal';

export const FEATURE_GEL = 'communications_gelees';

interface EtatGel { gele: boolean; geleLe: string | null }

export async function lireEtatGel(orgId: string): Promise<EtatGel> {
  const { data, error } = await supabase
    .from('org_features')
    .select('enabled, metadata')
    .eq('org_id', orgId)
    .eq('feature', FEATURE_GEL)
    .maybeSingle();
  if (error) throw error;
  const meta = (data?.metadata ?? {}) as { gele_le?: string | null };
  return { gele: data?.enabled === true, geleLe: meta.gele_le ?? null };
}

const TEXTES = {
  fr: {
    titre: 'Vos données importées ne sont pas encore activées.',
    plus: 'Plus d’infos',
    modalTitre: 'Données importées en attente d’activation',
    avertissement: 'Les automatisations ne sont pas activées tant que les données n’ont pas été activées dans Migrations.',
    detail: 'Aucun courriel, SMS, rappel ou demande d’avis ne part vers vos clients importés pendant cette période. Tout le reste fonctionne normalement : consultation, planification, devis, factures.',
    suite: 'Une fois la vérification terminée, l’activation se fait en un clic dans la console des migrations. Les automatisations reprennent immédiatement.',
    depuis: 'Import terminé le',
    console: 'Ouvrir la console des migrations',
    fermer: 'Compris',
  },
  en: {
    titre: 'Your imported data is not activated yet.',
    plus: 'More info',
    modalTitre: 'Imported data awaiting activation',
    avertissement: 'Automations stay off until the data has been activated in Migrations.',
    detail: 'No email, SMS, reminder or review request goes out to your imported clients during this period. Everything else works normally: browsing, scheduling, quotes, invoices.',
    suite: 'Once the review is complete, activation is one click in the migrations console. Automations resume immediately.',
    depuis: 'Import completed on',
    console: 'Open the migrations console',
    fermer: 'Got it',
  },
} as const;

export default function BandeauDonneesNonActivees({ peutActiver = false }: { peutActiver?: boolean }) {
  const { currentOrgId } = useCompany();
  const { language } = useTranslation();
  const tx = TEXTES[language === 'en' ? 'en' : 'fr'];
  const [ouvert, setOuvert] = useState(false);

  const etat = useQuery({
    queryKey: ['communications-gel', currentOrgId],
    queryFn: () => lireEtatGel(currentOrgId as string),
    enabled: !!currentOrgId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  if (!etat.data?.gele) return null;

  const dateImport = etat.data.geleLe
    ? new Date(etat.data.geleLe).toLocaleDateString(language === 'en' ? 'en-CA' : 'fr-CA', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <>
      <div
        role="status"
        className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-2 bg-amber-50 border-b border-amber-200 text-[13px] text-amber-900"
      >
        <AlertTriangle size={15} className="shrink-0 text-amber-600" />
        <span><strong>{tx.titre}</strong></span>
        <button
          type="button"
          onClick={() => setOuvert(true)}
          className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:text-amber-950 focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
        >
          <Info size={13} />
          {tx.plus}
        </button>
      </div>

      <Modal open={ouvert} onClose={() => setOuvert(false)} title={tx.modalTitre} size="md">
        <div className="space-y-4 text-[14px] text-text-primary">
          <div role="alert" className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
            <AlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-600" />
            <p className="font-semibold">{tx.avertissement}</p>
          </div>
          <p className="text-text-secondary">{tx.detail}</p>
          <p className="text-text-secondary">{tx.suite}</p>
          {dateImport && (
            <p className="text-[12px] text-text-tertiary">{tx.depuis} {dateImport}.</p>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {peutActiver && (
              <Link
                to="/creator-space/migrations"
                onClick={() => setOuvert(false)}
                className="px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-amber-600 text-white hover:bg-amber-700"
              >
                {tx.console}
              </Link>
            )}
            <button
              type="button"
              onClick={() => setOuvert(false)}
              className="px-3 py-1.5 rounded-lg text-[13px] font-semibold border border-border hover:bg-surface-tertiary"
            >
              {tx.fermer}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
