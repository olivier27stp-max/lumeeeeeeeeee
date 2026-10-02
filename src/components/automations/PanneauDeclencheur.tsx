/* ═══════════════════════════════════════════════════════════════
   Le panneau de réglage du DÉCLENCHEUR.

   Certains déclencheurs ne se suffisent pas à eux-mêmes. « Facture
   payée » se comprend seul ; « Date atteinte » ne veut rien dire tant
   qu'on n'a pas dit QUELLE date surveiller et combien de jours avant.

   Sans cet écran, ces réglages n'étaient saisissables NULLE PART : la
   règle se publiait, s'affichait comme active, et le balayage quotidien
   passait son chemin faute de `champ_id`. Une automatisation qui ne part
   jamais, sans un mot — l'échec le plus coûteux parce qu'il ne se voit pas.

   ── Même mécanique que le panneau d'étape ──────────────────────
   Brouillon local, « Annuler » qui annule vraiment, et les champs rendus
   par `ChampAction` — donc un type de champ ajouté au catalogue apparaît
   ici du même coup, sans code en double.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useId, useRef, useState } from 'react';
import { X, Zap } from 'lucide-react';
import type { DeclencheurCatalogue } from '../../lib/automationCatalogue';
import { champVisible, CASE_SORTIE, fautesDuDeclencheur } from '../../lib/automationCatalogue';
import { useModuleAccess } from '../../hooks/useModuleAccess';
import { apercuClientsInactifs } from '../../lib/reservationApi';
import ChampActionUI from './ChampAction';
import {
  ConditionsChampsEtape, SaisieValeurChamp, SelecteurChamp, champComparable, champSurveille, objetDeLaRegle,
  saisieDepuisValeurCondition, sansConditionsIncompletes, valeurConditionDepuisSaisie,
} from '../champs/automatisations';
import { LIBELLES_OBJET, type ChampPerso } from '../../lib/champs/types';

interface Props {
  declencheur: DeclencheurCatalogue;
  /** Les `conditions` de la règle — là où vivent ces réglages. */
  conditions: Record<string, unknown> | null;
  /** Les `settings` de la règle — là où vit la case « Arrêter si… ». */
  reglages?: Record<string, unknown> | null;
  fr: boolean;
  /** Champs date de la fiche client, pour le type `champ_date`. */
  champsDate: Array<{ id: string; label: string }>;
  /** Étapes des pipelines, pour le type `etape_pipeline`. */
  etapesPipeline?: Array<{ id: string; label: string }>;
  /** Étiquettes existantes (suggestions), pour le type `etiquette`. */
  etiquettes?: string[];
  /** Services du catalogue, pour le type `service`. */
  services?: Array<{ id: string; label: string }>;
  /**
   * Tous les champs personnalisés actifs : « quel champ ? » de « Champ
   * modifié », et les FILTRES de la règle (`conditions.champs_perso`).
   */
  champsPerso?: ChampPerso[];
  /** Ouvrir le tiroir pour changer de déclencheur (le clic sur la carte ouvre ce panneau). */
  onChanger?: () => void;
  /** `arreterSiResolu` n'est fourni que si la case est affichée. */
  onEnregistrer: (conditions: Record<string, unknown>, arreterSiResolu?: boolean) => void;
  onFermer: () => void;
  /**
   * Quelque chose a-t-il été touché depuis l'ouverture ? Le parent s'en sert
   * pour demander confirmation avant de remplacer ce panneau par un autre
   * (un seul panneau à droite à la fois).
   */
  onModifie?: (modifie: boolean) => void;
}

