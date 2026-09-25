/* ═══════════════════════════════════════════════════════════════
   Le panneau d'édition d'une étape — celui de GoHighLevel.

   C'était LE trou : cliquer une carte sélectionnait l'étape et n'ouvrait
   rien. On voyait son parcours sans jamais pouvoir le modifier.

   Ce panneau reprend, élément par élément, celui de leur capture :

     ┌──────────────────────────────────────┐
     │ [icône] Courriel                  ✕  │  ← en-tête : l'action
     │         Envoyer un courriel au client│
     ├──────────────────────────────────────┤
     │  Modifier l'action  │  Statistiques  │  ← deux onglets
     ├──────────────────────────────────────┤
     │ Nom de l'action *                    │
     │ [Courriel de confirmation          ] │
     │ Objet *                              │
     │ [...]                                │  ← les champs du catalogue
     ├──────────────────────────────────────┤
     │ Supprimer      Annuler   Enregistrer │  ← le pied
     └──────────────────────────────────────┘

   ── Pourquoi un brouillon local ────────────────────────────────
   Le panneau travaille sur une COPIE de l'étape, et ne la renvoie qu'au
   moment d'enregistrer. C'est ce qui donne un vrai « Annuler » : sans
   copie, chaque frappe modifierait le parcours et le bouton ne pourrait
   rien annuler du tout.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useId, useMemo, useState } from 'react';
import { X, Trash2, BarChart3, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  ACTIONS,
  FAMILLES_ACTIONS,
  actionCompatible,
  champVisible,
  trouverAction,
} from '../../lib/automationCatalogue';
import type { Etape, EtapeAction, EtapeAttendre, EtapeSi } from '../../lib/sequenceTypes';
import ChampActionUI from './ChampAction';

/** Les conditions d'une étape « si », en texte modifiable. */
/** L'opérateur, tel qu'on l'ecrit : `montant > 5000`. */
const SIGNES: Array<[string, string]> = [
  ['gte', '>='], ['lte', '<='], ['gt', '>'], ['lt', '<'], ['neq', '!='], ['eq', '='],
];

function texteDesConditions(etape: Etape): string {
  if (etape.type !== 'si') return '';
  const lignes: string[] = [];
  for (const [cle, v] of Object.entries(etape.conditions ?? {})) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      // Un intervalle (`{ gte, lt }`) s'ecrit sur DEUX lignes : c'est ce
      // qu'on relit le mieux, et l'analyse les recolle sur la meme cle.
      for (const [op, signe] of SIGNES) {
        if (op in (v as Record<string, unknown>)) {
          lignes.push(cle + ' ' + signe + ' ' + String((v as Record<string, unknown>)[op]));
        }
      }
      continue;
    }
    lignes.push(cle + ' = ' + String(v));
  }
  return lignes.join(String.fromCharCode(10));
}

/** Le texte saisi → l'objet `conditions`. Une ligne incomplète est ignorée. */
/** Un nombre pur (montant, quantité) reste un nombre. */
const NOMBRE_SEUL = /^-?[0-9]+([.][0-9]+)?$/;

function analyserConditions(texte: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const ligne of texte.split(String.fromCharCode(10))) {
    // `>=` et `<=` d'abord : sinon `>` couperait `>=` en deux.
    const trouve = SIGNES
      .map(([op, signe]) => ({ op, signe, i: ligne.indexOf(signe) }))
      .filter((x) => x.i > 0)
      .sort((a, b) => (a.i - b.i) || (b.signe.length - a.signe.length))[0];
    if (!trouve) continue;

    const cle = ligne.slice(0, trouve.i).trim();
    const val = ligne.slice(trouve.i + trouve.signe.length).trim();
    if (!cle || !val) continue;

    if (trouve.op === 'eq') {
      // L'égalité reste écrite à plat : c'est la forme d'origine, que
      // portent toutes les règles existantes.
      out[cle] = val;
      continue;
    }

    // Un montant s'écrit en chiffres : on le garde en nombre pour que la
    // comparaison ne dépende pas d'une conversion plus loin.
    const valeur = NOMBRE_SEUL.test(val) ? Number(val) : val;
    const existant = out[cle];
    out[cle] = (existant !== null && typeof existant === 'object' && !Array.isArray(existant))
      ? { ...(existant as Record<string, unknown>), [trouve.op]: valeur }
      : { [trouve.op]: valeur };
  }
  return out;
}

