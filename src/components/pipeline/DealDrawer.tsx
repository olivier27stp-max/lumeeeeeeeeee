/**
 * Fiche d'un deal — la même anatomie que les fiches de Lume (ClientDetails) :
 * un en-tête toujours visible, puis des onglets Aperçu / Notes / Tâches /
 * Activité / Lié.
 *
 * Ce qui reste HORS onglets, parce que c'est le conseil du moment et qu'il ne
 * doit pas se cacher derrière un clic : la guidance de l'étape (le « Path » de
 * Salesforce) et l'encart « Job à créer ».
 *
 * Le montant n'est jamais saisi sur le deal : il est DÉRIVÉ (job liée, devis
 * lié, ou dernier devis du client). La fiche affiche donc toujours d'où il
 * vient — un chiffre sans provenance se prend pour une promesse.
 */
import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, FileText, Hammer, MapPin, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Drawer } from '../ui/drawer';
import SpecificNotes from '../SpecificNotes';
import ActivityTimeline from '../ActivityTimeline';
import { useTranslation } from '../../i18n';
import { versDate } from '../../lib/dateSeule';
import {
  basculerTacheDeal, creerTacheDeal, estJobACreer, fetchElementsLies,
  fetchHistorique, fetchTachesDuDeal, nomClient,
  type Deal, type PipelineStage, type TacheDeal,
} from '../../lib/pipelineVentesApi';
import { LIBELLE_SOURCE, depuis, montant } from '../../lib/pipeline/presentation';
import type { DealSource } from '../../lib/pipeline/mockData';

interface Membre { id: string; name: string }

/** Provenance du montant affiché — calculée par `pipeline_montants` en base. */
export type MontantProvenance = 'job' | 'devis' | 'devis_client' | 'aucun';

type Onglet = 'apercu' | 'notes' | 'taches' | 'activite' | 'lie';


/** `deals.source` est du texte libre en base : un canal inconnu s'affiche tel quel. */
function libelleSource(source: string, fr: boolean): string {
  const connu = LIBELLE_SOURCE[source as DealSource];
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
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const idAssignation = useId();
  const idOnglets = useId();
  const [onglet, setOnglet] = useState<Onglet>('apercu');
  const listeMembres = useMemo(() => membres ?? [], [membres]);

  const etape = useMemo(
    () => (deal ? etapes.find((e) => e.id === deal.stage_id) ?? null : null),
    [deal, etapes],
  );

  // L'historique vient de la base : les triggers l'écrivent à chaque mouvement.
  const { data: historique = [] } = useQuery({
    queryKey: ['deal-historique', deal?.id],
    queryFn: () => fetchHistorique(deal?.id ?? ''),
    enabled: !!deal,
  });

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

  return (
    <Drawer open onClose={onClose} title={nomClient(deal)} width="lg">
      {/* Guidance de l'étape — le « Path ». Hors onglets : c'est le conseil du moment. */}
      {etape && (
        <div className="rounded-xl border border-outline bg-surface-secondary p-3.5">
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
          <>
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
              <div className="rounded-xl border border-outline bg-surface-card px-3.5 py-2 divide-y divide-border-subtle">
                <Ligne label={fr ? 'Nom' : 'Name'}>{nomClient(deal)}</Ligne>
                <Ligne label={fr ? 'Courriel' : 'Email'}>{deal.client?.email ?? '—'}</Ligne>
                <Ligne label={fr ? 'Téléphone' : 'Phone'}>{deal.client?.phone ?? '—'}</Ligne>
                <Ligne label={fr ? 'Adresse' : 'Address'}>
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={11} aria-hidden="true" className="text-text-muted shrink-0" />
                    {deal.client?.address ?? '—'}
                  </span>
                </Ligne>
              </div>
            </Section>

            <Section titre={fr ? 'Provenance' : 'Source'}>
              <div className="rounded-xl border border-outline bg-surface-card px-3.5 py-2 divide-y divide-border-subtle">
                <Ligne label={fr ? 'Source' : 'Source'}>{libelleSource(deal.source, fr)}</Ligne>
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
            </Section>

            <Section titre={fr ? 'Suivi' : 'Tracking'}>
              <div className="rounded-xl border border-outline bg-surface-card px-3.5 py-2 divide-y divide-border-subtle">
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
                {deal.lost_reason && <Ligne label={fr ? 'Raison de perte' : 'Loss reason'}>{deal.lost_reason}</Ligne>}
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
          </>
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
    </Drawer>
  );
}
