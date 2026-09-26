/* ═══════════════════════════════════════════════════════════════
   Les onglets « Historique » et « Journaux » de l'éditeur.

   C'est la réponse à la question qu'un entrepreneur pose vraiment :
   « pourquoi Mme Tremblay n'a pas eu son rappel ? »

   Les données étaient déjà là depuis des mois — le moteur écrit chaque
   action et chaque envoi prévu. Il manquait l'écran. Tant qu'il manquait,
   une automatisation cassée restait affichée « active » avec un badge vert,
   et personne n'apprenait que les clients n'avaient rien reçu.

   Structure reprise de GoHighLevel :
   · Historique  — Contact · Raison · Date · Étape · Statut · Prochaine exéc.
   · Journaux    — Contact · Action · Statut · Exécuté le
   Filtres par dates, par action et par statut ; fenêtre de 60 jours.
   ═══════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useId, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Clock, Ban } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  lireJournaux, lireInscriptions, libelleAction, libelleStatut, raisonLisible,
  FENETRE_JOURS,
  type LigneJournal, type LigneInscription,
} from '../../lib/automationJournauxApi';

/** Une date lisible, dans le fuseau du Québec. */
function quand(iso: string | null | undefined, fr: boolean): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(fr ? 'fr-CA' : 'en-CA', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Montreal',
  });
}

/** La pastille d'un statut, avec son icône. */
function Pastille({ statut, fr }: { statut: string; fr: boolean }) {
  const styles: Record<string, string> = {
    completed: 'bg-success-light text-success',
    pending: 'bg-surface-tertiary text-text-secondary',
    running: 'bg-info-light text-info',
    failed: 'bg-danger-light text-danger',
    cancelled: 'bg-surface-tertiary text-text-tertiary',
  };
  const Icone = statut === 'completed' ? CheckCircle2
    : statut === 'failed' ? XCircle
    : statut === 'cancelled' ? Ban
    : Clock;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
      styles[statut] ?? 'bg-surface-tertiary text-text-secondary')}>
      <Icone size={11} aria-hidden="true" />
      {libelleStatut(statut, fr)}
    </span>
  );
}

/** L'état vide, qui dit aussi la limite des 60 jours comme chez GHL. */
function Vide({ texte, fr }: { texte: string; fr: boolean }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-[13px] text-text-secondary">{texte}</p>
      <p className="mt-1 text-[11px] text-text-tertiary">
        {fr
          ? `Disponible sur les ${FENETRE_JOURS} derniers jours.`
          : `Available for the last ${FENETRE_JOURS} days.`}
      </p>
    </div>
  );
}

/**
 * CE QUI EST RÉELLEMENT PARTI, sous la ligne dépliée.
 *
 * Les journaux disaient « envoyé » sans jamais montrer le message.
 * Impossible pour un entrepreneur de vérifier que « [client_first_name] »
 * avait bien été remplacé par « Jean » — c'est pourtant la première
 * chose qu'on veut contrôler avant de publier. QA du 2026-09-25 (P1-4).
 *
 * On montre le contenu ENVOYÉ (`result_data`), et à défaut ce qui était
 * CONFIGURÉ (`action_config`) — les vieilles exécutions n'ont pas le
 * premier, et une ligne vide ne dirait rien à personne.
 */
function DetailEnvoi({ ligne, fr }: { ligne: LigneJournal; fr: boolean }) {
  const source = (ligne.result_data && Object.keys(ligne.result_data).length > 0)
    ? ligne.result_data
    : ligne.action_config;

  if (!source || Object.keys(source).length === 0) {
    return (
      <p className="text-[12px] text-text-tertiary">
        {fr
          ? 'Le contenu de cet envoi n’a pas été conservé (exécution antérieure au journal détaillé).'
          : 'The content of this run was not kept (it predates detailed logging).'}
      </p>
    );
  }

  /** Les champs qui intéressent vraiment, dans l'ordre où on les lit. */
  const LIBELLES: Record<string, { fr: string; en: string }> = {
    to: { fr: 'Destinataire', en: 'To' },
    subject: { fr: 'Objet', en: 'Subject' },
    body: { fr: 'Message', en: 'Message' },
    message: { fr: 'Message', en: 'Message' },
    title: { fr: 'Titre', en: 'Title' },
  };

  const connus = Object.keys(LIBELLES).filter((c) => source[c] !== undefined && source[c] !== null && source[c] !== '');
  const autres = Object.keys(source).filter((c) => !(c in LIBELLES) && source[c] !== null && source[c] !== '');

  return (
    <dl className="space-y-2 text-[12px]">
      {connus.map((cle) => (
        <div key={cle}>
          <dt className="font-medium text-text-secondary">{fr ? LIBELLES[cle].fr : LIBELLES[cle].en}</dt>
          <dd className="whitespace-pre-wrap break-words text-text-primary">{String(source[cle])}</dd>
        </div>
      ))}
      {autres.length > 0 && (
        <div>
          <dt className="font-medium text-text-secondary">{fr ? 'Autres détails' : 'Other details'}</dt>
          <dd className="whitespace-pre-wrap break-words font-mono text-[11px] text-text-tertiary">
            {autres.map((c) => `${c}: ${typeof source[c] === 'object' ? JSON.stringify(source[c]) : String(source[c])}`).join(String.fromCharCode(10))}
          </dd>
        </div>
      )}
    </dl>
  );
}

