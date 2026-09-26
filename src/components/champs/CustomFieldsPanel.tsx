/**
 * Les champs personnalisés d'UNE fiche — le même rendu partout :
 * client, opportunité (pipeline), job, devis, facture.
 *
 * · regroupés par dossier (repliables), « Sans dossier » en dernier ;
 * · édition en place : le texte s'enregistre au blur, une liste ou une
 *   date au changement ;
 * · chaque enregistrement porte la version lue : si quelqu'un a modifié
 *   le champ entre-temps, on le dit et on recharge au lieu d'écraser ;
 * · une erreur de validation s'affiche SOUS le champ, en clair.
 *
 * Derrière le drapeau `custom_fields_v2` : coupé, le panneau ne rend rien.
 */
import { useId, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useChampsPersoActifs } from '../../hooks/useChampsPersoActifs';
import { ecrireValeurs, lireValeurs, type ObjetChamp, type ValeurChamp } from '../../lib/champsPersoApi';
import ChampSaisie from './ChampSaisie';
import { messageChamps } from '../../lib/champs/messages';
import LienAjouterChamps from './LienAjouterChamps';
import GererChampsFenetre from './GererChampsFenetre';
import { usePermissions } from '../../hooks/usePermissions';
import { listerChamps } from '../../lib/champsPersoApi';
import { LIBELLES_OBJET } from '../../lib/champs/types';
import { Settings2 } from 'lucide-react';

interface Props {
  objet: ObjetChamp;
  entityId: string | null | undefined;
  fr: boolean;
  /** Titre de la section ; défaut « Champs personnalisés ». */
  titre?: string;
  className?: string;
  /** Lecture seule (permission manquante sur l'objet). */
  lectureSeule?: boolean;
}

