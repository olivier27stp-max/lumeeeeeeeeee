/**
 * « Copier vers d'autres bureaux » — une automatisation vers les bureaux de
 * l'entreprise où l'on a le droit de modifier les automatisations.
 *
 * Par défaut la copie reste LIÉE : modifier cette automatisation met ses
 * copies à jour. Chaque copie envoie depuis le numéro et le courriel de SON
 * bureau. Ce qui n'existe pas dans un bureau (étape, champ, personne) est
 * signalé et la copie y reste en brouillon.
 */
import { useId, useState } from 'react';
import { Building2, Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { copierVersBureaux, type BureauCible, type ResultatCopie } from '../../lib/automationBuilderApi';

export default function CopierVersBureauxModal({
  ruleId, ruleName, bureaux, fr, onClose, onFini,
}: {
  ruleId: string;
  ruleName: string;
  bureaux: BureauCible[];
  fr: boolean;
  onClose: () => void;
  onFini: () => void;
}) {
  const id = useId();
  const [choisis, setChoisis] = useState<Set<string>>(() => new Set(bureaux.map((b) => b.org_id)));
  const [lier, setLier] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [resultats, setResultats] = useState<ResultatCopie[] | null>(null);

  const basculer = (org: string) => setChoisis((s) => {
    const n = new Set(s);
    if (n.has(org)) n.delete(org); else n.add(org);
    return n;
  });

  const copier = async () => {
    setEnvoi(true);
    try {
      const r = await copierVersBureaux(ruleId, [...choisis], lier);
      setResultats(r);
      onFini();
    } catch (e: unknown) {
      console.error('[automatisations] copie vers bureaux échouée', e);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvoi(false);
    }
  };

  const libelle = (r: ResultatCopie) => {
    switch (r.statut) {
      case 'copiee': return r.active ? (fr ? 'Copiée et publiée' : 'Copied and published') : (fr ? 'Copiée en brouillon' : 'Copied as draft');
      case 'mise_a_jour': return fr ? 'Déjà là : mise à jour et liée' : 'Already there: updated and linked';
      case 'preset_mis_a_jour': return fr ? 'Automatisation fournie mise à jour' : 'Built-in automation updated';
      case 'existe_deja': return fr ? 'Existe déjà (non modifiée)' : 'Already exists (unchanged)';
      case 'sans_droit': return fr ? 'Pas le droit dans ce bureau' : 'No permission in this office';
      default: return r.erreur || (fr ? 'Échec' : 'Failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" tabIndex={-1} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titre`}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 id={`${id}-titre`} className="text-[15px] font-bold text-text-primary">
            {fr ? 'Copier vers d’autres bureaux' : 'Copy to other offices'}
          </h3>
          <button type="button" onClick={onClose} aria-label={fr ? 'Fermer' : 'Close'} className="rounded-lg p-1 text-text-tertiary hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-[13px] text-text-secondary">
            {fr
              ? `« ${ruleName} » : chaque copie envoie depuis le numéro et le courriel de son bureau.`
              : `“${ruleName}”: each copy sends from its own office’s number and email.`}
          </p>

          {!resultats ? (
            <>
              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 text-[12px] font-semibold text-text-secondary">{fr ? 'Bureaux' : 'Offices'}</legend>
                {bureaux.map((b) => (
                  <label key={b.org_id} htmlFor={`${id}-${b.org_id}`} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-text-primary hover:bg-surface-secondary">
                    <input id={`${id}-${b.org_id}`} type="checkbox" checked={choisis.has(b.org_id)} onChange={() => basculer(b.org_id)} />
                    <Building2 size={13} className="text-text-tertiary" aria-hidden="true" />
                    {b.name}
                  </label>
                ))}
              </fieldset>
              <label htmlFor={`${id}-lier`} className="flex cursor-pointer items-start gap-2 text-[13px] text-text-primary">
                <input id={`${id}-lier`} type="checkbox" className="mt-0.5" checked={lier} onChange={(e) => setLier(e.target.checked)} />
                <span>
                  {fr ? 'Garder les copies à jour' : 'Keep copies in sync'}
                  <span className="block text-[12px] text-text-tertiary">
                    {fr
                      ? 'Modifier celle-ci modifiera ses copies. Modifier une copie la détache.'
                      : 'Editing this one updates its copies. Editing a copy detaches it.'}
                  </span>
                </span>
              </label>
            </>
          ) : (
            <ul className="space-y-2" aria-live="polite">
              {resultats.map((r) => (
                <li key={r.org_id} className="rounded-lg border border-border px-3 py-2 text-[13px]">
                  <span className="flex items-center gap-2 font-medium text-text-primary">
                    {r.statut === 'echec' || r.statut === 'sans_droit'
                      ? <X size={13} className="text-danger" aria-hidden="true" />
                      : <Check size={13} className="text-success" aria-hidden="true" />}
                    {r.name || bureaux.find((b) => b.org_id === r.org_id)?.name}
                  </span>
                  <span className="block text-[12px] text-text-secondary">{libelle(r)}</span>
                  {r.a_revoir && r.a_revoir.length > 0 && (
                    <span className="block text-[12px] text-warning">
                      {fr ? 'À revoir dans ce bureau : ' : 'To review in this office: '}{r.a_revoir.join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="glass-button px-4 py-2 text-[13px]">
            {resultats ? (fr ? 'Fermer' : 'Close') : (fr ? 'Annuler' : 'Cancel')}
          </button>
          {!resultats && (
            <button
              type="button"
              onClick={copier}
              disabled={envoi || choisis.size === 0}
              className="glass-button-primary flex items-center gap-2 px-4 py-2 text-[13px] disabled:opacity-50"
            >
              {envoi && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
              {fr ? 'Copier' : 'Copy'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
