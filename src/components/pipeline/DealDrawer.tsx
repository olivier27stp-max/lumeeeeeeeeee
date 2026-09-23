/**
 * Drawer d'un deal — contact, source + UTM, guidance de l'étape, historique,
 * assignation, lien vers la job.
 *
 * La guidance est le « Path » de Salesforce : le conseil de l'étape courante,
 * affiché là où le vendeur travaille. Elle vient de l'étape, jamais du deal.
 */
import { useId, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Hammer, MapPin } from 'lucide-react';
import { Drawer } from '../ui/drawer';
import { useTranslation } from '../../i18n';
import {
  estJobACreer, fetchHistorique, nomClient, type Deal, type PipelineStage,
} from '../../lib/pipelineVentesApi';
import { LIBELLE_SOURCE, depuis } from '../../lib/pipeline/presentation';
import type { DealSource } from '../../lib/pipeline/mockData';

interface Membre { id: string; name: string }

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

export default function DealDrawer({ deal, etapes, membres, onClose, onAssigner, onCreerJob }: {
  deal: Deal | null;
  etapes: PipelineStage[];
  membres?: Membre[];
  onClose: () => void;
  onAssigner: (dealId: string, membreId: string | null) => void;
  onCreerJob: (deal: Deal) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const idAssignation = useId();
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

  return (
    <Drawer open onClose={onClose} title={nomClient(deal)} width="lg">
      {/* Guidance de l'étape — le « Path » */}
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

      {deal.job_id && (
        <Section titre={fr ? 'Job liée' : 'Linked job'}>
          <div className="rounded-xl border border-outline bg-surface-card p-3.5">
            <p className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-primary">
              <Briefcase size={13} aria-hidden="true" />
              {deal.job_id}
            </p>
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
    </Drawer>
  );
}
