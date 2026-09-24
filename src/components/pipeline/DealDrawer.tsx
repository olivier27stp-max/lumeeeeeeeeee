/**
 * Fiche d'un deal — popup CENTRÉ (et non plus un tiroir latéral) : un en-tête
 * toujours visible, puis des onglets Aperçu / Notes / Tâches / Activité / Lié.
 *
 * Tout ce qui est modifiable l'est EN PLACE : changer d'étape, d'assigné, de
 * source ou de contact ne demande jamais de quitter la fenêtre. Chaque écriture
 * est optimiste à l'affichage mais RÉVERSIBLE : si la base refuse, le champ
 * reprend sa valeur d'origine — un champ qui garde une valeur non enregistrée
 * ment à celui qui le lit.
 *
 * Ce qui reste HORS onglets, parce que c'est le conseil du moment et qu'il ne
 * doit pas se cacher derrière un clic : la guidance de l'étape (le « Path » de
 * Salesforce) et l'encart « Job à créer ».
 *
 * Le montant n'est jamais saisi sur le deal : il est DÉRIVÉ (job liée, devis
 * lié, ou dernier devis du client). La fiche affiche donc toujours d'où il
 * vient — un chiffre sans provenance se prend pour une promesse.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, ExternalLink, FileText, Hammer, MapPin, User, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import Modal from '../ui/Modal';
import SpecificNotes from '../SpecificNotes';
import CustomFieldsPanel from '../champs/CustomFieldsPanel';
import ActivityTimeline from '../ActivityTimeline';
import { useTranslation } from '../../i18n';
import { versDate } from '../../lib/dateSeule';
import {
  basculerTacheDeal, creerTacheDeal, deplacerDeal, estJobACreer, fetchElementsLies,
  fetchDossierClient, fetchHistorique, fetchRendezVousClient, fetchTachesDuDeal, majContactDuDeal, majRaisonPerte, majSourceDuDeal,
  abandonnerDeal, fetchRaisonsProposees, majDateFermeture, marquerPerdu, nomClient,
  type ContactClient, type Deal, type PipelineStage, type TacheDeal,
} from '../../lib/pipelineVentesApi';
import { LIBELLE_SOURCE, depuis, montant } from '../../lib/pipeline/presentation';
import type { DealSource } from '../../lib/pipeline/mockData';

interface Membre { id: string; name: string }

/** Provenance du montant affiché — calculée par `pipeline_montants` en base. */
export type MontantProvenance = 'job' | 'devis' | 'devis_client' | 'aucun';

type Onglet = 'lie' | 'apercu' | 'rdv' | 'taches' | 'notes' | 'paiements' | 'activite';

/**
 * Canaux proposés dans le sélecteur de source.
 *
 * `deals.source` est du texte LIBRE en base (aucune contrainte CHECK) : cette
 * liste n'est qu'une commodité de saisie. Une valeur venue d'ailleurs (import,
 * intégration) est ajoutée à la volée au sélecteur pour ne jamais être écrasée
 * par le simple fait d'ouvrir la fiche.
 */
const SOURCES_CONNUES = ['form_web', 'meta', 'manual', 'd2d'] as const;

/** Libellés des canaux absents de `LIBELLE_SOURCE` (qui ne couvre que la maquette). */
const LIBELLE_SOURCE_EXTRA: Record<string, { fr: string; en: string }> = {
  d2d: { fr: 'Porte-à-porte', en: 'Door to door' },
};

/** `deals.source` est du texte libre en base : un canal inconnu s'affiche tel quel. */
function libelleSource(source: string, fr: boolean): string {
  const connu = LIBELLE_SOURCE[source as DealSource] ?? LIBELLE_SOURCE_EXTRA[source];
  if (!connu) return source;
  return fr ? connu.fr : connu.en;
}

/** Délai entre la création du deal et le premier contact, en heures. */
function delaiPremierContactHeures(deal: Deal): number | null {
  if (!deal.first_contacted_at) return null;
  const ms = new Date(deal.first_contacted_at).getTime() - new Date(deal.created_at).getTime();
  return Math.max(0, ms / 3_600_000);
}

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[11px] text-text-tertiary shrink-0">{label}</span>
      <span className="text-[12px] text-text-primary text-right min-w-0 break-words">{children}</span>
    </div>
  );
}

/**
 * Champ texte sauvé au blur (le motif de ClientDetails).
 *
 * `valeur` est la vérité venue de la base : dès qu'elle change (rafraîchissement
 * du parent, ou remise en état après un échec), le champ la reprend. C'est ce
 * qui permet à l'appelant d'annuler une saisie refusée sans état supplémentaire.
 */
function ChampTexte({
  label, valeur, type = 'text', placeholder, indice, onEnregistrer,
}: {
  label: string;
  valeur: string;
  type?: 'text' | 'email' | 'tel';
  placeholder?: string;
  indice?: string;
  onEnregistrer: (valeur: string) => void;
}) {
  const id = useId();
  const [brouillon, setBrouillon] = useState(valeur);

  // La valeur de la base gagne toujours : elle vient d'un rafraîchissement
  // réussi, ou du retour en arrière après un refus.
  useEffect(() => { setBrouillon(valeur); }, [valeur]);

  return (
    <div>
      <label htmlFor={id} className="block text-[11px] text-text-tertiary mb-1">{label}</label>
      <input
        id={id}
        type={type}
        value={brouillon}
        placeholder={placeholder}
        onChange={(e) => setBrouillon(e.target.value)}
        onBlur={() => { if (brouillon !== valeur) onEnregistrer(brouillon); }}
        className="input-field w-full text-[12.5px]"
      />
      {indice && <p className="text-[10.5px] text-text-muted mt-1">{indice}</p>}
    </div>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">{titre}</h3>
      {children}
    </section>
  );
}

/** Ligne sobre quand un élément lié n'existe pas — jamais une section vide. */
function Vide({ texte }: { texte: string }) {
  return <p className="text-[12px] text-text-muted py-1">{texte}</p>;
}

// ── Onglet Tâches ───────────────────────────────────────────

