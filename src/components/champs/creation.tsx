/**
 * Les champs personnalisés DANS un formulaire de création (client, job,
 * devis, opportunité) — comme GoHighLevel, on les remplit avant que la fiche
 * existe.
 *
 *   const champs = useChampsCreation('client', fr, { sections: ['coordonnees', 'adresse'] });
 *   // à la fin de chaque section branchée : {champs.section('coordonnees')}
 *   // en fin de formulaire : {champs.bloc}
 *   // avant de créer : const err = champs.valider(); if (err) { toast.error(err); return; }
 *   // après : await champs.enregistrer(nouvelId);
 *
 * La validation passe par le même module que le serveur (preparerValeur) :
 * un champ obligatoire vide ou une valeur invalide bloque la création AVANT
 * qu'une fiche à moitié remplie n'existe. Coupé par le drapeau, `bloc` est
 * null et les deux fonctions ne font rien.
 *
 * Placement (mission GHL, phase 4) : un champ rangé dans un dossier SYSTÈME
 * (section du formulaire) s'affiche à la fin de cette section, si le
 * formulaire l'a branchée (`sections`) ; sinon dans `bloc`, sous le nom de la
 * section. Un dossier créé par l'entreprise devient une section à la fin du
 * formulaire, titrée par son nom ; les champs sans dossier suivent.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useChampsPersoActifs } from '../../hooks/useChampsPersoActifs';
import { ecrireValeurs, listerChamps, supprimerFichierChamp } from '../../lib/champsPersoApi';
import { preparerValeur, ErreurValeur } from '../../lib/champs/valeurs';
import type { ObjetChamp, ValeurChamp } from '../../lib/champs/types';
import ChampSaisie from './ChampSaisie';
import { messageChamps } from '../../lib/champs/messages';
import LienAjouterChamps from './LienAjouterChamps';
import GererChampsFenetre from './GererChampsFenetre';
import { usePermissions } from '../../hooks/usePermissions';
import { Settings2 } from 'lucide-react';
import { nomDossier } from '../../lib/champs/standard';
import type { ChampPerso } from '../../lib/champs/types';

/** Titre de la fenêtre de création, par objet (panneau « Gérer les champs »). */
const TITRE_FENETRE: Record<ObjetChamp, { fr: string; en: string }> = {
  client: { fr: 'Nouveau client', en: 'New client' },
  deal: { fr: 'Nouvelle carte du pipeline', en: 'New pipeline card' },
  job: { fr: 'Nouveau job', en: 'New job' },
  quote: { fr: 'Nouvelle soumission', en: 'New quote' },
  invoice: { fr: 'Nouvelle facture', en: 'New invoice' },
  property: { fr: 'Nouvelle propriété', en: 'New property' },
};