// ═══════════════════════════════════════════════════════════════

export function OngletJournaux({ ruleId, fr }: { ruleId: string; fr: boolean }) {
  const ids = useId();
  const [lignes, setLignes] = useState<LigneJournal[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [action, setAction] = useState('all');
  const [statut, setStatut] = useState<'all' | 'succes' | 'echec'>('all');

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      setLignes(await lireJournaux({ ruleId, action, statut }));
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      console.error('[journaux] lecture échouée', m);
      setErreur(fr ? 'Les journaux n’ont pas pu être lus.' : 'Logs could not be read.');
    } finally {
      setChargement(false);
    }
  }, [ruleId, action, statut, fr]);

  useEffect(() => { charger(); }, [charger]);

  /** Les types d'action réellement présents — pas une liste théorique. */
  const actions = [...new Set(lignes.map((l) => l.action_type))];

  /*
   * Quelle ligne est dépliée. Les journaux étaient une liste MORTE :
   * on voyait « envoyé » sans jamais pouvoir lire ce qui était parti.
   * L'entrepreneur ne pouvait donc pas vérifier que ses variables
   * avaient été remplacées — QA du 2026-09-25 (P1-4).
   */
  const [depliee, setDepliee] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-[1100px] p-5">
      <h2 className="text-[15px] font-semibold text-text-primary">
        {fr ? 'Journaux d’exécution' : 'Execution logs'}
      </h2>
      <p className="mt-0.5 text-[12px] text-text-secondary">
        {fr
          ? 'Tout ce que cette automatisation a exécuté, et ce qui a échoué.'
          : 'Everything this automation ran, and what failed.'}
      </p>

      {/* Filtres */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor={`${ids}-action`} className="text-[12px] text-text-secondary">
          {fr ? 'Action' : 'Action'}
        </label>
        <select
          id={`${ids}-action`}
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="glass-input py-1 text-[12px]"
        >
          <option value="all">{fr ? 'Toutes les actions' : 'All actions'}</option>
          {actions.map((a) => (
            <option key={a} value={a}>{libelleAction(a, fr)}</option>
          ))}
        </select>

        <label htmlFor={`${ids}-statut`} className="ml-2 text-[12px] text-text-secondary">
          {fr ? 'Statut' : 'Status'}
        </label>
        <select
          id={`${ids}-statut`}
          value={statut}
          onChange={(e) => setStatut(e.target.value as typeof statut)}
          className="glass-input py-1 text-[12px]"
        >
          <option value="all">{fr ? 'Tous les statuts' : 'All statuses'}</option>
          <option value="succes">{fr ? 'Réussis' : 'Succeeded'}</option>
          <option value="echec">{fr ? 'Échoués' : 'Failed'}</option>
        </select>

        <span className="ml-auto text-[12px] text-text-tertiary">
          {lignes.length} {fr ? 'ligne(s)' : 'row(s)'}
        </span>
      </div>

      <div className="section-card mt-3 overflow-hidden">
        {chargement ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-hidden="true" />
          </div>
        ) : erreur ? (
          <Vide texte={erreur} fr={fr} />
        ) : lignes.length === 0 ? (
          <Vide texte={fr ? 'Aucun journal.' : 'No logs found.'} fr={fr} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-outline/40 text-left text-[12px] text-text-secondary">
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Client' : 'Contact'}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Action' : 'Action'}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Statut' : 'Status'}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Exécuté le' : 'Executed on'}</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => {
                  const raison = raisonLisible(l.result_error, fr);
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
                        {l.client || <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary">{libelleAction(l.action_type, fr)}</td>
                      <td className="px-4 py-2.5">
                        <Pastille statut={l.result_success ? 'completed' : 'failed'} fr={fr} />
                        {/* La RAISON, pas seulement « échoué » : c'est ce qui
                            dit à l'entrepreneur quoi corriger. */}
                        {!l.result_success && raison && (
                          <span className="mt-0.5 block text-[11px] text-danger">{raison}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary">{quand(l.created_at, fr)}</td>
                    </tr>
                    {depliee === l.id && (
                      <tr className="border-b border-outline/20 bg-surface-secondary">
                        <td colSpan={4} className="px-4 py-3">
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
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════

export function OngletHistorique({ ruleId, fr }: { ruleId: string; fr: boolean }) {
  const ids = useId();
  const [lignes, setLignes] = useState<LigneInscription[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [statut, setStatut] = useState<'all' | 'pending' | 'completed' | 'failed' | 'cancelled'>('all');

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      setLignes(await lireInscriptions({ ruleId, statut }));
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      console.error('[historique] lecture échouée', m);
      setErreur(fr ? 'L’historique n’a pas pu être lu.' : 'History could not be read.');
    } finally {
      setChargement(false);
    }
  }, [ruleId, statut, fr]);

  useEffect(() => { charger(); }, [charger]);

  return (
    <div className="mx-auto max-w-[1100px] p-5">
      <h2 className="text-[15px] font-semibold text-text-primary">
        {fr ? 'Historique' : 'Enrollment history'}
      </h2>
      <p className="mt-0.5 text-[12px] text-text-secondary">
        {fr
          ? 'Les clients passés dans ce parcours, et où chacun en est.'
          : 'The clients that entered this path, and where each one stands.'}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor={`${ids}-h-statut`} className="text-[12px] text-text-secondary">
          {fr ? 'Statut' : 'Status'}
        </label>
        <select
          id={`${ids}-h-statut`}
          value={statut}
          onChange={(e) => setStatut(e.target.value as typeof statut)}
          className="glass-input py-1 text-[12px]"
        >
          <option value="all">{fr ? 'Tous' : 'All events'}</option>
          <option value="pending">{fr ? 'En attente' : 'Pending'}</option>
          <option value="completed">{fr ? 'Terminés' : 'Completed'}</option>
          <option value="failed">{fr ? 'Échoués' : 'Failed'}</option>
          <option value="cancelled">{fr ? 'Annulés' : 'Cancelled'}</option>
        </select>
        <span className="ml-auto text-[12px] text-text-tertiary">
          {lignes.length} {fr ? 'ligne(s)' : 'row(s)'}
        </span>
      </div>

      <div className="section-card mt-3 overflow-hidden">
        {chargement ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-hidden="true" />
          </div>
        ) : erreur ? (
          <Vide texte={erreur} fr={fr} />
        ) : lignes.length === 0 ? (
          <Vide texte={fr ? 'Aucune inscription.' : 'No enrollments found.'} fr={fr} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b border-outline/40 text-left text-[12px] text-text-secondary">
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Client' : 'Contact'}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Étape en cours' : 'Current action'}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Statut' : 'Status'}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Prévu le' : 'Next execution'}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{fr ? 'Terminé le' : 'Completed on'}</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => {
                  const raison = raisonLisible(l.last_error, fr);
                  return (
                    <tr key={l.id} className="border-b border-outline/20 last:border-0">
                      <td className="px-4 py-2.5 text-text-primary">
                        {l.client || <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary">
                        {libelleAction(l.action_config?.type ?? '', fr)}
                        {l.step_id && (
                          <span className="ml-1 text-[11px] text-text-tertiary">({l.step_id})</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Pastille statut={l.status} fr={fr} />
                        {raison && (
                          <span className="mt-0.5 block text-[11px] text-text-tertiary">{raison}</span>
                        )}
                        {l.attempts > 1 && (
                          <span className="mt-0.5 block text-[11px] text-text-tertiary">
                            {fr ? `${l.attempts} tentatives` : `${l.attempts} attempts`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary">{quand(l.execute_at, fr)}</td>
                      <td className="px-4 py-2.5 text-text-secondary">{quand(l.completed_at, fr)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