export default function PanneauDeclencheur({
  declencheur, conditions, reglages, fr, champsDate, etapesPipeline = [], etiquettes = [], services = [],
  champsPerso = [], onChanger, onEnregistrer, onFermer, onModifie,
}: Props) {
  const idCase = useId();
  const idChamp = useId();
  const estChampModifie = declencheur.cle === 'custom_field.changed';
  /*
   * « Champ modifié » : QUEL champ, et « quand il devient … ». Le champ
   * part en `{ field_id: { eq } }`, la valeur en `{ new_value: { eq } }` —
   * deux clés que `evaluateConditions` compare déjà aux métadonnées de
   * l'événement, sans code de plus côté moteur.
   */
  const [champId, setChampId] = useState(() => champSurveille(conditions));
  const [devient, setDevientBrut] = useState('');
  /*
   * La valeur relue dépend du TYPE du champ (un montant stocké en cents
   * s'affiche en dollars) — or les champs arrivent après le premier rendu.
   * On la relit donc quand ils arrivent, tant que personne n'y a touché.
   */
  const devientTouche = useRef(false);
  const setDevient = (v: string) => { devientTouche.current = true; setDevientBrut(v); };
  useEffect(() => {
    if (devientTouche.current) return;
    const v = conditions?.new_value;
    const brut = v && typeof v === 'object' && !Array.isArray(v) ? (v as { eq?: unknown }).eq : v;
    setDevientBrut(saisieDepuisValeurCondition(champsPerso.find((c) => c.id === champSurveille(conditions)), brut));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- même raison que l'effet suivant : suivre la règle, pas l'objet.
  }, [declencheur.cle, champsPerso]);
  /** Les filtres de la règle : conditions sur les champs, jugées sur les valeurs ACTUELLES. */
  const [filtres, setFiltres] = useState<Record<string, unknown>>({});
  // La case « Arrêter si… » : seulement pour les 4 déclencheurs concernés,
  // et seulement si l'entreprise a le drapeau. Absente de la règle = ce que
  // faisait le moteur avant (CASE_SORTIE.defaut).
  const { isEnabled: sortieActive } = useModuleAccess('auto_sortie_parcours');
  const caseSortie = sortieActive ? CASE_SORTIE[declencheur.cle] : undefined;
  const [arreterSiResolu, setArreterSiResolu] = useState<boolean>(() => {
    const v = reglages?.arreter_si_resolu;
    return typeof v === 'boolean' ? v : (CASE_SORTIE[declencheur.cle]?.defaut ?? true);
  });
  /*
   * Le brouillon : toutes les valeurs en TEXTE, comme les champs d'action.
   * La conversion vers le type final se fait à l'enregistrement, au même
   * endroit que la validation — jamais à chaque frappe.
   */
  const [brouillon, setBrouillon] = useState<Record<string, string>>({});
  /*
   * « Touché » plutôt que « différent » : les valeurs relues changent de forme
   * en route (un montant en cents affiché en dollars, les champs qui arrivent
   * après le premier rendu) — comparer donnerait de faux « modifié ». Une
   * saisie de l'utilisateur, elle, ne trompe pas.
   */
  const [touche, setTouche] = useState(false);
  useEffect(() => { onModifie?.(touche); }, [touche, onModifie]);
  useEffect(() => () => onModifie?.(false), [onModifie]);

  // Clé sur `cle` du déclencheur, PAS sur l'objet : dépendre de l'objet
  // relancerait l'effet à chaque rendu du parent et effacerait la saisie
  // en cours.
  useEffect(() => {
    const init: Record<string, string> = {};
    for (const champ of declencheur.champs ?? []) {
      const v = conditions?.[champ.cle];
      init[champ.cle] = v === undefined || v === null ? '' : String(v);
    }
    setBrouillon(init);
    setChampId(champSurveille(conditions));
    setFiltres(Array.isArray(conditions?.champs_perso) ? { champs_perso: conditions?.champs_perso } : {});
    setTouche(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declencheur.cle]);

  const champs = declencheur.champs ?? [];

  /*
   * « Client inactif » : combien de clients correspondent AUJOURD'HUI au
   * seuil choisi. C'est ce que l'entreprise doit voir avant d'activer — une
   * règle qui viserait 400 anciens clients d'un coup ne doit pas surprendre.
   */
  const estClientInactif = declencheur.cle === 'client.inactive';
  const moisChoisi = Number(brouillon.mois || 6);
  const [nbInactifs, setNbInactifs] = useState<number | null>(null);
  useEffect(() => {
    if (!estClientInactif || !Number.isFinite(moisChoisi) || moisChoisi < 1) { setNbInactifs(null); return; }
    let vivant = true;
    const minuterie = setTimeout(() => {
      apercuClientsInactifs(moisChoisi)
        .then((n) => { if (vivant) setNbInactifs(n); })
        .catch((e) => { console.error('[PanneauDeclencheur] aperçu clients inactifs', e); if (vivant) setNbInactifs(null); });
    }, 300);
    return () => { vivant = false; clearTimeout(minuterie); };
  }, [estClientInactif, moisChoisi]);

  /** Ce qui manque encore — le bouton reste actif, le message est clair. */
  const manquants = champs.filter(
    (c) => c.obligatoire && champVisible(c, brouillon) && !String(brouillon[c.cle] ?? '').trim(),
  );

  /*
   * Ce que le serveur refuserait — ou, pire, enregistrerait tel quel pour une
   * automatisation qui ne partirait jamais : un nombre hors bornes, « 2,5
   * mois », un minimum plus grand que le maximum. Refusé ICI, avec la borne
   * dite, avant tout envoi (triage déclencheurs, 03:316 et 03:581). La règle
   * est celle du serveur (`fautesDuDeclencheur`, catalogue partagé).
   *
   * Comme pour un champ obligatoire resté vide, le bouton RESTE cliquable :
   * le refus est écrit dans le panneau dès la saisie, et un clic y ramène
   * (un bouton grisé sans raison visible ne dit pas quoi corriger).
   */
  const fautes = fautesDuDeclencheur(declencheur.cle, brouillon).map((f) => (fr ? f.fr : f.en));
  const refRefus = useRef<HTMLDivElement>(null);

  const enregistrer = () => {
    if (fautes.length > 0) {
      refRefus.current?.scrollIntoView?.({ block: 'nearest' });
      refRefus.current?.focus();
      return;
    }
    /*
     * On repart des conditions EXISTANTES : une règle peut porter des
     * conditions qui ne viennent pas de ce panneau (filtres d'un « si »,
     * réglages d'une version antérieure). Les écraser ferait disparaître
     * des réglages que personne n'a demandé à supprimer.
     */
    const sortie: Record<string, unknown> = { ...(conditions ?? {}) };
    for (const champ of champs) {
      const brut = String(brouillon[champ.cle] ?? '').trim();
      if (!brut || !champVisible(champ, brouillon)) {
        delete sortie[champ.cle];
        continue;
      }
      // `nombre` part en NOMBRE : le balayage fait `Number(...)`, et une
      // chaîne vide y devient 0 sans qu'on s'en aperçoive.
      sortie[champ.cle] = champ.type === 'nombre' ? Number(brut) : brut;
    }
    if (estChampModifie) {
      delete sortie.field_id;
      delete sortie.new_value;
      if (champId) {
        sortie.field_id = { eq: champId };
        const champ = champsPerso.find((c) => c.id === champId);
        const v = champ && champComparable(champ) ? valeurConditionDepuisSaisie(champ, devient) : null;
        if (v !== null) sortie.new_value = { eq: v };
      }
    }
    // Les filtres : une ligne incomplète est retirée, jamais enregistrée —
    // elle bloquerait la règle pour toujours, sans un mot.
    // Un filtre sur un champ d'un AUTRE objet que celui de l'événement (le
    // champ surveillé a changé d'objet) ne serait jamais vrai : retiré aussi.
    delete sortie.champs_perso;
    const objet = objetDeLaRegle(declencheur.cle, sortie, champsPerso);
    const gardes = (Array.isArray(filtres.champs_perso) ? filtres.champs_perso as Array<{ field_id: string }> : [])
      .filter((c) => objet && champsPerso.find((x) => x.id === c.field_id)?.object_type === objet);
    onEnregistrer(
      sansConditionsIncompletes(gardes.length ? { ...sortie, champs_perso: gardes } : sortie),
      caseSortie ? arreterSiResolu : undefined,
    );
  };

  return (
    <aside
      aria-label={fr ? 'Réglages du déclencheur' : 'Trigger settings'}
      className="flex w-[380px] shrink-0 flex-col border-l border-border bg-surface-card"
    >
      <div className="flex items-start gap-2.5 border-b border-border px-4 py-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Zap className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text-primary">
            {fr ? declencheur.fr : declencheur.en}
          </span>
          <span className="block text-[11px] text-text-secondary">
            {fr ? declencheur.aide_fr : declencheur.aide_en}
          </span>
        </span>
        <button
          type="button"
          onClick={onFermer}
          aria-label={fr ? 'Fermer' : 'Close'}
          className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {onChanger && (
          <button
            type="button"
            onClick={onChanger}
            className="w-full rounded-lg border border-border px-3 py-2 text-left text-[12px] text-text-secondary transition-colors hover:border-accent hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {fr ? 'Changer de déclencheur…' : 'Change trigger…'}
          </button>
        )}

        {estChampModifie && (
          <>
            <div>
              <label htmlFor={`${idChamp}-champ`} className="mb-1 block text-xs font-medium text-text-primary">
                {fr ? 'Quel champ' : 'Which field'}
                <span className="font-normal text-text-tertiary"> {fr ? '(facultatif)' : '(optional)'}</span>
              </label>
              <SelecteurChamp
                id={`${idChamp}-champ`}
                valeur={champId}
                champs={champsPerso}
                fr={fr}
                onChange={(v) => { setChampId(v); setDevient(''); setTouche(true); }}
                className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <p className="mt-1 text-[11px] text-text-tertiary">
                {fr ? 'Vide = n’importe quel champ, sur n’importe quelle fiche.' : 'Empty = any field, on any record.'}
              </p>
            </div>
            {(() => {
              const champ = champsPerso.find((c) => c.id === champId);
              if (!champ) {
                return champId && champsPerso.length > 0 ? (
                  <p className="text-[11px] text-danger">
                    {fr ? 'Ce champ n’existe plus : choisissez-en un autre.' : 'This field no longer exists: pick another one.'}
                  </p>
                ) : null;
              }
              if (!champComparable(champ)) return null;
              return (
                <div>
                  <label htmlFor={`${idChamp}-devient`} className="mb-1 block text-xs font-medium text-text-primary">
                    {champ.field_type === 'dropdown_multi'
                      ? (fr ? 'Quand il contient' : 'When it contains')
                      : (fr ? 'Quand il devient' : 'When it becomes')}
                    <span className="font-normal text-text-tertiary"> {fr ? '(facultatif)' : '(optional)'}</span>
                  </label>
                  <SaisieValeurChamp
                    id={`${idChamp}-devient`}
                    champ={champ}
                    valeur={devient}
                    onChange={(v) => { setDevient(v); setTouche(true); }}
                    fr={fr}
                    libelleVide={fr ? '— N’importe quelle valeur —' : '— Any value —'}
                  />
                  <p className="mt-1 text-[11px] text-text-tertiary">
                    {fr
                      ? `Fiche : ${LIBELLES_OBJET[champ.object_type].fr}. Vide = à chaque changement.`
                      : `Record: ${LIBELLES_OBJET[champ.object_type].en}. Empty = on every change.`}
                  </p>
                </div>
              );
            })()}
          </>
        )}

        {champs.map((champ) =>
          champVisible(champ, brouillon) ? (
            <ChampActionUI
              key={champ.cle}
              champ={champ}
              valeur={brouillon[champ.cle] ?? ''}
              onChange={(v) => { setBrouillon((p) => ({ ...p, [champ.cle]: v })); setTouche(true); }}
              fr={fr}
              champsDate={champsDate}
              etapesPipeline={etapesPipeline}
              etiquettes={etiquettes}
              services={services}
            />
          ) : null,
        )}

        {estClientInactif && nbInactifs !== null && (
          <p role="status" className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-[12px] text-text-primary">
            {fr
              ? `${nbInactifs} client${nbInactifs > 1 ? 's' : ''} correspond${nbInactifs > 1 ? 'ent' : ''} aujourd’hui.`
              : `${nbInactifs} client${nbInactifs > 1 ? 's' : ''} match${nbInactifs > 1 ? '' : 'es'} today.`}
          </p>
        )}

        {/*
          FILTRES — « seulement si Nombre de fenêtres > 20 ». Conditions sur
          les champs de la fiche de l'événement, jugées sur ses valeurs
          ACTUELLES (conditionsChampsOk). Tant que l'objet n'est pas connu
          (« Champ modifié » sans champ choisi), il n'y a rien à filtrer.
        */}
        {(() => {
          const objet = objetDeLaRegle(
            declencheur.cle,
            { ...(conditions ?? {}), ...brouillon, ...(estChampModifie ? { field_id: champId } : {}) },
            champsPerso,
          );
          if (!objet || !champsPerso.some((c) => c.object_type === objet)) return null;
          return (
            <section aria-label={fr ? 'Filtres' : 'Filters'} className="rounded-lg border border-border px-3 py-2.5">
              <h3 className="text-xs font-semibold text-text-primary">{fr ? 'Filtres' : 'Filters'}</h3>
              <p className="mt-0.5 text-[11px] text-text-tertiary">
                {fr
                  ? `Seulement si les champs de la fiche (${LIBELLES_OBJET[objet].fr}) remplissent ces conditions au moment de l’événement.`
                  : `Only if the record’s fields (${LIBELLES_OBJET[objet].en}) meet these conditions when the event happens.`}
              </p>
              <ConditionsChampsEtape conditions={filtres} onChange={(c) => { setFiltres(c); setTouche(true); }} champs={champsPerso} objet={objet} fr={fr} />
            </section>
          );
        })()}

        {caseSortie && (
          <div className="rounded-lg border border-border px-3 py-2.5">
            <label htmlFor={idCase} className="flex cursor-pointer items-start gap-2.5">
              <input
                id={idCase}
                type="checkbox"
                checked={arreterSiResolu}
                onChange={(e) => { setArreterSiResolu(e.target.checked); setTouche(true); }}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-text-primary">{fr ? caseSortie.fr : caseSortie.en}</span>
                <span className="block text-[11px] text-text-secondary">
                  {fr
                    ? 'Vérifié avant chaque étape qui suit un délai. Le motif de l’arrêt apparaît dans l’historique.'
                    : 'Checked before every step that follows a delay. The reason appears in the history.'}
                </span>
              </span>
            </label>
          </div>
        )}

        {fautes.length > 0 && (
          <div
            ref={refRefus}
            role="alert"
            tabIndex={-1}
            className="rounded-lg border border-danger/40 bg-danger-light px-3 py-2 text-[12px] text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            <p className="font-medium">{fr ? 'À corriger avant d’enregistrer :' : 'To fix before saving:'}</p>
            {fautes.map((f) => <p key={f}>{f}</p>)}
          </div>
        )}

        {manquants.length > 0 && (
          <p className="rounded-lg border border-warning/40 bg-warning-light px-3 py-2 text-[12px] text-warning">
            {fr
              ? `Sans « ${manquants.map((c) => c.fr).join(' », « ')} », l’automatisation ne partirait jamais.`
              : `Without “${manquants.map((c) => c.en).join('”, “')}”, the automation would never run.`}
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        {/* Le refus est AUSSI écrit ici, à côté du bouton : dans le corps du panneau il
            peut être sous le pli (fenêtre basse, beaucoup de réglages) — on ne le voyait
            alors qu'après un clic sur « Enregistrer », qui y ramène. */}
        {fautes.length > 0 && (
          <span data-testid="refus-pres-du-bouton" className="mr-auto max-w-[60%] text-[11px] leading-tight text-danger">
            {fautes[0]}
          </span>
        )}
        <button
          type="button"
          onClick={onFermer}
          className="rounded-lg px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {fr ? 'Annuler' : 'Cancel'}
        </button>
        <button type="button" onClick={enregistrer} title={fautes[0]} className="glass-button-primary text-[13px]">
          {fr ? 'Enregistrer' : 'Save'}
        </button>
      </div>
    </aside>
  );
}