function OngletTaches({ dealId, fr }: { dealId: string; fr: boolean }) {
  const client = useQueryClient();
  const idTitre = useId();
  const idEcheance = useId();
  const [titre, setTitre] = useState('');
  const [echeance, setEcheance] = useState('');
  const idTri = useId();
  const [tri, setTri] = useState<'echeance' | 'creation'>('echeance');

  const cle = useMemo(() => ['deal-taches', dealId], [dealId]);
  const { data: taches = [], isLoading } = useQuery({
    queryKey: cle,
    queryFn: () => fetchTachesDuDeal(dealId),
  });

  const creer = useMutation({
    mutationFn: () => creerTacheDeal(dealId, { title: titre.trim(), due_date: echeance || null }),
    onSuccess: () => {
      setTitre('');
      setEcheance('');
      void client.invalidateQueries({ queryKey: cle });
      toast.success(fr ? 'Tâche ajoutée.' : 'Task added.');
    },
    onError: (e: unknown) => {
      console.error('[DealDrawer] création de tâche', e);
      toast.error(e instanceof Error ? e.message : String(e));
    },
  });

  const basculer = useMutation({
    mutationFn: (v: { id: string; fait: boolean }) => basculerTacheDeal(v.id, v.fait),
    onSuccess: () => void client.invalidateQueries({ queryKey: cle }),
    onError: (e: unknown) => {
      console.error('[DealDrawer] bascule de tâche', e);
      toast.error(e instanceof Error ? e.message : String(e));
    },
  });

  /**
   * Les tâches triées.
   *
   * Les FAITES vont en bas quel que soit le tri : elles n'ont plus rien à
   * demander, et les laisser au milieu obligerait à sauter par-dessus pour
   * lire ce qui reste.
   */
  const tachesTriees = useMemo(() => {
    const cle = (t: TacheDeal) =>
      tri === 'creation' ? (t.created_at ?? '') : (t.due_date ?? '9999-12-31');
    return [...taches].sort((a, b) => {
      const faitA = a.status !== 'open' ? 1 : 0;
      const faitB = b.status !== 'open' ? 1 : 0;
      if (faitA !== faitB) return faitA - faitB;
      // Échéance : la plus proche d'abord. Création : la plus récente d'abord.
      return tri === 'creation' ? cle(b).localeCompare(cle(a)) : cle(a).localeCompare(cle(b));
    });
  }, [taches, tri]);

  const enRetard = (t: TacheDeal): boolean =>
    // `versDate` lit « 2026-09-04 » comme une date civile : `new Date()` en
    // ferait minuit UTC, soit la veille au Québec — une échéance d'aujourd'hui
    // passerait pour en retard (garde figé par tests/date-seule.test.ts).
    t.status === 'open' && !!t.due_date && versDate(t.due_date) < new Date();

  return (
    <>
      <Section titre={fr ? 'Ajouter une tâche' : 'Add a task'}>
        <form
          className="rounded-xl border border-outline bg-surface-card p-3 space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (titre.trim()) creer.mutate();
          }}
        >
          <div>
            <label htmlFor={idTitre} className="block text-[11px] text-text-tertiary mb-1">
              {fr ? 'Titre' : 'Title'}
            </label>
            <input
              id={idTitre}
              type="text"
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
              placeholder={fr ? 'Rappeler le client…' : 'Call the client back…'}
              className="input-field w-full text-[12.5px]"
            />
          </div>
          <div>
            <label htmlFor={idEcheance} className="block text-[11px] text-text-tertiary mb-1">
              {fr ? 'Échéance (optionnelle)' : 'Due date (optional)'}
            </label>
            <input
              id={idEcheance}
              type="date"
              value={echeance}
              onChange={(e) => setEcheance(e.target.value)}
              className="input-field w-full text-[12.5px]"
            />
          </div>
          <button
            type="submit"
            disabled={!titre.trim() || creer.isPending}
            className="btn-primary text-[12px] px-3 py-1.5 disabled:opacity-50"
          >
            {creer.isPending ? (fr ? 'Ajout…' : 'Adding…') : (fr ? 'Ajouter' : 'Add')}
          </button>
        </form>
      </Section>

      <Section titre={fr ? 'Tâches du deal' : 'Deal tasks'}>
        {/*
          Trier par échéance ou par date de création. Les deux répondent à
          des questions différentes : « qu'est-ce qui arrive » et « qu'est-ce
          que j'ai noté en dernier ». Les tâches FAITES restent en bas dans
          les deux cas — elles n'ont plus rien à demander.
        */}
        {taches.length > 1 && (
          <div className="mb-2 flex items-center gap-2">
            <label htmlFor={idTri} className="text-[11px] text-text-tertiary">
              {fr ? 'Trier par' : 'Sort by'}
            </label>
            <select
              id={idTri}
              value={tri}
              onChange={(e) => setTri(e.target.value as 'echeance' | 'creation')}
              className="input-field max-w-[170px] text-[12px]"
            >
              <option value="echeance">{fr ? 'Échéance' : 'Due date'}</option>
              <option value="creation">{fr ? 'Date de création' : 'Date created'}</option>
            </select>
          </div>
        )}
        {isLoading && <Vide texte={fr ? 'Chargement…' : 'Loading…'} />}
        {!isLoading && taches.length === 0 && (
          <Vide texte={fr ? 'Aucune tâche sur ce deal.' : 'No task on this deal.'} />
        )}
        {taches.length > 0 && (
          <ul className="rounded-xl border border-outline bg-surface-card divide-y divide-border-subtle">
            {tachesTriees.map((t) => {
              const idCase = `tache-${t.id}`;
              return (
                <li key={t.id} className="flex items-start gap-2.5 px-3 py-2">
                  <input
                    id={idCase}
                    type="checkbox"
                    checked={t.status === 'done'}
                    disabled={basculer.isPending}
                    onChange={(e) => basculer.mutate({ id: t.id, fait: e.target.checked })}
                    className="mt-0.5 shrink-0 accent-primary"
                  />
                  <label htmlFor={idCase} className="min-w-0 cursor-pointer">
                    <span
                      className={
                        t.status === 'done'
                          ? 'block text-[12.5px] text-text-muted line-through'
                          : 'block text-[12.5px] text-text-primary'
                      }
                    >
                      {t.title}
                    </span>
                    <span className="block text-[10.5px] text-text-muted">
                      {t.due_date
                        ? `${fr ? 'Échéance' : 'Due'} ${versDate(t.due_date).toLocaleDateString(fr ? 'fr-CA' : 'en-CA')}`
                        : (fr ? 'Sans échéance' : 'No due date')}
                      {enRetard(t) && ` · ${fr ? 'en retard' : 'overdue'}`}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}

// ── Onglet Lié ──────────────────────────────────────────────

/** Somme en cents → « 1 250 $ ». Les cents sont la source de vérité. */
function argent(cents: number, fr: boolean): string {
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', {
    style: 'currency', currency: 'CAD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Une ligne d'historique cliquable : job, devis ou facture. */
function LigneDossier({ vers, numero, titre, statut, cents, alerte, fr }: {
  vers: string; numero: string; titre: string; statut: string;
  cents: number; alerte?: string; fr: boolean;
}) {
  return (
    <Link
      to={vers}
      className="flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-hover"
    >
      <span className="min-w-0 flex-1 truncate text-[12px] text-text-primary">
        <span className="font-semibold">{numero}</span>
        {titre && <span className="text-text-secondary"> · {titre}</span>}
      </span>
      {alerte && (
        <span className="shrink-0 text-[11px] font-semibold" style={{ color: 'var(--color-danger)' }}>
          {alerte}
        </span>
      )}
      <span className="shrink-0 text-[11px] text-text-tertiary">{statut}</span>
      <span className="shrink-0 text-[12px] tabular-nums text-text-primary">{argent(cents, fr)}</span>
    </Link>
  );
}

/**
 * Le dossier du client : tout ce qu'il a fait avec l'entreprise.
 *
 * La fiche ne lisait que la job et le devis DE CE DEAL. Un client qui a fait
 * affaire six fois apparaissait donc comme s'il arrivait de nulle part —
 * alors qu'un vendeur qui le rappelle a besoin de savoir qu'il doit encore
 * 1 200 $, ou qu'on lui a déjà posé trois devis sans suite.
 */
function DossierDuClient({ clientId, fr }: { clientId: string | null; fr: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['deal-dossier-client', clientId],
    queryFn: () => fetchDossierClient(clientId),
    enabled: !!clientId,
    staleTime: 60_000,
  });

  if (!clientId) return null;
  if (isLoading) return <Vide texte={fr ? 'Chargement du dossier…' : 'Loading history…'} />;

  const d = data ?? { jobs: [], devis: [], factures: [], messages: [], paye_cents: 0, du_cents: 0 };
  const rien = d.jobs.length + d.devis.length + d.factures.length === 0;

  return (
    <>
      {/* Ce qu'il a payé, ce qu'il doit. La première question avant de
          rappeler quelqu'un pour lui vendre autre chose. */}
      {(d.paye_cents > 0 || d.du_cents > 0) && (
        <div className="mt-4 flex gap-2">
          <div className="flex-1 rounded-xl border border-outline bg-surface-card px-3.5 py-2.5">
            <div className="text-[10.5px] uppercase tracking-wide text-text-tertiary">
              {fr ? 'Payé à ce jour' : 'Paid to date'}
            </div>
            <div className="mt-0.5 text-[15px] font-bold tabular-nums text-text-primary">
              {argent(d.paye_cents, fr)}
            </div>
          </div>
          <div
            className="flex-1 rounded-xl border px-3.5 py-2.5"
            style={
              d.du_cents > 0
                ? { borderColor: 'var(--color-danger)', background: 'color-mix(in srgb, var(--color-danger) 7%, transparent)' }
                : { borderColor: 'var(--color-outline)' }
            }
          >
            <div className="text-[10.5px] uppercase tracking-wide text-text-tertiary">
              {fr ? 'Doit encore' : 'Still owes'}
            </div>
            <div
              className="mt-0.5 text-[15px] font-bold tabular-nums"
              style={{ color: d.du_cents > 0 ? 'var(--color-danger)' : 'var(--color-text-primary)' }}
            >
              {argent(d.du_cents, fr)}
            </div>
          </div>
        </div>
      )}

      {rien && (
        <Section titre={fr ? 'Historique' : 'History'}>
          <Vide texte={fr ? 'Premier contact avec ce client.' : 'First contact with this client.'} />
        </Section>
      )}

      {/*
        Facturer depuis ici. L'audit relevait que l'onglet Payments de GHL
        permet de créer devis et factures sans quitter l'opportunité — chez
        nous on ne pouvait que les LIRE.
      */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={`/quotes/new?clientId=${clientId}`} className="btn-secondary text-[12px]">
          {fr ? 'Faire un devis' : 'New quote'}
        </Link>
        <Link to={`/invoices/new?clientId=${clientId}`} className="btn-secondary text-[12px]">
          {fr ? 'Facturer' : 'New invoice'}
        </Link>
      </div>

      {d.factures.length > 0 && (
        <Section titre={fr ? `Factures (${d.factures.length})` : `Invoices (${d.factures.length})`}>
          <div className="-mx-2">
            {d.factures.map((f) => (
              <LigneDossier
                key={f.id} vers={`/invoices/${f.id}`} numero={f.numero} titre={f.titre}
                statut={f.statut} cents={f.cents} fr={fr}
                alerte={(f.solde_cents ?? 0) > 0 ? `${argent(f.solde_cents ?? 0, fr)} ${fr ? 'dû' : 'due'}` : undefined}
              />
            ))}
          </div>
        </Section>
      )}

      {d.jobs.length > 0 && (
        <Section titre={fr ? `Jobs (${d.jobs.length})` : `Jobs (${d.jobs.length})`}>
          <div className="-mx-2">
            {d.jobs.map((j) => (
              <LigneDossier key={j.id} vers={`/jobs/${j.id}`} numero={j.numero} titre={j.titre}
                statut={j.statut} cents={j.cents} fr={fr} />
            ))}
          </div>
        </Section>
      )}

      {d.devis.length > 0 && (
        <Section titre={fr ? `Devis (${d.devis.length})` : `Quotes (${d.devis.length})`}>
          <div className="-mx-2">
            {d.devis.map((q) => (
              <LigneDossier key={q.id} vers={`/quotes/${q.id}`} numero={q.numero} titre={q.titre}
                statut={q.statut} cents={q.cents} fr={fr} />
            ))}
          </div>
        </Section>
      )}

      {d.messages.length > 0 && (
        <Section titre={fr ? 'Derniers échanges' : 'Recent messages'}>
          <div className="space-y-1.5">
            {d.messages.map((m) => (
              <div key={m.id} className="rounded-lg border border-outline bg-surface-card px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary">
                    {m.direction === 'inbound' ? (fr ? 'Reçu' : 'Received') : (fr ? 'Envoyé' : 'Sent')}
                  </span>
                  <span className="text-[10.5px] text-text-muted">
                    {new Date(m.date).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[12px] text-text-secondary">{m.texte}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}


/**
 * Les rendez-vous du client.
 *
 * On ne montre QUE ça : une bande par visite, comme dans la fiche d'une job,
 * et rien d'autre. La question posée en ouvrant cette section est « est-ce
 * qu'il y a un rendez-vous ? » — tout le reste (valeur, étape, source) vit
 * dans la section Deal et n'a rien à faire ici.
 *
 * Les visites vivent sur la JOB (`schedule_events.job_id`), pas sur le deal :
 * on planifie du travail, pas une intention de vente. On montre donc les
 * visites de TOUTES les jobs du client — quelqu'un qu'on rappelle a
 * peut-être déjà une visite mardi pour un autre contrat, et l'ignorer ferait
 * proposer deux passages la même semaine.
 */
function OngletRendezVous({ deal, fr }: { deal: Deal; fr: boolean }) {
  const { data: rdv = [], isLoading } = useQuery({
    queryKey: ['deal-rdv', deal.client_id],
    queryFn: () => fetchRendezVousClient(deal.client_id),
    enabled: !!deal.client_id,
    staleTime: 60_000,
  });

  const loc = fr ? 'fr-CA' : 'en-CA';

  function jourEtHeure(iso: string | null): { jour: string; heure: string | null } {
    if (!iso) return { jour: fr ? 'Non planifiée' : 'Unscheduled', heure: null };
    const d = new Date(iso);
    return {
      jour: d.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' }),
      heure: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }),
    };
  }

  if (isLoading) return <Vide texte={fr ? 'Chargement\u2026' : 'Loading\u2026'} />;

  // AUCUN rendez-vous : un gros bouton, rien d'autre. Une section qui
  // n'offre qu'une phrase laisse l'utilisateur chercher quoi faire.
  if (rdv.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-outline px-5 py-10 text-center">
        <p className="text-[13px] text-text-secondary">
          {fr ? 'Aucun rendez-vous pour ce client.' : 'No appointment for this client.'}
        </p>
        <Link to="/calendar" className="btn-primary text-[13px]">
          {fr ? 'Cr\u00e9er un rendez-vous' : 'Create appointment'}
        </Link>
        <p className="max-w-[34ch] text-[11px] text-text-muted">
          {fr
            ? "La visite se planifie dans le calendrier : elle demande une dur\u00e9e, une \u00e9quipe et une adresse."
            : 'A visit is scheduled in the calendar: it needs a duration, a crew and an address.'}
        </p>
      </div>
    );
  }

  const maintenant = Date.now();

  return (
    <div className="space-y-2">
      {rdv.map((r) => {
        const { jour, heure } = jourEtHeure(r.debut);
        const statut = (r.statut || '').toLowerCase();
        const fait = statut === 'completed';
        const annule = statut === 'cancelled';
        const passe = !!r.debut && new Date(r.debut).getTime() < maintenant;

        return (
          <div
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-outline-subtle bg-surface-secondary p-3.5"
          >
            <div className="min-w-0">
              <span className="flex items-center gap-2">
                <span
                  className={
                    'truncate text-[13px] font-semibold '
                    + (fait || annule ? 'text-text-tertiary line-through' : 'text-text-primary')
                  }
                >
                  {jour}
                </span>
                {fait && (
                  <span className="shrink-0 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">
                    {fr ? 'Compl\u00e9t\u00e9e' : 'Completed'}
                  </span>
                )}
                {annule && (
                  <span className="shrink-0 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">
                    {fr ? 'Annul\u00e9e' : 'Cancelled'}
                  </span>
                )}
                {!fait && !annule && passe && (
                  <span className="shrink-0 rounded-full border border-outline px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-muted">
                    {fr ? 'Pass\u00e9e' : 'Past'}
                  </span>
                )}
              </span>
              {heure && (
                <span className="block text-[12px] tabular-nums text-text-tertiary">{heure}</span>
              )}
              {r.titre && (
                <span className="block truncate text-[11.5px] text-text-muted">{r.titre}</span>
              )}
            </div>

            {/* Modifier la visite se fait dans sa job : c'est l\u00e0 que vivent la
                dur\u00e9e, l'\u00e9quipe et l'adresse. */}
            <Link
              to={r.job_id ? `/jobs/${r.job_id}` : '/calendar'}
              aria-label={fr ? `Modifier le rendez-vous du ${jour}` : `Edit the appointment on ${jour}`}
              className="shrink-0 rounded-lg border border-outline px-2.5 py-1.5 text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
            >
              {fr ? 'Modifier' : 'Edit'}
            </Link>
          </div>
        );
      })}

      <Link to="/calendar" className="btn-secondary inline-flex text-[12.5px]">
        + {fr ? 'Ajouter un rendez-vous' : 'Add appointment'}
      </Link>
    </div>
  );
}

/**
 * L'argent du client : devis, factures, encaissements.
 *
 * Le filtre reprend les quatre vues de GoHighLevel — tous, devis, factures,
 * transactions — parce qu'elles répondent à quatre questions différentes :
 * « qu'est-ce que je lui ai proposé », « qu'est-ce que je lui ai facturé »,
 * « qu'est-ce qu'il a payé ».
 *
 * Le bouton « Actions » crée depuis ici. Chez GHL c'est un menu ; ici les
 * deux gestes vivent dans leur propre écran, avec le client pré-rempli — un
 * devis ne se bâcle pas dans une fenêtre superposée.
 */
function OngletPaiements({ deal, fr }: { deal: Deal; fr: boolean }) {
  const idFiltre = useId();
  const [type, setType] = useState<'tous' | 'devis' | 'factures' | 'transactions'>('tous');

  const { data, isLoading } = useQuery({
    queryKey: ['deal-dossier-client', deal.client_id],
    queryFn: () => fetchDossierClient(deal.client_id),
    enabled: !!deal.client_id,
    staleTime: 60_000,
  });

  const d = data ?? { jobs: [], devis: [], factures: [], transactions: [], messages: [], paye_cents: 0, du_cents: 0 };

  const lignes = [
    // `?? []` sur chaque liste : une réponse partielle (cache d'une version
    // précédente, lecture refusée par la RLS des montants) ne doit pas faire
    // planter l'écran entier — une section vide vaut mieux qu'un écran mort.
    ...(type === 'tous' || type === 'devis'
      ? (d.devis ?? []).map((x) => ({ ...x, genre: 'devis' as const }))
      : []),
    ...(type === 'tous' || type === 'factures'
      ? (d.factures ?? []).map((x) => ({ ...x, genre: 'facture' as const }))
      : []),
    ...(type === 'tous' || type === 'transactions'
      ? (d.transactions ?? []).map((x) => ({ ...x, genre: 'transaction' as const }))
      : []),
  ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  const LIBELLE_GENRE = {
    devis: fr ? 'Devis' : 'Estimate',
    facture: fr ? 'Facture' : 'Invoice',
    transaction: fr ? 'Paiement' : 'Payment',
  };

  function lienDe(g: string, id: string): string {
    if (g === 'devis') return `/quotes/${id}`;
    if (g === 'facture') return `/invoices/${id}`;
    // Un encaissement n'a pas d'écran à lui : on ouvre la page des paiements.
    return '/payments';
  }

  return (
    <>
      {/* La barre d'actions : créer, et filtrer ce qu'on regarde. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor={idFiltre} className="sr-only">
            {fr ? 'Type' : 'Type'}
          </label>
          <select
            id={idFiltre}
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="input-field max-w-[190px] text-[12.5px]"
          >
            <option value="tous">{fr ? 'Tous les types' : 'All types'}</option>
            <option value="devis">{fr ? 'Devis' : 'Estimates'}</option>
            <option value="factures">{fr ? 'Factures' : 'Invoices'}</option>
            <option value="transactions">{fr ? 'Transactions' : 'Transactions'}</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Link to={`/quotes/new?clientId=${deal.client_id}`} className="btn-secondary text-[12.5px]">
            {fr ? 'Cr\u00e9er un devis' : 'Create estimate'}
          </Link>
          <Link to={`/invoices/new?clientId=${deal.client_id}`} className="btn-primary text-[12.5px]">
            {fr ? 'Cr\u00e9er une facture' : 'Create invoice'}
          </Link>
        </div>
      </div>

      {/* Ce qu'il a pay\u00e9, ce qu'il doit : la question avant de lui vendre
          autre chose. */}
      {(d.paye_cents > 0 || d.du_cents > 0) && (
        <div className="mt-3 flex gap-2">
          <div className="flex-1 rounded-xl border border-outline bg-surface-card px-3.5 py-2.5">
            <div className="text-[10.5px] uppercase tracking-wide text-text-tertiary">
              {fr ? 'Pay\u00e9 \u00e0 ce jour' : 'Paid to date'}
            </div>
            <div className="mt-0.5 text-[15px] font-bold tabular-nums text-text-primary">
              {montant(d.paye_cents, fr)}
            </div>
          </div>
          <div
            className="flex-1 rounded-xl border px-3.5 py-2.5"
            style={
              d.du_cents > 0
                ? { borderColor: 'var(--color-danger)', background: 'color-mix(in srgb, var(--color-danger) 7%, transparent)' }
                : { borderColor: 'var(--color-outline)' }
            }
          >
            <div className="text-[10.5px] uppercase tracking-wide text-text-tertiary">
              {fr ? 'Doit encore' : 'Still owes'}
            </div>
            <div
              className="mt-0.5 text-[15px] font-bold tabular-nums"
              style={{ color: d.du_cents > 0 ? 'var(--color-danger)' : 'var(--color-text-primary)' }}
            >
              {montant(d.du_cents, fr)}
            </div>
          </div>
        </div>
      )}

      {isLoading && <Vide texte={fr ? 'Chargement\u2026' : 'Loading\u2026'} />}

      {!isLoading && lignes.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-outline px-5 py-8 text-center">
          <p className="text-[12.5px] text-text-secondary">
            {type === 'tous'
              ? (fr ? 'Aucune transaction pour ce client.' : 'No transaction for this client.')
              : (fr ? 'Rien de ce type.' : 'Nothing of this type.')}
          </p>
        </div>
      )}

      {lignes.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-tertiary">
                <th scope="col" className="py-2 pr-3 font-semibold">{fr ? 'Date' : 'Date'}</th>
                <th scope="col" className="py-2 px-2 font-semibold">{fr ? 'Type' : 'Type'}</th>
                <th scope="col" className="py-2 px-2 font-semibold">{fr ? 'Num\u00e9ro' : 'Number'}</th>
                <th scope="col" className="py-2 px-2 font-semibold">{fr ? 'Statut' : 'Status'}</th>
                <th scope="col" className="py-2 pl-2 text-right font-semibold">{fr ? 'Montant' : 'Amount'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {lignes.map((l) => (
                <tr key={`${l.genre}-${l.id}`}>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-text-secondary">
                    {l.date
                      ? new Date(l.date).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short', year: 'numeric' })
                      : '\u2014'}
                  </td>
                  <td className="py-2 px-2 text-text-secondary">{LIBELLE_GENRE[l.genre]}</td>
                  <td className="py-2 px-2">
                    <Link to={lienDe(l.genre, l.id)} className="text-text-primary hover:underline">
                      {l.numero || '\u2014'}
                    </Link>
                  </td>
                  <td className="py-2 px-2 text-text-tertiary">
                    {l.statut || '\u2014'}
                    {/* Le solde restant, l\u00e0 o\u00f9 il existe : une facture « envoy\u00e9e »
                        \u00e0 moiti\u00e9 pay\u00e9e n'est pas la m\u00eame chose qu'une intacte. */}
                    {l.genre === 'facture' && (l.solde_cents ?? 0) > 0 && (
                      <span className="ml-1.5 text-[11px] font-semibold" style={{ color: 'var(--color-danger)' }}>
                        {montant(l.solde_cents ?? 0, fr)} {fr ? 'd\u00fb' : 'due'}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pl-2 text-right tabular-nums text-text-primary">
                    {montant(l.cents, fr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function OngletLie({ deal, fr }: { deal: Deal; fr: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['deal-lies', deal.id, deal.job_id, deal.quote_id],
    queryFn: () => fetchElementsLies(deal),
  });

  const job = data?.job ?? null;
  const devis = data?.devis ?? null;
  const paiements = data?.paiements ?? [];
  const porte = data?.porte ?? null;

  return (
    <>
      {/* Le deal vient d'une porte cognée : on peut retourner la voir sur la
          carte. La carte accepte ?lat=&lng= pour se centrer dessus. */}
      {porte && (
        <Section titre={fr ? 'Porte-à-porte' : 'Door-to-door'}>
          {porte.lat != null && porte.lng != null ? (
            <Link
              to={`/field-sales?lat=${porte.lat}&lng=${porte.lng}`}
              className="flex items-center gap-2 rounded-xl border border-outline bg-surface-card px-3.5 py-2.5 text-[12.5px] text-text-primary hover:bg-surface-hover"
            >
              <MapPin size={13} aria-hidden="true" className="text-text-muted shrink-0" />
              <span className="min-w-0 truncate">
                {porte.address ?? (fr ? 'Voir sur la carte' : 'View on the map')}
              </span>
            </Link>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-outline bg-surface-card px-3.5 py-2.5 text-[12.5px] text-text-secondary">
              <MapPin size={13} aria-hidden="true" className="text-text-muted shrink-0" />
              <span className="min-w-0 truncate">{porte.address ?? (fr ? 'Adresse inconnue' : 'Unknown address')}</span>
            </div>
          )}
        </Section>
      )}

      <Section titre={fr ? 'Client' : 'Client'}>
        {deal.client_id ? (
          <Link
            to={`/clients/${deal.client_id}`}
            className="flex items-center gap-2 rounded-xl border border-outline bg-surface-card px-3.5 py-2.5 text-[12.5px] text-text-primary hover:bg-surface-hover"
          >
            <User size={13} aria-hidden="true" className="text-text-muted shrink-0" />
            {nomClient(deal)}
          </Link>
        ) : (
          <Vide texte={fr ? 'Aucun client rattaché.' : 'No client linked.'} />
        )}
      </Section>

      {/* Tout ce que ce client a fait avec l'entreprise — pas seulement ce
          que CE deal a produit. */}
      <DossierDuClient clientId={deal.client_id} fr={fr} />

      <Section titre={fr ? 'Job' : 'Job'}>
        {isLoading && <Vide texte={fr ? 'Chargement…' : 'Loading…'} />}
        {!isLoading && !job && <Vide texte={fr ? 'Aucune job liée.' : 'No linked job.'} />}
        {job && (
          <Link
            to={`/jobs/${job.id}`}
            className="block rounded-xl border border-outline bg-surface-card px-3.5 py-2.5 hover:bg-surface-hover"
          >
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text-primary">
              <Briefcase size={13} aria-hidden="true" />
              {job.job_number}
            </span>
            <span className="block text-[11.5px] text-text-secondary mt-0.5">{job.title}</span>
            <span className="block text-[11px] text-text-muted mt-0.5">
              {montant(job.total_cents, fr)} · {job.status}
            </span>
          </Link>
        )}
      </Section>

      <Section titre={fr ? 'Devis' : 'Quote'}>
        {isLoading && <Vide texte={fr ? 'Chargement…' : 'Loading…'} />}
        {!isLoading && !devis && <Vide texte={fr ? 'Aucun devis lié.' : 'No linked quote.'} />}
        {devis && (
          <Link
            to={`/quotes/${devis.id}`}
            className="block rounded-xl border border-outline bg-surface-card px-3.5 py-2.5 hover:bg-surface-hover"
          >
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text-primary">
              <FileText size={13} aria-hidden="true" />
              {devis.quote_number}
            </span>
            {devis.title && (
              <span className="block text-[11.5px] text-text-secondary mt-0.5">{devis.title}</span>
            )}
            <span className="block text-[11px] text-text-muted mt-0.5">
              {montant(devis.total_cents, fr)} · {devis.status}
            </span>
          </Link>
        )}
      </Section>

      {/*
        Les paiements sont ceux de la JOB liée (`payments.job_id`), pas ceux du
        client : sans job, aucun chiffre ne peut être rattaché au deal avec
        certitude, et on le dit plutôt que d'en afficher un approximatif.
      */}
      <Section titre={fr ? 'Paiements reçus' : 'Payments received'}>
        {!deal.job_id && (
          <Vide
            texte={fr
              ? "Aucune job liée : les paiements ne peuvent pas être rattachés à ce deal."
              : 'No linked job: payments cannot be tied to this deal.'}
          />
        )}
        {deal.job_id && isLoading && <Vide texte={fr ? 'Chargement…' : 'Loading…'} />}
        {deal.job_id && !isLoading && paiements.length === 0 && (
          <Vide texte={fr ? 'Aucun paiement sur la job liée.' : 'No payment on the linked job.'} />
        )}
        {paiements.length > 0 && (
          <ul className="rounded-xl border border-outline bg-surface-card px-3.5 py-2 divide-y divide-border-subtle">
            {paiements.map((p) => (
              <li key={p.id}>
                <Ligne label={new Date(p.paid_at).toLocaleDateString(fr ? 'fr-CA' : 'en-CA')}>
                  {montant(p.amount_cents, fr)}
                  <span className="text-text-muted"> · {p.method ?? p.status}</span>
                </Ligne>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

// ── Fiche ───────────────────────────────────────────────────


export default function DealDrawer({
  deal, etapes, membres, montantCents, montantProvenance, onClose, onAssigner, onCreerJob,
  onChangement,
}: {
  deal: Deal | null;
  etapes: PipelineStage[];
  membres?: Membre[];
  /** Montant DÉRIVÉ du deal (jamais stocké). `null` = aucune source. */
  montantCents?: number | null;
  /** D'où vient ce montant — affiché sous le chiffre. */
  montantProvenance?: MontantProvenance;
  onClose: () => void;
  onAssigner: (dealId: string, membreId: string | null) => void;
  onCreerJob: (deal: Deal) => void;
  /** Appelé après chaque écriture réussie faite DEPUIS la fiche, pour que le parent recharge. */
  onChangement?: () => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const idAssignation = useId();
  const idEtape = useId();
  const idSource = useId();
  const idRaisonPerte = useId();
  const idRaisonAbandon = useId();
  const idDateFermeture = useId();
  const idOnglets = useId();
  const [onglet, setOnglet] = useState<Onglet>('lie');
  const listeMembres = useMemo(() => membres ?? [], [membres]);

  // Étape « en attente d'une raison » : un passage vers une étape `lost` n'est
  // écrit qu'une fois la raison saisie. Tant qu'elle manque, le deal n'a pas
  // bougé — et le sélecteur montre l'étape RÉELLE, pas celle qu'on vise.
  const [etapePerdueVisee, setEtapePerdueVisee] = useState<string | null>(null);
  const [raisonSaisie, setRaisonSaisie] = useState('');
  const [enEcriture, setEnEcriture] = useState(false);

  // « Abandonné » n'est pas une étape : c'est une décision. Le vendeur dit
  // qu'il arrête de relancer, et la base place le deal dans l'étape perdue
  // elle-même — lui demander LAQUELLE rendrait le geste ambigu.
  // Les motifs proposés : lecture seule ici, la liste se gère dans les
  // réglages. `staleTime` long — elle change rarement.
  const { data: raisonsProposees = [] } = useQuery({
    queryKey: ['pipeline-raisons-proposees'],
    queryFn: fetchRaisonsProposees,
    staleTime: 600_000,
  });

  const [abandonVise, setAbandonVise] = useState(false);
  const [raisonAbandon, setRaisonAbandon] = useState('');

  const etape = useMemo(
    () => (deal ? etapes.find((e) => e.id === deal.stage_id) ?? null : null),
    [deal, etapes],
  );

  const etapesVisibles = useMemo(
    () => etapes.filter((e) => !e.archived_at).sort((a, b) => a.position - b.position),
    [etapes],
  );

  // L'historique vient de la base : les triggers l'écrivent à chaque mouvement.
  const { data: historique = [] } = useQuery({
    queryKey: ['deal-historique', deal?.id],
    queryFn: () => fetchHistorique(deal?.id ?? ''),
    enabled: !!deal,
  });

  // Fermer la fiche, ou en ouvrir une autre, ne doit jamais laisser traîner une
  // raison de perte à moitié saisie sur le deal suivant.
  const dealId = deal?.id ?? null;
  useEffect(() => {
    setEtapePerdueVisee(null);
    setRaisonSaisie('');
    // Chaque deal s'ouvre sur son CLIENT : la première question est « c'est
    // qui, et où on en est avec lui ? ». Revenir sur le deal précédent avec
    // la section qu'on regardait la fois d'avant serait déroutant.
    setOnglet('lie');
  }, [dealId]);

  if (!deal) return null;

  const maintenant = new Date().toISOString();
  const jobACreer = estJobACreer(deal, etapes);
  const delai = delaiPremierContactHeures(deal);
  const nomEtape = (id: string | null) => {
    if (!id) return fr ? '(entrée)' : '(entry)';
    const e = etapes.find((x) => x.id === id);
    return e ? (fr ? e.name_fr : e.name_en) : id;
  };

  const provenance = montantProvenance ?? 'aucun';
  const LIBELLE_PROVENANCE: Record<MontantProvenance, string> = {
    job: fr ? 'Montant de la job liée' : 'Amount of the linked job',
    devis: fr ? 'Montant du devis' : 'Amount of the quote',
    devis_client: fr
      ? 'Dernier devis de ce client (à confirmer)'
      : 'Latest quote of this client (to confirm)',
    aucun: fr ? 'Aucun devis ni job lié' : 'No quote or job linked',
  };

  /**
   * Les sections, dans l'ordre où on en a besoin.
   *
   * Le CLIENT d'abord : quand on ouvre un deal, la première question est
   * « c'est qui, et où on en est avec lui ? ». L'aperçu du deal (étape,
   * source, montant) vient ensuite — c'est utile, mais ça ne remplace pas
   * de savoir qu'il doit encore 1 200 $.
   */
  const ONGLETS: { cle: Onglet; libelle: string }[] = [
    { cle: 'lie', libelle: fr ? 'Client' : 'Client' },
    { cle: 'apercu', libelle: fr ? 'Deal' : 'Deal' },
    { cle: 'rdv', libelle: fr ? 'Rendez-vous' : 'Appointments' },
    { cle: 'taches', libelle: fr ? 'Tâches' : 'Tasks' },
    { cle: 'notes', libelle: fr ? 'Notes' : 'Notes' },
    { cle: 'paiements', libelle: fr ? 'Paiements' : 'Payments' },
    { cle: 'activite', libelle: fr ? 'Activité' : 'Activity' },
  ];

  /** Écriture générique : toast de succès, rafraîchissement, message de la base sinon. */
  const ecrire = async (
    action: () => Promise<void>,
    succes: string,
    apresEchec?: () => void,
  ): Promise<void> => {
    setEnEcriture(true);
    try {
      await action();
      toast.success(succes);
      onChangement?.();
    } catch (e) {
      console.error('[DealDrawer] écriture refusée', e);
      toast.error(e instanceof Error ? e.message : String(e));
      apresEchec?.();
    } finally {
      setEnEcriture(false);
    }
  };

  const changerEtape = (versId: string): void => {
    if (!versId || versId === deal.stage_id) return;
    const cible = etapes.find((e) => e.id === versId);
    if (!cible) return;
    if (cible.kind === 'lost') {
      // La raison n'est pas une formalité : c'est elle qui ajuste les prix et
      // les relances. On la demande AVANT d'écrire quoi que ce soit.
      setEtapePerdueVisee(versId);
      setRaisonSaisie(deal.lost_reason ?? '');
      return;
    }
    setEtapePerdueVisee(null);
    if (cible.kind === 'won') {
      // Gagné passe par le même chemin que le board : le parent ouvre le modal
      // de création de job, qui écrit l'étape ET la job d'un seul geste.
      onCreerJob(deal);
      return;
    }
    void ecrire(
      () => deplacerDeal(deal.id, versId),
      fr
        ? `Deal déplacé vers « ${cible.name_fr} ».`
        : `Deal moved to “${cible.name_en}”.`,
    );
  };

  const confirmerPerte = (): void => {
    const cibleId = etapePerdueVisee;
    const raison = raisonSaisie.trim();
    if (!cibleId || !raison) return;
    void ecrire(
      () => marquerPerdu(deal.id, cibleId, raison),
      fr ? 'Deal marqué comme perdu.' : 'Deal marked as lost.',
    ).then(() => {
      setEtapePerdueVisee(null);
      setRaisonSaisie('');
    });
  };

  const confirmerAbandon = (): void => {
    void ecrire(
      () => abandonnerDeal(deal.id, raisonAbandon),
      fr ? 'Deal abandonné — plus de relance prévue.' : 'Deal abandoned — no further follow-up.',
    ).then(() => {
      setAbandonVise(false);
      setRaisonAbandon('');
    });
  };

  const enregistrerContact = (champs: Partial<ContactClient>): void => {
    if (!deal.client_id) {
      toast.error(fr ? 'Aucun client rattaché à ce deal.' : 'No client linked to this deal.');
      return;
    }
    void ecrire(
      () => majContactDuDeal(deal.client_id, champs),
      fr ? 'Contact du client enregistré.' : 'Client contact saved.',
      // L'échec est déjà visible : `ChampTexte` reprend `valeur`, qui n'a pas
      // bougé faute de rafraîchissement. Rien à défaire à la main.
      () => onChangement?.(),
    );
  };

  // La valeur courante reste dans la liste même si elle vient d'un import : on
  // ne réécrit jamais une source par le seul fait d'ouvrir le sélecteur.
  const sourcesProposees: string[] = SOURCES_CONNUES.includes(deal.source as typeof SOURCES_CONNUES[number])
    ? [...SOURCES_CONNUES]
    : [...SOURCES_CONNUES, deal.source];

  const etapePerdue = etape?.kind === 'lost';
  const indiceClient = fr
    ? 'Ces champs appartiennent à la fiche du client : les modifier ici la modifie partout.'
    : 'These fields belong to the client record: editing them here changes it everywhere.';

  return (
    <Modal open onClose={onClose} size="xl">
      {/*
        `Modal` plafonne à `max-w-xl` (576 px) — bien trop étroit pour deux
        colonnes. On élargit le conteneur DEPUIS l'enfant (`:has`), plutôt que de
        toucher `Modal.tsx`, qui sert à toute l'application.
      */}
      <div className="[.modal-content:has(&)]:max-w-[980px] max-h-[75vh] overflow-y-auto -mx-6 -my-5 px-6 py-5">
        {/* En-tête : qui, où il en est, combien. */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {deal.client_id ? (
              <Link
                to={`/clients/${deal.client_id}`}
                className="inline-flex items-center gap-1.5 text-[19px] font-bold tracking-tight text-text-primary hover:text-primary transition-colors"
              >
                {nomClient(deal)}
                <ExternalLink size={14} aria-hidden="true" className="text-text-muted shrink-0" />
              </Link>
            ) : (
              <span className="text-[19px] font-bold tracking-tight text-text-primary">
                {nomClient(deal)}
              </span>
            )}
            <p className="text-[11.5px] text-text-tertiary mt-1">
              {etape ? (fr ? etape.name_fr : etape.name_en) : (fr ? 'Sans étape' : 'No stage')}
              {' · '}
              {fr
                ? `créé il y a ${depuis(deal.created_at, maintenant, fr)}`
                : `created ${depuis(deal.created_at, maintenant, fr)} ago`}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[24px] font-semibold text-text-primary tabular-nums leading-none">
              {montantCents != null && montantCents > 0 ? montant(montantCents, fr) : '—'}
            </p>
            <p className="text-[10.5px] text-text-tertiary mt-1.5">{LIBELLE_PROVENANCE[provenance]}</p>
          </div>

          {/*
            `Modal` ne dessine sa croix que s'il reçoit un `title` ; l'en-tête
            étant fait ici, il faut la poser nous-mêmes. Sans elle, la seule
            sortie est Échap ou le clic sur le fond — que rien n'annonce.
          */}
          <button
            type="button"
            onClick={onClose}
            aria-label={fr ? 'Fermer la fiche' : 'Close'}
            className="shrink-0 rounded-xl border border-outline p-1.5 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>

        {/*
          Créer la job ne doit pas attendre que le deal soit gagné : en service
          terrain, on planifie souvent le travail AVANT de clore la vente. Le
          bouton reste donc offert tant qu'aucune job n'est liée — sur un deal
          déjà gagné, c'est l'encart ambre ci-dessous qui prend le relais.
        */}
        {!deal.job_id && !jobACreer && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline bg-surface-secondary p-3.5">
            <p className="text-[12px] text-text-secondary">
              {fr
                ? 'Aucune job rattachée à ce deal.'
                : 'No job linked to this deal yet.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {/*
                Le devis AVANT la job : en service terrain, on chiffre d'abord
                et on planifie une fois que c'est accepté. Le client arrive
                pré-rempli — sans ça le vendeur devrait rechercher à la main
                quelqu'un qu'il vient de désigner.
              */}
              {deal.client_id && (
                <Link
                  to={`/quotes/new?clientId=${deal.client_id}`}
                  className="btn-secondary text-[12px]"
                >
                  {fr ? 'Faire un devis' : 'Create a quote'}
                </Link>
              )}
              <button
                type="button"
                onClick={() => onCreerJob(deal)}
                className="btn-secondary text-[12px]"
              >
                {fr ? 'Créer une job' : 'Create a job'}
              </button>
            </div>
          </div>
        )}

        {/* Guidance de l'étape — le « Path ». Hors onglets : c'est le conseil du moment. */}
        {etape && (
          <div className="mt-4 rounded-xl border border-outline bg-surface-secondary p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
              {fr ? etape.name_fr : etape.name_en}
            </p>
            <p className="text-[12.5px] text-text-secondary leading-relaxed mt-1.5">
              {fr ? etape.guidance_fr : etape.guidance_en}
            </p>
          </div>
        )}

        {jobACreer && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5">
            <p className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-700 dark:text-amber-400">
              <Hammer size={14} aria-hidden="true" />
              {fr ? 'Job à créer' : 'Job to create'}
            </p>
            <p className="text-[11.5px] text-text-secondary mt-1 leading-relaxed">
              {fr
                ? "Ce deal est gagné mais aucune job n'y est rattachée."
                : 'This deal is won but no job is linked to it.'}
            </p>
            <button
              type="button"
              onClick={() => onCreerJob(deal)}
              className="btn-primary mt-2.5 text-[12px] px-3 py-1.5"
            >
              {fr ? 'Créer la job' : 'Create the job'}
            </button>
          </div>
        )}

        {/*
          Navigation À GAUCHE, comme la page Client : sur une fenêtre large,
          une rangée d'onglets horizontaux gaspille la hauteur et oblige à
          relire la ligne pour retrouver où l'on est. En colonne, les
          sections restent visibles pendant qu'on lit le contenu.
          Sur téléphone, la colonne repasse au-dessus en ligne — une barre
          latérale de 150 px sur 390 px d'écran ne laisserait rien au texte.
        */}
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label={fr ? 'Sections du deal' : 'Deal sections'}
            className="flex shrink-0 gap-1 overflow-x-auto sm:w-[150px] sm:flex-col sm:overflow-visible"
          >
            {ONGLETS.map((o) => (
              <button
                key={o.cle}
                type="button"
                role="tab"
                id={`${idOnglets}-${o.cle}`}
                aria-selected={onglet === o.cle}
                aria-controls={`${idOnglets}-${o.cle}-panneau`}
                tabIndex={onglet === o.cle ? 0 : -1}
                onClick={() => setOnglet(o.cle)}
                className={
                  'whitespace-nowrap rounded-lg px-3 py-2 text-left text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary '
                  + (onglet === o.cle
                    ? 'bg-surface-tertiary font-semibold text-text-primary'
                    : 'text-text-tertiary hover:bg-surface-secondary hover:text-text-primary')
                }
              >
                {o.libelle}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id={`${idOnglets}-${onglet}-panneau`}
            aria-labelledby={`${idOnglets}-${onglet}`}
            className="min-w-0 flex-1"
          >
          {onglet === 'apercu' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-6">
              {/* Colonne gauche — la valeur et à qui l'on parle. */}
              <div>
                <Section titre={fr ? 'Valeur' : 'Value'}>
                  <div className="rounded-xl border border-outline bg-surface-card px-3.5 py-3">
                    {/*
                      Un montant venu du DERNIER DEVIS DU CLIENT n'est pas la
                      valeur de ce deal-ci : c'est un chiffre d'un autre
                      contrat, parfois d'un autre service. Affiché en gros, il
                      se prend pour une promesse — un « Nouveau lead » de
                      4 900 $ alors que rien n'a été chiffré.
                      On le garde comme REPÈRE, en petit, et le gros chiffre
                      reste vide tant que ce deal n'a ni devis ni job.
                    */}
                    {provenance === 'devis_client' ? (
                      <>
                        <p className="text-[22px] font-semibold text-text-muted tabular-nums leading-none">—</p>
                        <p className="mt-1.5 text-[11px] text-text-tertiary">
                          {fr
                            ? `Rien de chiffré pour ce deal. Dernier devis du client : ${montant(montantCents ?? 0, fr)}.`
                            : `Nothing quoted for this deal. Client's last quote: ${montant(montantCents ?? 0, fr)}.`}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[22px] font-semibold text-text-primary tabular-nums leading-none">
                          {montantCents != null && montantCents > 0 ? montant(montantCents, fr) : '—'}
                        </p>
                        <p className="text-[11px] text-text-tertiary mt-1.5">
                          {LIBELLE_PROVENANCE[provenance]}
                        </p>
                      </>
                    )}
                  </div>
                </Section>

                <Section titre={fr ? 'Contact' : 'Contact'}>
                  <div className="rounded-xl border border-outline bg-surface-card px-3.5 py-3 space-y-2.5">
                    <Ligne label={fr ? 'Nom' : 'Name'}>{nomClient(deal)}</Ligne>
                    <ChampTexte
                      label={fr ? 'Courriel' : 'Email'}
                      type="email"
                      valeur={deal.client?.email ?? ''}
                      placeholder={fr ? 'client@exemple.ca' : 'client@example.com'}
                      onEnregistrer={(v) => enregistrerContact({ email: v.trim() || null })}
                    />
                    <ChampTexte
                      label={fr ? 'Téléphone' : 'Phone'}
                      type="tel"
                      valeur={deal.client?.phone ?? ''}
                      placeholder="514 555-0199"
                      onEnregistrer={(v) => enregistrerContact({ phone: v.trim() || null })}
                    />
                    <ChampTexte
                      label={fr ? 'Adresse' : 'Address'}
                      valeur={deal.client?.address ?? ''}
                      placeholder={fr ? '123 rue Principale, Montréal' : '123 Main St, Montreal'}
                      indice={indiceClient}
                      onEnregistrer={(v) => enregistrerContact({ address: v.trim() || null })}
                    />
                  </div>
                </Section>
              </div>

              {/* Colonne droite — d'où il vient, où il en est, qui s'en occupe. */}
              <div>
                <Section titre={fr ? 'Provenance' : 'Source'}>
                  <div className="rounded-xl border border-outline bg-surface-card px-3.5 py-3">
                    <label htmlFor={idSource} className="block text-[11px] text-text-tertiary mb-1">
                      {fr ? 'Canal' : 'Channel'}
                    </label>
                    <select
                      id={idSource}
                      value={deal.source}
                      disabled={enEcriture}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === deal.source) return;
                        void ecrire(
                          () => majSourceDuDeal(deal.id, v),
                          fr ? 'Source enregistrée.' : 'Source saved.',
                        );
                      }}
                      className="input-field w-full text-[12.5px]"
                    >
                      {sourcesProposees.map((s) => (
                        <option key={s} value={s}>{libelleSource(s, fr)}</option>
                      ))}
                    </select>

                    {(deal.utm_campaign || deal.utm_content || deal.utm_source
                      || deal.utm_medium || deal.fbclid) && (
                      <div className="mt-2.5 pt-1 border-t border-border-subtle divide-y divide-border-subtle">
                        {deal.utm_campaign && <Ligne label="Campagne">{deal.utm_campaign}</Ligne>}
                        {deal.utm_content && <Ligne label="Contenu">{deal.utm_content}</Ligne>}
                        {deal.utm_source && <Ligne label="utm_source">{deal.utm_source}</Ligne>}
                        {deal.utm_medium && <Ligne label="utm_medium">{deal.utm_medium}</Ligne>}
                        {deal.fbclid && (
                          <Ligne label="fbclid">
                            <span className="font-mono text-[10.5px] text-text-tertiary">{deal.fbclid.slice(0, 18)}…</span>
                          </Ligne>
                        )}
                      </div>
                    )}
                  </div>
                </Section>

                <Section titre={fr ? 'Suivi' : 'Tracking'}>
                  <div className="rounded-xl border border-outline bg-surface-card px-3.5 py-3">
                    <label htmlFor={idEtape} className="block text-[11px] text-text-tertiary mb-1">
                      {fr ? 'Étape' : 'Stage'}
                    </label>
                    <select
                      id={idEtape}
                      value={deal.stage_id}
                      disabled={enEcriture}
                      onChange={(e) => changerEtape(e.target.value)}
                      className="input-field w-full text-[12.5px]"
                    >
                      {etapesVisibles.map((e) => (
                        <option key={e.id} value={e.id}>{fr ? e.name_fr : e.name_en}</option>
                      ))}
                    </select>

                    {/*
                      Perdre un deal sans dire pourquoi, c'est perdre l'information
                      avec : l'étape n'est écrite qu'une fois la raison donnée.
                    */}
                    {etapePerdueVisee && (
                      <div className="mt-2.5 rounded-xl border border-outline bg-surface-secondary p-3">
                        <label htmlFor={idRaisonPerte} className="block text-[11px] text-text-tertiary mb-1">
                          {fr ? 'Raison de la perte (obligatoire)' : 'Loss reason (required)'}
                        </label>
                        {/*
                          Les motifs courants en un clic, la saisie libre juste
                          en dessous. Sans cette liste, « trop cher », « prix »
                          et « trop dispendieux » comptent pour trois raisons
                          distinctes dans les statistiques — et le seul retour
                          structuré sur pourquoi on perd devient illisible.
                          On ne FORCE pas la liste : le motif imprévu est
                          souvent celui qui apprend quelque chose.
                        */}
                        {raisonsProposees.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {raisonsProposees.map((r) => (
                              <button
                                key={r.id}
                                type="button"
                                onClick={() => setRaisonSaisie(r.libelle)}
                                className={
                                  'rounded-full border px-2.5 py-1 text-[11.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary '
                                  + (raisonSaisie.trim() === r.libelle
                                    ? 'border-outline-strong bg-surface-tertiary font-semibold text-text-primary'
                                    : 'border-outline text-text-tertiary hover:bg-surface-secondary hover:text-text-primary')
                                }
                              >
                                {r.libelle}
                              </button>
                            ))}
                          </div>
                        )}
                        <textarea
                          id={idRaisonPerte}
                          rows={2}
                          value={raisonSaisie}
                          onChange={(e) => setRaisonSaisie(e.target.value)}
                          placeholder={fr ? 'Ou écris un motif précis…' : 'Or write a specific reason…'}
                          className="input-field w-full text-[12.5px] resize-none"
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => { setEtapePerdueVisee(null); setRaisonSaisie(''); }}
                            className="btn-secondary text-[12px] px-3 py-1.5"
                          >
                            {fr ? 'Annuler' : 'Cancel'}
                          </button>
                          <button
                            type="button"
                            disabled={!raisonSaisie.trim() || enEcriture}
                            onClick={confirmerPerte}
                            className="btn-primary text-[12px] px-3 py-1.5 disabled:opacity-50"
                          >
                            {fr ? 'Marquer perdu' : 'Mark lost'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/*
                      Abandonner ≠ perdre. « Perdu » veut dire que le client a
                      dit non ; « abandonné » qu'il ne répond plus. Les
                      confondre fait compter comme défaite commerciale un deal
                      qui n'a jamais été arbitré.
                      On ne le propose que sur un deal encore ouvert.
                    */}
                    {!etapePerdue && etape?.kind !== 'won' && !etapePerdueVisee && (
                      abandonVise ? (
                        <div className="mt-2.5 rounded-xl border border-outline bg-surface-secondary p-3">
                          <label htmlFor={idRaisonAbandon} className="block text-[11px] text-text-tertiary mb-1">
                            {fr ? 'Pourquoi abandonner ? (facultatif)' : 'Why abandon it? (optional)'}
                          </label>
                          <textarea
                            id={idRaisonAbandon}
                            rows={2}
                            value={raisonAbandon}
                            onChange={(e) => setRaisonAbandon(e.target.value)}
                            placeholder={fr ? 'Ex. : injoignable après 4 relances' : 'e.g. unreachable after 4 follow-ups'}
                            className="input-field w-full text-[12.5px] resize-none"
                          />
                          <p className="mt-1.5 text-[10.5px] text-text-muted">
                            {fr
                              ? "Le deal sort du pipeline sans compter comme une défaite commerciale."
                              : 'The deal leaves the pipeline without counting as a commercial loss.'}
                          </p>
                          <div className="flex justify-end gap-2 mt-2">
                            <button
                              type="button"
                              onClick={() => { setAbandonVise(false); setRaisonAbandon(''); }}
                              className="btn-secondary text-[12px] px-3 py-1.5"
                            >
                              {fr ? 'Annuler' : 'Cancel'}
                            </button>
                            <button
                              type="button"
                              disabled={enEcriture}
                              onClick={confirmerAbandon}
                              className="btn-primary text-[12px] px-3 py-1.5 disabled:opacity-50"
                            >
                              {fr ? 'Abandonner' : 'Abandon'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAbandonVise(true)}
                          className="mt-2.5 text-[11.5px] text-text-tertiary underline-offset-2 hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary rounded"
                        >
                          {fr ? 'Abandonner ce deal…' : 'Abandon this deal…'}
                        </button>
                      )
                    )}

                    {/*
                      La date visée : c'est elle qui range le deal dans un
                      mois de la chronologie des prévisions. Sans elle, il
                      tombe dans « Sans date » — visible, pas caché.
                      La reporter compte comme un glissement ; l'avancer non.
                    */}
                    <div className="mt-2.5">
                      <label htmlFor={idDateFermeture} className="block text-[11px] text-text-tertiary mb-1">
                        {fr ? 'Fermeture visée' : 'Expected close date'}
                      </label>
                      <input
                        id={idDateFermeture}
                        type="date"
                        value={deal.expected_close_date ?? ''}
                        onChange={(e) => {
                          void ecrire(
                            () => majDateFermeture(deal.id, e.target.value || null),
                            fr ? 'Date enregistrée.' : 'Date saved.',
                          );
                        }}
                        className="input-field w-full text-[12.5px]"
                      />
                    </div>

                    <div className="mt-2.5 pt-1 border-t border-border-subtle divide-y divide-border-subtle">
                      <Ligne label={fr ? 'Créé' : 'Created'}>
                        {fr
                          ? `il y a ${depuis(deal.created_at, maintenant, fr)}`
                          : `${depuis(deal.created_at, maintenant, fr)} ago`}
                      </Ligne>
                      <Ligne label={fr ? 'Premier contact' : 'First contact'}>
                        {delai === null
                          ? (fr ? 'Jamais contacté' : 'Never contacted')
                          : delai < 1
                            ? (fr ? "moins d'une heure" : 'under an hour')
                            : `${Math.round(delai)} h`}
                      </Ligne>
                      <Ligne label={fr ? 'Dernière activité' : 'Last activity'}>
                        {fr
                          ? `il y a ${depuis(deal.last_activity_at, maintenant, fr)}`
                          : `${depuis(deal.last_activity_at, maintenant, fr)} ago`}
                      </Ligne>
                    </div>

                    {/*
                      Les champs propres à l'entreprise — superficie, type de
                      surface, nombre de fenêtres. Ce qui décide d'un prix en
                      service terrain, et qu'une note en texte libre perd.
                      Rien ne s'affiche tant qu'aucun champ n'est défini :
                      une section vide ferait croire à un écran cassé.
                    */}
                    {/* Champs personnalisés v2 : même panneau que client, job, devis,
                        facture (groupés par dossier, validés par type). */}
                    <CustomFieldsPanel objet="deal" entityId={deal.id} fr={fr} className="mt-3 border-t border-border-subtle pt-3"
                      titre={fr ? 'Informations du métier' : 'Business details'} />

                    {/* Le deal est DÉJÀ perdu : la raison se corrige sans changer d'étape. */}
                    {etapePerdue && !etapePerdueVisee && (
                      <div className="mt-2.5">
                        <ChampTexte
                          label={fr ? 'Raison de perte' : 'Loss reason'}
                          valeur={deal.lost_reason ?? ''}
                          placeholder={fr ? 'Pourquoi ce deal est-il perdu ?' : 'Why was this deal lost?'}
                          onEnregistrer={(v) => {
                            const raison = v.trim();
                            if (!raison) {
                              toast.error(fr ? 'La raison ne peut pas être vide.' : 'The reason cannot be empty.');
                              onChangement?.();
                              return;
                            }
                            void ecrire(
                              () => majRaisonPerte(deal.id, raison),
                              fr ? 'Raison enregistrée.' : 'Reason saved.',
                            );
                          }}
                        />
                      </div>
                    )}
                  </div>
                </Section>

                <Section titre={fr ? 'Assignation' : 'Assignment'}>
                  <label htmlFor={idAssignation} className="block text-[11px] text-text-tertiary mb-1.5">
                    {fr ? 'Responsable du deal' : 'Deal owner'}
                  </label>
                  <select
                    id={idAssignation}
                    value={deal.assigned_user_id ?? ''}
                    onChange={(e) => onAssigner(deal.id, e.target.value || null)}
                    className="input-field w-full text-[12.5px]"
                  >
                    <option value="">{fr ? 'Non assigné' : 'Unassigned'}</option>
                    {listeMembres.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </Section>
              </div>
            </div>
          )}

          {onglet === 'notes' && (
            <div className="mt-4">
              <SpecificNotes entityType="deal" entityId={deal.id} mode="full" />
            </div>
          )}

          {onglet === 'taches' && <OngletTaches dealId={deal.id} fr={fr} />}

          {onglet === 'activite' && (
            <>
              <Section titre={fr ? 'Historique des étapes' : 'Stage history'}>
                <ol className="space-y-2">
                  {historique.map((h) => (
                    <li key={h.id} className="flex items-start gap-2.5">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-text-muted shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-[12px] text-text-primary">
                          {nomEtape(h.from_stage_id)} → <span className="font-semibold">{nomEtape(h.to_stage_id)}</span>
                        </p>
                        <p className="text-[10.5px] text-text-muted">
                          {h.actor_type === 'automation' && (fr ? 'Automatisation' : 'Automation')}
                          {h.actor_type === 'lumi' && 'Lumi'}
                          {h.actor_type === 'system' && (fr ? 'Système' : 'System')}
                          {h.actor_type === 'user'
                            && (listeMembres.find((m) => m.id === h.actor_id)?.name
                              ?? (fr ? 'Utilisateur' : 'User'))}
                          {' · '}
                          {fr
                            ? `il y a ${depuis(h.created_at, maintenant, fr)}`
                            : `${depuis(h.created_at, maintenant, fr)} ago`}
                        </p>
                      </div>
                    </li>
                  ))}
                  {historique.length === 0 && (
                    <li className="text-[12px] text-text-muted">{fr ? 'Aucun mouvement.' : 'No movement yet.'}</li>
                  )}
                </ol>
              </Section>

              <Section titre={fr ? "Journal d'activité" : 'Activity log'}>
                <ActivityTimeline entityType="deal" entityId={deal.id} />
              </Section>
            </>
          )}

          {onglet === 'lie' && <OngletLie deal={deal} fr={fr} />}

            {onglet === 'rdv' && <OngletRendezVous deal={deal} fr={fr} />}

            {onglet === 'paiements' && <OngletPaiements deal={deal} fr={fr} />}
          </div>
        </div>
      </div>
    </Modal>
  );
}