export default function CustomFieldsPanel({ objet, entityId, fr, titre, className, lectureSeule }: Props) {
  const { isEnabled } = useChampsPersoActifs();
  const qc = useQueryClient();
  const idBase = useId();
  const cleRequete = ['champs-perso-valeurs', objet, entityId];
  const { data, isLoading, error } = useQuery({
    queryKey: cleRequete,
    queryFn: () => lireValeurs(objet, entityId as string),
    enabled: isEnabled && !!entityId,
    staleTime: 30_000,
  });
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [enCours, setEnCours] = useState<Record<string, boolean>>({});
  const [replies, setReplies] = useState<Record<string, boolean>>({});
  const { role } = usePermissions();
  const peutGerer = (role === 'owner' || role === 'admin') && !lectureSeule;
  const [gerer, setGerer] = useState(false);
  const { data: tousChamps } = useQuery({
    queryKey: ['champs-perso', objet],
    queryFn: () => listerChamps(objet),
    enabled: isEnabled && peutGerer,
    staleTime: 60_000,
  });
  const actifsObjet = useMemo(() => (tousChamps?.fields ?? []).filter((c) => !c.archived_at), [tousChamps]);
  const boutonGerer = peutGerer ? (
    <button type="button" onClick={() => setGerer(true)}
      className="inline-flex items-center gap-1 rounded text-[12px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <Settings2 size={12} aria-hidden />{fr ? 'Gérer les champs' : 'Manage fields'}
    </button>
  ) : null;
  const panneau = gerer ? (
    <GererChampsFenetre portee="fiche" objet={objet} titreFenetre={fr ? LIBELLES_OBJET[objet].fr : LIBELLES_OBJET[objet].en}
      champs={actifsObjet} dossiers={tousChamps?.folders ?? []} fr={fr} onClose={() => setGerer(false)} />
  ) : null;

  const groupes = useMemo(() => {
    if (!data) return [];
    const parDossier = new Map<string | null, typeof data.fields>();
    // Retirés de la fiche par « Gérer les champs » : masqués (la valeur reste en base).
    for (const c of data.fields.filter((x) => !x.config?.masque_fiche)) {
      const cle = c.folder_id && data.folders.some((d) => d.id === c.folder_id) ? c.folder_id : null;
      parDossier.set(cle, [...(parDossier.get(cle) ?? []), c]);
    }
    const ordonnes = data.folders
      .filter((d) => parDossier.has(d.id))
      .map((d) => ({ id: d.id, nom: d.name, champs: parDossier.get(d.id)! }));
    if (parDossier.has(null)) ordonnes.push({ id: '__sans', nom: fr ? 'Sans dossier' : 'No folder', champs: parDossier.get(null)! });
    return ordonnes;
  }, [data, fr]);

  if (!isEnabled || !entityId) return null;
  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2 py-3 text-[12px] text-text-tertiary', className)}>
        <Loader2 size={14} className="animate-spin" aria-hidden /> {fr ? 'Chargement des champs…' : 'Loading fields…'}
      </div>
    );
  }
  if (error) {
    return (
      <p className={cn('py-3 text-[12px] text-red-600', className)}>
        {fr ? 'Les champs personnalisés n’ont pas pu être chargés.' : 'Custom fields could not be loaded.'}
      </p>
    );
  }
  if (!data) return null;
  if (groupes.length === 0) {
    return (
      <div className={cn('flex flex-wrap items-center justify-between gap-2 py-2', className)}>
        {data.fields.length === 0 ? <LienAjouterChamps fr={fr} /> : (
          <p className="text-[12px] text-text-tertiary">{fr ? 'Aucun champ personnalisé sur cette fiche.' : 'No custom fields on this record.'}</p>
        )}
        {boutonGerer}
        {panneau}
      </div>
    );
  }

  const enregistrer = async (fieldId: string, valeur: ValeurChamp) => {
    const version = data.values[fieldId]?.version ?? null;
    setEnCours((e) => ({ ...e, [fieldId]: true }));
    setErreurs((e) => { const { [fieldId]: _x, ...reste } = e; return reste; });
    try {
      const [r] = await ecrireValeurs(objet, entityId, [{ field_id: fieldId, value: valeur, version }]);
      if (!r?.ok) {
        setErreurs((e) => ({ ...e, [fieldId]: r?.erreur ?? (fr ? 'Refusé.' : 'Rejected.') }));
        if (r?.conflict) await qc.invalidateQueries({ queryKey: cleRequete });
        return;
      }
      await qc.invalidateQueries({ queryKey: cleRequete });
    } catch (err) {
      console.error('[CustomFieldsPanel] écriture', err);
      setErreurs((e) => ({ ...e, [fieldId]: messageChamps(err instanceof Error ? err.message : String(err), fr) }));
    } finally {
      setEnCours((e) => ({ ...e, [fieldId]: false }));
    }
  };

  return (
    <section className={cn('space-y-3', className)} aria-label={titre ?? (fr ? 'Champs personnalisés' : 'Custom fields')}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
          {titre ?? (fr ? 'Champs personnalisés' : 'Custom fields')}
        </h4>
        {boutonGerer}
      </div>
      {panneau}
      {groupes.map((g) => {
        const replie = !!replies[g.id];
        const idGroupe = `${idBase}-g-${g.id}`;
        return (
          // Un seul groupe : pas de cadre dans le cadre (le parent en a déjà un).
          <div key={g.id} className={cn(groupes.length > 1 && 'rounded-xl border border-outline-subtle bg-surface-card')}>
            {groupes.length > 1 && (
              <button
                type="button"
                aria-expanded={!replie}
                aria-controls={idGroupe}
                onClick={() => setReplies((r) => ({ ...r, [g.id]: !replie }))}
                className="flex w-full items-center justify-between px-3.5 py-2 text-[12px] font-semibold text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xl"
              >
                {g.nom}
                <ChevronDown size={14} aria-hidden className={cn('transition-transform', replie && '-rotate-90')} />
              </button>
            )}
            {!replie && (
              <div id={idGroupe} className={cn('space-y-3', groupes.length > 1 && 'px-3.5 pb-3 pt-1')}>
                {g.champs.map((c) => {
                  const idChamp = `${idBase}-${c.id}`;
                  const idAide = `${idChamp}-aide`;
                  const err = erreurs[c.id];
                  return (
                    <div key={c.id}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <label htmlFor={idChamp} className="text-[12px] font-medium text-text-secondary">
                          {c.label}{c.is_required && <span className="text-red-500" aria-hidden> *</span>}
                          {c.archived_at && <span className="ml-1 text-[10px] text-text-tertiary">{fr ? '(archivé)' : '(archived)'}</span>}
                        </label>
                        {enCours[c.id] && <Loader2 size={12} className="animate-spin text-text-tertiary" aria-label={fr ? 'Enregistrement…' : 'Saving…'} />}
                      </div>
                      <ChampSaisie
                        id={idChamp}
                        champ={c}
                        valeur={data.values[c.id]?.value ?? null}
                        fr={fr}
                        disabled={lectureSeule || !!c.archived_at || enCours[c.id]}
                        invalide={!!err}
                        describedBy={err || c.help_text ? idAide : undefined}
                        onValider={(v) => { void enregistrer(c.id, v); }}
                      />
                      {err ? (
                        <p id={idAide} role="alert" className="mt-1 flex items-center gap-1 text-[11px] text-red-600">
                          <AlertCircle size={11} aria-hidden /> {err}
                        </p>
                      ) : c.help_text ? (
                        <p id={idAide} className="mt-1 text-[11px] text-text-tertiary">{c.help_text}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
