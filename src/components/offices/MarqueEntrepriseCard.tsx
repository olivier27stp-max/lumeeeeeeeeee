/**
 * Réglages → Bureaux → Marque commune (propriétaire, 2+ bureaux).
 *
 * Le logo et la couleur d'un bureau deviennent la marque de l'entreprise ;
 * chaque bureau choisit de la suivre (elle lui est alors recopiée
 * automatiquement, et chaque changement se propage) ou de garder la sienne.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCompany } from '../../contexts/CompanyContext';
import { useTranslation } from '../../i18n';
import { captureClientException } from '../../lib/sentry';
import {
  definirMarqueEntreprise,
  getMarqueEntreprise,
  suivreMarqueEntreprise,
  type MarqueEntreprise,
} from '../../lib/officesApi';

export default function MarqueEntrepriseCard({ bureauxIds }: { bureauxIds: string[] }) {
  const { current } = useCompany();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const uid = useId();
  const [data, setData] = useState<MarqueEntreprise | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  const charger = useCallback(async () => {
    if (!current) return;
    try {
      setData(await getMarqueEntreprise(current.orgId, bureauxIds));
    } catch (e) {
      console.error('[MarqueEntrepriseCard] chargement', e);
      captureClientException(e);
    }
  }, [current, bureauxIds]);
  useEffect(() => { void charger(); }, [charger]);

  if (!current || !data) return null;
  const bureauActuel = data.bureaux.find((b) => b.org_id === current.orgId);
  const nom = (n: string | null | undefined) => n || (fr ? 'Bureau sans nom' : 'Unnamed office');

  const prendreMarqueDuBureau = async () => {
    if (!bureauActuel) return;
    setEnCours('definir');
    try {
      await definirMarqueEntreprise(data.company_group_id, bureauActuel.logo_url, bureauActuel.brand_color);
      toast.success(fr ? 'Marque commune mise à jour.' : 'Company brand updated.');
      await charger();
    } catch (e: any) {
      console.error('[MarqueEntrepriseCard] définir', e);
      captureClientException(e);
      toast.error(fr ? 'Mise à jour impossible.' : 'Could not update.');
    } finally { setEnCours(null); }
  };

  const basculer = async (orgId: string, suit: boolean) => {
    setEnCours(orgId);
    try {
      await suivreMarqueEntreprise(orgId, suit);
      await charger();
    } catch (e: any) {
      console.error('[MarqueEntrepriseCard] suivre', e);
      captureClientException(e);
      toast.error(fr ? 'Modification impossible.' : 'Could not update.');
    } finally { setEnCours(null); }
  };

  const aMarque = !!(data.logo_url || data.brand_color);

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[16px] font-semibold text-text-primary">{fr ? 'Marque commune' : 'Company brand'}</h3>
        <p className="text-[12px] text-text-tertiary mt-0.5">
          {fr
            ? 'Le logo et la couleur que voient vos clients (soumissions, factures, courriels, pages de paiement). Un bureau qui suit la marque commune la reçoit automatiquement ; les coordonnées restent celles de chaque bureau.'
            : 'The logo and colour your clients see (quotes, invoices, emails, payment pages). An office that follows the company brand gets it automatically; contact details stay per office.'}
        </p>
      </div>

      <div className="rounded-2xl border border-outline-subtle bg-surface-card p-4 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl border border-outline overflow-hidden bg-surface-secondary flex items-center justify-center shrink-0">
            {data.logo_url
              ? <img src={data.logo_url} alt={fr ? 'Logo commun' : 'Company logo'} className="w-full h-full object-contain" />
              : <span className="text-[10px] text-text-tertiary">{fr ? 'Aucun' : 'None'}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-text-primary">
              {aMarque ? (fr ? 'Marque commune définie' : 'Company brand set') : (fr ? 'Aucune marque commune' : 'No company brand yet')}
            </p>
            {data.brand_color && (
              <p className="text-[12px] text-text-secondary inline-flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full border border-outline" style={{ background: data.brand_color }} />
                {data.brand_color}
              </p>
            )}
          </div>
          <button type="button" onClick={() => void prendreMarqueDuBureau()} disabled={!bureauActuel || enCours !== null}
            className="glass-button text-[12px] shrink-0 inline-flex items-center gap-1.5 disabled:opacity-50">
            {enCours === 'definir' && <Loader2 size={12} className="animate-spin" />}
            {fr ? `Prendre la marque de ${nom(bureauActuel?.company_name)}` : `Use ${nom(bureauActuel?.company_name)}'s brand`}
          </button>
        </div>

        <div className="space-y-2 border-t border-outline-subtle pt-3">
          {data.bureaux.map((b) => (
            <label key={b.org_id} htmlFor={`${uid}-${b.org_id}`} className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-[13px] text-text-primary truncate">{nom(b.company_name)}</span>
              <span className="flex items-center gap-2 shrink-0">
                {enCours === b.org_id && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
                <span className="text-[12px] text-text-secondary">{fr ? 'Suit la marque commune' : 'Follows company brand'}</span>
                <input id={`${uid}-${b.org_id}`} type="checkbox" className="h-4 w-4 rounded"
                  checked={b.suit_marque_entreprise} disabled={enCours !== null || !aMarque}
                  onChange={(e) => void basculer(b.org_id, e.target.checked)} />
              </span>
            </label>
          ))}
          {!aMarque && (
            <p className="text-[12px] text-text-tertiary">
              {fr ? 'Définissez d’abord la marque commune pour que les bureaux puissent la suivre.' : 'Set the company brand first so offices can follow it.'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