/** Les variables offertes, insérables d'un clic dans un champ de texte. */
const VARIABLES = [
  { cle: 'client_name', fr: 'Nom du client', en: 'Client name' },
  { cle: 'company_name', fr: 'Votre entreprise', en: 'Your company' },
  { cle: 'invoice_total', fr: 'Total', en: 'Total' },
  { cle: 'invoice_link', fr: 'Lien facture', en: 'Invoice link' },
  { cle: 'quote_link', fr: 'Lien soumission', en: 'Quote link' },
  { cle: 'appointment_date', fr: 'Date du rendez-vous', en: 'Appointment date' },
];

interface Props {
  etape: Etape;
  fr: boolean;
  /**
   * Le déclencheur de la règle.
   *
   * Il décide de l'ENTITÉ qui arrivera (un devis, une facture, un
   * rendez-vous), donc des actions qui ont un sens : « envoyer la facture »
   * après « soumission envoyée » ne peut pas marcher. On les retire du menu
   * plutôt que de laisser publier un parcours qui échouera en silence.
   */
  declencheur?: string;
  membres: Array<{ user_id: string; nom: string }>;
  etiquettes: string[];
  /** Autres automatisations publiées, pour « Démarrer une automatisation ». */
  automatisations?: Array<{ id: string; nom: string }>;
  /** Statistiques de l'étape, pour l'onglet du même nom. */
  stats?: { envois: number; succes: number; echecs: number } | null;
  onEnregistrer: (etape: Etape) => void;
  onSupprimer: (id: string) => void;
  onFermer: () => void;
}

/** Les unités de délai proposées pour une attente. */
const UNITES: Array<{ cle: string; secondes: number; fr: string; en: string }> = [
  { cle: 'minutes', secondes: 60, fr: 'minutes', en: 'minutes' },
  { cle: 'heures', secondes: 3600, fr: 'heures', en: 'hours' },
  { cle: 'jours', secondes: 86400, fr: 'jours', en: 'days' },
];

/** Décompose un délai en la plus grande unité qui tombe juste. */
function decomposer(secondes: number): { valeur: number; unite: string } {
  if (secondes > 0 && secondes % 86400 === 0) return { valeur: secondes / 86400, unite: 'jours' };
  if (secondes > 0 && secondes % 3600 === 0) return { valeur: secondes / 3600, unite: 'heures' };
  return { valeur: Math.max(0, Math.round(secondes / 60)), unite: 'minutes' };
}

