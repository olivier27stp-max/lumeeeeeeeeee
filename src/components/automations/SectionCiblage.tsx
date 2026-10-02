/* ═══════════════════════════════════════════════════════════════
   « QUI EST CIBLÉ » — la section du panneau du déclencheur.

     Qui est ciblé
     (•) Tous les clients          ( ) Seulement certains clients
         Inclure les clients qui remplissent  [au moins une ▾]  de ces conditions
           [Étiquette ▾] est [VIP]                                   ✕
           [Type de client ▾] [est ▾] [Entreprise ▾]                 ✕
           + Ajouter une condition
         Toujours exclure
           [Étiquette ▾] est [Ne pas relancer]                       ✕
           + Ajouter une exclusion
     🔒 Toujours exclus : les clients désabonnés ou qui ont répondu STOP
     🔒 (demande d'avis) les clients « Aucune demande d'avis »
     Touche 2 000 clients · 60 ne recevront pas de texto (STOP)      Voir la liste

   COMPOSANT CONTRÔLÉ (`valeur`, `onChange`) : il ne sait rien du panneau qui
   l'accueille. Il rend un `Ciblage` (src/lib/automationCiblage.ts) ; à
   l'enregistrement, le parent écrit `ecrireCiblage(conditions, valeur)`.

   LE COMPTEUR appelle le serveur 300 ms après la dernière modification, avec
   le ciblage NETTOYÉ (une ligne en cours de saisie ne compte pas) — le même
   évaluateur que l'exécution le calcule. Une réponse périmée est ignorée.
   « X clients » = les clients du carnet qui correspondent AUJOURD'HUI, pas
   « X messages partiront » : la section le dit.

   Les exclusions VERROUILLÉES (désabonnés / STOP, et « Aucune demande d'avis »
   pour une demande d'avis) sont affichées et ne se retirent pas : le moteur
   les applique quoi que dise le ciblage.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Lock, Plus, X } from 'lucide-react';
import EditeurConditions from '../champs/EditeurConditions';
import type { Condition } from '../../lib/champs/filtres';
import { LIBELLES_OPERATEUR } from '../../lib/champs/filtres';
import type { ChampPerso } from '../../lib/champs/types';
import {
  CIBLAGE_MAX_EXCLURE, CIBLAGE_MAX_INCLURE, CLES_FICHE, LIBELLES_FICHE, VALEURS_FICHE,
  ciblageVide, fautesDuCiblage, nettoyerCiblage, operateursDeLaFiche,
  type CanalClient, type Ciblage, type CleFiche, type ModeCiblage, type OperateurFiche, type RegleCiblage,
} from '../../lib/automationCiblage';
import { apercuCiblage as apercuParLeServeur, type ApercuCiblageReponse, type DemandeApercuCiblage, type EmpechementApercu } from '../../lib/automationCiblageApi';

/** Délai entre la dernière modification et l'appel du compteur. */
export const DELAI_COMPTEUR_MS = 300;

interface Props {
  /** Le ciblage affiché (voir `ciblagePourEditeur`). `{}` = tous les clients. */
  valeur: Ciblage;
  onChange: (ciblage: Ciblage) => void;
  fr: boolean;
  /** Étiquettes existantes du bureau (suggestions de saisie). */
  etiquettes?: string[];
  /** Champs personnalisés du bureau : seuls ceux de la fiche CLIENT sont offerts. */
  champsPerso?: ChampPerso[];
  /** Les canaux par lesquels l'automatisation écrit au client — décident des sous-comptes du compteur. */
  canaux?: CanalClient[];
  /** L'automatisation demande un avis : l'exclusion « Aucune demande d'avis » est affichée, verrouillée. */
  demandeAvis?: boolean;
  /** Le compteur. Remplaçable (tests, écran sans réseau) ; par défaut : le serveur. */
  chargerApercu?: (demande: DemandeApercuCiblage, signal?: AbortSignal) => Promise<ApercuCiblageReponse>;
  /** Délai du compteur, en ms (300 par défaut). */
  delaiMs?: number;
}

const champSaisie = 'h-8 rounded-md border border-border bg-surface-primary px-2 text-[13px] text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const boutonDiscret = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/** Ce sur quoi porte une ligne : `etiquette`, `fiche:<cle>` ou `champ`. */
type Sujet = 'etiquette' | 'champ' | `fiche:${CleFiche}`;
const sujetDe = (r: RegleCiblage): Sujet => (r.type === 'fiche' ? `fiche:${r.cle}` : r.type);

const nombre = (n: number, fr: boolean) => n.toLocaleString(fr ? 'fr-CA' : 'en-CA').replace(/[  ]/g, ' ');

