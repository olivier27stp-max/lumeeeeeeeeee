/* ═══════════════════════════════════════════════════════════════
   L'Historique et les Journaux des automatisations.

   C'est la réponse à la question qu'un entrepreneur pose vraiment :
   « pourquoi Mme Tremblay n'a pas eu son rappel ? »

   Deux vues, deux rôles (mission, point 5) :
   · HISTORIQUE — pour le propriétaire : une ligne par passage d'un client
     dans l'automatisation. Qui (lien vers sa fiche, et vers la facture, le
     devis ou le job), quand, quelle étape, et le résultat en clair
     (« Texto envoyé », « Ignoré : client désabonné », « Reporté au prochain
     créneau d'envoi »). Les automatisations immédiates y sont aussi, et ce
     qui est encore à venir (les envois prévus). Dans l'éditeur, la même vue
     donne l'historique des MODIFICATIONS : qui a changé quoi, et quand.
   · JOURNAUX — le détail technique : l'événement déclencheur, la décision
     (code d'issue), le résultat de chaque étape, l'erreur exacte, la durée,
     la clé d'exécution.

   Les deux se cherchent (nom du client), se filtrent (statut, dates,
   automatisation) et se paginent — côté serveur, avec le total affiché.
   Sans `ruleId`, la vue est celle de tout le BUREAU.

   Heures : dans le fuseau de l'ENTREPRISE (rendu par le serveur), jamais
   celui du navigateur ni Montréal en dur.
   ═══════════════════════════════════════════════════════════════ */

import React, { useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, Clock, Ban, RefreshCw, MinusCircle, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  lireJournaux, lireHistorique, lireModifications, FENETRE_JOURS,
  type LigneJournal, type Passage, type EvenementPassage, type FicheLiee, type LigneModification, type FiltresLecture,
} from '../../lib/automationJournauxApi';
import {
  FILTRES_STATUT, PERIODES_JOURS, libelleAction, libelleCategorie, libelleFiltreStatut, libelleIssue, libellePeriode,
  raisonLisible, resultatLisible, type FiltreStatut, type PeriodeJours,
} from '../../lib/automationIssues';
import { lirePeriodeChoisie, retenirPeriode } from '../../lib/automationStatsApi';
import { ACTION_REGLE_ECARTEE, trouverDeclencheur } from '../../lib/automationCatalogue';
import { useRafraichissementVisible } from '../../hooks/useRafraichissementVisible';

const PAR_PAGE = 50;

/** Le fuseau de l'entreprise, rendu par le serveur avec chaque lecture. */
const FuseauEntreprise = React.createContext('America/Montreal');

/** Une date lisible, dans le fuseau de l'ENTREPRISE. */
export function quand(iso: string | null | undefined, fr: boolean, fuseau: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(fr ? 'fr-CA' : 'en-CA', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: fuseau,
  });
}

/** La pastille d'une issue, avec son icône. */
function Pastille({ categorie, fr, libelle }: { categorie: string; fr: boolean; libelle?: string }) {
  const styles: Record<string, string> = {
    envoyee: 'bg-success-light text-success',
    action: 'bg-success-light text-success',
    echouee: 'bg-danger-light text-danger',
    ignoree: 'bg-surface-tertiary text-text-secondary',
    annulee: 'bg-surface-tertiary text-text-tertiary',
    reportee: 'bg-info-light text-info',
    en_cours: 'bg-surface-tertiary text-text-secondary',
    tentative: 'bg-surface-tertiary text-text-tertiary',
  };
  const Icone = categorie === 'envoyee' || categorie === 'action' ? CheckCircle2
    : categorie === 'echouee' ? XCircle
    : categorie === 'annulee' ? Ban
    : categorie === 'ignoree' ? MinusCircle
    : Clock;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
      styles[categorie] ?? 'bg-surface-tertiary text-text-secondary')}>
      <Icone size={11} aria-hidden="true" />
      {libelle ?? libelleCategorie(categorie, fr)}
    </span>
  );
}

/** L'état vide, qui dit aussi jusqu'où remontent les journaux. */
function Vide({ texte, fr }: { texte: string; fr: boolean }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-[13px] text-text-secondary">{texte}</p>
      <p className="mt-1 text-[11px] text-text-tertiary">
        {fr
          ? `Les journaux sont gardés ${FENETRE_JOURS} jours.`
          : `Logs are kept for ${FENETRE_JOURS} days.`}
      </p>
    </div>
  );
}

/** Une lecture en panne s'affiche comme une panne — jamais comme « rien à montrer ». */
function Panne({ texte, fr, onReessayer }: { texte: string; fr: boolean; onReessayer: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <p className="flex items-center gap-2 text-[13px] text-warning">
        <AlertTriangle size={15} aria-hidden="true" />
        {texte}
      </p>
      <button type="button" onClick={onReessayer} className="glass-button text-[12px]">
        {fr ? 'Réessayer' : 'Try again'}
      </button>
    </div>
  );
}

/** Le nom du client, cliquable quand sa fiche existe ; et la fiche concernée (facture, devis, job…). */
function CelluleClient({ clientId, nom, fiche, fr }: { clientId: string | null; nom: string | null; fiche: FicheLiee | null; fr: boolean }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <>
      {clientId && nom ? (
        <Link
          to={`/clients/${clientId}`}
          onClick={stop}
          onKeyDown={stop}
          className="font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {nom}
        </Link>
      ) : (
        <span className="text-text-tertiary">{nom || '—'}</span>
      )}
      {fiche && (
        <span className="mt-0.5 block text-[11px] text-text-tertiary">
          {fiche.lien ? (
            <Link
              to={fiche.lien}
              onClick={stop}
              onKeyDown={stop}
              className="hover:text-text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {libelleFiche(fiche, fr)}
            </Link>
          ) : libelleFiche(fiche, fr)}
        </span>
      )}
    </>
  );
}

