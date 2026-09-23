/**
 * Pipeline de ventes — MAQUETTE (Phase 1, données mock, zéro backend).
 *
 * L'avant-job : les leads entrent, avancent dans des étapes renommables, et
 * « Gagné » mène à la création d'une job. Trois onglets : Board, Statistiques,
 * Réglages.
 *
 * Tout l'état vit ici, en mémoire. Aucun appel réseau, aucune écriture : c'est
 * l'écran à valider AVANT de toucher à la base.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GitBranch } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '../components/ui/PageHeader';
import PipelineBoard from '../components/pipeline/PipelineBoard';
import DealDrawer from '../components/pipeline/DealDrawer';
import GagneJobModal from '../components/pipeline/GagneJobModal';
import PerduModal from '../components/pipeline/PerduModal';
import PipelineReglages from '../components/pipeline/PipelineReglages';
import PipelineStats from '../components/pipeline/PipelineStats';
import { useTranslation } from '../i18n';
import {
  MOCK_DEALS, MOCK_MEMBERS, MOCK_NOW, MOCK_STAGES, MOCK_STAGE_ACTIONS,
  type MockDeal, type MockStage, type MockStageAction,
} from '../lib/pipeline/mockData';

type Onglet = 'board' | 'stats' | 'reglages';

export default function Pipeline() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [params, setParams] = useSearchParams();
  const onglet = (params.get('tab') as Onglet) || 'board';

  const [deals, setDeals] = useState<MockDeal[]>(MOCK_DEALS);
  const [etapes, setEtapes] = useState<MockStage[]>(MOCK_STAGES);
  const [actions, setActions] = useState<MockStageAction[]>(MOCK_STAGE_ACTIONS);

  const [dealOuvert, setDealOuvert] = useState<MockDeal | null>(null);
  const [dealAGagner, setDealAGagner] = useState<MockDeal | null>(null);
  const [dealAPerdre, setDealAPerdre] = useState<MockDeal | null>(null);

  const etapeParId = useMemo(() => new Map(etapes.map((e) => [e.id, e])), [etapes]);

  function choisirOnglet(suivant: Onglet) {
    const sp = new URLSearchParams();
    if (suivant !== 'board') sp.set('tab', suivant);
    setParams(sp);
  }

  /** Déplacement depuis le board : les étapes terminales ouvrent une fenêtre. */
  function deplacer(dealId: string, versEtapeId: string) {
    const deal = deals.find((d) => d.id === dealId);
    const cible = etapeParId.get(versEtapeId);
    if (!deal || !cible) return;

    if (cible.kind === 'won') {
      // On marque gagné TOUT DE SUITE ; la job est proposée juste après.
      // Annuler la popup laisse le deal gagné, avec le badge « Job à créer ».
      appliquerEtape(dealId, versEtapeId, { wonAt: MOCK_NOW, lostAt: null, lostReason: null });
      setDealAGagner({ ...deal, stageId: versEtapeId });
      return;
    }

    if (cible.kind === 'lost') {
      setDealAPerdre({ ...deal, stageId: versEtapeId });
      return;
    }

    appliquerEtape(dealId, versEtapeId, { wonAt: null, lostAt: null });
  }

  function appliquerEtape(
    dealId: string,
    versEtapeId: string,
    extra: Partial<MockDeal> = {},
  ) {
    setDeals((prev) =>
      prev.map((d) =>
        d.id === dealId
          ? { ...d, stageId: versEtapeId, stageEnteredAt: MOCK_NOW, lastActivityAt: MOCK_NOW, ...extra }
          : d,
      ),
    );
  }

  const tabs: { cle: Onglet; libelle: string }[] = [
    { cle: 'board', libelle: fr ? 'Board' : 'Board' },
    { cle: 'stats', libelle: fr ? 'Statistiques' : 'Statistics' },
    { cle: 'reglages', libelle: fr ? 'Réglages' : 'Settings' },
  ];

  return (
    <>
      <PageHeader
        title={fr ? 'Pipeline' : 'Pipeline'}
        subtitle={
          fr
            ? `${deals.length} deals · maquette avec données de démonstration`
            : `${deals.length} deals · mockup with demo data`
        }
        icon={GitBranch}
      />

      <div className="tab-nav mt-4">
        {tabs.map((t) => (
          <button
            key={t.cle}
            type="button"
            className={onglet === t.cle ? 'tab-item-active' : 'tab-item'}
            onClick={() => choisirOnglet(t.cle)}
          >
            {t.libelle}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {onglet === 'board' && (
          <PipelineBoard
            deals={deals}
            etapes={etapes}
            onOuvrir={setDealOuvert}
            onDeplacer={deplacer}
          />
        )}

        {onglet === 'stats' && <PipelineStats deals={deals} etapes={etapes} onOuvrirDeal={setDealOuvert} />}

        {onglet === 'reglages' && (
          <PipelineReglages
            etapes={etapes}
            deals={deals}
            actions={actions}
            onChangement={(e, a) => {
              setEtapes(e);
              setActions(a);
            }}
          />
        )}
      </div>

      <DealDrawer
        deal={dealOuvert}
        etapes={etapes}
        onClose={() => setDealOuvert(null)}
        onAssigner={(dealId, membreId) => {
          const membre = MOCK_MEMBERS.find((m) => m.id === membreId) ?? null;
          setDeals((prev) =>
            prev.map((d) =>
              d.id === dealId
                ? { ...d, assignedUserId: membre?.id ?? null, assignedName: membre?.name ?? null, assignedAt: MOCK_NOW }
                : d,
            ),
          );
          setDealOuvert((d) =>
            d && d.id === dealId
              ? { ...d, assignedUserId: membre?.id ?? null, assignedName: membre?.name ?? null }
              : d,
          );
        }}
        onCreerJob={(deal) => {
          setDealOuvert(null);
          setDealAGagner(deal);
        }}
      />

      <GagneJobModal
        deal={dealAGagner}
        onFermer={() => {
          // Le deal reste gagné : le badge « Job à créer » est DÉRIVÉ.
          setDealAGagner(null);
          toast.info(fr ? 'Deal gagné — job à créer.' : 'Deal won — job to create.');
        }}
        onCreer={(dealId, titre) => {
          setDeals((prev) =>
            prev.map((d) =>
              d.id === dealId ? { ...d, jobId: `JOB-${dealId.slice(-4)}`, jobAmountCents: d.jobAmountCents ?? 0 } : d,
            ),
          );
          setDealAGagner(null);
          toast.success(fr ? `Job créée : ${titre}` : `Job created: ${titre}`);
        }}
      />

      <PerduModal
        deal={dealAPerdre}
        onFermer={() => setDealAPerdre(null)}
        onConfirmer={(dealId, raison) => {
          const deal = deals.find((d) => d.id === dealId);
          appliquerEtape(dealId, dealAPerdre?.stageId ?? '', {
            lostAt: MOCK_NOW,
            lostReason: raison,
            lostFromStageId: deal?.stageId ?? null,
            wonAt: null,
          });
          setDealAPerdre(null);
        }}
      />
    </>
  );
}