/** « 60 ne recevront pas de texto (STOP) » — une ligne par empêchement non nul. */
function phrasesDont(a: ApercuCiblageReponse, fr: boolean): string[] {
  const p = (n: number, frTxt: string, enTxt: string) => (n > 0 ? [`${nombre(n, fr)} ${fr ? frTxt : enTxt}`] : []);
  const un = (n: number) => n === 1;
  return [
    ...p(a.dont.stop_texto, un(a.dont.stop_texto) ? 'ne recevra pas de texto (STOP)' : 'ne recevront pas de texto (STOP)', un(a.dont.stop_texto) ? 'will not get a text (STOP)' : 'will not get a text (STOP)'),
    ...p(a.dont.sans_telephone, 'sans numéro de téléphone', 'with no phone number'),
    ...p(a.dont.desabonnes_courriel, un(a.dont.desabonnes_courriel) ? 'désabonné des courriels' : 'désabonnés des courriels', 'unsubscribed from emails'),
    ...p(a.dont.sans_courriel, 'sans adresse courriel', 'with no email address'),
    ...p(a.dont.sans_avis, un(a.dont.sans_avis) ? 'marqué « Aucune demande d’avis »' : 'marqués « Aucune demande d’avis »', 'marked “No review request”'),
  ];
}

const LIBELLE_EMPECHEMENT: Record<EmpechementApercu, [string, string]> = {
  stop_texto: ['a répondu STOP', 'replied STOP'],
  sans_telephone: ['sans téléphone', 'no phone'],
  desabonne_courriel: ['désabonné des courriels', 'unsubscribed from emails'],
  sans_courriel: ['sans courriel', 'no email'],
  sans_avis: ['aucune demande d’avis', 'no review request'],
};

