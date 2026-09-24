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
import { Loader2, Plus, Trash2, Zap, Clock, Send, AlertTriangle } from 'lucide-react';
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

  const declencheurChoisi = useMemo(
    () => catalogue.declencheurs.find((d) => d.cle === declencheur),
    [catalogue.declencheurs, declencheur],
  );

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
  }, [nom, declencheur, actions, catalogue.actions, fr]);

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
          for (const v of variablesInconnues(valeur)) trouvees.add(v);
        }
      }
    }
    return [...trouvees];
  }, [actions]);

  const enregistrer = async () => {
    if (problemes.length) return;
    setEnregistre(true);
    try {
      const brouillon = {
        name: nom.trim(),
        description: description.trim() || null,
        trigger_event: declencheur,
        delay_seconds: secondes,
        actions: actions.map((a) => ({
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
        {declencheurFige && (
          <p className="mt-2 text-xs text-text-secondary">
            {fr
              ? 'Automatisation fournie avec Lume : son déclencheur ne change pas, mais le délai et les messages sont à vous. Dupliquez-la pour tout changer.'
              : 'Built-in automation: its trigger stays fixed, but the timing and messages are yours. Duplicate it to change everything.'}
          </p>
        )}
      </section>

      {/* ── Attendre ── */}
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

      {/* ── Faire ── */}
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

                {modele?.champs.map((champ) => (
                  <div key={champ.cle} className="mb-3 last:mb-0">
                    <label
                      htmlFor={`${ids}-a${i}-${champ.cle}`}
                      className="block text-xs font-medium text-text-primary mb-1"
                    >
                      {fr ? champ.fr : champ.en}
                      {!champ.obligatoire && (
                        <span className="text-text-secondary font-normal"> {fr ? '(facultatif)' : '(optional)'}</span>
                      )}
                    </label>
                    {champ.multiligne ? (
                      <textarea
                        id={`${ids}-a${i}-${champ.cle}`}
                        rows={3}
                        maxLength={champ.max}
                        value={(action.config as Record<string, string | undefined>)[champ.cle] ?? ''}
                        onChange={(e) => majAction(i, { config: { ...action.config, [champ.cle]: e.target.value } })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-surface-primary text-text-primary text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                    ) : (
                      <input
                        id={`${ids}-a${i}-${champ.cle}`}
                        type="text"
                        maxLength={champ.max}
                        value={(action.config as Record<string, string | undefined>)[champ.cle] ?? ''}
                        onChange={(e) => majAction(i, { config: { ...action.config, [champ.cle]: e.target.value } })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-surface-primary text-text-primary text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                    )}
                  </div>
                ))}

                {/* Variables : cliquer pour insérer, plutôt que les retenir. */}
                {modele?.champs.some((c) => c.multiligne) && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {VARIABLES_PROPOSEES.map((v) => (
                      <button
                        key={v.cle}
                        type="button"
                        onClick={() => {
                          const champ = modele.champs.find((c) => c.multiligne)!;
                          const actuel = (action.config as Record<string, string | undefined>)[champ.cle] ?? '';
                          majAction(i, { config: { ...action.config, [champ.cle]: `${actuel}[${v.cle}]` } });
                        }}
                        className="px-2 py-1 rounded-md bg-surface-tertiary text-[11px] text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {fr ? v.fr : v.en}
                      </button>
                    ))}
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
