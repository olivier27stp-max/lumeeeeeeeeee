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
import { useCallback, useMemo, useState } from 'react';
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
import PipelinePrevisions from '../components/pipeline/PipelinePrevisions';
import PipelineJournalLots from '../components/pipeline/PipelineJournalLots';
import { useTranslation } from '../i18n';
import { hasPermission } from '../lib/permissions';
import { usePermissions } from '../hooks/usePermissions';
import {
  assignerDeal, deplacerDeal, fetchDeals, fetchMembres, fetchMontants, fetchMontantsDetailles,
  fetchPipelineDefaut, fetchPipelines, fetchStages, lierJob, marquerPerdu, nomClient,
  type Deal, type PipelineStage,
} from '../lib/pipelineVentesApi';

/**
 * « Statistiques » a été absorbé par « Prévisions » : c'était la même
 * question posée deux fois — ce qui s'est passé, et ce qui va arriver. Les
 * anciens liens `?tab=stats` retombent sur Prévisions plutôt que sur le
 * board, pour atterrir là où la donnée a déménagé.
 */
type Onglet = 'board' | 'previsions' | 'lots' | 'reglages';

/**
 * Le dernier pipeline consulté, par navigateur. Pas en base : c'est une
 * commodité d'affichage, pas une donnée d'entreprise — et une lecture
 * refusée (navigation privée) doit simplement retomber sur le défaut.
 */
const CLE_PIPELINE_VU = 'lume-pipeline-vu';

export default function Pipeline() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [params, setParams] = useSearchParams();
  const brut = params.get('tab');
  // Redirection douce des liens déjà partagés, signets compris.
  const onglet = (brut === 'stats' ? 'previsions' : brut) as Onglet || 'board';
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

  // Tous les pipelines, pour que le sélecteur du board en propose vraiment
  // plusieurs. Auparavant il affichait une option codée en dur : on pouvait
  // créer un 2e pipeline sans jamais pouvoir le consulter.
  const pipelinesQ = useQuery({
    queryKey: ['pipeline-liste'],
    queryFn: fetchPipelines,
    staleTime: 300_000,
  });
  const pipelines = useMemo(() => pipelinesQ.data ?? [], [pipelinesQ.data]);

  // Le pipeline REGARDÉ, qui n'est pas forcément celui par défaut : consulter
  // un autre tableau ne doit pas changer un réglage d'organisation.
  // Mémorisé par utilisateur et par navigateur — c'est une commodité
  // d'affichage, pas une donnée : elle n'a rien à faire en base.
  const [pipelineChoisi, setPipelineChoisi] = useState<string | null>(() => {
    try { return localStorage.getItem(CLE_PIPELINE_VU); } catch { return null; }
  });

  const choisirPipeline = useCallback((id: string) => {
    setPipelineChoisi(id);
    try { localStorage.setItem(CLE_PIPELINE_VU, id); } catch { /* navigation privée */ }
  }, []);

  // Un pipeline mémorisé qui n'existe plus (supprimé, ou org changée) ne doit
  // pas laisser le board vide : on retombe sur le défaut.
  const pipelineId = useMemo(() => {
    if (pipelineChoisi && pipelines.some((p) => p.id === pipelineChoisi)) return pipelineChoisi;
    return pipelineQ.data?.id ?? null;
  }, [pipelineChoisi, pipelines, pipelineQ.data]);

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
  // Les montants AVEC provenance, pour la fiche seulement : le board écarte
  // les chiffres spéculatifs, la fiche les explique.
  const detailsQ = useQuery({
    queryKey: ['pipeline-montants-details', pipelineId],
    queryFn: fetchMontantsDetailles,
    enabled: !!pipelineId,
    staleTime: 60_000,
  });

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

  /**
   * La fiche suit les données rechargées.
   *
   * `dealOuvert` est une copie prise au clic. Après une écriture, la liste
   * `deals` porte la version à jour — mais la fiche continuait d'afficher
   * l'ancienne : on changeait l'étape, le toast confirmait, et le champ
   * revenait à sa valeur précédente. On relit donc toujours la version
   * fraîche, en retombant sur la copie tant que la requête n'a pas répondu.
   */
  const dealAffiche = useMemo<Deal | null>(() => {
    if (!dealOuvert) return null;
    return deals.find((d) => d.id === dealOuvert.id) ?? dealOuvert;
  }, [dealOuvert, deals]);
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
    // Les prévisions suivent le board : c'est la même question, projetée.
    { cle: 'previsions', libelle: fr ? 'Prévisions' : 'Forecast', visible: voitLesStats },
    // Le journal des lots : réservé aux patrons, comme les actions elles-mêmes.
    { cle: 'lots', libelle: fr ? 'Actions en lot' : 'Bulk actions', visible: estPatron },
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
            pipelines={pipelines}
          pipelineActif={pipelineId}
          modeCouleur={pipelines.find((p) => p.id === pipelineId)?.color_mode ?? 'dot'}
          onChangerPipeline={choisirPipeline}
          // Créer un pipeline est un geste d'administration : la base le
          // refuserait de toute façon, autant ne pas proposer la porte.
          onCreerPipeline={peutConfigurer ? () => choisirOnglet('reglages') : undefined}
          onAssigner={assigner}
            onChangement={rafraichir}
          />
        )}

        {ongletActif === 'previsions' && voitLesStats && (
          <PipelinePrevisions
            pipelines={pipelines}
            pipelineActif={pipelineId}
            onOuvrirDeal={(id) => {
              const d = deals.find((x) => x.id === id);
              if (d) { setDealOuvert(d); choisirOnglet('board'); }
            }}
          />
        )}

        {ongletActif === 'lots' && estPatron && <PipelineJournalLots />}


        {ongletActif === 'reglages' && peutConfigurer && (
          <PipelineReglages
            pipelineId={pipelineId}
            etapes={etapes}
            deals={deals}
            onOuvrirPipeline={(id) => { choisirPipeline(id); choisirOnglet('board'); }}
            onChangement={() => {
              qc.invalidateQueries({ queryKey: ['pipeline-stages', pipelineId] });
              // La LISTE aussi : supprimer un pipeline ou changer le défaut
              // laissait le sélecteur du board proposer l'ancien état
              // pendant cinq minutes (staleTime).
              qc.invalidateQueries({ queryKey: ['pipeline-liste'] });
              qc.invalidateQueries({ queryKey: ['pipeline-defaut'] });
              rafraichir();
            }}
          />
        )}
      </div>

      <DealDrawer
        deal={dealAffiche}
        etapes={etapes}
        membres={membresQ.data ?? []}
        // La provenance vient de la BASE, elle n'est plus devinée depuis
        // `job_id`/`quote_id` : `pipeline_montants` connaît le cas « dernier
        // devis du client », que la page ne pouvait pas distinguer.
        montantCents={dealAffiche ? (detailsQ.data?.[dealAffiche.id]?.cents ?? null) : null}
        montantProvenance={
          (dealAffiche ? detailsQ.data?.[dealAffiche.id]?.provenance : undefined) ?? 'aucun'
        }
        onClose={() => setDealOuvert(null)}
        onChangement={() => {
          // Le montant vient d'une AUTRE requête que les deals : changer le
          // devis lié sans la rafraîchir laisserait le board afficher
          // l'ancien montant.
          qc.invalidateQueries({ queryKey: ['pipeline-montants-details', pipelineId] });
          rafraichir();
        }}
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
