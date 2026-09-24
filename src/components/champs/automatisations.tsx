/**
 * Champs personnalisés × builder d'automatisations.
 *
 *   · useChampsTous : tous les champs (drapeau `custom_fields_v2` requis) ;
 *   · SelecteurChamp : choisir un champ (déclencheur « champ modifié »,
 *     action « mettre à jour un champ ») ;
 *   · BoutonsVariablesChamps : insérer [client_cf_superficie]… ;
 *   · ConditionsChampsEtape : conditions `champs_perso` d'une étape « si ».
 * Coupé par le drapeau, rien de tout ça ne s'affiche.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useModuleAccess } from '../../hooks/useModuleAccess';
import { listerChamps } from '../../lib/champsPersoApi';
import { LIBELLES_OBJET, OBJETS, variableModele, type ChampPerso, type ObjetChamp } from '../../lib/champs/types';
import type { Condition } from '../../lib/champs/filtres';
import EditeurConditions from './EditeurConditions';

export function useChampsTous(): ChampPerso[] {
  const { isEnabled } = useModuleAccess('custom_fields_v2');
  const { data } = useQuery({
    queryKey: ['champs-perso', 'tous'],
    queryFn: () => listerChamps(),
    enabled: isEnabled,
    staleTime: 60_000,
  });
  return useMemo(() => (data?.fields ?? []).filter((c) => !c.archived_at), [data]);
}

/** L'objet d'un déclencheur du catalogue (champ `entite`). */
export function objetDuDeclencheur(entite: string | undefined): ObjetChamp | null {
  switch (entite) {
    case 'lead': return 'client';
    case 'deal': return 'deal';
    case 'job': return 'job';
    case 'quote': return 'quote';
    case 'invoice': return 'invoice';
    default: return null;
  }
}

/** Variables de modèle des champs : [client_cf_superficie], … */
export function variablesDesChamps(champs: ChampPerso[]): string[] {
  return champs.map((c) => variableModele(c.object_type, c.key));
}

export function SelecteurChamp({ id, valeur, onChange, champs, fr, objet, className }: {
  id: string; valeur: string; onChange: (id: string) => void; champs: ChampPerso[]; fr: boolean;
  /** Restreindre à un objet (celui de l'événement), sinon tous groupés. */
  objet?: ObjetChamp | null; className?: string;
}) {
  const objets = objet ? [objet] : [...OBJETS];
  return (
    <select id={id} value={valeur} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{fr ? '— Choisir un champ —' : '— Choose a field —'}</option>
      {objets.map((o) => {
        const liste = champs.filter((c) => c.object_type === o);
        return liste.length ? (
          <optgroup key={o} label={fr ? LIBELLES_OBJET[o].fr : LIBELLES_OBJET[o].en}>
            {liste.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}

export function BoutonsVariablesChamps({ champs, fr, onInserer }: { champs: ChampPerso[]; fr: boolean; onInserer: (variable: string) => void }) {
  if (champs.length === 0) return null;
  return (
    <>
      {champs.map((c) => (
        <button
          key={c.id} type="button"
          onClick={() => onInserer(variableModele(c.object_type, c.key))}
          title={`[${variableModele(c.object_type, c.key)}]`}
          className="rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {(fr ? LIBELLES_OBJET[c.object_type].fr : LIBELLES_OBJET[c.object_type].en)} · {c.label}
        </button>
      ))}
    </>
  );
}

/** Conditions sur les champs d'une étape « si » (clé réservée `champs_perso`). */
export function ConditionsChampsEtape({ conditions, onChange, champs, objet, fr }: {
  conditions: Record<string, unknown> | undefined; onChange: (c: Record<string, unknown>) => void;
  champs: ChampPerso[]; objet: ObjetChamp | null; fr: boolean;
}) {
  if (!objet) return null;
  const duObjet = champs.filter((c) => c.object_type === objet);
  if (duObjet.length === 0) return null;
  const actuelles = (Array.isArray(conditions?.champs_perso) ? conditions!.champs_perso : []) as Condition[];
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-xs font-medium text-text-primary">
        {fr ? '… et si les champs personnalisés sont :' : '… and if the custom fields are:'}
      </p>
      <EditeurConditions champs={duObjet} conditions={actuelles} fr={fr}
        onChange={(liste) => {
          const { champs_perso: _ancien, ...reste } = conditions ?? {};
          onChange(liste.length ? { ...reste, champs_perso: liste } : reste);
        }} />
    </div>
  );
}

/**
 * Variables de champs proposées dans un éditeur de courriel.
 *   · modèle de facture (invoice_sent, invoice_reminder) : champs du client
 *     et de la facture ; modèle de soumission (quote_sent) : client et devis —
 *     ce que le serveur sait remplir pour ce poste ;
 *   · autre modèle d'entreprise : aucun (le serveur ne les remplirait pas) ;
 *   · automatisation (pas de type) : tous les objets.
 */
export function variablesChampsPourCourriel(
  typeCourriel: string | undefined, champs: ChampPerso[],
): Array<{ cle: string; fr: string; en: string }> {
  const objets: ObjetChamp[] = !typeCourriel
    ? [...OBJETS]
    : typeCourriel === 'invoice_sent' || typeCourriel === 'invoice_reminder' ? ['client', 'invoice']
    : typeCourriel === 'quote_sent' ? ['client', 'quote'] : [];
  return champs.filter((c) => objets.includes(c.object_type)).map((c) => ({
    cle: variableModele(c.object_type, c.key),
    fr: `${LIBELLES_OBJET[c.object_type].fr} · ${c.label}`,
    en: `${LIBELLES_OBJET[c.object_type].en} · ${c.label}`,
  }));
}
