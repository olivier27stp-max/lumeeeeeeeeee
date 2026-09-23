/**
 * Pipeline de ventes — l'avant-job.
 *
 * Les leads entrent, avancent dans des étapes que le client renomme lui-même,
 * et « Gagné » mène à la création d'une job.
 *
 * Tout ce que l'écran affiche vient de la base : les statistiques passent par
 * les fonctions `pipeline_*` (SECURITY INVOKER, `org_id` dérivé de la session),
 * et les mouvements n'écrivent QUE l'étape — horodatages, historique et
 * événements sont posés par les triggers. C'est ce qui garantit qu'un deal
 * déplacé par Lumi, un import ou du SQL produit exactement le même résultat
 * qu'un glisser-déposer ici.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import PipelineBoard from '../components/pipeline/PipelineBoard';
import DealDrawer from '../components/pipeline/DealDrawer';
import GagneJobModal from '../components/pipeline/GagneJobModal';
import PerduModal from '../components/pipeline/PerduModal';
import PipelineReglages from '../components/pipeline/PipelineReglages';
import PipelineStats from '../components/pipeline/PipelineStats';
import { useTranslation } from '../i18n';
import { hasPermission } from '../lib/permissions';
import { usePermissions } from '../hooks/usePermissions';
import {
  assignerDeal, deplacerDeal, fetchDeals, fetchMembres, fetchMontants,
  fetchPipelineDefaut, fetchStages, lierJob, marquerPerdu, nomClient,
  type Deal, type PipelineStage,
} from '../lib/pipelineVentesApi';

type Onglet = 'board' | 'stats' | 'reglages';

export default function Pipeline() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [params, setParams] = useSearchParams();
  const onglet = (params.get('tab') as Onglet) || 'board';
  const qc = useQueryClient();

  const perms = usePermissions();
  const estPatron = perms.role === 'owner' || perms.role === 'admin';
  // Les revenus et la performance par vendeur restent réservés aux
  // propriétaires et administrateurs (décision Q7).
  const voitLesStats = estPatron
    || hasPermission(perms.permissions, 'financial.view_analytics', perms.role ?? undefined);
  const peutConfigurer = estPatron;

  const pipelineQ = useQuery({
    queryKey: ['pipeline-defaut'],
    queryFn: fetchPipelineDefaut,
    staleTime: 300_000,
  });
  const pipelineId = pipelineQ.data?.id ?? null;

  const stagesQ = useQuery({
    queryKey: ['pipeline-stages', pipelineId],
    queryFn: () => fetchStages(pipelineId as string),
    enabled: !!pipelineId,
    staleTime: 60_000,
  });

  const dealsQ = useQuery({
    queryKey: ['pipeline-deals', pipelineId],
    queryFn: () => fetchDeals(pipelineId as string),
    enabled: !!pipelineId,
    staleTime: 30_000,
  });

  // La valeur des deals est DÉRIVÉE (job, puis devis) : jamais stockée sur le
  // deal. Requête séparée pour que le board s'affiche sans l'attendre.
  const montantsQ = useQuery({
    queryKey: ['pipeline-montants', pipelineId],
    queryFn: fetchMontants,
    enabled: !!pipelineId,
    staleTime: 60_000,
  });

  const membresQ = useQuery({
    queryKey: ['pipeline-membres'],
    queryFn: fetchMembres,
    staleTime: 300_000,
  });

  const etapes = useMemo<PipelineStage[]>(() => stagesQ.data ?? [], [stagesQ.data]);
  const deals = useMemo<Deal[]>(() => dealsQ.data ?? [], [dealsQ.data]);
  const etapeParId = useMemo(() => new Map(etapes.map((e) => [e.id, e])), [etapes]);

  const [dealOuvert, setDealOuvert] = useState<Deal | null>(null);
  const [dealAGagner, setDealAGagner] = useState<Deal | null>(null);
  const [dealAPerdre, setDealAPerdre] = useState<{ deal: Deal; versEtapeId: string } | null>(null);

  const rafraichir = () => {
    qc.invalidateQueries({ queryKey: ['pipeline-deals', pipelineId] });
    qc.invalidateQueries({ queryKey: ['pipeline-montants', pipelineId] });
    qc.invalidateQueries({ queryKey: ['pipeline-stats'] });
  };

  /** Assignation — appelée par le menu « ⋮ » d'une carte et par la fiche. */
  async function assigner(dealId: string, membreId: string | null) {
    const membre = membresQ.data?.find((m) => m.id === membreId) ?? null;
    try {
      await assignerDeal(dealId, membreId);
      rafraichir();
      setDealOuvert((d) => (d && d.id === dealId ? { ...d, assigned_user_id: membreId } : d));
      toast.success(
        membre
          ? (fr ? `Assigné à ${membre.name}.` : `Assigned to ${membre.name}.`)
          : (fr ? 'Deal désassigné.' : 'Deal unassigned.'),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  function choisirOnglet(suivant: Onglet) {
    const sp = new URLSearchParams();
    if (suivant !== 'board') sp.set('tab', suivant);
    setParams(sp);
  }

  /** Déplacement depuis le board : les étapes terminales ouvrent une fenêtre. */
  async function deplacer(dealId: string, versEtapeId: string) {
    const deal = deals.find((d) => d.id === dealId);
    const cible = etapeParId.get(versEtapeId);
    if (!deal || !cible) return;

    if (cible.kind === 'lost') {
      // La raison est demandée AVANT d'écrire : un deal perdu sans raison
      // n'apprend rien sur les prix.
      setDealAPerdre({ deal, versEtapeId });
      return;
    }

    try {
      await deplacerDeal(dealId, versEtapeId);
      rafraichir();
      if (cible.kind === 'won') {
        // Le deal est gagné tout de suite ; la job est proposée juste après.
        // Annuler la fenêtre laisse le deal gagné, avec le badge « Job à créer ».
        setDealAGagner({ ...deal, stage_id: versEtapeId });
      } else {
        toast.success(fr ? `Déplacé vers « ${cible.name_fr} ».` : `Moved to “${cible.name_en}”.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
      rafraichir();
    }
  }

  const tabs: { cle: Onglet; libelle: string; visible: boolean }[] = [
    { cle: 'board', libelle: 'Board', visible: true },
    { cle: 'stats', libelle: fr ? 'Statistiques' : 'Statistics', visible: voitLesStats },
    { cle: 'reglages', libelle: fr ? 'Réglages' : 'Settings', visible: peutConfigurer },
  ];
  const ongletActif = tabs.find((t) => t.cle === onglet)?.visible ? onglet : 'board';

  if (pipelineQ.isLoading || stagesQ.isLoading) {
    return (
      <>
        <PageHeader title="Pipeline" icon={GitBranch} />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-7 w-7 animate-spin text-text-tertiary" aria-hidden="true" />
          <span className="sr-only">{fr ? 'Chargement…' : 'Loading…'}</span>
        </div>
      </>
    );
  }

  if (!pipelineId || etapes.length === 0) {
    return (
      <>
        <PageHeader title="Pipeline" icon={GitBranch} />
        <EmptyState
          icon={GitBranch}
          title={fr ? 'Pipeline non configuré' : 'Pipeline not set up'}
          description={
            fr
              ? "Aucun pipeline n'est encore rattaché à cette entreprise. Contacte le support : il se crée normalement tout seul."
              : 'No pipeline is attached to this company yet. Contact support — it is normally created automatically.'
          }
        />
      </>
    );
  }

  const ouverts = deals.filter((d) => etapeParId.get(d.stage_id)?.kind === 'open').length;

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={
          fr
            ? `${deals.length} deals · ${ouverts} en cours`
            : `${deals.length} deals · ${ouverts} open`
        }
        icon={GitBranch}
      />

      <div className="tab-nav mt-4">
        {tabs.filter((t) => t.visible).map((t) => (
          <button
            key={t.cle}
            type="button"
            className={ongletActif === t.cle ? 'tab-item-active' : 'tab-item'}
            onClick={() => choisirOnglet(t.cle)}
          >
            {t.libelle}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {ongletActif === 'board' && (
          <PipelineBoard
            deals={deals}
            etapes={etapes}
            montants={montantsQ.data ?? {}}
            membres={membresQ.data ?? []}
            chargement={dealsQ.isLoading}
            onOuvrir={setDealOuvert}
            onDeplacer={deplacer}
            onAssigner={assigner}
            onChangement={rafraichir}
          />
        )}

        {ongletActif === 'stats' && voitLesStats && (
          <PipelineStats onOuvrirDeal={(id) => {
            const d = deals.find((x) => x.id === id);
            if (d) { setDealOuvert(d); choisirOnglet('board'); }
          }} />
        )}

        {ongletActif === 'reglages' && peutConfigurer && (
          <PipelineReglages
            pipelineId={pipelineId}
            etapes={etapes}
            deals={deals}
            onChangement={() => {
              qc.invalidateQueries({ queryKey: ['pipeline-stages', pipelineId] });
              rafraichir();
            }}
          />
        )}
      </div>

      <DealDrawer
        deal={dealOuvert}
        etapes={etapes}
        membres={membresQ.data ?? []}
        montantCents={dealOuvert ? (montantsQ.data?.[dealOuvert.id] ?? null) : null}
        montantProvenance={
          dealOuvert && montantsQ.data?.[dealOuvert.id]
            ? (dealOuvert.job_id ? 'job' : dealOuvert.quote_id ? 'devis' : 'devis_client')
            : 'aucun'
        }
        onClose={() => setDealOuvert(null)}
        onAssigner={async (dealId, membreId) => {
          try {
            await assignerDeal(dealId, membreId);
            rafraichir();
            toast.success(membreId ? (fr ? 'Deal assigné.' : 'Deal assigned.') : (fr ? 'Deal désassigné.' : 'Deal unassigned.'));
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
          }
        }}
        onCreerJob={(deal) => { setDealOuvert(null); setDealAGagner(deal); }}
      />

      <GagneJobModal
        deal={dealAGagner}
        onFermer={() => {
          // Le deal RESTE gagné : le badge « Job à créer » est dérivé de
          // l'étape et de l'absence de job, jamais d'un indicateur stocké.
          setDealAGagner(null);
          toast.info(fr ? 'Deal gagné — job à créer.' : 'Deal won — job to create.');
        }}
        onCreer={async (dealId, jobId) => {
          try {
            await lierJob(dealId, jobId);
            rafraichir();
            setDealAGagner(null);
            toast.success(fr ? 'Job créée et liée au deal.' : 'Job created and linked.');
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
          }
        }}
      />

      <PerduModal
        deal={dealAPerdre?.deal ?? null}
        onFermer={() => setDealAPerdre(null)}
        onConfirmer={async (dealId, raison) => {
          if (!dealAPerdre) return;
          try {
            await marquerPerdu(dealId, dealAPerdre.versEtapeId, raison);
            rafraichir();
            setDealAPerdre(null);
            toast.success(fr ? `${nomClient(dealAPerdre.deal)} — marqué perdu.` : `${nomClient(dealAPerdre.deal)} — marked lost.`);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    </>
  );
}
