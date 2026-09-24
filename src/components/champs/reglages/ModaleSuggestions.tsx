/**
 * Réglages → Champs personnalisés : « Champs suggérés pour ton métier ».
 *
 * Le métier choisi à l'inscription est présélectionné (modifiable) ; chaque
 * champ du modèle est coché d'office, sauf ceux qui existent déjà. Un seul
 * appel crée le tout (src/lib/champs/modeles.ts, rejouable côté serveur).
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Loader2 } from 'lucide-react';
import Modal from '../../ui/Modal';
import { installerModele, lireIndustrie, type ChampPerso } from '../../../lib/champsPersoApi';
import { INDUSTRIES_MODELES, MODELES_CHAMPS, type IndustrieModele } from '../../../lib/champs/modeles';
import { LIBELLES_OBJET, LIBELLES_TYPE } from '../../../lib/champs/types';

const NOMS_INDUSTRIE: Record<IndustrieModele, { fr: string; en: string }> = {
  landscaping: { fr: 'Paysagement', en: 'Landscaping' },
  snow_removal: { fr: 'Déneigement', en: 'Snow removal' },
  residential_cleaning: { fr: 'Nettoyage résidentiel', en: 'Residential cleaning' },
  commercial_cleaning: { fr: 'Nettoyage commercial', en: 'Commercial cleaning' },
  plumbing: { fr: 'Plomberie', en: 'Plumbing' },
  electrical: { fr: 'Électricité', en: 'Electrical' },
  roofing: { fr: 'Toiture', en: 'Roofing' },
  hvac: { fr: 'HVAC / Chauffage-Clim', en: 'HVAC' },
  window_cleaning: { fr: 'Lavage de vitres', en: 'Window cleaning' },
  other: { fr: 'Autre', en: 'Other' },
};

export function useIndustrie(actif: boolean) {
  return useQuery({ queryKey: ['champs-perso', 'industrie'], queryFn: lireIndustrie, enabled: actif, staleTime: 3_600_000 });
}

export function nomIndustrie(i: IndustrieModele, fr: boolean) {
  return fr ? NOMS_INDUSTRIE[i].fr : NOMS_INDUSTRIE[i].en;
}

export default function ModaleSuggestions({ open, onClose, onInstalle, champsExistants, fr }: {
  open: boolean; onClose: () => void; onInstalle: () => void; champsExistants: ChampPerso[]; fr: boolean;
}) {
  const ids = useId();
  const { data: industrieOrg } = useIndustrie(open);
  const [industrie, setIndustrie] = useState<IndustrieModele>('other');
  const [choix, setChoix] = useState<Set<string>>(new Set());
  const [envoi, setEnvoi] = useState(false);

  const pris = useMemo(() => new Set(champsExistants.map((c) => `${c.object_type}:${c.key}`)), [champsExistants]);
  const modele = MODELES_CHAMPS[industrie];
  /** Déjà là = présent sur TOUS ses objets. */
  const dejaLa = (id: string) => {
    const m = modele.find((x) => x.id === id);
    return !!m && m.objets.every((o) => pris.has(`${o}:${m.key}`));
  };

  useEffect(() => { if (open) setIndustrie(industrieOrg ?? 'other'); }, [open, industrieOrg]);
  useEffect(() => {
    setChoix(new Set(MODELES_CHAMPS[industrie].filter((m) => !m.objets.every((o) => pris.has(`${o}:${m.key}`))).map((m) => m.id)));
  }, [industrie, pris]);

  const installer = async () => {
    if (choix.size === 0) return;
    setEnvoi(true);
    try {
      const r = await installerModele(industrie, [...choix], fr ? 'fr' : 'en');
      // Même compte que le bouton : un champ du modèle posé sur plusieurs objets compte pour un.
      const n = choix.size;
      toast.success(r.crees === 0
        ? (fr ? 'Ces champs existent déjà.' : 'These fields already exist.')
        : fr ? `${n} champ${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''}.` : `${n} field${n === 1 ? '' : 's'} added.`);
      onInstalle();
      onClose();
    } catch (err) {
      console.error('[ModaleSuggestions] installation', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={fr ? 'Champs suggérés pour ton métier' : 'Suggested fields for your trade'}
      description={fr
        ? 'Les infos que les entreprises comme la tienne notent sur chaque client et chaque job. Tu pourras tout renommer ou retirer ensuite.'
        : 'What businesses like yours track on every client and job. You can rename or remove anything later.'}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="glass-button">{fr ? 'Annuler' : 'Cancel'}</button>
          <button type="button" disabled={envoi || choix.size === 0} onClick={() => { void installer(); }} className="glass-button-primary inline-flex items-center gap-2">
            {envoi && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {fr ? `Ajouter ${choix.size} champ${choix.size > 1 ? 's' : ''}` : `Add ${choix.size} field${choix.size === 1 ? '' : 's'}`}
          </button>
        </div>
      )}>
      <div className="space-y-4">
        <div>
          <label htmlFor={`${ids}-metier`} className="mb-1 block text-[12px] font-medium text-text-secondary">{fr ? 'Métier' : 'Trade'}</label>
          <select id={`${ids}-metier`} value={industrie} onChange={(e) => setIndustrie(e.target.value as IndustrieModele)} className="glass-input h-9 w-full text-[13px]">
            {INDUSTRIES_MODELES.map((i) => <option key={i} value={i}>{nomIndustrie(i, fr)}</option>)}
          </select>
        </div>
        <ul className="divide-y divide-outline/40 rounded-lg border border-outline">
          {modele.map((m) => {
            const la = dejaLa(m.id);
            return (
              <li key={m.id}>
                <label htmlFor={`${ids}-${m.id}`} className="flex items-start gap-3 px-3 py-2.5">
                  <input id={`${ids}-${m.id}`} type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" disabled={la} checked={!la && choix.has(m.id)}
                    onChange={(e) => setChoix((c) => { const n = new Set(c); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n; })} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-text-primary">{fr ? m.fr : m.en}</span>
                    <span className="mt-0.5 block text-[12px] text-text-tertiary">
                      {(fr ? LIBELLES_TYPE[m.field_type].fr : LIBELLES_TYPE[m.field_type].en)}
                      {' · '}
                      {m.objets.map((o) => (fr ? LIBELLES_OBJET[o].fr : LIBELLES_OBJET[o].en)).join(', ')}
                      {m.options && ` · ${m.options.map((o) => (fr ? o.fr : o.en)).join(', ')}`}
                    </span>
                  </span>
                  {m.document && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-surface-secondary px-1.5 py-0.5 text-[11px] text-text-secondary"
                      title={fr ? 'Affiché sur le devis et la facture' : 'Shown on the quote and invoice'}>
                      <FileText size={11} aria-hidden />{fr ? 'Sur le document' : 'On documents'}
                    </span>
                  )}
                  {la && <span className="shrink-0 text-[11px] text-text-tertiary">{fr ? 'Déjà là' : 'Already added'}</span>}
                </label>
              </li>
            );
          })}
        </ul>
        {modele.some((m) => m.objets.length > 1) && (
          <p className="text-[12px] text-text-tertiary">
            {fr
              ? 'Un champ sur le devis ET le job suit tout seul quand tu convertis le devis, puis quand tu factures.'
              : 'A field on both the quote AND the job follows automatically when you convert the quote, then when you invoice.'}
          </p>
        )}
      </div>
    </Modal>
  );
}
