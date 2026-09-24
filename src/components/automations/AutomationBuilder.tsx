/* ═══════════════════════════════════════════════════════════════
   Construire son automatisation

   « Quand CECI arrive · attendre CE TEMPS · faire CECI. »

   Trois blocs, dans l'ordre où on y pense. Pas de canevas, pas de nœuds à
   relier : une automatisation Lume est aujourd'hui une suite d'actions
   déclenchées par un événement, et un canevas ne dessinerait qu'une ligne
   droite. Le jour où les séquences arrivent (attentes multiples, Si/Sinon),
   ce formulaire devient la vue simple et le canevas la vue avancée.

   CE QU'ON NE DEMANDE PAS, volontairement :
   · le destinataire — il vient toujours du client concerné, jamais d'un champ
     libre (`DESTINATAIRE_IMPOSE`, server/lib/actions/index.ts) ;
   · l'heure d'envoi — le moteur ne texte jamais entre 20 h et 8 h, sans qu'on
     ait à y penser ;
   · quoi faire si le client répond — le moteur arrête déjà la relance quand la
     facture est payée ou la soumission acceptée.

   C'est la différence avec GoHighLevel, où ces trois réglages sont cachés dans
   un onglet « Settings » que personne n'ouvre.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useId, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, Zap, Clock, Send, AlertTriangle, GitBranch, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import type { AutomationRule } from '../../lib/automationRulesApi';
import {
  creerAutomatisation,
  modifierAutomatisation,
  enSecondes,
  depuisSecondes,
  type ActionAutomatisation,
  type CatalogueAutomatisations,
  type UniteDelai,
} from '../../lib/automationBuilderApi';
import { VARIABLES_PROPOSEES, variablesInconnues } from '../../lib/emailBodyText';
import SequenceCanvas from './SequenceCanvas';
import ChampActionUI from './ChampAction';
import { champVisible } from '../../lib/automationCatalogue';
import {
  useChampsTous, objetDuDeclencheur, variablesDesChamps, SelecteurChamp, BoutonsVariablesChamps, ConditionsChampsEtape,
} from '../champs/automatisations';
import type { ChampPerso, ObjetChamp } from '../../lib/champs/types';
import {
  type Etape,
  type TypeEtape,
  nouvelIdEtape,
  etapeVierge,
  insererEtape,
  retirerEtape,
} from '../../lib/sequenceTypes';

interface Props {
  /** Règle à modifier ; absente pour une création. */
  regle?: AutomationRule | null;
  catalogue: CatalogueAutomatisations;
  fr: boolean;
  onFerme: () => void;
  /** Rechargement de la liste après enregistrement. */
  onEnregistre: () => void;
}

const UNITES: Array<{ cle: UniteDelai; fr: string; en: string }> = [
  { cle: 'minutes', fr: 'minutes', en: 'minutes' },
  { cle: 'heures', fr: 'heures', en: 'hours' },
  { cle: 'jours', fr: 'jours', en: 'days' },
];

const FAMILLES: Array<{ cle: string; fr: string; en: string }> = [
  { cle: 'devis', fr: 'Soumissions', en: 'Quotes' },
  { cle: 'facture', fr: 'Factures', en: 'Invoices' },
  { cle: 'rendezvous', fr: 'Rendez-vous', en: 'Appointments' },
  { cle: 'job', fr: 'Jobs', en: 'Jobs' },
  { cle: 'client', fr: 'Clients et prospects', en: 'Clients and leads' },
  { cle: 'vente', fr: 'Pipeline de ventes', en: 'Sales pipeline' },
];

