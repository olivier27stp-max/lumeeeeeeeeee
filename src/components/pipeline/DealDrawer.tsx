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
import { Briefcase, ExternalLink, FileText, Hammer, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import Modal from '../ui/Modal';
import SpecificNotes from '../SpecificNotes';
import ActivityTimeline from '../ActivityTimeline';
import { useTranslation } from '../../i18n';
import { versDate } from '../../lib/dateSeule';
import {
  basculerTacheDeal, creerTacheDeal, deplacerDeal, estJobACreer, fetchElementsLies,
  fetchHistorique, fetchTachesDuDeal, majContactDuDeal, majRaisonPerte, majSourceDuDeal,
  marquerPerdu, nomClient,
  type ContactClient, type Deal, type PipelineStage, type TacheDeal,
} from '../../lib/pipelineVentesApi';
import { LIBELLE_SOURCE, depuis, montant } from '../../lib/pipeline/presentation';
import type { DealSource } from '../../lib/pipeline/mockData';

interface Membre { id: string; name: string }

/** Provenance du montant affiché — calculée par `pipeline_montants` en base. */
export type MontantProvenance = 'job' | 'devis' | 'devis_client' | 'aucun';

type Onglet = 'apercu' | 'notes' | 'taches' | 'activite' | 'lie';

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
        {isLoading && <Vide texte={fr ? 'Chargement…' : 'Loading…'} />}
        {!isLoading && taches.length === 0 && (
          <Vide texte={fr ? 'Aucune tâche sur ce deal.' : 'No task on this deal.'} />
        )}
        {taches.length > 0 && (
          <ul className="rounded-xl border border-outline bg-surface-card divide-y divide-border-subtle">
            {taches.map((t) => {
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

function OngletLie({ deal, fr }: { deal: Deal; fr: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['deal-lies', deal.id, deal.job_id, deal.quote_id],
    queryFn: () => fetchElementsLies(deal),
  });

  const job = data?.job ?? null;
  const devis = data?.devis ?? null;
  const paiements = data?.paiements ?? [];

  return (
    <>
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
  const idOnglets = useId();
  const [onglet, setOnglet] = useState<Onglet>('apercu');
  const listeMembres = useMemo(() => membres ?? [], [membres]);

  // Étape « en attente d'une raison » : un passage vers une étape `lost` n'est
  // écrit qu'une fois la raison saisie. Tant qu'elle manque, le deal n'a pas
  // bougé — et le sélecteur montre l'étape RÉELLE, pas celle qu'on vise.
  const [etapePerdueVisee, setEtapePerdueVisee] = useState<string | null>(null);
  const [raisonSaisie, setRaisonSaisie] = useState('');
  const [enEcriture, setEnEcriture] = useState(false);

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
    setOnglet('apercu');
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

  const ONGLETS: { cle: Onglet; libelle: string }[] = [
    { cle: 'apercu', libelle: fr ? 'Aperçu' : 'Overview' },
    { cle: 'notes', libelle: fr ? 'Notes' : 'Notes' },
    { cle: 'taches', libelle: fr ? 'Tâches' : 'Tasks' },
    { cle: 'activite', libelle: fr ? 'Activité' : 'Activity' },
    { cle: 'lie', libelle: fr ? 'Lié' : 'Linked' },
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
        </header>

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

        <div className="tab-nav mt-4" role="tablist" aria-label={fr ? 'Sections du deal' : 'Deal sections'}>
          {ONGLETS.map((o) => (
            <button
              key={o.cle}
              type="button"
              role="tab"
              id={`${idOnglets}-${o.cle}`}
              aria-selected={onglet === o.cle}
              aria-controls={`${idOnglets}-${o.cle}-panneau`}
              tabIndex={onglet === o.cle ? 0 : -1}
              className={onglet === o.cle ? 'tab-item-active' : 'tab-item'}
              onClick={() => setOnglet(o.cle)}
            >
              {o.libelle}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`${idOnglets}-${onglet}-panneau`}
          aria-labelledby={`${idOnglets}-${onglet}`}
          className="mt-1"
        >
          {onglet === 'apercu' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-6">
              {/* Colonne gauche — la valeur et à qui l'on parle. */}
              <div>
                <Section titre={fr ? 'Valeur' : 'Value'}>
                  <div className="rounded-xl border border-outline bg-surface-card px-3.5 py-3">
                    <p className="text-[22px] font-semibold text-text-primary tabular-nums leading-none">
                      {montantCents != null && montantCents > 0 ? montant(montantCents, fr) : '—'}
                    </p>
                    <p className="text-[11px] text-text-tertiary mt-1.5">
                      {LIBELLE_PROVENANCE[provenance]}
                    </p>
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
                        <textarea
                          id={idRaisonPerte}
                          rows={2}
                          value={raisonSaisie}
                          onChange={(e) => setRaisonSaisie(e.target.value)}
                          placeholder={fr ? 'Ex. : a choisi un concurrent 15 % moins cher' : 'e.g. chose a competitor 15% cheaper'}
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
        </div>
      </div>
    </Modal>
  );
}
