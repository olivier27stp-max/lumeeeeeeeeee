/**
 * Drawer d'un deal — contact, source + UTM, guidance de l'étape, historique,
 * actions exécutées, activités, assignation, lien vers la job.
 *
 * La guidance est le « Path » de Salesforce : le conseil de l'étape courante,
 * affiché là où le vendeur travaille. Elle vient de l'étape, jamais du deal.
 */
import { useId, useMemo } from 'react';
import {
  Bot, Briefcase, CheckCircle2, Hammer, Mail, MapPin, Phone, Sparkles, User, Zap,
} from 'lucide-react';
import { Drawer } from '../ui/drawer';
import { useTranslation } from '../../i18n';
import {
  MOCK_ACTIVITIES, MOCK_MEMBERS, MOCK_NOW, MOCK_STAGE_HISTORY, delaiPremierContactHeures,
  isJobACreer, type MockDeal, type MockStage,
} from '../../lib/pipeline/mockData';
import { LIBELLE_SOURCE, depuis, montant } from '../../lib/pipeline/presentation';

const ICONE_ACTIVITE = {
  note: Sparkles,
  call: Phone,
  sms: Phone,
  email: Mail,
  stage: Zap,
  action: Bot,
} as const;

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

export default function DealDrawer({ deal, etapes, onClose, onAssigner, onCreerJob }: {
  deal: MockDeal | null;
  etapes: MockStage[];
  onClose: () => void;
  onAssigner: (dealId: string, membreId: string | null) => void;
  onCreerJob: (deal: MockDeal) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const idAssignation = useId();

  const etape = useMemo(
    () => (deal ? etapes.find((e) => e.id === deal.stageId) ?? null : null),
    [deal, etapes],
  );
  const historique = useMemo(
    () => (deal ? MOCK_STAGE_HISTORY.filter((h) => h.dealId === deal.id) : []),
    [deal],
  );
  const activites = useMemo(
    () => (deal ? MOCK_ACTIVITIES.filter((a) => a.dealId === deal.id) : []),
    [deal],
  );

  if (!deal) return null;

  const jobACreer = isJobACreer(deal, etapes);
  const delai = delaiPremierContactHeures(deal);
  const nomEtape = (id: string | null) => {
    if (!id) return fr ? '(entrée)' : '(entry)';
    const e = etapes.find((x) => x.id === id);
    return e ? (fr ? e.nameFr : e.nameEn) : id;
  };

  return (
    <Drawer open onClose={onClose} title={deal.clientName} width="lg">
      {/* Guidance de l'étape — le « Path » */}
      {etape && (
        <div className="rounded-xl border border-outline bg-surface-secondary p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            {fr ? etape.nameFr : etape.nameEn}
          </p>
          <p className="text-[12.5px] text-text-secondary leading-relaxed mt-1.5">
            {fr ? etape.guidanceFr : etape.guidanceEn}
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

      <Section titre={fr ? 'Contact' : 'Contact'}>
        <div className="rounded-xl border border-outline bg-surface-card px-3.5 py-2 divide-y divide-border-subtle">
          <Ligne label={fr ? 'Nom' : 'Name'}>{deal.clientName}</Ligne>
          <Ligne label={fr ? 'Courriel' : 'Email'}>{deal.clientEmail ?? '—'}</Ligne>
          <Ligne label={fr ? 'Téléphone' : 'Phone'}>{deal.clientPhone ?? '—'}</Ligne>
          <Ligne label={fr ? 'Adresse' : 'Address'}>
            <span className="inline-flex items-center gap-1">
              <MapPin size={11} aria-hidden="true" className="text-text-muted shrink-0" />
              {deal.address}
            </span>
          </Ligne>
        </div>
      </Section>

      <Section titre={fr ? 'Provenance' : 'Source'}>
        <div className="rounded-xl border border-outline bg-surface-card px-3.5 py-2 divide-y divide-border-subtle">
          <Ligne label={fr ? 'Source' : 'Source'}>
            {fr ? LIBELLE_SOURCE[deal.source].fr : LIBELLE_SOURCE[deal.source].en}
          </Ligne>
          {deal.utmCampaign && <Ligne label="Campagne">{deal.utmCampaign}</Ligne>}
          {deal.utmContent && <Ligne label="Contenu">{deal.utmContent}</Ligne>}
          {deal.utmSource && <Ligne label="utm_source">{deal.utmSource}</Ligne>}
          {deal.utmMedium && <Ligne label="utm_medium">{deal.utmMedium}</Ligne>}
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
            {fr ? `il y a ${depuis(deal.createdAt, MOCK_NOW, fr)}` : `${depuis(deal.createdAt, MOCK_NOW, fr)} ago`}
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
              ? `il y a ${depuis(deal.lastActivityAt, MOCK_NOW, fr)}`
              : `${depuis(deal.lastActivityAt, MOCK_NOW, fr)} ago`}
          </Ligne>
          {deal.lostReason && <Ligne label={fr ? 'Raison de perte' : 'Loss reason'}>{deal.lostReason}</Ligne>}
        </div>
      </Section>

      <Section titre={fr ? 'Assignation' : 'Assignment'}>
        <label htmlFor={idAssignation} className="block text-[11px] text-text-tertiary mb-1.5">
          {fr ? 'Responsable du deal' : 'Deal owner'}
        </label>
        <select
          id={idAssignation}
          value={deal.assignedUserId ?? ''}
          onChange={(e) => onAssigner(deal.id, e.target.value || null)}
          className="input-field w-full text-[12.5px]"
        >
          <option value="">{fr ? 'Non assigné' : 'Unassigned'}</option>
          {MOCK_MEMBERS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </Section>

      {deal.jobId && (
        <Section titre={fr ? 'Job liée' : 'Linked job'}>
          <div className="rounded-xl border border-outline bg-surface-card p-3.5">
            <p className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-primary">
              <Briefcase size={13} aria-hidden="true" />
              {deal.jobId}
            </p>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[11.5px] text-text-tertiary">
                {fr ? 'Montant' : 'Amount'}{' '}
                <span className="font-semibold text-text-primary tabular-nums">
                  {montant(deal.jobAmountCents, fr)}
                </span>
              </span>
              <span className="text-[11.5px] text-text-tertiary">
                {fr ? 'Encaissé' : 'Collected'}{' '}
                <span className="font-semibold text-text-primary tabular-nums">
                  {montant(deal.invoicePaidCents, fr)}
                </span>
              </span>
            </div>
          </div>
        </Section>
      )}

      <Section titre={fr ? 'Historique des étapes' : 'Stage history'}>
        <ol className="space-y-2">
          {historique.map((h) => (
            <li key={h.id} className="flex items-start gap-2.5">
              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-text-muted shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[12px] text-text-primary">
                  {nomEtape(h.fromStageId)} → <span className="font-semibold">{nomEtape(h.toStageId)}</span>
                </p>
                <p className="text-[10.5px] text-text-muted">
                  {h.actorType === 'automation' && (fr ? 'Automatisation' : 'Automation')}
                  {h.actorType === 'lumi' && 'Lumi'}
                  {h.actorType === 'system' && (fr ? 'Système' : 'System')}
                  {h.actorType === 'user' && (h.actorName ?? (fr ? 'Utilisateur' : 'User'))}
                  {' · '}
                  {fr ? `il y a ${depuis(h.createdAt, MOCK_NOW, fr)}` : `${depuis(h.createdAt, MOCK_NOW, fr)} ago`}
                </p>
              </div>
            </li>
          ))}
          {historique.length === 0 && (
            <li className="text-[12px] text-text-muted">{fr ? 'Aucun mouvement.' : 'No movement yet.'}</li>
          )}
        </ol>
      </Section>

      <Section titre={fr ? 'Activités' : 'Activity'}>
        <ul className="space-y-2.5">
          {activites.map((a) => {
            const Icone = ICONE_ACTIVITE[a.kind] ?? Sparkles;
            const auto = a.kind === 'action';
            return (
              <li key={a.id} className="flex items-start gap-2.5">
                <span
                  className="grid place-items-center w-6 h-6 rounded-full bg-surface-tertiary text-text-secondary shrink-0"
                  aria-hidden="true"
                >
                  <Icone size={12} />
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] text-text-primary leading-relaxed">{a.body}</p>
                  <p className="text-[10.5px] text-text-muted mt-0.5">
                    {auto && (
                      <span className="inline-flex items-center gap-1 mr-1.5 text-text-tertiary">
                        <CheckCircle2 size={9} aria-hidden="true" />
                        {fr ? 'Action exécutée' : 'Action ran'}
                      </span>
                    )}
                    {!auto && a.authorName && (
                      <span className="inline-flex items-center gap-1 mr-1.5">
                        <User size={9} aria-hidden="true" />
                        {a.authorName}
                      </span>
                    )}
                    {fr ? `il y a ${depuis(a.createdAt, MOCK_NOW, fr)}` : `${depuis(a.createdAt, MOCK_NOW, fr)} ago`}
                  </p>
                </div>
              </li>
            );
          })}
          {activites.length === 0 && (
            <li className="text-[12px] text-text-muted">{fr ? 'Aucune activité.' : 'No activity yet.'}</li>
          )}
        </ul>
      </Section>
    </Drawer>
  );
}