export default function AutomationBuilder({ regle, catalogue, fr, onFerme, onEnregistre }: Props) {
  const ids = useId();
  const enModification = Boolean(regle);
  // Sur un préréglage, le déclencheur appartient au moteur : les conditions
  // d'arrêt s'appuient dessus. Tout le reste — nom, délai, textes — se
  // personnalise librement, et c'est bien le but.
  const declencheurFige = Boolean(regle?.is_preset);

  const [nom, setNom] = useState(regle?.name ?? '');
  const [description, setDescription] = useState(regle?.description ?? '');
  const [declencheur, setDeclencheur] = useState(regle?.trigger_event ?? '');
  // Champs personnalisés (v2) : le champ surveillé par « champ modifié » vit
  // dans les conditions de la règle ({field_id: {eq}}), comparé aux
  // métadonnées de l'événement par le moteur.
  const champsPerso = useChampsTous();
  const [conditionsRegle, setConditionsRegle] = useState<Record<string, unknown>>(regle?.conditions ?? {});

  const delaiInitial = depuisSecondes(regle?.delay_seconds ?? 0);
  const [delaiValeur, setDelaiValeur] = useState(String(delaiInitial.valeur));
  const [delaiUnite, setDelaiUnite] = useState<UniteDelai>(delaiInitial.unite);
  const [avant, setAvant] = useState(delaiInitial.avant);

  const [actions, setActions] = useState<ActionAutomatisation[]>(
    regle?.actions?.length
      ? regle.actions.map((a) => ({ type: a.type, config: { ...a.config } }))
      : [{ type: 'send_sms', config: { body: '' } }],
  );

  const [enregistre, setEnregistre] = useState(false);

  // ── Mode séquence ──
  // Une règle existante avec des étapes s'ouvre en séquence ; une règle
  // simple s'ouvre en simple. Le choix reste celui de l'utilisateur ensuite.
  const [mode, setMode] = useState<'simple' | 'sequence'>(
    Array.isArray(regle?.steps) && regle!.steps!.length > 0 ? 'sequence' : 'simple',
  );
  const [steps, setSteps] = useState<Etape[]>((regle?.steps as Etape[] | undefined) ?? []);
  const [etapeChoisie, setEtapeChoisie] = useState<string | null>(null);
  /** Où insérer la prochaine étape, tant que son type n'est pas choisi. */
  const [typeAAjouter, setTypeAAjouter] = useState<{ apresId: string | null; branche?: 'alors' | 'sinon' } | null>(null);

  const declencheurChoisi = useMemo(
    () => catalogue.declencheurs.find((d) => d.cle === declencheur),
    [catalogue.declencheurs, declencheur],
  );
  // L'objet dont on peut lire/écrire les champs : celui de l'événement.
  // « Champ modifié » part de n'importe quel objet : on ne restreint pas.
  const objetRegle: ObjetChamp | null = declencheur === 'custom_field.changed'
    ? null : objetDuDeclencheur(declencheurChoisi?.entite);

  // « Avant » n'a de sens que pour un événement qui porte une date future.
  // Si l'utilisateur change de déclencheur alors qu'il avait coché « avant »,
  // on repasse à « après » plutôt que de lui laisser un réglage que le serveur
  // refusera à l'enregistrement.
  useEffect(() => {
    if (avant && declencheurChoisi && !declencheurChoisi.accepte_delai_negatif) {
      setAvant(false);
    }
  }, [avant, declencheurChoisi]);

  const majAction = (index: number, patch: Partial<ActionAutomatisation>) => {
    setActions((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  const changerTypeAction = (index: number, type: string) => {
    // Les champs ne sont pas les mêmes d'une action à l'autre : garder l'objet
    // d'un courriel sur un texto ferait refuser l'enregistrement. On repart
    // d'une config vide en conservant le texte, qui est presque toujours
    // réutilisable.
    const texte = actions[index]?.config.body ?? '';
    majAction(index, { type, config: texte ? { body: texte } : {} });
  };

  /**
   * Ajoute une étape au parcours.
   *
   * On demande d'abord QUOI ajouter — un message, une attente, une
   * condition — parce qu'insérer une carte vide puis choisir son type fait
   * un aller-retour de plus pour rien.
   */
  const ajouterEtape = (apresId: string | null, branche?: 'alors' | 'sinon') => {
    setTypeAAjouter({ apresId, branche });
  };

  /** Type demandé, une fois choisi dans le petit menu. */
  const confirmerAjout = (type: TypeEtape) => {
    if (!typeAAjouter) return;
    const nouvelle = etapeVierge(type, nouvelIdEtape(steps));
    setSteps((prev) => insererEtape(prev, nouvelle, typeAAjouter.apresId, typeAAjouter.branche));
    setEtapeChoisie(nouvelle.id);
    setTypeAAjouter(null);
  };

  const secondes = (() => {
    const n = Number(delaiValeur);
    if (!Number.isFinite(n) || n < 0) return 0;
    return enSecondes(n, delaiUnite, avant);
  })();

  /** Ce qui empêche d'enregistrer, dit en clair, avant même d'appeler le serveur. */
  const problemes = useMemo(() => {
    const out: string[] = [];
    if (!nom.trim()) out.push(fr ? 'Donnez un nom à votre automatisation.' : 'Name your automation.');
    if (!declencheur) out.push(fr ? 'Choisissez ce qui la déclenche.' : 'Pick what triggers it.');
    if (mode === 'sequence') {
      if (!steps.length) out.push(fr ? 'Ajoutez au moins une étape.' : 'Add at least one step.');
      const vides = steps.filter(
        (e) => e.type === 'action' && !String(e.action?.config?.body ?? e.action?.config?.title ?? '').trim(),
      );
      if (vides.length) {
        out.push(fr ? `${vides.length} étape(s) sans texte.` : `${vides.length} step(s) with no text.`);
      }
      return out;
    }
    if (!actions.length) out.push(fr ? 'Ajoutez au moins une action.' : 'Add at least one action.');

    actions.forEach((action, i) => {
      const modele = catalogue.actions.find((a) => a.cle === action.type);
      if (!modele) return;
      for (const champ of modele.champs) {
        const valeur = (action.config as Record<string, string | undefined>)[champ.cle];
        if (champ.obligatoire && !valeur?.trim()) {
          out.push(
            fr
              ? `Action ${i + 1} — « ${champ.fr} » est vide.`
              : `Action ${i + 1} — “${champ.en}” is empty.`,
          );
        }
      }
    });
    return out;
  }, [nom, declencheur, actions, catalogue.actions, fr, mode, steps]);

  /**
   * Les variables écrites à la main qui n'existent pas.
   *
   * Le serveur remplace une variable inconnue par une chaîne vide : le client
   * reçoit « Bonjour , » et personne n'est prévenu. On le dit ici, avant
   * l'envoi — c'est un avertissement, pas un blocage, parce qu'un crochet peut
   * être du texte voulu.
   */
  const variablesDouteuses = useMemo(() => {
    const trouvees = new Set<string>();
    for (const action of actions) {
      for (const valeur of Object.values(action.config)) {
        if (typeof valeur === 'string') {
          for (const v of variablesInconnues(valeur, variablesDesChamps(champsPerso))) trouvees.add(v);
        }
      }
    }
    return [...trouvees];
  }, [actions, champsPerso]);

  const enregistrer = async () => {
    if (problemes.length) return;
    setEnregistre(true);
    try {
      const brouillon = {
        name: nom.trim(),
        description: description.trim() || null,
        trigger_event: declencheur,
        // Le champ surveillé : seulement pour « champ modifié » — les autres
        // règles gardent leurs conditions intactes (on ne les envoie pas).
        ...(declencheur === 'custom_field.changed' ? { conditions: conditionsRegle } : {}),
        // En mode séquence, le délai de tête n'a plus de sens : ce sont les
        // étapes « attendre » qui portent le temps. On l'envoie à 0 pour que
        // le moteur ne double pas l'attente.
        delay_seconds: mode === 'sequence' ? 0 : secondes,
        steps: mode === 'sequence' ? steps : null,
        // En SÉQUENCE, `actions` est DÉRIVÉ des étapes — ce ne sont pas deux
        // listes concurrentes. Deux raisons :
        //   · le serveur exige au moins une action valide, et celle du mode
        //     simple resterait vide (l'enregistrement échouait ici) ;
        //   · la liste des automatisations lit `actions` pour afficher les
        //     canaux (Texto, Courriel…) : sans ça, une séquence s'afficherait
        //     sans aucun canal.
        // Le moteur, lui, ne lit QUE `steps` dès qu'elles existent.
        actions: (mode === 'sequence'
          ? steps
              .filter((e): e is Extract<Etape, { type: 'action' }> => e.type === 'action')
              .map((e) => e.action)
          : actions
        ).map((a) => ({
          type: a.type,
          // Les champs vides sont retirés : le serveur refuse une clé qui
          // n'appartient pas à l'action, et un champ facultatif laissé vide
          // n'a rien à faire en base.
          config: Object.fromEntries(
            Object.entries(a.config).filter(([, v]) => typeof v === 'string' && v.trim()),
          ),
        })),
      };

      if (regle) {
        // Le déclencheur d'un préréglage ne se change pas : ne pas l'envoyer
        // du tout évite un refus du serveur sur une valeur pourtant identique.
        const patch = declencheurFige
          ? { ...brouillon, trigger_event: undefined }
          : brouillon;
        await modifierAutomatisation(regle.id, patch);
        toast.success(fr ? 'Automatisation modifiée' : 'Automation updated');
      } else {
        await creerAutomatisation(brouillon);
        toast.success(
          fr
            ? 'Automatisation créée — elle est en pause, activez-la quand vous êtes prêt'
            : 'Automation created — it is paused, turn it on when you are ready',
        );
      }
      onEnregistre();
      onFerme();
    } catch (e: unknown) {
      // Le serveur explique en clair ; on montre son texte plutôt qu'un code.
      const message = e instanceof Error ? e.message : String(e);
      toast.error(message);
      console.error('[AutomationBuilder] enregistrement échoué', message);
    } finally {
      setEnregistre(false);
    }
  };

  const groupes = FAMILLES.map((f) => ({
    ...f,
    items: catalogue.declencheurs.filter((d) => d.famille === f.cle),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      {/* ── Nom ── */}
      <div>
        <label htmlFor={`${ids}-nom`} className="block text-sm font-medium text-text-primary mb-1.5">
          {fr ? 'Nom de l\'automatisation' : 'Automation name'}
        </label>
        <input
          id={`${ids}-nom`}
          type="text"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          maxLength={120}
          placeholder={fr ? 'Relance des soumissions sans réponse' : 'Follow up on unanswered quotes'}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface-primary text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>

      {/* ── Simple ou séquence ──
          Deux formes du même objet : une suite d'actions après un délai, ou
          un parcours avec des attentes et des branches. On ne force personne
          au canevas pour une relance à trois jours. */}
      <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label={fr ? 'Type d’automatisation' : 'Automation type'}>
        {(['simple', 'sequence'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              mode === m ? 'bg-text-primary text-white' : 'text-text-secondary hover:bg-surface-tertiary',
            )}
          >
            {m === 'simple'
              ? (fr ? 'Simple' : 'Simple')
              : (fr ? 'Séquence' : 'Sequence')}
          </button>
        ))}
      </div>
      <p className="-mt-3 text-xs text-text-secondary">
        {mode === 'simple'
          ? (fr ? 'Un délai, puis une ou plusieurs actions.' : 'One delay, then one or more actions.')
          : (fr ? 'Un parcours : des attentes, des messages, et des branches « si ».' : 'A path: waits, messages, and “if” branches.')}
      </p>

      {/* ── Quand ── */}
      <section className="rounded-xl border border-border bg-surface-secondary p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary mb-3">
          <Zap className="w-4 h-4 text-accent" aria-hidden="true" />
          {fr ? 'Quand ceci arrive' : 'When this happens'}
        </h3>
        <label htmlFor={`${ids}-declencheur`} className="sr-only">
          {fr ? 'Déclencheur' : 'Trigger'}
        </label>
        <select
          id={`${ids}-declencheur`}
          value={declencheur}
          disabled={declencheurFige}
          onChange={(e) => setDeclencheur(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface-primary text-text-primary disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="">{fr ? '— Choisir —' : '— Choose —'}</option>
          {groupes.map((g) => (
            <optgroup key={g.cle} label={fr ? g.fr : g.en}>
              {g.items.map((d) => (
                <option key={d.cle} value={d.cle}>{fr ? d.fr : d.en}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {declencheurChoisi && (
          <p className="mt-2 text-xs text-text-secondary">
            {fr ? declencheurChoisi.aide_fr : declencheurChoisi.aide_en}
          </p>
        )}
        {declencheur === 'custom_field.changed' && (
          <div className="mt-3">
            <label htmlFor={`${ids}-champ-surveille`} className="mb-1 block text-xs font-medium text-text-primary">
              {fr ? 'Quel champ ?' : 'Which field?'}
            </label>
            <SelecteurChamp
              id={`${ids}-champ-surveille`}
              champs={champsPerso}
              fr={fr}
              valeur={String((conditionsRegle.field_id as { eq?: string } | undefined)?.eq ?? '')}
              onChange={(id) => {
                const { field_id: _ancien, ...reste } = conditionsRegle;
                setConditionsRegle(id ? { ...reste, field_id: { eq: id } } : reste);
              }}
              className={'w-full px-3 py-2 rounded-lg border border-border bg-surface-primary text-text-primary text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'}
            />
            <p className="mt-1 text-xs text-text-secondary">
              {fr ? 'Vide = n’importe quel champ.' : 'Empty = any field.'}
            </p>
          </div>
        )}
        {declencheurFige && (
          <p className="mt-2 text-xs text-text-secondary">
            {fr
              ? 'Automatisation fournie avec Lume : son déclencheur ne change pas, mais le délai et les messages sont à vous. Dupliquez-la pour tout changer.'
              : 'Built-in automation: its trigger stays fixed, but the timing and messages are yours. Duplicate it to change everything.'}
          </p>
        )}
      </section>

      {/* ── Attendre (mode simple seulement : en séquence, ce sont les
          étapes « attendre » qui portent le temps) ── */}
      {mode === 'simple' && (
      <section className="rounded-xl border border-border bg-surface-secondary p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary mb-3">
          <Clock className="w-4 h-4 text-accent" aria-hidden="true" />
          {fr ? 'Attendre' : 'Wait'}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${ids}-delai`} className="sr-only">{fr ? 'Délai' : 'Delay'}</label>
          <input
            id={`${ids}-delai`}
            type="number"
            min={0}
            value={delaiValeur}
            onChange={(e) => setDelaiValeur(e.target.value)}
            className="w-24 px-3 py-2 rounded-lg border border-border bg-surface-primary text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <label htmlFor={`${ids}-unite`} className="sr-only">{fr ? 'Unité' : 'Unit'}</label>
          <select
            id={`${ids}-unite`}
            value={delaiUnite}
            onChange={(e) => setDelaiUnite(e.target.value as UniteDelai)}
            className="px-3 py-2 rounded-lg border border-border bg-surface-primary text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {UNITES.map((u) => (
              <option key={u.cle} value={u.cle}>{fr ? u.fr : u.en}</option>
            ))}
          </select>
          {declencheurChoisi?.accepte_delai_negatif && (
            <>
              <label htmlFor={`${ids}-sens`} className="sr-only">{fr ? 'Avant ou après' : 'Before or after'}</label>
              <select
                id={`${ids}-sens`}
                value={avant ? 'avant' : 'apres'}
                onChange={(e) => setAvant(e.target.value === 'avant')}
                className="px-3 py-2 rounded-lg border border-border bg-surface-primary text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="apres">{fr ? 'après' : 'after'}</option>
                <option value="avant">{fr ? 'avant le rendez-vous' : 'before the appointment'}</option>
              </select>
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-text-secondary">
          {secondes === 0
            ? (fr ? 'Tout de suite.' : 'Right away.')
            : avant
              ? (fr ? 'Le message part avant le rendez-vous.' : 'The message goes out before the appointment.')
              : (fr ? 'Le message part après l\'événement.' : 'The message goes out after the event.')}
          {' '}
          {fr
            ? 'Un texto n\'est jamais envoyé entre 20 h et 8 h : il attend le matin.'
            : 'A text is never sent between 8 p.m. and 8 a.m.: it waits for morning.'}
        </p>
      </section>
      )}

      {/* ── Le parcours, en canevas ── */}
      {mode === 'sequence' && (
        <section className="rounded-xl border border-border bg-surface-secondary p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
            <GitBranch className="h-4 w-4 text-accent" aria-hidden="true" />
            {fr ? 'Le parcours' : 'The path'}
          </h3>
          <SequenceCanvas
            declencheurLabel={declencheurChoisi ? (fr ? declencheurChoisi.fr : declencheurChoisi.en) : (fr ? '— à choisir —' : '— to pick —')}
            steps={steps}
            fr={fr}
            selectionId={etapeChoisie}
            onSelection={setEtapeChoisie}
            onAjouter={ajouterEtape}
          />
          {/* Quoi ajouter ? Demandé AVANT d'insérer, pour ne pas poser une
              carte vide qu'il faudrait ensuite typer. */}
          {typeAAjouter && (
            <div className="mt-3 rounded-lg border border-border bg-surface-primary p-3">
              <p className="mb-2 text-xs font-medium text-text-primary">
                {fr ? 'Ajouter…' : 'Add…'}
              </p>
              <div className="flex flex-wrap gap-2">
                {([
                  ['action', fr ? 'Un message' : 'A message'],
                  ['attendre', fr ? 'Une attente' : 'A wait'],
                  ['si', fr ? 'Une condition' : 'A condition'],
                  ['arreter', fr ? 'Arrêter ici' : 'Stop here'],
                ] as Array<[TypeEtape, string]>).map(([t, libelle]) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => confirmerAjout(t)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-primary transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {libelle}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setTypeAAjouter(null)}
                  className="rounded-lg px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {fr ? 'Annuler' : 'Cancel'}
                </button>
              </div>
            </div>
          )}

          {etapeChoisie && steps.some((e) => e.id === etapeChoisie) && (
            <EditeurEtape
              etape={steps.find((e) => e.id === etapeChoisie) as Etape}
              catalogue={catalogue}
              fr={fr}
              champsPerso={champsPerso}
              objetRegle={objetRegle}
              onChange={(maj: Etape) => setSteps((prev) => prev.map((e) => (e.id === maj.id ? maj : e)))}
              onRetirer={() => {
                setSteps((prev) => retirerEtape(prev, etapeChoisie));
                setEtapeChoisie(null);
              }}
              onFermer={() => setEtapeChoisie(null)}
            />
          )}
        </section>
      )}

      {/* ── Faire (mode simple) ── */}
      {mode === 'simple' && (
      <section className="rounded-xl border border-border bg-surface-secondary p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary mb-3">
          <Send className="w-4 h-4 text-accent" aria-hidden="true" />
          {fr ? 'Faire ceci' : 'Do this'}
        </h3>

        <div className="space-y-4">
          {actions.map((action, i) => {
            const modele = catalogue.actions.find((a) => a.cle === action.type);
            return (
              <div key={i} className="rounded-lg border border-border bg-surface-primary p-3">
                <div className="flex items-center gap-2 mb-3">
                  <label htmlFor={`${ids}-action-${i}`} className="sr-only">
                    {fr ? `Action ${i + 1}` : `Action ${i + 1}`}
                  </label>
                  <select
                    id={`${ids}-action-${i}`}
                    value={action.type}
                    onChange={(e) => changerTypeAction(i, e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface-primary text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {catalogue.actions.map((a) => (
                      <option key={a.cle} value={a.cle}>{fr ? a.fr : a.en}</option>
                    ))}
                  </select>
                  {actions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setActions((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={fr ? `Retirer l'action ${i + 1}` : `Remove action ${i + 1}`}
                      className="p-2 rounded-lg text-text-secondary hover:text-red-500 hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>

                {modele && (
                  <p className="text-xs text-text-secondary mb-3">{fr ? modele.aide_fr : modele.aide_en}</p>
                )}

                <div className="space-y-3">
                  {modele?.champs
                    .filter((champ) => champVisible(champ, action.config as Record<string, unknown>))
                    .map((champ) => (
                      <ChampActionUI
                        key={champ.cle}
                        champ={champ}
                        valeur={(action.config as Record<string, string | undefined>)[champ.cle] ?? ''}
                        onChange={(v) => majAction(i, { config: { ...action.config, [champ.cle]: v } })}
                        fr={fr}
                      />
                    ))}
                </div>

                {/* Variables : cliquer pour insérer, plutôt que les retenir. */}
                {modele?.champs.some((c) => c.type === 'zone') && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {VARIABLES_PROPOSEES.map((v) => (
                      <button
                        key={v.cle}
                        type="button"
                        onClick={() => {
                          const champ = modele.champs.find((c) => c.type === 'zone');
                          if (!champ) return;
                          const actuel = (action.config as Record<string, string | undefined>)[champ.cle] ?? '';
                          majAction(i, { config: { ...action.config, [champ.cle]: `${actuel}[${v.cle}]` } });
                        }}
                        className="px-2 py-1 rounded-md bg-surface-tertiary text-[11px] text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {fr ? v.fr : v.en}
                      </button>
                    ))}
                    <BoutonsVariablesChamps champs={champsPerso} fr={fr} onInserer={(variable) => {
                      // `type === 'zone'` a remplacé `multiligne` : le type
                      // d'un champ décide maintenant du contrôle affiché.
                      const champ = modele.champs.find((c) => c.type === 'zone');
                      if (!champ) return;
                      const actuel = (action.config as Record<string, string | undefined>)[champ.cle] ?? '';
                      majAction(i, { config: { ...action.config, [champ.cle]: `${actuel}[${variable}]` } });
                    }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setActions((prev) => [...prev, { type: 'send_sms', config: { body: '' } }])}
          disabled={actions.length >= 5}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-accent hover:bg-surface-tertiary disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {fr ? 'Ajouter une action' : 'Add an action'}
        </button>
      </section>
      )}

      {/* ── Ce qui cloche ── */}
      {variablesDouteuses.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            {fr
              ? `Ces variables n'existent pas et seront remplacées par du vide : ${variablesDouteuses.map((v) => `[${v}]`).join(', ')}`
              : `These variables do not exist and will come out empty: ${variablesDouteuses.map((v) => `[${v}]`).join(', ')}`}
          </p>
        </div>
      )}

      {problemes.length > 0 && (
        <ul className="rounded-lg border border-border bg-surface-secondary p-3 text-xs text-text-secondary space-y-1">
          {problemes.map((p) => <li key={p}>· {p}</li>)}
        </ul>
      )}

      {/* ── Actions ── */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onFerme}
          className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {fr ? 'Annuler' : 'Cancel'}
        </button>
        <button
          type="button"
          onClick={enregistrer}
          disabled={enregistre || problemes.length > 0}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-accent',
            'hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          )}
        >
          {enregistre && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {enModification
            ? (fr ? 'Enregistrer' : 'Save')
            : (fr ? 'Créer l\'automatisation' : 'Create automation')}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   L'éditeur de l'étape sélectionnée

   S'ouvre sous le canevas plutôt qu'en modale : on garde le parcours sous
   les yeux pendant qu'on écrit le message, et on voit tout de suite où
   l'étape se situe.
   ═══════════════════════════════════════════════════════════════ */

function EditeurEtape({
  etape, catalogue, fr, onChange, onRetirer, onFermer, champsPerso = [], objetRegle = null,
}: {
  /** Champs personnalisés (v2) : conditions « si » et action « mettre à jour un champ ». */
  champsPerso?: ChampPerso[];
  objetRegle?: ObjetChamp | null;
  etape: Etape;
  catalogue: CatalogueAutomatisations;
  fr: boolean;
  onChange: (maj: Etape) => void;
  onRetirer: () => void;
  onFermer: () => void;
}) {
  const ids = useId();

  return (
    <div className="mt-4 rounded-lg border border-accent/40 bg-surface-primary p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-text-primary">
          {fr ? 'Cette étape' : 'This step'}
        </h4>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRetirer}
            aria-label={fr ? 'Retirer cette étape' : 'Remove this step'}
            className="rounded-md p-1.5 text-text-tertiary transition-colors hover:text-red-500 hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onFermer}
            aria-label={fr ? 'Fermer' : 'Close'}
            className="rounded-md p-1.5 text-text-tertiary transition-colors hover:text-text-primary hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ── Une attente ── */}
      {etape.type === 'attendre' && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${ids}-attente`} className="text-xs text-text-secondary">
            {fr ? 'Attendre' : 'Wait'}
          </label>
          <input
            id={`${ids}-attente`}
            type="number"
            min={0}
            value={Math.round((etape.delai_secondes || 0) / 86400) || ''}
            onChange={(e) => onChange({ ...etape, delai_secondes: Math.max(0, Number(e.target.value) || 0) * 86400 })}
            className="w-20 rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <span className="text-xs text-text-secondary">{fr ? 'jour(s)' : 'day(s)'}</span>
        </div>
      )}

      {/* ── Une condition ──
          Une liste de cas courants, pas un éditeur d'expressions : « la
          soumission est toujours sans réponse » est ce qu'un entrepreneur
          veut dire, et ça se traduit en `{status: {eq: 'sent'}}` pour le
          moteur. Un champ libre laisserait écrire des conditions que le
          moteur refuse en silence. */}
      {etape.type === 'si' && (
        <div>
          <label htmlFor={`${ids}-cond`} className="mb-1 block text-xs font-medium text-text-primary">
            {fr ? 'Continuer seulement si…' : 'Continue only if…'}
          </label>
          <select
            id={`${ids}-cond`}
            value={String(((etape.conditions as Record<string, { eq?: unknown }>)?.status?.eq) ?? '')}
            onChange={(e) =>
              onChange({
                ...etape,
                conditions: {
                  ...(Array.isArray((etape.conditions as Record<string, unknown> | undefined)?.champs_perso)
                    ? { champs_perso: (etape.conditions as Record<string, unknown>).champs_perso } : {}),
                  ...(e.target.value ? { status: { eq: e.target.value } } : {}),
                },
              })
            }
            className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">{fr ? '— toujours continuer —' : '— always continue —'}</option>
            <option value="sent">{fr ? 'la soumission est toujours sans réponse' : 'the quote is still unanswered'}</option>
            <option value="approved">{fr ? 'la soumission est acceptée' : 'the quote is approved'}</option>
            <option value="unpaid">{fr ? 'la facture est toujours impayée' : 'the invoice is still unpaid'}</option>
            <option value="paid">{fr ? 'la facture est payée' : 'the invoice is paid'}</option>
          </select>
          <p className="mt-2 text-xs text-text-secondary">
            {fr
              ? 'Vérifié au moment où on arrive à cette étape, pas au déclenchement.'
              : 'Checked when this step is reached, not at trigger time.'}
          </p>
          <ConditionsChampsEtape
            conditions={etape.conditions as Record<string, unknown> | undefined}
            onChange={(c) => onChange({ ...etape, conditions: c })}
            champs={champsPerso}
            objet={objetRegle}
            fr={fr}
          />
        </div>
      )}

      {/* ── Un message ── */}
      {etape.type === 'action' && (
        <div className="space-y-3">
          <div>
            <label htmlFor={`${ids}-type`} className="sr-only">{fr ? 'Type de message' : 'Message type'}</label>
            <select
              id={`${ids}-type`}
              value={etape.action.type}
              onChange={(e) => {
                const texte = etape.action.config.body ?? '';
                onChange({ ...etape, action: { type: e.target.value, config: texte ? { body: texte } : {} } });
              }}
              className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {catalogue.actions.map((a) => (
                <option key={a.cle} value={a.cle}>{fr ? a.fr : a.en}</option>
              ))}
            </select>
          </div>

          {catalogue.actions
            .find((a) => a.cle === etape.action.type)
            ?.champs.filter((champ) => champVisible(champ, etape.action.config))
            .map((champ) => (
              <ChampActionUI
                key={champ.cle}
                champ={champ}
                valeur={etape.action.config[champ.cle] ?? ''}
                onChange={(v) => onChange({ ...etape, action: { ...etape.action, config: { ...etape.action.config, [champ.cle]: v } } })}
                fr={fr}
              />
            ))}

          <div className="flex flex-wrap gap-1.5">
            {VARIABLES_PROPOSEES.map((v) => (
              <button
                key={v.cle}
                type="button"
                onClick={() =>
                  onChange({
                    ...etape,
                    action: { ...etape.action, config: { ...etape.action.config, body: `${etape.action.config.body ?? ''}[${v.cle}]` } },
                  })
                }
                className="rounded-md bg-surface-tertiary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {fr ? v.fr : v.en}
              </button>
            ))}
            <BoutonsVariablesChamps champs={champsPerso} fr={fr} onInserer={(variable) =>
              onChange({ ...etape, action: { ...etape.action, config: { ...etape.action.config, body: `${etape.action.config.body ?? ''}[${variable}]` } } })} />
          </div>
        </div>
      )}

      {etape.type === 'arreter' && (
        <p className="text-xs text-text-secondary">
          {fr ? 'La séquence s’arrête ici. Rien de plus n’est envoyé.' : 'The sequence stops here. Nothing more is sent.'}
        </p>
      )}
    </div>
  );
}
