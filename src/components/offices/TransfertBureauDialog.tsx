/**
 * « Transférer vers un bureau » — fenêtre de choix du bureau (contrôlée par la
 * page, rendue HORS du menu déroulant qui se ferme au clic) + usePeutTransferer.
 *
 * Copie l'élément dans le bureau cible (nouveau numéro, taxes du bureau cible)
 * et archive l'original ; tout est vérifié en base (transferer_vers_bureau).
 * Visible seulement pour un admin / propriétaire qui a au moins 2 bureaux.
 */
import { useId, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCompany } from '../../contexts/CompanyContext';
import { useTranslation } from '../../i18n';
import { captureClientException } from '../../lib/sentry';
import { transfererVersBureau, type EntiteTransferable } from '../../lib/transfertsApi';

const CHEMIN: Record<EntiteTransferable, string> = { client: '/clients', quote: '/quotes', job: '/jobs' };

/** Bureaux vers lesquels l'utilisateur peut transférer (admin/propriétaire des deux côtés). */
function useBureauxCibles() {
  const { companies, current, currentRole } = useCompany();
  const autres = useMemo(
    () => companies.filter((c) => c.orgId !== current?.orgId && (c.role === 'owner' || c.role === 'admin') && c.status === 'active'),
    [companies, current?.orgId],
  );
  const permis = !!current && (currentRole === 'owner' || currentRole === 'admin') && autres.length > 0;
  return { autres, permis };
}

/** Faut-il montrer l'entrée « Transférer vers un bureau… » ? */
export function usePeutTransferer(): boolean {
  return useBureauxCibles().permis;
}

/** Libellé de l'entrée de menu, avec son icône. */
export function LibelleTransfert() {
  const { language } = useTranslation();
  return <><ArrowRightLeft size={14} /> {language === 'fr' ? 'Transférer vers un bureau…' : 'Move to another office…'}</>;
}

export default function TransfertBureauDialog({
  entite,
  id,
  ouvert,
  onFermer,
  onTransfere,
}: {
  entite: EntiteTransferable;
  id: string;
  ouvert: boolean;
  onFermer: () => void;
  /** Après un transfert réussi (recharger la fiche : l'original est archivé). */
  onTransfere?: () => void;
}) {
  const { companies, switchCompany } = useCompany();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const uid = useId();
  const { autres, permis } = useBureauxCibles();
  const [cible, setCible] = useState('');
  const [enCours, setEnCours] = useState(false);
  const cibleEffective = cible || (autres.length === 1 ? autres[0].orgId : '');
  if (!permis || !ouvert) return null;

  const nomBureau = (orgId: string) =>
    companies.find((c) => c.orgId === orgId)?.companyName || (fr ? 'Bureau sans nom' : 'Unnamed office');

  const quoi = {
    client: fr ? 'ce client' : 'this client',
    quote: fr ? 'cette soumission' : 'this quote',
    job: fr ? 'ce job' : 'this job',
  }[entite];

  const explication = {
    client: fr
      ? 'Le client est copié dans le bureau choisi, avec ses soumissions ouvertes et ses jobs non facturés. Ses factures restent dans ce bureau-ci ; sans facture, la fiche d’origine est archivée.'
      : 'The client is copied to the chosen office, with its open quotes and unbilled jobs. Its invoices stay here; without invoices, the original is archived.',
    quote: fr
      ? 'La soumission est copiée en brouillon dans le bureau choisi, avec un nouveau numéro et ses taxes ; l’originale est archivée. Renvoyez-la depuis le nouveau bureau.'
      : 'The quote is copied as a draft to the chosen office, with a new number and its taxes; the original is archived. Re-send it from the new office.',
    job: fr
      ? 'Le job est copié dans le bureau choisi avec un nouveau numéro, ses lignes et ses visites à venir ; l’original est archivé et retiré du calendrier.'
      : 'The job is copied to the chosen office with a new number, its lines and upcoming visits; the original is archived and removed from the calendar.',
  }[entite];

  const transferer = async () => {
    const cible = cibleEffective;
    if (!cible) return;
    setEnCours(true);
    try {
      const r = await transfererVersBureau(entite, id, cible);
      const bureau = nomBureau(cible);
      const extra = entite === 'client' && (r.devis || r.jobs)
        ? (fr ? ` (${r.devis ?? 0} soumission(s), ${r.jobs ?? 0} job(s) avec lui)` : ` (${r.devis ?? 0} quote(s), ${r.jobs ?? 0} job(s) with it)`)
        : '';
      const taxes = r.taxes === 'conservees'
        ? (fr ? ' Taxes d’origine conservées : le bureau cible n’a pas de taxe par défaut.' : ' Original taxes kept: the target office has no default tax.')
        : '';
      toast.success(
        fr ? `Transféré vers ${bureau}${r.numero ? ` — n° ${r.numero}` : ''}${extra}.${taxes}` : `Moved to ${bureau}${r.numero ? ` — #${r.numero}` : ''}${extra}.${taxes}`,
        {
          duration: 10000,
          action: {
            label: fr ? `Ouvrir dans ${bureau}` : `Open in ${bureau}`,
            onClick: () => { switchCompany(cible); window.location.assign(`${CHEMIN[entite]}/${r.id_cible}`); },
          },
        },
      );
      onFermer();
      onTransfere?.();
    } catch (e: any) {
      console.error('[TransfertBureauBouton]', e);
      captureClientException(e);
      toast.error(e?.message || (fr ? 'Transfert impossible.' : 'Transfer failed.'));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <>
      {(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" role="presentation" tabIndex={-1} onClick={() => !enCours && onFermer()} />
          <div role="dialog" aria-modal="true" aria-labelledby={`${uid}-titre`}
            className="relative w-full max-w-md bg-surface border border-outline rounded-2xl shadow-xl p-5 space-y-4">
            <h2 id={`${uid}-titre`} className="text-[16px] font-semibold text-text-primary">
              {fr ? `Transférer ${quoi} vers un autre bureau` : `Move ${quoi} to another office`}
            </h2>
            <p className="text-[13px] text-text-secondary">{explication}</p>
            <div>
              <label htmlFor={`${uid}-bureau`} className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                {fr ? 'Bureau cible' : 'Target office'}
              </label>
              <select id={`${uid}-bureau`} value={cibleEffective} onChange={(e) => setCible(e.target.value)} className="glass-input w-full mt-1">
                <option value="">{fr ? 'Choisir un bureau…' : 'Choose an office…'}</option>
                {autres.map((c) => <option key={c.orgId} value={c.orgId}>{nomBureau(c.orgId)}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onFermer} disabled={enCours} className="glass-button px-3 py-2 text-[13px]">
                {fr ? 'Annuler' : 'Cancel'}
              </button>
              <button type="button" onClick={() => void transferer()} disabled={!cibleEffective || enCours}
                className="glass-button-primary px-3 py-2 text-[13px] inline-flex items-center gap-2 disabled:opacity-50">
                {enCours && <Loader2 size={14} className="animate-spin" />}
                {fr ? 'Transférer' : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