/** « Facture 1042 », « Devis 17 », « Job 23 », « Rendez-vous ». */
export function libelleFiche(f: FicheLiee, fr: boolean): string {
  const noms: Record<string, [string, string]> = {
    invoice: ['Facture', 'Invoice'],
    quote: ['Devis', 'Quote'],
    job: ['Job', 'Job'],
    schedule_event: ['Rendez-vous', 'Appointment'],
    deal: ['Opportunité', 'Opportunity'],
  };
  const n = noms[f.type];
  const base = n ? (fr ? n[0] : n[1]) : (fr ? 'Fiche' : 'Record');
  const suite = f.numero ?? f.titre;
  return suite ? `${base} ${suite}` : base;
}

/** « Étape 2 · Texto » — le nom donné à l'étape dans l'éditeur s'il y en a un, jamais « e3 ». */
function etapeLisible(e: { step_id: string | null; etape_position: number | null; etape_nom: string | null; action_type: string }, fr: boolean): string {
  const nom = e.etape_nom || libelleAction(e.action_type, fr);
  if (!e.step_id) return nom;
  if (e.etape_position === null) return `${nom} (${fr ? 'étape retirée du parcours' : 'step removed from the workflow'})`;
  return `${fr ? 'Étape' : 'Step'} ${e.etape_position} · ${nom}`;
}

/** L'événement déclencheur, en mots : « Nouveau prospect ». */
function evenementLisible(cle: string | null, fr: boolean): string {
  if (!cle) return '—';
  if (cle === 'scheduled') return fr ? 'Étape planifiée (file d’attente)' : 'Scheduled step (queue)';
  if (cle === 'sequence') return fr ? 'Étape d’un parcours' : 'Workflow step';
  const d = trouverDeclencheur(cle);
  return d ? `${fr ? d.fr : d.en} (${cle})` : cle;
}

/**
 * CE QUI EST RÉELLEMENT PARTI, sous la ligne dépliée — puis le détail technique.
 *
 * Les journaux disaient « envoyé » sans jamais montrer le message.
 * Impossible pour un entrepreneur de vérifier que « [client_first_name] »
 * avait bien été remplacé par « Jean » — c'est pourtant la première
 * chose qu'on veut contrôler avant de publier. QA du 2026-09-25 (P1-4).
 *
 * On montre le contenu ENVOYÉ (`result_data`), et à défaut ce qui était
 * CONFIGURÉ (`action_config`) : un envoi échoué ou ignoré n'a pas le
 * premier, et c'est justement le message qui DEVAIT partir qu'on veut lire.
 */