export default function PanneauEtape({
  etape, fr, declencheur, membres, etiquettes, automatisations = [], stats, onEnregistrer, onSupprimer, onFermer,
}: Props) {
  const ids = useId();
  const [onglet, setOnglet] = useState<'edition' | 'stats'>('edition');
  // Le brouillon : on ne touche au parcours qu'en enregistrant.
  const [brouillon, setBrouillon] = useState<Etape>(etape);

  /**
   * Le texte BRUT du champ « Conditions », tel qu'on le tape.
   *
   * Il était dérivé de l'objet `conditions` à chaque rendu, et l'analyse ne
   * gardait une ligne que si la clé ET la valeur étaient remplies. Taper
   * « statut » (sans encore de « = ») jetait donc la ligne, et la valeur
   * dérivée réécrivait un champ vide : le champ S'EFFAÇAIT à chaque frappe.
   * De l'extérieur, on croyait qu'il refusait le clavier.
   *
   * On garde donc le texte tel quel pendant la saisie, et on ne l'analyse
   * qu'au moment d'enregistrer.
   */
  const [conditionsTexte, setConditionsTexte] = useState(() => texteDesConditions(etape));

  /*
   * Changer de CARTE remet le panneau sur la nouvelle étape, et ramène
   * l'onglet d'édition — on ouvre une étape pour la modifier, pas pour lire
   * les statistiques de la précédente.
   *
   * La dépendance est `etape.id`, PAS `etape` : le jour où le parent cessera
   * de mémoriser l'étape (`useMemo` sur `steps`), un objet neuf à chaque
   * rendu rejouerait cet effet en boucle et effacerait la saisie en cours.
   * Suivre l'identifiant décrit ce qu'on veut vraiment — « une AUTRE carte a
   * été ouverte » — au lieu de dépendre d'un détail du parent.
   */
  useEffect(() => {
    setBrouillon(etape);
    setConditionsTexte(texteDesConditions(etape));
    setOnglet('edition');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- voir ci-dessus : suivre `etape` rendrait le panneau fragile à une optimisation du parent.
  }, [etape.id]);

  const modele = brouillon.type === 'action' ? trouverAction(brouillon.action.type) : undefined;

  /** Ce qui empêche d'enregistrer, dit avant de cliquer. */
  const problemes = useMemo(() => {
    const out: string[] = [];
    if (brouillon.type !== 'action') return out;
    if (!modele) return out;
    const config = brouillon.action.config as Record<string, string | undefined>;
    /*
     * L'action peut-elle seulement partir sur ce déclencheur ?
     *
     * Le cas arrive quand on change le déclencheur d'une règle déjà bâtie :
     * « envoyer la facture » reste dans le parcours mais l'entité qui
     * arrivera est devenue un devis. Le dire ICI, pas dans un journal
     * d'échec après publication.
     */
    if (declencheur && !actionCompatible(modele, declencheur)) {
      out.push(
        fr
          ? `« ${modele.fr} » ne peut pas suivre ce déclencheur : choisissez-en une autre.`
          : `“${modele.en}” cannot follow this trigger: pick another one.`,
      );
    }

    for (const champ of modele.champs) {
      if (!champ.obligatoire) continue;
      if (!champVisible(champ, config)) continue;
      if (!config[champ.cle]?.trim()) {
        out.push(fr ? `« ${champ.fr} » est vide.` : `“${champ.en}” is empty.`);
      }
    }
    return out;
  }, [brouillon, modele, fr, declencheur]);

  const majConfig = (cle: string, valeur: string) => {
    setBrouillon((b) => {
      if (b.type !== 'action') return b;
      return { ...b, action: { ...b.action, config: { ...b.action.config, [cle]: valeur } } };
    });
  };

  /** Changer le type d'action : on repart d'une config vide. */
  const changerType = (type: string) => {
    setBrouillon((b) => {
      if (b.type !== 'action') return b;
      // Le texte est presque toujours réutilisable d'une action à l'autre ;
      // le reste ne l'est pas (un objet de courriel sur un texto ferait
      // refuser l'enregistrement par la validation serveur).
      const texte = b.action.config.body;
      const cible = trouverAction(type);
      const garde = cible?.champs?.some((c) => c.cle === 'body') && texte ? { body: texte } : {};
      return { ...b, action: { type, config: garde } };
    });
  };

  const titre = (() => {
    if (brouillon.type === 'action') {
      return brouillon.nom?.trim() || (modele ? (fr ? modele.fr : modele.en) : 'Action');
    }
    if (brouillon.type === 'attendre') return fr ? 'Attendre' : 'Wait';
    if (brouillon.type === 'si') return fr ? 'Condition' : 'Condition';
    return fr ? 'Arrêter ici' : 'Stop here';
  })();

  const sousTitre = (() => {
    if (brouillon.type === 'action' && modele) return fr ? modele.aide_fr : modele.aide_en;
    if (brouillon.type === 'attendre') {
      return fr ? 'Met le parcours en pause avant la suite.' : 'Pauses the journey before the next step.';
    }
    if (brouillon.type === 'si') {
      return fr ? 'Sépare le parcours en deux chemins.' : 'Splits the journey in two.';
    }
    return fr ? 'Le parcours se termine ici.' : 'The journey ends here.';
  })();

  const delai = brouillon.type === 'attendre' ? decomposer(brouillon.delai_secondes) : null;

  return (
    <aside
      aria-label={fr ? 'Modifier l’étape' : 'Edit step'}
      className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-surface-card"
    >
      {/* ── En-tête ─────────────────────────────────────────── */}
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-text-primary">{titre}</h2>
          <p className="mt-0.5 text-[11px] text-text-tertiary">{sousTitre}</p>
        </div>
        <button
          type="button"
          onClick={onFermer}
          aria-label={fr ? 'Fermer le panneau' : 'Close panel'}
          className="shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* ── Onglets ─────────────────────────────────────────── */}
      <div className="flex border-b border-border" role="tablist">
        {([
          ['edition', fr ? 'Modifier l’action' : 'Edit action', Pencil],
          ['stats', fr ? 'Statistiques' : 'Statistics', BarChart3],
        ] as const).map(([cle, libelle, Icone]) => (
          <button
            key={cle}
            type="button"
            role="tab"
            aria-selected={onglet === cle}
            onClick={() => setOnglet(cle)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              onglet === cle
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            <Icone className="h-3.5 w-3.5" aria-hidden="true" />
            {libelle}
          </button>
        ))}
      </div>

      {/* ── Corps ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {onglet === 'stats' ? (
          <div className="space-y-3">
            {stats ? (
              <>
                {([
                  [fr ? 'Envois' : 'Sends', stats.envois, 'text-text-primary'],
                  [fr ? 'Réussis' : 'Succeeded', stats.succes, 'text-emerald-600 dark:text-emerald-400'],
                  [fr ? 'Échoués' : 'Failed', stats.echecs, 'text-red-600 dark:text-red-400'],
                ] as const).map(([libelle, valeur, couleur]) => (
                  <div key={libelle} className="flex items-baseline justify-between rounded-lg border border-border px-3 py-2.5">
                    <span className="text-xs text-text-secondary">{libelle}</span>
                    <span className={cn('text-lg font-semibold tabular-nums', couleur)}>{valeur}</span>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-text-tertiary">
                {fr
                  ? 'Aucun passage encore. Les chiffres apparaîtront après le premier déclenchement.'
                  : 'No runs yet. Numbers show up after the first trigger.'}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* ── Étape « action » ────────────────────────────── */}
            {brouillon.type === 'action' && (
              <>
                {/* Nom de l'action — le « Action Name » de GHL. */}
                <div>
                  <label htmlFor={`${ids}-nom`} className="mb-1 block text-xs font-medium text-text-primary">
                    {fr ? 'Nom de l’action' : 'Action name'}
                    <span className="font-normal text-text-tertiary"> {fr ? '(facultatif)' : '(optional)'}</span>
                  </label>
                  <input
                    id={`${ids}-nom`}
                    type="text"
                    maxLength={80}
                    value={brouillon.nom ?? ''}
                    onChange={(e) => setBrouillon({ ...brouillon, nom: e.target.value })}
                    placeholder={modele ? (fr ? modele.fr : modele.en) : ''}
                    className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <p className="mt-1 text-[11px] text-text-tertiary">
                    {fr
                      ? 'Ce qui s’affiche sur la carte. Utile quand le parcours envoie plusieurs courriels.'
                      : 'What shows on the card. Useful when a journey sends several emails.'}
                  </p>
                </div>

                {/* Le type d'action, groupé par famille comme leur menu. */}
                <div>
                  <label htmlFor={`${ids}-type`} className="mb-1 block text-xs font-medium text-text-primary">
                    {fr ? 'Quoi faire' : 'What to do'}
                    <span className="text-red-500"> *</span>
                  </label>
                  <select
                    id={`${ids}-type`}
                    value={brouillon.action.type}
                    onChange={(e) => changerType(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {FAMILLES_ACTIONS.map((famille) => {
                      // Seules les actions COMPATIBLES avec le déclencheur.
                      // Une famille qui n'en garde aucune disparaît, plutôt
                      // que d'afficher un groupe vide.
                      const offertes = ACTIONS.filter(
                        (a) => a.famille === famille.cle
                          && (!declencheur || actionCompatible(a, declencheur)),
                      );
                      if (!offertes.length) return null;
                      return (
                        <optgroup key={famille.cle} label={fr ? famille.fr : famille.en}>
                          {offertes.map((a) => (
                            <option key={a.cle} value={a.cle}>
                              {fr ? a.fr : a.en}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>

                {/* Les champs de l'action choisie. */}
                {modele?.champs
                  .filter((champ) => champVisible(champ, brouillon.action.config as Record<string, unknown>))
                  .map((champ) => (
                    <ChampActionUI
                      key={champ.cle}
                      champ={champ}
                      valeur={(brouillon.action.config as Record<string, string | undefined>)[champ.cle] ?? ''}
                      onChange={(v) => majConfig(champ.cle, v)}
                      fr={fr}
                      membres={membres}
                      etiquettes={etiquettes}
                      automatisations={automatisations}
                    />
                  ))}

                {/* Variables — cliquer pour insérer, plutôt que les retenir. */}
                {modele?.champs?.some((c) => c.type === 'zone') && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-medium text-text-secondary">
                      {fr ? 'Insérer une information du client' : 'Insert client information'}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {VARIABLES.map((v) => (
                        <button
                          key={v.cle}
                          type="button"
                          onClick={() => {
                            const champ = modele.champs.find((c) => c.type === 'zone');
                            if (!champ) return;
                            const actuel =
                              (brouillon.action.config as Record<string, string | undefined>)[champ.cle] ?? '';
                            majConfig(champ.cle, `${actuel}[${v.cle}]`);
                          }}
                          className="rounded-md bg-surface-tertiary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {fr ? v.fr : v.en}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Étape « attendre » ──────────────────────────── */}
            {brouillon.type === 'attendre' && delai && (
              <div>
                <label htmlFor={`${ids}-delai`} className="mb-1 block text-xs font-medium text-text-primary">
                  {fr ? 'Attendre' : 'Wait'}
                  <span className="text-red-500"> *</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id={`${ids}-delai`}
                    type="number"
                    min={0}
                    max={365}
                    value={delai.valeur}
                    onChange={(e) => {
                      const n = Math.max(0, Number(e.target.value) || 0);
                      const u = UNITES.find((x) => x.cle === delai.unite) ?? UNITES[0];
                      setBrouillon({ ...(brouillon as EtapeAttendre), delai_secondes: n * u.secondes });
                    }}
                    className="w-24 rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <select
                    aria-label={fr ? 'Unité de temps' : 'Time unit'}
                    value={delai.unite}
                    onChange={(e) => {
                      const u = UNITES.find((x) => x.cle === e.target.value) ?? UNITES[0];
                      setBrouillon({ ...(brouillon as EtapeAttendre), delai_secondes: delai.valeur * u.secondes });
                    }}
                    className="flex-1 rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {UNITES.map((u) => (
                      <option key={u.cle} value={u.cle}>
                        {fr ? u.fr : u.en}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="mt-1 text-[11px] text-text-tertiary">
                  {fr
                    ? 'Les messages ne partent jamais entre 20 h et 8 h, même si l’attente se termine la nuit.'
                    : 'Messages never go out between 8 p.m. and 8 a.m., even if the wait ends overnight.'}
                </p>

                {/* Attendre une DURÉE, ou attendre que le client réponde.
                    Le second est ce qui rend une relance intelligente : plus
                    besoin d'une condition « a-t-il répondu ? » ensuite. */}
                <div className="mt-3">
                  <label htmlFor={`${ids}-mode`} className="mb-1 block text-xs font-medium text-text-primary">
                    {fr ? 'Ce qu’on attend' : 'What we wait for'}
                  </label>
                  <select
                    id={`${ids}-mode`}
                    value={(brouillon as EtapeAttendre).mode ?? 'duree'}
                    onChange={(e) => setBrouillon({
                      ...(brouillon as EtapeAttendre),
                      mode: e.target.value as 'duree' | 'reponse',
                    })}
                    className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <option value="duree">{fr ? 'Simplement ce délai' : 'Just this delay'}</option>
                    <option value="reponse">
                      {fr ? 'La réponse du client (au plus ce délai)' : 'The client’s reply (at most this delay)'}
                    </option>
                  </select>
                  <p className="mt-1 text-[11px] text-text-tertiary">
                    {(brouillon as EtapeAttendre).mode === 'reponse'
                      ? (fr
                        ? 'S’il répond, le parcours s’arrête ici. Sinon, la suite part une fois le délai écoulé.'
                        : 'If they reply, the journey stops here. Otherwise the next step runs once the delay is up.')
                      : (fr
                        ? 'Le parcours continue une fois le délai écoulé, quoi qu’il arrive.'
                        : 'The journey continues once the delay is up, whatever happens.')}
                  </p>
                </div>
              </div>
            )}

            {/* ── Étape « si » ────────────────────────────────── */}
            {brouillon.type === 'si' && (
              <div>
                <label htmlFor={`${ids}-cond`} className="mb-1 block text-xs font-medium text-text-primary">
                  {fr ? 'Conditions' : 'Conditions'}
                </label>
                <p className="mb-2 text-[11px] text-text-tertiary">
                  {fr
                    ? 'Une ligne par condition : champ = valeur, ou une comparaison (montant > 5000, created_at >= 2026-06-01). Deux lignes sur le même champ font un intervalle. Le parcours suit « alors » quand toutes sont vraies.'
                    : 'One condition per line: field = value, or a comparison (amount > 5000, created_at >= 2026-06-01). Two lines on the same field make a range. The journey follows “then” when all are true.'}
                </p>

                {/*
                  Des exemples CLIQUABLES plutôt qu'un champ nu.
                  L'audit du 2026-09-25 le dit : « aucune autocomplétion,
                  aucune liste des champs valides — l'utilisateur ne sait
                  même pas quoi écrire ». Les champs disponibles dépendent du
                  déclencheur (le moteur compare aux métadonnées de
                  l'événement), donc on propose les plus courants au lieu
                  d'inventer une liste exhaustive qui serait fausse ailleurs.
                */}
                <div className="mb-2 flex flex-wrap gap-1">
                  {['statut = ', 'source = ', 'total_cents > ', 'created_at >= '].map((exemple) => (
                    <button
                      key={exemple}
                      type="button"
                      onClick={() => {
                        const ajout = `${conditionsTexte.trim() ? `${conditionsTexte.replace(/\n+$/, '')}\n` : ''}${exemple}`;
                        setConditionsTexte(ajout);
                        setBrouillon({
                          ...(brouillon as EtapeSi),
                          conditions: analyserConditions(ajout),
                        });
                      }}
                      className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-secondary transition-colors hover:border-accent hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {exemple}
                    </button>
                  ))}
                </div>
                <textarea
                  id={`${ids}-cond`}
                  rows={4}
                  value={conditionsTexte}
                  onChange={(e) => {
                    // Le texte affiché est CELUI QU'ON TAPE, jamais une
                    // reconstruction depuis l'objet : c'est ce qui rendait le
                    // champ inutilisable (une ligne sans « = » était jetée, et
                    // la valeur dérivée réécrivait un champ vide à chaque
                    // frappe). L'objet suit, pour l'enregistrement.
                    setConditionsTexte(e.target.value);
                    setBrouillon({
                      ...(brouillon as EtapeSi),
                      conditions: analyserConditions(e.target.value),
                    });
                  }}
                  className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            )}

            {brouillon.type === 'arreter' && (
              <p className="text-xs text-text-secondary">
                {fr
                  ? 'Rien à configurer. Le client sort du parcours en arrivant ici.'
                  : 'Nothing to configure. The client leaves the journey here.'}
              </p>
            )}

            {/* Ce qui bloque l'enregistrement, dit avant de cliquer. */}
            {problemes.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30">
                {problemes.map((p) => (
                  <li key={p} className="text-[11px] text-amber-800 dark:text-amber-200">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── Pied : Supprimer · Annuler · Enregistrer ─────────── */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={() => onSupprimer(brouillon.id)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {fr ? 'Supprimer' : 'Delete'}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onFermer}
          className="rounded-lg px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {fr ? 'Annuler' : 'Cancel'}
        </button>
        <button
          type="button"
          onClick={() => onEnregistrer(brouillon)}
          disabled={problemes.length > 0}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {fr ? 'Enregistrer' : 'Save action'}
        </button>
      </div>
    </aside>
  );
}

export type { EtapeAction };