export function useChampsCreation(objet: ObjetChamp, fr: boolean, opts: { sections?: string[] } = {}) {
  const { isEnabled } = useChampsPersoActifs();
  const idBase = useId();
  const { data } = useQuery({
    queryKey: ['champs-perso', objet],
    queryFn: () => listerChamps(objet),
    enabled: isEnabled,
    staleTime: 60_000,
  });
  // Tous les champs actifs de l'objet (pour « Gérer les champs »), et ceux affichés dans la fenêtre.
  const tousActifs = useMemo(() => (data?.fields ?? []).filter((c) => !c.archived_at), [data]);
  const champs = useMemo(() => tousActifs.filter((c) => !c.config?.masque_creation), [tousActifs]);
  const { role } = usePermissions();
  const peutGerer = role === 'owner' || role === 'admin';
  const [gerer, setGerer] = useState(false);
  const [valeurs, setValeurs] = useState<Record<string, ValeurChamp>>({});
  // Le clic sur « Créer » suit le blur du dernier champ texte dans le MÊME
  // événement : l'état React n'est pas encore rendu, la closure verrait
  // l'ancienne valeur. La ref, elle, est à jour.
  const courant = useRef<Record<string, ValeurChamp>>({});
  const poser = (id: string, v: ValeurChamp) => {
    // Fichier remplacé avant même la création de la fiche : le précédent n'est
    // référencé nulle part, il part tout de suite.
    const ancien = courant.current[id];
    if (typeof ancien === 'string' && ancien !== v
        && champs.find((c) => c.id === id)?.field_type === 'file') {
      void supprimerFichierChamp(ancien);
    }
    courant.current = { ...courant.current, [id]: v };
    setValeurs(courant.current);
  };

  // Valeur par défaut (« Set default value ») : posée une fois par champ, dès
  // qu'il est connu, sans écraser ce que l'utilisateur a déjà saisi. Liste :
  // le défaut est un libellé, la saisie attend l'id de l'option.
  const preremplis = useRef(new Set<string>());
  useEffect(() => {
    let change = false;
    for (const c of champs) {
      if (preremplis.current.has(c.id)) continue;
      preremplis.current.add(c.id);
      const d = c.default_value;
      if (d === null || d === undefined || c.id in courant.current) continue;
      const actives = c.options.filter((o) => !o.archived_at);
      const idDe = (l: string) => actives.find((o) => o.label === l)?.id;
      const v: ValeurChamp = c.field_type === 'dropdown_multi'
        ? (Array.isArray(d) ? d : [String(d)]).map(idDe).filter((x): x is string => !!x)
        : c.field_type === 'dropdown_single' ? (idDe(Array.isArray(d) ? d[0] ?? '' : String(d)) ?? null)
          : Array.isArray(d) ? null : d;
      if (vide(v)) continue;
      courant.current = { ...courant.current, [c.id]: v };
      change = true;
    }
    if (change) setValeurs(courant.current);
  }, [champs]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const boutonGerer = peutGerer ? (
    <button type="button" onClick={() => setGerer(true)}
      className="inline-flex items-center gap-1 rounded text-[12px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <Settings2 size={12} aria-hidden />{fr ? 'Gérer les champs' : 'Manage fields'}
    </button>
  ) : null;
  const panneau = gerer ? (
    <GererChampsFenetre objet={objet} titreFenetre={fr ? TITRE_FENETRE[objet].fr : TITRE_FENETRE[objet].en}
      champs={tousActifs} dossiers={data?.folders ?? []} fr={fr} onClose={() => setGerer(false)} />
  ) : null;

  const dossiers = data?.folders ?? [];
  const cleSysteme = (c: ChampPerso) => dossiers.find((d) => d.id === c.folder_id)?.cle_systeme ?? null;
  const branchees = new Set(opts.sections ?? []);
  const saisie = (c: ChampPerso) => {
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
  };

  /** Les champs d'un dossier système, à poser à la fin de la section du formulaire. */
  const section = (cle: string) => {
    if (!isEnabled) return null;
    const liste = champs.filter((c) => cleSysteme(c) === cle);
    if (liste.length === 0) return null;
    return <div className="mt-3 grid gap-3 sm:grid-cols-2" data-champs-section={cle}>{liste.map(saisie)}</div>;
  };

  // Hors des sections branchées : dossiers dans leur ordre (système non branchés,
  // puis ceux de l'entreprise), chacun titré ; les champs sans dossier à la fin.
  const groupes = [
    ...dossiers.filter((d) => !(d.cle_systeme && branchees.has(d.cle_systeme)))
      .map((d) => ({ id: d.id, titre: nomDossier(d, fr), champs: champs.filter((c) => c.folder_id === d.id) })),
    { id: '__sans', titre: fr ? 'Champs personnalisés' : 'Custom fields',
      champs: champs.filter((c) => !c.folder_id || !dossiers.some((d) => d.id === c.folder_id)) },
  ].filter((g) => g.champs.length > 0);
  const nbHorsSections = groupes.reduce((n, g) => n + g.champs.length, 0);

  // Aucun champ affiché (liste chargée) : on le dit, avec de quoi en ajouter, plutôt qu'un silence.
  const bloc = !isEnabled ? null : nbHorsSections === 0 ? (data ? (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {tousActifs.length === 0 ? <LienAjouterChamps fr={fr} /> : champs.length === 0 ? (
        <p className="text-[12px] text-text-tertiary">{fr ? 'Aucun champ personnalisé dans cette fenêtre.' : 'No custom fields in this window.'}</p>
      ) : <span />}
      {boutonGerer}
      {panneau}
    </div>
  ) : null) : (
    <div className="space-y-4">
      {panneau}
      {groupes.map((g, i) => (
        <div key={g.id} className="space-y-3" data-champs-dossier={g.id}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{g.titre}</p>
            {i === 0 && boutonGerer}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">{g.champs.map(saisie)}</div>
        </div>
      ))}
    </div>
  );

  return { bloc, section, valider, enregistrer, actif: champs.length > 0 };
}