function DetailEnvoi({ ligne, fr }: { ligne: LigneJournal; fr: boolean }) {
  const fuseau = useContext(FuseauEntreprise);
  /** Les champs qui intéressent vraiment, dans l'ordre où on les lit. */
  const LIBELLES: Record<string, { fr: string; en: string }> = {
    to: { fr: 'Destinataire', en: 'To' },
    subject: { fr: 'Objet', en: 'Subject' },
    body: { fr: 'Message', en: 'Message' },
    message: { fr: 'Message', en: 'Message' },
    title: { fr: 'Titre', en: 'Title' },
  };
  /** Déjà dits par la décision et le détail technique : pas deux fois, et jamais en clés brutes. */
  const DEJA_DITS = new Set(['saute', 'saute_code', 'condition', 'recu', 'attendu']);

  const parti = ligne.categorie === 'envoyee' || ligne.categorie === 'action';
  const envoye = ligne.result_data ?? {};
  // Le gabarit configuré : `config` d'une action de la file, ou la configuration elle-même.
  const brute = ligne.action_config ?? {};
  const configure = (typeof brute.config === 'object' && brute.config !== null ? brute.config : brute) as Record<string, unknown>;
  const source: Record<string, unknown> = parti ? envoye : { ...configure, ...envoye };

  const connus = Object.keys(LIBELLES).filter((c) => source[c] !== undefined && source[c] !== null && source[c] !== '');
  const autres = parti
    ? Object.keys(envoye).filter((c) => !(c in LIBELLES) && !DEJA_DITS.has(c) && envoye[c] !== null && envoye[c] !== '')
    : [];

  const recu = ligne.result_data?.recu;
  const attendu = ligne.result_data?.attendu;
  const condition = ligne.result_data?.condition;
  const erreurExacte = ligne.result_error ?? ligne.tache?.last_error ?? null;
  const technique: Array<[string, React.ReactNode]> = [
    [fr ? 'Événement déclencheur' : 'Trigger event', evenementLisible(ligne.trigger_event, fr)],
    [fr ? 'Décision' : 'Decision', (
      <>
        {ligne.categorie === 'ignoree' || ligne.categorie === 'annulee' || ligne.categorie === 'reportee'
          ? libelleIssue(ligne.issue, fr, typeof ligne.result_data?.saute === 'string' ? ligne.result_data.saute : ligne.tache?.last_error)
          : libelleCategorie(ligne.categorie, fr)}
        {' '}<code className="font-mono text-[11px] text-text-tertiary">({ligne.issue})</code>
      </>
    )],
  ];
  if (typeof condition === 'string' && condition) {
    technique.push([fr ? 'Condition non remplie' : 'Condition not met', (
      <>
        {condition}
        {recu !== undefined && (
          <span className="text-text-tertiary">
            {fr ? ' — reçu : ' : ' — received: '}{String(recu)}
            {attendu !== undefined && (fr ? ` ; attendu : ${typeof attendu === 'object' ? JSON.stringify(attendu) : String(attendu)}` : `; expected: ${typeof attendu === 'object' ? JSON.stringify(attendu) : String(attendu)}`)}
          </span>
        )}
      </>
    )]);
  }
  if (ligne.step_id) technique.push([fr ? 'Étape' : 'Step', etapeLisible(ligne, fr)]);
  if (ligne.fiche) technique.push([fr ? 'Fiche' : 'Record', libelleFiche(ligne.fiche, fr)]);
  if (ligne.source === 'journal' && ligne.duration_ms !== null) technique.push([fr ? 'Durée' : 'Duration', `${ligne.duration_ms} ms`]);
  if (ligne.tache) {
    technique.push([fr ? 'File d’attente' : 'Queue', (
      <>
        {fr
          ? { pending: 'en attente', running: 'en cours', completed: 'terminée', failed: 'en échec', cancelled: 'annulée' }[ligne.tache.status] ?? ligne.tache.status
          : { pending: 'pending', running: 'running', completed: 'completed', failed: 'failed', cancelled: 'cancelled' }[ligne.tache.status] ?? ligne.tache.status}
        {(ligne.tache.status === 'pending' || ligne.tache.status === 'running') && (fr ? ` — prévue le ${quand(ligne.tache.execute_at, true, fuseau)}` : ` — due ${quand(ligne.tache.execute_at, false, fuseau)}`)}
        {ligne.tache.attempts > 1 && (fr ? ` — ${ligne.tache.attempts} tentatives` : ` — ${ligne.tache.attempts} attempts`)}
      </>
    )]);
  }
  if (ligne.execution_key) technique.push([fr ? 'Clé d’exécution' : 'Execution key', <code className="break-all font-mono text-[11px]">{ligne.execution_key}</code>]);
  if (erreurExacte && ligne.categorie !== 'envoyee' && ligne.categorie !== 'action') {
    technique.push([fr ? 'Texte exact du moteur' : 'Exact engine text', <code className="whitespace-pre-wrap break-words font-mono text-[11px]">{erreurExacte}</code>]);
  }

  /** L'événement a été écarté AVANT toute action (conditions, hors ciblage…) : il n'y a pas de message à montrer. */
  const ecarte = ligne.action_type === ACTION_REGLE_ECARTEE;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
          {ecarte
            ? (fr ? 'Aucune action lancée' : 'No action started')
            : parti ? (fr ? 'Ce qui est parti' : 'What was sent') : (fr ? 'Rien n’est parti — le message prévu' : 'Nothing was sent — the planned message')}
        </p>
        {ecarte ? (
          <p className="text-[12px] text-text-secondary">
            {fr
              ? 'L’automatisation a vu l’événement et l’a écarté : ses conditions n’étaient pas remplies pour cette fiche.'
              : 'The automation saw the event and set it aside: its conditions were not met for this record.'}
          </p>
        ) : connus.length === 0 && autres.length === 0 ? (
          <p className="text-[12px] text-text-tertiary">
            {fr
              ? 'Le contenu de cette étape n’a pas été conservé.'
              : 'The content of this step was not kept.'}
          </p>
        ) : (
          <dl className="space-y-2 text-[12px]">
            {connus.map((cle) => (
              <div key={cle}>
                <dt className="font-medium text-text-secondary">{fr ? LIBELLES[cle].fr : LIBELLES[cle].en}</dt>
                <dd className="whitespace-pre-wrap break-words text-text-primary">{String(source[cle])}</dd>
              </div>
            ))}
            {autres.length > 0 && (
              <div>
                <dt className="font-medium text-text-secondary">{fr ? 'Autres données' : 'Other data'}</dt>
                <dd className="whitespace-pre-wrap break-words font-mono text-[11px] text-text-tertiary">
                  {autres.map((c) => `${c}: ${typeof envoye[c] === 'object' ? JSON.stringify(envoye[c]) : String(envoye[c])}`).join(String.fromCharCode(10))}
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
          {fr ? 'Détail technique' : 'Technical detail'}
        </p>
        <dl className="space-y-1.5 text-[12px]">
          {technique.map(([libelle, valeur]) => (
            <div key={libelle} className="flex gap-2">
              <dt className="w-[150px] shrink-0 text-text-secondary">{libelle}</dt>
              <dd className="min-w-0 break-words text-text-primary">{valeur}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// ── Filtres, pagination, lecture ────────────────────────────

export interface RegleDuFiltre { id: string; nom: string }

interface EtatFiltres {
  jours: PeriodeJours;
  statut: FiltreStatut | '';
  action: string;
  du: string;
  au: string;
  recherche: string;
  regle: string;
  page: number;
}

/** Les filtres d'une vue, la recherche tapée étant appliquée après une courte pause. */
function useFiltres(regleInitiale = '') {
  const [f, setF] = useState<EtatFiltres>(() => ({
    jours: lirePeriodeChoisie(), statut: '', action: '', du: '', au: '', recherche: '', regle: regleInitiale, page: 1,
  }));
  const [saisie, setSaisie] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setF((x) => (x.recherche === saisie.trim() ? x : { ...x, recherche: saisie.trim(), page: 1 })), 350);
    return () => window.clearTimeout(t);
  }, [saisie]);
  /** Tout changement de filtre ramène à la première page. */
  const changer = (patch: Partial<EtatFiltres>) => setF((x) => ({ ...x, page: 1, ...patch }));
  return { f, changer, saisie, setSaisie, allerPage: (page: number) => setF((x) => ({ ...x, page })) };
}

function BarreFiltres({
  ids, fr, f, changer, saisie, setSaisie, statuts, actions, regles, enRafraichissement, onRafraichir,
}: {
  ids: string;
  fr: boolean;
  f: EtatFiltres;
  changer: (patch: Partial<EtatFiltres>) => void;
  saisie: string;
  setSaisie: (v: string) => void;
  statuts: FiltreStatut[];
  /** Les types d'action présents (Journaux seulement). */
  actions?: string[];
  /** Les automatisations du bureau (vue du bureau seulement). */
  regles?: RegleDuFiltre[];
  enRafraichissement: boolean;
  onRafraichir: () => void;
}) {
  const etiquette = 'text-[12px] text-text-secondary';
  const champ = 'glass-input py-1 text-[12px]';
  return (
    <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-2">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={`${ids}-periode`} className={etiquette}>{fr ? 'Période' : 'Period'}</label>
        <select
          id={`${ids}-periode`}
          value={f.jours}
          onChange={(e) => { const j = Number(e.target.value) as PeriodeJours; retenirPeriode(j); changer({ jours: j }); }}
          className={champ}
        >
          {PERIODES_JOURS.map((j) => <option key={j} value={j}>{libellePeriode(j, fr)}</option>)}
        </select>
      </div>

      {regles && (
        <div className="flex flex-col gap-0.5">
          <label htmlFor={`${ids}-regle`} className={etiquette}>{fr ? 'Automatisation' : 'Automation'}</label>
          <select id={`${ids}-regle`} value={f.regle} onChange={(e) => changer({ regle: e.target.value })} className={cn(champ, 'max-w-[240px]')}>
            <option value="">{fr ? 'Toutes les automatisations' : 'All automations'}</option>
            {regles.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        <label htmlFor={`${ids}-client`} className={etiquette}>{fr ? 'Client' : 'Client'}</label>
        <input
          id={`${ids}-client`}
          type="search"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder={fr ? 'Nom du client' : 'Client name'}
          maxLength={80}
          className={cn(champ, 'w-[170px]')}
        />
      </div>

      <div className="flex flex-col gap-0.5">
        <label htmlFor={`${ids}-statut`} className={etiquette}>{fr ? 'Statut' : 'Status'}</label>
        <select id={`${ids}-statut`} value={f.statut} onChange={(e) => changer({ statut: e.target.value as FiltreStatut | '' })} className={champ}>
          <option value="">{fr ? 'Tous les statuts' : 'All statuses'}</option>
          {statuts.map((s) => <option key={s} value={s}>{libelleFiltreStatut(s, fr)}</option>)}
        </select>
      </div>

      {actions && (
        <div className="flex flex-col gap-0.5">
          <label htmlFor={`${ids}-action`} className={etiquette}>{fr ? 'Action' : 'Action'}</label>
          <select id={`${ids}-action`} value={f.action} onChange={(e) => changer({ action: e.target.value })} className={champ}>
            <option value="">{fr ? 'Toutes les actions' : 'All actions'}</option>
            {/* L'action filtrée reste proposée même si la page courante n'en a plus. */}
            {[...new Set([...actions, ...(f.action ? [f.action] : [])])].map((a) => (
              <option key={a} value={a}>{libelleAction(a, fr)}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        <label htmlFor={`${ids}-du`} className={etiquette}>{fr ? 'Du' : 'From'}</label>
        <input id={`${ids}-du`} type="date" value={f.du} max={f.au || undefined} onChange={(e) => changer({ du: e.target.value })} className={champ} />
      </div>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={`${ids}-au`} className={etiquette}>{fr ? 'Au' : 'To'}</label>
        <input id={`${ids}-au`} type="date" value={f.au} min={f.du || undefined} onChange={(e) => changer({ au: e.target.value })} className={champ} />
      </div>

      <button
        type="button"
        onClick={onRafraichir}
        disabled={enRafraichissement}
        className="glass-button inline-flex items-center gap-1.5 text-[12px] disabled:opacity-60"
      >
        <RefreshCw size={12} className={enRafraichissement ? 'animate-spin' : undefined} aria-hidden="true" />
        {fr ? 'Actualiser' : 'Refresh'}
      </button>
    </div>
  );
}

/** « 1 à 50 sur 230 », et les pages. Le total vient de la base, pas des lignes chargées. */
function Pagination({ fr, total, page, parPage, allerPage, unite }: {
  fr: boolean; total: number; page: number; parPage: number; allerPage: (p: number) => void; unite: [string, string];
}) {
  const pages = Math.max(1, Math.ceil(total / parPage));
  const de = total === 0 ? 0 : (page - 1) * parPage + 1;
  const a = Math.min(total, page * parPage);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-text-tertiary">
      <span className="ml-auto" aria-live="polite">
        {total <= parPage
          ? `${total} ${fr ? unite[0] : unite[1]}`
          : fr ? `${de} à ${a} sur ${total} ${unite[0]}` : `${de} to ${a} of ${total} ${unite[1]}`}
      </span>
      {pages > 1 && (
        <>
          <button type="button" onClick={() => allerPage(page - 1)} disabled={page <= 1} className="glass-button px-2 py-1 text-[12px] disabled:opacity-50">
            {fr ? 'Précédent' : 'Previous'}
          </button>
          <span>{fr ? `Page ${page} sur ${pages}` : `Page ${page} of ${pages}`}</span>
          <button type="button" onClick={() => allerPage(page + 1)} disabled={page >= pages} className="glass-button px-2 py-1 text-[12px] disabled:opacity-50">
            {fr ? 'Suivant' : 'Next'}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Une lecture qui se tient à jour : chargement visible au premier affichage et à chaque
 * changement de filtre, puis relectures SILENCIEUSES (retour sur l'onglet, minuterie, bouton).
 * Seule la dernière demande a le droit d'écrire l'écran.
 */
function useLecture<T>(lire: () => Promise<T>, messagePanne: string) {
  const [donnees, setDonnees] = useState<T | null>(null);
  const [chargement, setChargement] = useState(true);
  const [rafraichissement, setRafraichissement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const numero = useRef(0);

  const charger = useCallback(async (silencieux: boolean) => {
    const moi = ++numero.current;
    if (silencieux) setRafraichissement(true); else setChargement(true);
    try {
      const d = await lire();
      if (moi !== numero.current) return;
      setDonnees(d);
      setErreur(null);
    } catch (e: unknown) {
      if (moi !== numero.current) return;
      console.error('[automatisations] lecture échouée', e instanceof Error ? e.message : String(e));
      // Une relecture silencieuse ratée garde les lignes déjà à l'écran — mais le dit.
      setErreur(messagePanne);
      if (!silencieux) setDonnees(null);
    } finally {
      if (moi === numero.current) { setChargement(false); setRafraichissement(false); }
    }
  }, [lire, messagePanne]);

  useEffect(() => { void charger(false); }, [charger]);
  useRafraichissementVisible(() => { if (!chargement) void charger(true); }, 60_000);

  return { donnees, chargement, rafraichissement, erreur, rafraichir: () => void charger(true), recharger: () => void charger(false) };
}

const filtresServeur = (f: EtatFiltres, ruleId: string | undefined): FiltresLecture => ({
  ruleId: ruleId ?? (f.regle || null),
  jours: f.jours,
  du: f.du || null,
  au: f.au || null,
  statut: f.statut || null,
  action: f.action || null,
  recherche: f.recherche || null,
  page: f.page,
  parPage: PAR_PAGE,
});

// ═══════════════════════════════════════════════════════════════
// JOURNAUX — le détail technique
// ═══════════════════════════════════════════════════════════════

export function OngletJournaux({ ruleId, fr, regles, regleInitiale }: {
  /** Absent : les journaux de tout le bureau. */
  ruleId?: string;
  fr: boolean;
  regles?: RegleDuFiltre[];
  regleInitiale?: string;
}) {
  const ids = useId();
  const { f, changer, saisie, setSaisie, allerPage } = useFiltres(regleInitiale);
  const lire = useCallback(() => lireJournaux(filtresServeur(f, ruleId)), [f, ruleId]);
  const { donnees, chargement, rafraichissement, erreur, rafraichir, recharger } = useLecture(
    lire, fr ? 'Les journaux n’ont pas pu être lus.' : 'Logs could not be read.',
  );
  const lignes = donnees?.lignes ?? [];
  const fuseau = donnees?.periode.fuseau ?? 'America/Montreal';
  const bureau = !ruleId;

  /*
   * Quelle ligne est dépliée. Les journaux étaient une liste MORTE :
   * on voyait « envoyé » sans jamais pouvoir lire ce qui était parti.
   * L'entrepreneur ne pouvait donc pas vérifier que ses variables
   * avaient été remplacées — QA du 2026-09-25 (P1-4).
   */
  const [depliee, setDepliee] = useState<string | null>(null);
  const colonnes = bureau ? 5 : 4;

  return (
    <div className="mx-auto max-w-[1100px] p-5">
      <h2 className="text-[15px] font-semibold text-text-primary">
        {fr ? 'Journaux d’exécution' : 'Execution logs'}
      </h2>
      <p className="mt-0.5 text-[12px] text-text-secondary">
        {fr
          ? 'Le détail technique : chaque action exécutée, ignorée, reportée ou en échec, avec sa raison exacte.'
          : 'The technical detail: every action that ran, was skipped, postponed or failed, with its exact reason.'}
      </p>

      <BarreFiltres
        ids={ids} fr={fr} f={f} changer={changer} saisie={saisie} setSaisie={setSaisie}
        statuts={Object.keys(FILTRES_STATUT) as FiltreStatut[]}
        actions={donnees?.actions ?? []}
        regles={bureau ? regles : undefined}
        enRafraichissement={rafraichissement}
        onRafraichir={rafraichir}
      />
      <Pagination fr={fr} total={donnees?.total ?? 0} page={f.page} parPage={PAR_PAGE} allerPage={allerPage} unite={['ligne(s)', 'row(s)']} />

      {erreur && donnees && (
        <p role="alert" className="mt-2 flex items-center gap-2 text-[12px] text-warning">
          <AlertTriangle size={13} aria-hidden="true" />
          {fr ? 'La dernière mise à jour a échoué : ces lignes datent de la lecture précédente.' : 'The last refresh failed: these rows are from the previous read.'}
        </p>
      )}

      <div className="section-card mt-2 overflow-hidden">
        {chargement ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-hidden="true" />
          </div>
        ) : erreur && !donnees ? (
          <Panne texte={erreur} fr={fr} onReessayer={recharger} />
        ) : lignes.length === 0 ? (
          <Vide texte={fr ? 'Aucun journal pour ces filtres.' : 'No logs for these filters.'} fr={fr} />
        ) : (
          <FuseauEntreprise.Provider value={fuseau}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-outline/40 text-left text-[12px] text-text-secondary">
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Client' : 'Contact'}</th>
                  {bureau && <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Automatisation' : 'Automation'}</th>}
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Action' : 'Action'}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Statut' : 'Status'}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Exécuté le' : 'Executed on'}</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => {
                  const detail = typeof l.result_data?.saute === 'string' ? l.result_data.saute : (l.result_error ?? l.tache?.last_error ?? null);
                  // La RAISON, pas seulement « échoué » : c'est ce qui dit à l'entrepreneur quoi corriger.
                  const raison = l.categorie === 'envoyee' || l.categorie === 'action'
                    ? null
                    : resultatLisible({ issue: l.issue, categorie: l.categorie, action_type: l.action_type, detail }, fr);
                  return (
                    <React.Fragment key={l.id}>
                    <tr
                      className="cursor-pointer border-b border-outline/20 transition-colors last:border-0 hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      onClick={() => setDepliee((d) => (d === l.id ? null : l.id))}
                      onKeyDown={(e) => {
                        // Une ligne qu'on ne peut ouvrir qu'à la souris exclut
                        // qui navigue au clavier — et le cliquet d'accessibilité
                        // le refuse (à juste titre).
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setDepliee((d) => (d === l.id ? null : l.id));
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-expanded={depliee === l.id}
                    >
                      <td className="px-4 py-2.5 text-text-primary">
                        <CelluleClient clientId={l.client_id} nom={l.client_nom} fiche={l.fiche} fr={fr} />
                      </td>
                      {bureau && (
                        <td className="px-4 py-2.5 text-text-secondary">
                          <Link
                            to={`/automations/${l.rule_id}`}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            className="hover:text-text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            {l.rule_nom ?? '—'}
                          </Link>
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-text-secondary">{etapeLisible(l, fr)}</td>
                      <td className="px-4 py-2.5">
                        <Pastille categorie={l.categorie} fr={fr} />
                        {raison && (
                          <span className={cn('mt-0.5 block text-[11px]', l.categorie === 'echouee' ? 'text-danger' : 'text-text-tertiary')}>
                            {raison}
                            {l.categorie === 'en_cours' && l.tache && (l.tache.status === 'pending' || l.tache.status === 'running')
                              && (fr ? ` — prévu le ${quand(l.tache.execute_at, true, fuseau)}` : ` — due ${quand(l.tache.execute_at, false, fuseau)}`)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary">{quand(l.quand, fr, fuseau)}</td>
                    </tr>
                    {depliee === l.id && (
                      <tr className="border-b border-outline/20 bg-surface-secondary">
                        <td colSpan={colonnes} className="px-4 py-3">
                          <DetailEnvoi ligne={l} fr={fr} />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          </FuseauEntreprise.Provider>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HISTORIQUE — une ligne par passage d'un client
// ═══════════════════════════════════════════════════════════════

/** L'événement qui dit le résultat d'un passage, et sa phrase. */
function resumePassage(p: Passage, fr: boolean, fuseau: string): { evenement: EvenementPassage | null; phrase: string } {
  const evs = p.evenements ?? [];
  const dernier = <T,>(liste: T[]) => (liste.length ? liste[liste.length - 1] : null);

  if (p.resultat === 'en_cours') {
    const enFile = dernier(evs.filter((e) => e.en_file));
    if (!enFile) return { evenement: dernier(evs), phrase: fr ? 'En cours' : 'In progress' };
    const prevu = fr ? `prévu le ${quand(enFile.execute_at, true, fuseau)}` : `due ${quand(enFile.execute_at, false, fuseau)}`;
    // Reporté (heures d'envoi, rafale) : la raison de l'attente, celle de la tâche ou de la ligne du journal.
    const report = enFile.categorie === 'reportee' ? enFile : dernier(evs.filter((e) => e.categorie === 'reportee'));
    if (report) return { evenement: enFile, phrase: `${resultatLisible(report, fr)} — ${prevu}` };
    if (evs.some((e) => e.issue === 'en_reprise')) {
      return { evenement: enFile, phrase: `${resultatLisible({ issue: 'en_reprise', categorie: 'en_cours' }, fr)} — ${prevu}` };
    }
    return { evenement: enFile, phrase: fr ? `À venir : ${etapeLisible(enFile, true)}, ${prevu}` : `Upcoming: ${etapeLisible(enFile, false)}, ${prevu}` };
  }
  const decisif = dernier(evs.filter((e) => e.categorie === p.resultat)) ?? dernier(evs);
  return { evenement: decisif, phrase: decisif ? resultatLisible(decisif, fr) : libelleCategorie(p.resultat, fr) };
}

function VuePassages({ ruleId, fr, regles, regleInitiale }: { ruleId?: string; fr: boolean; regles?: RegleDuFiltre[]; regleInitiale?: string }) {
  const ids = useId();
  const { f, changer, saisie, setSaisie, allerPage } = useFiltres(regleInitiale);
  const lire = useCallback(() => lireHistorique(filtresServeur(f, ruleId)), [f, ruleId]);
  const { donnees, chargement, rafraichissement, erreur, rafraichir, recharger } = useLecture(
    lire, fr ? 'L’historique n’a pas pu être lu.' : 'History could not be read.',
  );
  const passages = donnees?.passages ?? [];
  const fuseau = donnees?.periode.fuseau ?? 'America/Montreal';
  const bureau = !ruleId;
  const [deplie, setDeplie] = useState<string | null>(null);
  const colonnes = bureau ? 5 : 4;

  return (
    <>
      <BarreFiltres
        ids={ids} fr={fr} f={f} changer={changer} saisie={saisie} setSaisie={setSaisie}
        statuts={['reussis', 'ignores', 'reportes', 'echoues', 'en_cours']}
        regles={bureau ? regles : undefined}
        enRafraichissement={rafraichissement}
        onRafraichir={rafraichir}
      />
      <Pagination fr={fr} total={donnees?.total ?? 0} page={f.page} parPage={PAR_PAGE} allerPage={allerPage} unite={['passage(s)', 'run(s)']} />

      {erreur && donnees && (
        <p role="alert" className="mt-2 flex items-center gap-2 text-[12px] text-warning">
          <AlertTriangle size={13} aria-hidden="true" />
          {fr ? 'La dernière mise à jour a échoué : ces lignes datent de la lecture précédente.' : 'The last refresh failed: these rows are from the previous read.'}
        </p>
      )}

      <div className="section-card mt-2 overflow-hidden">
        {chargement ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-hidden="true" />
          </div>
        ) : erreur && !donnees ? (
          <Panne texte={erreur} fr={fr} onReessayer={recharger} />
        ) : passages.length === 0 ? (
          <Vide texte={fr ? 'Aucun client n’est passé par ici pour ces filtres.' : 'No client went through here for these filters.'} fr={fr} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-outline/40 text-left text-[12px] text-text-secondary">
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Client' : 'Contact'}</th>
                  {bureau && <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Automatisation' : 'Automation'}</th>}
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Quand' : 'When'}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Étape' : 'Step'}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Résultat' : 'Result'}</th>
                </tr>
              </thead>
              <tbody>
                {passages.map((p) => {
                  const { evenement, phrase } = resumePassage(p, fr, fuseau);
                  const ouvert = deplie === p.cle;
                  const basculer = () => setDeplie((d) => (d === p.cle ? null : p.cle));
                  return (
                    <React.Fragment key={p.cle}>
                      <tr
                        className="cursor-pointer border-b border-outline/20 transition-colors last:border-0 hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                        onClick={basculer}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); basculer(); } }}
                        role="button"
                        tabIndex={0}
                        aria-expanded={ouvert}
                      >
                        <td className="px-4 py-2.5 text-text-primary">
                          <CelluleClient clientId={p.client_id} nom={p.client_nom} fiche={p.fiche} fr={fr} />
                        </td>
                        {bureau && (
                          <td className="px-4 py-2.5 text-text-secondary">
                            <Link
                              to={`/automations/${p.rule_id}`}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              className="hover:text-text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              {p.rule_nom ?? '—'}
                            </Link>
                          </td>
                        )}
                        <td className="px-4 py-2.5 text-text-secondary">{quand(p.debut, fr, fuseau)}</td>
                        <td className="px-4 py-2.5 text-text-secondary">{evenement ? etapeLisible(evenement, fr) : '—'}</td>
                        <td className="px-4 py-2.5">
                          <Pastille categorie={p.resultat} fr={fr} />
                          <span className={cn('mt-0.5 block text-[11px]', p.resultat === 'echouee' ? 'text-danger' : 'text-text-tertiary')}>{phrase}</span>
                        </td>
                      </tr>
                      {ouvert && (
                        <tr className="border-b border-outline/20 bg-surface-secondary">
                          <td colSpan={colonnes} className="px-4 py-3">
                            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                              {fr ? 'Le passage, étape par étape' : 'The run, step by step'}
                            </p>
                            <ol className="space-y-1.5 text-[12px]">
                              {p.evenements.map((e) => (
                                <li key={`${e.id}:${e.issue}`} className="flex flex-wrap items-baseline gap-x-2">
                                  <span className="w-[150px] shrink-0 tabular-nums text-text-tertiary">{quand(e.quand, fr, fuseau)}</span>
                                  <span className="text-text-secondary">{etapeLisible(e, fr)}</span>
                                  <span className={e.categorie === 'echouee' ? 'text-danger' : 'text-text-primary'}>
                                    {resultatLisible(e, fr)}
                                    {e.en_file && e.execute_at && (fr ? ` — prévu le ${quand(e.execute_at, true, fuseau)}` : ` — due ${quand(e.execute_at, false, fuseau)}`)}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// MODIFICATIONS — qui a changé quoi, et quand
// ═══════════════════════════════════════════════════════════════

const majuscule = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** « Marie », « Lumi, à la demande de Marie », « le système ». */
function auteurLisible(m: LigneModification, fr: boolean): string {
  if (m.origine === 'lumi') {
    return m.auteur_nom ? (fr ? `Lumi, à la demande de ${m.auteur_nom}` : `Lumi, at ${m.auteur_nom}’s request`) : 'Lumi';
  }
  if (m.origine === 'systeme') return fr ? 'le système' : 'the system';
  return m.auteur_nom ?? (fr ? 'un membre de l’équipe' : 'a team member');
}

interface ActionLue { type?: string; config?: Record<string, unknown> }
interface EtapeLue { type?: string; action?: ActionLue; delai_secondes?: number; nom?: string | null }

function dureeLisible(secondes: unknown, fr: boolean): string {
  const s = Math.abs(Number(secondes) || 0);
  if (s === 0) return fr ? 'immédiatement' : 'immediately';
  const u = (n: number, f: string, e: string) => `${n} ${fr ? f : e}${n > 1 ? 's' : ''}`;
  if (s % 86_400 === 0) return u(s / 86_400, 'jour', 'day');
  if (s % 3_600 === 0) return u(s / 3_600, 'heure', 'hour');
  if (s % 60 === 0) return u(s / 60, 'minute', 'minute');
  return u(s, 'seconde', 'second');
}

function actionLisible(a: ActionLue | undefined, fr: boolean): string {
  const nom = libelleAction(a?.type ?? '', fr);
  const c = a?.config ?? {};
  const texte = [c.subject, c.title, c.body ?? c.message].filter((v) => typeof v === 'string' && v).join(' — ');
  return texte ? `${nom} : « ${texte} »` : nom;
}

/** La valeur d'un champ modifié, en mots (les messages en entier : c'est ce qu'on vient relire). */
function valeurLisible(champ: string, v: unknown, fr: boolean): string {
  if (v === null || v === undefined || v === '') return '—';
  if (champ === 'is_active') return v === true ? (fr ? 'Publiée' : 'Published') : (fr ? 'Brouillon' : 'Draft');
  if (champ === 'delay_seconds') return dureeLisible(v, fr);
  if (champ === 'trigger_event') {
    const d = trouverDeclencheur(String(v));
    return d ? (fr ? d.fr : d.en) : String(v);
  }
  if (champ === 'actions' && Array.isArray(v)) {
    return (v as ActionLue[]).map((a, i) => `${i + 1}. ${actionLisible(a, fr)}`).join('\n') || '—';
  }
  if (champ === 'steps' && Array.isArray(v)) {
    return (v as EtapeLue[]).map((e, i) => {
      if (e.type === 'action') return `${i + 1}. ${e.nom ? `${e.nom} — ` : ''}${actionLisible(e.action, fr)}`;
      if (e.type === 'attendre') return `${i + 1}. ${fr ? 'Attendre' : 'Wait'} ${dureeLisible(e.delai_secondes, fr)}`;
      if (e.type === 'si') return `${i + 1}. ${fr ? 'Condition' : 'Condition'}`;
      if (e.type === 'arreter') return `${i + 1}. ${fr ? 'Arrêter' : 'Stop'}`;
      return `${i + 1}. ${fr ? 'Étape' : 'Step'}`;
    }).join('\n') || '—';
  }
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function libelleChamp(champ: string, fr: boolean): string {
  const l: Record<string, [string, string]> = {
    name: ['Nom', 'Name'],
    trigger_event: ['Déclencheur', 'Trigger'],
    conditions: ['Conditions', 'Conditions'],
    delay_seconds: ['Délai', 'Delay'],
    actions: ['Actions', 'Actions'],
    steps: ['Parcours', 'Workflow'],
    settings: ['Réglages', 'Settings'],
    is_active: ['Statut', 'Status'],
    folder_id: ['Dossier', 'Folder'],
    deleted_at: ['Corbeille', 'Bin'],
  };
  const p = l[champ];
  return p ? (fr ? p[0] : p[1]) : champ;
}

export function VueModifications({ ruleId, fr }: { ruleId: string; fr: boolean }) {
  const [page, setPage] = useState(1);
  const lire = useCallback(() => lireModifications(ruleId, page), [ruleId, page]);
  const { donnees, chargement, erreur, recharger } = useLecture(
    lire, fr ? 'Les modifications n’ont pas pu être lues.' : 'Changes could not be read.',
  );
  const [ouverte, setOuverte] = useState<string | null>(null);
  const lignes = donnees?.lignes ?? [];
  // L'heure d'une modification est celle de qui la lit : c'est un geste de l'équipe, pas un envoi.
  const fuseau = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <>
      <Pagination fr={fr} total={donnees?.total ?? 0} page={page} parPage={donnees?.par_page ?? 25} allerPage={setPage} unite={['modification(s)', 'change(s)']} />
      <div className="section-card mt-2 overflow-hidden">
        {chargement ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-hidden="true" />
          </div>
        ) : erreur && !donnees ? (
          <Panne texte={erreur} fr={fr} onReessayer={recharger} />
        ) : lignes.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-[13px] text-text-secondary">{fr ? 'Aucune modification enregistrée.' : 'No change recorded.'}</p>
            <p className="mt-1 text-[11px] text-text-tertiary">
              {fr
                ? 'Chaque changement fait ici, par un membre de l’équipe ou par Lumi, apparaîtra dans cette liste. Gardé 12 mois.'
                : 'Every change made here, by a team member or by Lumi, will show in this list. Kept for 12 months.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-outline/20">
            {lignes.map((m) => (
              <li key={m.id} className="px-4 py-3">
                <p className="text-[13px] text-text-primary">{majuscule(fr ? m.resume_fr : m.resume_en)}</p>
                <p className="mt-0.5 text-[11px] text-text-tertiary">
                  {fr ? `Modifié par ${auteurLisible(m, true)}` : `Changed by ${auteurLisible(m, false)}`}
                  {' · '}{quand(m.created_at, fr, fuseau)}
                </p>
                {m.champs.length > 0 && (m.avant || m.apres) && (
                  <button
                    type="button"
                    onClick={() => setOuverte((o) => (o === m.id ? null : m.id))}
                    aria-expanded={ouverte === m.id}
                    className="mt-1 text-[11px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {ouverte === m.id ? (fr ? 'Masquer l’avant et l’après' : 'Hide before and after') : (fr ? 'Voir l’avant et l’après' : 'See before and after')}
                  </button>
                )}
                {ouverte === m.id && (
                  <div className="mt-2 space-y-2">
                    {m.champs.map((c) => (
                      <div key={c} className="grid gap-2 text-[12px] md:grid-cols-2">
                        <div>
                          <p className="font-medium text-text-secondary">{libelleChamp(c, fr)} — {fr ? 'avant' : 'before'}</p>
                          <p className="whitespace-pre-wrap break-words text-text-tertiary">{valeurLisible(c, m.avant?.[c], fr)}</p>
                        </div>
                        <div>
                          <p className="font-medium text-text-secondary">{libelleChamp(c, fr)} — {fr ? 'après' : 'after'}</p>
                          <p className="whitespace-pre-wrap break-words text-text-primary">{valeurLisible(c, m.apres?.[c], fr)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════

export function OngletHistorique({ ruleId, fr, regles, regleInitiale }: {
  /** Absent : l'historique de tout le bureau (sans la vue « Modifications », propre à une automatisation). */
  ruleId?: string;
  fr: boolean;
  regles?: RegleDuFiltre[];
  regleInitiale?: string;
}) {
  const [vue, setVue] = useState<'clients' | 'modifications'>('clients');
  const VUES = [
    { cle: 'clients' as const, fr: 'Clients', en: 'Clients' },
    { cle: 'modifications' as const, fr: 'Modifications', en: 'Changes' },
  ];

  return (
    <div className="mx-auto max-w-[1100px] p-5">
      <h2 className="text-[15px] font-semibold text-text-primary">
        {fr ? 'Historique' : 'History'}
      </h2>
      <p className="mt-0.5 text-[12px] text-text-secondary">
        {vue === 'clients'
          ? (fr
            ? 'Chaque client passé par ici : ce qu’il a reçu, ce qui a été ignoré et pourquoi, et ce qui est encore à venir.'
            : 'Every client that went through: what they received, what was skipped and why, and what is still to come.')
          : (fr
            ? 'Qui a modifié cette automatisation, quoi, et quand — un membre de l’équipe ou Lumi.'
            : 'Who changed this automation, what, and when — a team member or Lumi.')}
      </p>

      {ruleId && (
        <div role="tablist" aria-label={fr ? 'Vues de l’historique' : 'History views'} className="mt-3 inline-flex rounded-lg border border-outline/40 p-0.5">
          {VUES.map((v) => (
            <button
              key={v.cle}
              type="button"
              role="tab"
              aria-selected={vue === v.cle}
              onClick={() => setVue(v.cle)}
              className={cn(
                'rounded-md px-3 py-1 text-[12px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                vue === v.cle ? 'bg-surface-tertiary text-text-primary' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {fr ? v.fr : v.en}
            </button>
          ))}
        </div>
      )}

      {vue === 'modifications' && ruleId
        ? <VueModifications ruleId={ruleId} fr={fr} />
        : <VuePassages ruleId={ruleId} fr={fr} regles={regles} regleInitiale={regleInitiale} />}
    </div>
  );
}
