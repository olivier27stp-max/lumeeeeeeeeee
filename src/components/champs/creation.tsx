/**
 * Les champs personnalisés DANS un formulaire de création (client, job,
 * devis, opportunité) — comme GoHighLevel, on les remplit avant que la fiche
 * existe.
 *
 *   const champs = useChampsCreation('client', fr);
 *   // rendu : {champs.bloc}
 *   // avant de créer : const err = champs.valider(); if (err) { toast.error(err); return; }
 *   // après : await champs.enregistrer(nouvelId);
 *
 * La validation passe par le même module que le serveur (preparerValeur) :
 * un champ obligatoire vide ou une valeur invalide bloque la création AVANT
 * qu'une fiche à moitié remplie n'existe. Coupé par le drapeau, `bloc` est
 * null et les deux fonctions ne font rien.
 */
import { useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useModuleAccess } from '../../hooks/useModuleAccess';
import { ecrireValeurs, listerChamps } from '../../lib/champsPersoApi';
import { preparerValeur, ErreurValeur } from '../../lib/champs/valeurs';
import type { ObjetChamp, ValeurChamp } from '../../lib/champs/types';
import ChampSaisie from './ChampSaisie';
import { messageChamps } from '../../lib/champs/messages';

export function useChampsCreation(objet: ObjetChamp, fr: boolean) {
  const { isEnabled } = useModuleAccess('custom_fields_v2');
  const idBase = useId();
  const { data } = useQuery({
    queryKey: ['champs-perso', objet],
    queryFn: () => listerChamps(objet),
    enabled: isEnabled,
    staleTime: 60_000,
  });
  const champs = useMemo(() => (data?.fields ?? []).filter((c) => !c.archived_at), [data]);
  const [valeurs, setValeurs] = useState<Record<string, ValeurChamp>>({});
  // Le clic sur « Créer » suit le blur du dernier champ texte dans le MÊME
  // événement : l'état React n'est pas encore rendu, la closure verrait
  // l'ancienne valeur. La ref, elle, est à jour.
  const courant = useRef<Record<string, ValeurChamp>>({});
  const poser = (id: string, v: ValeurChamp) => {
    courant.current = { ...courant.current, [id]: v };
    setValeurs(courant.current);
  };

  const vide = (v: ValeurChamp | undefined) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

  /** Première erreur (obligatoire manquant, format), ou null si tout est bon. */
  const valider = (): string | null => {
    for (const c of champs) {
      const v = courant.current[c.id];
      if (vide(v)) {
        if (c.is_required) return fr ? `« ${c.label} » est obligatoire.` : `“${c.label}” is required.`;
        continue;
      }
      try {
        preparerValeur(c, v);
      } catch (err) {
        if (err instanceof ErreurValeur) return messageChamps(err.message, fr);
        throw err;
      }
    }
    return null;
  };

  /** Écrit les valeurs sur la fiche créée. Un refus est signalé, jamais bloquant : la fiche existe déjà. */
  const enregistrer = async (entityId: string | null | undefined) => {
    if (!entityId) return;
    const ecritures = champs.filter((c) => !vide(courant.current[c.id])).map((c) => ({ field_id: c.id, value: courant.current[c.id] }));
    if (ecritures.length === 0) return;
    try {
      const resultats = await ecrireValeurs(objet, entityId, ecritures);
      const refus = resultats.filter((r) => !r.ok);
      if (refus.length) toast.error(refus.map((r) => r.erreur).filter(Boolean).join(' · '));
    } catch (err) {
      console.error('[useChampsCreation] enregistrement des champs', err);
      toast.error(fr ? 'La fiche est créée, mais ses champs personnalisés n’ont pas pu être enregistrés.' : 'Record created, but its custom fields could not be saved.');
    }
  };

  const bloc = !isEnabled || champs.length === 0 ? null : (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
        {fr ? 'Champs personnalisés' : 'Custom fields'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {champs.map((c) => {
          const id = `${idBase}-${c.id}`;
          return (
            <div key={c.id} className={c.field_type === 'multi_line' || c.field_type === 'dropdown_multi' ? 'sm:col-span-2' : undefined}>
              <label htmlFor={id} className="mb-1 block text-[12px] font-medium text-text-secondary">
                {c.label}{c.is_required && <span className="text-red-500" aria-hidden> *</span>}
              </label>
              <ChampSaisie id={id} champ={c} valeur={valeurs[c.id] ?? null} fr={fr}
                onValider={(v) => poser(c.id, v)} />
              {c.help_text && <p className="mt-1 text-[11px] text-text-tertiary">{c.help_text}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );

  return { bloc, valider, enregistrer, actif: bloc !== null };
}