export default function SectionCiblage({
  valeur, onChange, fr, etiquettes = [], champsPerso = [], canaux = [], demandeAvis = false,
  chargerApercu = apercuParLeServeur, delaiMs = DELAI_COMPTEUR_MS,
}: Props) {
  const ids = useId();
  const champsClient = useMemo(() => champsPerso.filter((c) => c.object_type === 'client' && !c.archived_at), [champsPerso]);
  const inclure = valeur.inclure?.regles ?? [];
  const exclure = valeur.exclure ?? [];
  const mode: ModeCiblage = valeur.inclure?.mode ?? 'une';

  /*
   * « Tous » ou « Seulement certains » : un ciblage qui porte au moins une
   * ligne est forcément « certains ». Vide, c'est le dernier choix de
   * l'utilisateur qui compte — sinon cocher « Seulement certains » sans encore
   * de ligne reviendrait tout seul à « Tous ».
   */
  const [certains, setCertains] = useState(() => inclure.length > 0 || exclure.length > 0);
  useEffect(() => { if (inclure.length > 0 || exclure.length > 0) setCertains(true); }, [inclure.length, exclure.length]);
  /** Les lignes mises de côté par « Tous les clients » : revenir à « certains » les rend. */
  const misDeCote = useRef<Ciblage | null>(null);

  const emettre = (regles: RegleCiblage[], exclusions: RegleCiblage[], m: ModeCiblage = mode) => onChange({
    ...(regles.length ? { inclure: { mode: m, regles } } : {}),
    ...(exclusions.length ? { exclure: exclusions } : {}),
  });

  const choisirTous = () => {
    if (inclure.length > 0 || exclure.length > 0) misDeCote.current = valeur;
    setCertains(false);
    onChange({});
  };
  const choisirCertains = () => {
    setCertains(true);
    if (misDeCote.current) { onChange(misDeCote.current); misDeCote.current = null; }
  };

  // ── Le compteur ──
  const propre = useMemo(() => nettoyerCiblage(valeur), [valeur]);
  const cleDemande = JSON.stringify({ c: propre, canaux, demandeAvis });
  const [apercu, setApercu] = useState<ApercuCiblageReponse | null>(null);
  const [etat, setEtat] = useState<'calcul' | 'pret' | 'erreur'>('calcul');
  const [listeOuverte, setListeOuverte] = useState(false);
  // La fonction de chargement peut changer d'identité à chaque rendu du parent : elle ne doit pas relancer le compteur.
  const charger = useRef(chargerApercu);
  charger.current = chargerApercu;
  useEffect(() => {
    let vivant = true;
    const coupure = typeof AbortController === 'function' ? new AbortController() : null;
    setEtat('calcul');
    const minuterie = setTimeout(() => {
      charger.current({ ciblage: propre, canaux, demande_avis: demandeAvis }, coupure?.signal)
        .then((r) => { if (vivant) { setApercu(r); setEtat('pret'); } })
        .catch((e: unknown) => {
          if (!vivant) return;
          console.error('[SectionCiblage] compteur indisponible', e);
          setApercu(null);
          setEtat('erreur');
        });
    }, delaiMs);
    return () => { vivant = false; clearTimeout(minuterie); coupure?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `cleDemande` résume le ciblage nettoyé, les canaux et la demande d'avis.
  }, [cleDemande, delaiMs]);

  const fautes = useMemo(
    () => fautesDuCiblage(propre, Object.fromEntries(champsClient.map((c) => [c.id, { label: c.label, type: c.field_type }]))),
    [propre, champsClient],
  );
  const pleinInclure = inclure.length >= CIBLAGE_MAX_INCLURE;
  const pleinExclure = exclure.length >= CIBLAGE_MAX_EXCLURE;

  /** Une ligne neuve du sujet choisi, prête à être complétée. */
  const ligneNeuve = (sujet: Sujet): RegleCiblage => {
    if (sujet === 'etiquette') return { type: 'etiquette', valeur: '' };
    if (sujet === 'champ') {
      const premier = champsClient[0];
      return { type: 'champ', field_id: premier?.id ?? '', op: premier?.field_type === 'checkbox' ? 'is' : 'is_not_empty', ...(premier?.field_type === 'checkbox' ? { value: true } : {}) };
    }
    const cle = sujet.slice('fiche:'.length) as CleFiche;
    return { type: 'fiche', cle, op: 'is', value: VALEURS_FICHE[cle]?.[0]?.cle ?? '' };
  };

  /** Les lignes d'une liste (inclusions ou exclusions). */
  const lignes = (regles: RegleCiblage[], maj: (regles: RegleCiblage[]) => void, liste: 'inclure' | 'exclure') => (
    <ul className="space-y-1.5">
      {regles.map((r, i) => {
        const id = `${ids}-${liste}-${i}`;
        const remplacer = (nouvelle: RegleCiblage) => maj(regles.map((x, j) => (j === i ? nouvelle : x)));
        const retirer = () => maj(regles.filter((_, j) => j !== i));
        const sujet = sujetDe(r);
        return (
          <li key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-surface-secondary/60 p-2">
            <label htmlFor={`${id}-sujet`} className="sr-only">{fr ? 'Sur quoi porte la condition' : 'What the condition is about'}</label>
            <select id={`${id}-sujet`} className={champSaisie} value={sujet} onChange={(e) => remplacer(ligneNeuve(e.target.value as Sujet))}>
              <option value="etiquette">{fr ? 'Étiquette' : 'Tag'}</option>
              <optgroup label={fr ? 'Fiche du client' : 'Client record'}>
                {CLES_FICHE.map((cle) => <option key={cle} value={`fiche:${cle}`}>{fr ? LIBELLES_FICHE[cle].fr : LIBELLES_FICHE[cle].en}</option>)}
              </optgroup>
              {champsClient.length > 0 && <option value="champ">{fr ? 'Champ personnalisé…' : 'Custom field…'}</option>}
            </select>

            {r.type === 'etiquette' && (
              <>
                <span className="text-[12px] text-text-tertiary">{fr ? 'est' : 'is'}</span>
                <input
                  aria-label={fr ? 'Étiquette' : 'Tag'} list={`${id}-suggestions`} className={`${champSaisie} min-w-0 flex-1`}
                  value={r.valeur} maxLength={200} placeholder={fr ? 'ex. : VIP' : 'e.g. VIP'}
                  onChange={(e) => remplacer({ type: 'etiquette', valeur: e.target.value })}
                />
                <datalist id={`${id}-suggestions`}>{etiquettes.map((t) => <option key={t} value={t} />)}</datalist>
              </>
            )}

            {r.type === 'fiche' && (
              <>
                <label htmlFor={`${id}-op`} className="sr-only">{fr ? 'Comparaison' : 'Comparison'}</label>
                <select
                  id={`${id}-op`} className={champSaisie} value={r.op}
                  onChange={(e) => remplacer({ ...r, op: e.target.value as OperateurFiche })}
                >
                  {operateursDeLaFiche(r.cle).map((o) => <option key={o} value={o}>{fr ? LIBELLES_OPERATEUR[o].fr : LIBELLES_OPERATEUR[o].en}</option>)}
                </select>
                {r.op !== 'is_empty' && r.op !== 'is_not_empty' && (VALEURS_FICHE[r.cle] ? (
                  <>
                    <label htmlFor={`${id}-valeur`} className="sr-only">{fr ? 'Valeur' : 'Value'}</label>
                    <select id={`${id}-valeur`} className={champSaisie} value={String(r.value ?? '')} onChange={(e) => remplacer({ ...r, value: e.target.value })}>
                      {VALEURS_FICHE[r.cle]!.map((o) => <option key={o.cle} value={o.cle}>{fr ? o.fr : o.en}</option>)}
                    </select>
                  </>
                ) : (
                  <input
                    aria-label={fr ? 'Valeur' : 'Value'} className={`${champSaisie} min-w-0 flex-1`} value={String(r.value ?? '')} maxLength={200}
                    onChange={(e) => remplacer({ ...r, value: e.target.value })}
                  />
                ))}
              </>
            )}

            {r.type === 'champ' && (
              <div className="min-w-0 flex-1">
                {/* Même éditeur que les filtres de la pipeline : champ · comparaison · valeur, selon le type du champ. */}
                <EditeurConditions
                  champs={champsClient} fr={fr} max={1}
                  conditions={[(({ type: _type, ...condition }) => condition as Condition)(r)]}
                  onChange={(liste) => (liste[0] ? remplacer({ type: 'champ', ...liste[0] }) : retirer())}
                />
              </div>
            )}

            {r.type !== 'champ' && (
              <button
                type="button" onClick={retirer} aria-label={fr ? 'Retirer la condition' : 'Remove condition'}
                className="ml-auto rounded p-1 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );

  const total = apercu ? nombre(apercu.total, fr) : '';
  const dont = apercu ? phrasesDont(apercu, fr) : [];

  return (
    <section aria-labelledby={`${ids}-titre`} className="rounded-lg border border-border px-3 py-2.5">
      <h3 id={`${ids}-titre`} className="text-xs font-semibold text-text-primary">{fr ? 'Qui est ciblé' : 'Who is targeted'}</h3>

      <div role="radiogroup" aria-labelledby={`${ids}-titre`} className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
        <label htmlFor={`${ids}-tous`} className="flex cursor-pointer items-center gap-2 text-[13px] text-text-primary">
          <input id={`${ids}-tous`} type="radio" name={`${ids}-qui`} checked={!certains} onChange={choisirTous} className="h-4 w-4 accent-accent" />
          {fr ? 'Tous les clients' : 'All clients'}
        </label>
        <label htmlFor={`${ids}-certains`} className="flex cursor-pointer items-center gap-2 text-[13px] text-text-primary">
          <input id={`${ids}-certains`} type="radio" name={`${ids}-qui`} checked={certains} onChange={choisirCertains} className="h-4 w-4 accent-accent" />
          {fr ? 'Seulement certains clients' : 'Only some clients'}
        </label>
      </div>

      {certains && (
        <div className="mt-3 space-y-3 border-l-2 border-border pl-3">
          <div>
            <p className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-text-primary">
              <span>{fr ? 'Inclure les clients qui remplissent' : 'Include clients who meet'}</span>
              <label htmlFor={`${ids}-mode`} className="sr-only">{fr ? 'Combien de conditions' : 'How many conditions'}</label>
              <select
                id={`${ids}-mode`} className={champSaisie} value={mode}
                onChange={(e) => emettre(inclure, exclure, e.target.value as ModeCiblage)} disabled={inclure.length < 2}
              >
                <option value="une">{fr ? 'au moins une' : 'at least one'}</option>
                <option value="toutes">{fr ? 'toutes' : 'all'}</option>
              </select>
              <span>{fr ? 'de ces conditions' : 'of these conditions'}</span>
            </p>
            {inclure.length === 0 && (
              <p className="mb-1.5 text-[11px] text-text-tertiary">
                {fr ? 'Aucune condition : tous les clients sont inclus.' : 'No condition: every client is included.'}
              </p>
            )}
            {lignes(inclure, (regles) => emettre(regles, exclure), 'inclure')}
            {!pleinInclure && (
              <button type="button" className={`${boutonDiscret} mt-1`} onClick={() => emettre([...inclure, ligneNeuve('etiquette')], exclure)}>
                <Plus size={13} aria-hidden="true" /> {fr ? 'Ajouter une condition' : 'Add a condition'}
              </button>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-text-primary">{fr ? 'Toujours exclure' : 'Always exclude'}</p>
            <p className="mb-1.5 text-[11px] text-text-tertiary">
              {fr ? 'Une seule de ces conditions suffit à écarter un client, même s’il est inclus plus haut.' : 'Any one of these conditions keeps a client out, even if included above.'}
            </p>
            {lignes(exclure, (regles) => emettre(inclure, regles), 'exclure')}
            {!pleinExclure && (
              <button type="button" className={`${boutonDiscret} mt-1`} onClick={() => emettre(inclure, [...exclure, ligneNeuve('etiquette')])}>
                <Plus size={13} aria-hidden="true" /> {fr ? 'Ajouter une exclusion' : 'Add an exclusion'}
              </button>
            )}
          </div>
        </div>
      )}

      <ul className="mt-3 space-y-1 text-[11px] text-text-secondary">
        <li className="flex items-start gap-1.5">
          <Lock size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{fr ? 'Toujours exclus : les clients désabonnés ou qui ont répondu STOP.' : 'Always excluded: clients who unsubscribed or replied STOP.'}</span>
        </li>
        {demandeAvis && (
          <li className="flex items-start gap-1.5">
            <Lock size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{fr ? 'Toujours exclus de cette demande d’avis : les clients marqués « Aucune demande d’avis ».' : 'Always excluded from this review request: clients marked “No review request”.'}</span>
          </li>
        )}
      </ul>

      {fautes.length > 0 && (
        <div role="alert" className="mt-3 rounded-lg border border-danger/40 bg-danger-light px-3 py-2 text-[12px] text-danger">
          {fautes.map((f) => <p key={f.fr}>{fr ? f.fr : f.en}</p>)}
        </div>
      )}

      <div className="mt-3 rounded-lg border border-border bg-surface-secondary px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p role="status" className="min-w-0 flex-1 text-[12px] text-text-primary">
            {etat === 'calcul' && (fr ? 'Calcul du nombre de clients…' : 'Counting clients…')}
            {etat === 'erreur' && (fr ? 'Compteur indisponible pour l’instant.' : 'Counter unavailable right now.')}
            {etat === 'pret' && apercu && (
              <>
                <strong className="font-semibold">
                  {apercu.tronque
                    ? (fr ? `Touche au moins ${total} clients` : `Reaches at least ${total} clients`)
                    : (fr ? `Touche ${total} client${apercu.total > 1 ? 's' : ''}` : `Reaches ${total} client${apercu.total === 1 ? '' : 's'}`)}
                </strong>
                {dont.length > 0 && ` · ${dont.join(' · ')}`}
              </>
            )}
          </p>
          {etat === 'pret' && apercu && apercu.total > 0 && (
            <button type="button" className={boutonDiscret} aria-expanded={listeOuverte} aria-controls={`${ids}-liste`} onClick={() => setListeOuverte((o) => !o)}>
              {listeOuverte ? (fr ? 'Masquer la liste' : 'Hide the list') : (fr ? 'Voir la liste' : 'See the list')}
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-text-tertiary">
          {etat === 'pret' && apercu?.tronque
            ? (fr
              ? `Le carnet compte plus de ${nombre(apercu.plafond, true)} clients : le compteur s’arrête là.`
              : `The client list has more than ${nombre(apercu.plafond, false)} clients: the counter stops there.`)
            : ciblageVide(propre)
              ? (fr ? 'Les clients du carnet aujourd’hui. Le message part quand l’événement arrive pour l’un d’eux.' : 'Clients in your list today. The message is sent when the event happens for one of them.')
              : (fr ? 'Les clients du carnet qui correspondent aujourd’hui — jugé de nouveau à chaque envoi. Le message part quand l’événement arrive pour l’un d’eux.' : 'Clients in your list who match today — checked again at every send. The message is sent when the event happens for one of them.')}
        </p>
        {listeOuverte && etat === 'pret' && apercu && (
          <div id={`${ids}-liste`} className="mt-2 border-t border-border pt-2">
            {apercu.apercu.length === 0 ? (
              <p className="text-[12px] text-text-tertiary">{fr ? 'Aucun de ces clients ne vous est visible.' : 'None of these clients is visible to you.'}</p>
            ) : (
              <ul className="space-y-0.5 text-[12px] text-text-primary">
                {apercu.apercu.map((c) => (
                  <li key={c.id}>
                    {c.nom}
                    {c.empechements.length > 0 && (
                      <span className="text-text-tertiary"> — {c.empechements.map((e) => LIBELLE_EMPECHEMENT[e][fr ? 0 : 1]).join(', ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {apercu.total > apercu.apercu.length && apercu.apercu.length > 0 && (
              <p className="mt-1 text-[11px] text-text-tertiary">
                {fr ? `Les ${apercu.apercu.length} premiers, par ordre alphabétique.` : `The first ${apercu.apercu.length}, in alphabetical order.`}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
