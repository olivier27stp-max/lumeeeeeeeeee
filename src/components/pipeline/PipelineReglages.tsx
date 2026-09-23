/**
 * Réglages du pipeline — étapes, renommage, ordre, archivage.
 *
 * Les garde-fous ne sont pas ici : ils sont EN BASE (une étape qui contient des
 * deals, ou la dernière étape de son type, refuse d'être archivée). L'écran se
 * contente de relayer le message que la base renvoie — c'est ce qui garantit
 * qu'un même refus vaut aussi pour Lumi, le MCP ou un script.
 *
 * Les champs texte sont sauvés au `blur`, jamais à la frappe : une écriture par
 * caractère saturerait PostgREST pour rien.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, Info, Plus, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { confirmer } from '../ui/ConfirmDialog';
import { useTranslation } from '../../i18n';
import {
  ajouterEtape, archiverEtape, renommerEtape, reordonnerEtapes,
  type Deal, type PipelineStage,
} from '../../lib/pipelineVentesApi';
import { LIBELLE_KIND, rangsOuverts, visuelEtape } from '../../lib/pipeline/presentation';
import type { MockStage } from '../../lib/pipeline/mockData';

/**
 * `presentation.ts` est typé sur la maquette : `visuelEtape` et `rangsOuverts`
 * ne lisent que `id`, `kind` et `position`, identiques entre les deux formes.
 */
function pourVisuel(e: PipelineStage): MockStage {
  return {
    id: e.id,
    nameFr: e.name_fr,
    nameEn: e.name_en,
    guidanceFr: e.guidance_fr,
    guidanceEn: e.guidance_en,
    position: e.position,
    kind: e.kind,
    archivedAt: e.archived_at,
  };
}

/** Message d'erreur de la base, affiché tel quel : c'est lui qui explique le refus. */
function messageErreur(e: unknown, fr: boolean): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fr ? 'Erreur inconnue' : 'Unknown error';
}

function Aide({ texte }: { texte: string }) {
  return (
    <span className="inline-flex items-center text-text-muted" title={texte}>
      <Info size={12} aria-label={texte} />
    </span>
  );
}

// ── Une étape ──

function CarteEtape({
  etape, etapes, deals, fr, onEnregistrer, onMonter, onDescendre, onArchiver,
}: {
  etape: PipelineStage;
  etapes: PipelineStage[];
  deals: Deal[];
  fr: boolean;
  onEnregistrer: (
    id: string,
    champs: Partial<Pick<PipelineStage, 'name_fr' | 'name_en' | 'guidance_fr' | 'guidance_en'>>,
  ) => void;
  onMonter: (id: string) => void;
  onDescendre: (id: string) => void;
  onArchiver: (id: string) => void;
}) {
  const idNomFr = useId();
  const idNomEn = useId();
  const idGuidFr = useId();
  const idGuidEn = useId();
  const [ouvert, setOuvert] = useState(false);

  // Brouillon local : la frappe reste fluide, l'écriture part au `blur`.
  const [nomFr, setNomFr] = useState(etape.name_fr);
  const [nomEn, setNomEn] = useState(etape.name_en);
  const [guidFr, setGuidFr] = useState(etape.guidance_fr);
  const [guidEn, setGuidEn] = useState(etape.guidance_en);

  // Une écriture refusée par la base laisse le brouillon désynchronisé : on le
  // recale sur la valeur réelle dès que le parent recharge les étapes.
  useEffect(() => {
    setNomFr(etape.name_fr);
    setNomEn(etape.name_en);
    setGuidFr(etape.guidance_fr);
    setGuidEn(etape.guidance_en);
  }, [etape.name_fr, etape.name_en, etape.guidance_fr, etape.guidance_en]);

  const rangs = rangsOuverts(etapes.map(pourVisuel));
  const v = visuelEtape(pourVisuel(etape), rangs[etape.id] ?? 0);
  const nb = deals.filter((d) => d.stage_id === etape.id).length;

  return (
    <div className="rounded-xl border border-outline bg-surface-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: v.teinte }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-text-primary truncate">
            {fr ? etape.name_fr : etape.name_en}
          </p>
          <p className="text-[11px] text-text-muted">
            {fr ? LIBELLE_KIND[etape.kind].fr : LIBELLE_KIND[etape.kind].en}
            {' · '}
            {nb} {nb > 1 ? 'deals' : 'deal'}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onMonter(etape.id)}
            aria-label={fr ? `Monter ${etape.name_fr}` : `Move ${etape.name_en} up`}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            onClick={() => onDescendre(etape.id)}
            aria-label={fr ? `Descendre ${etape.name_fr}` : `Move ${etape.name_en} down`}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
          >
            <ArrowDown size={14} />
          </button>
          <button
            type="button"
            onClick={() => onArchiver(etape.id)}
            aria-label={fr ? `Archiver ${etape.name_fr}` : `Archive ${etape.name_en}`}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
          >
            <Archive size={14} />
          </button>
          <button
            type="button"
            onClick={() => setOuvert((o) => !o)}
            className="ml-1 text-[11.5px] font-medium text-text-secondary hover:text-text-primary px-2 py-1 rounded-md hover:bg-surface-secondary transition-colors"
          >
            {ouvert ? (fr ? 'Fermer' : 'Close') : fr ? 'Modifier' : 'Edit'}
          </button>
        </div>
      </div>

      {ouvert && (
        <div className="px-4 pb-4 pt-1 border-t border-border-subtle space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={idNomFr} className="block text-[11px] text-text-tertiary mb-1.5">
                {fr ? 'Nom (français)' : 'Name (French)'}
              </label>
              <input
                id={idNomFr}
                value={nomFr}
                onChange={(e) => setNomFr(e.target.value)}
                onBlur={() => { if (nomFr !== etape.name_fr) onEnregistrer(etape.id, { name_fr: nomFr }); }}
                className="input-field w-full text-[12.5px]"
              />
            </div>
            <div>
              <label htmlFor={idNomEn} className="block text-[11px] text-text-tertiary mb-1.5">
                {fr ? 'Nom (anglais)' : 'Name (English)'}
              </label>
              <input
                id={idNomEn}
                value={nomEn}
                onChange={(e) => setNomEn(e.target.value)}
                onBlur={() => { if (nomEn !== etape.name_en) onEnregistrer(etape.id, { name_en: nomEn }); }}
                className="input-field w-full text-[12.5px]"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={idGuidFr} className="flex items-center gap-1.5 text-[11px] text-text-tertiary mb-1.5">
                {fr ? 'Conseil affiché (français)' : 'Guidance shown (French)'}
                <Aide
                  texte={
                    fr
                      ? "Affiché dans la fiche du deal, à cette étape seulement."
                      : 'Shown in the deal panel, at this stage only.'
                  }
                />
              </label>
              <textarea
                id={idGuidFr}
                rows={3}
                value={guidFr}
                onChange={(e) => setGuidFr(e.target.value)}
                onBlur={() => { if (guidFr !== etape.guidance_fr) onEnregistrer(etape.id, { guidance_fr: guidFr }); }}
                className="input-field w-full text-[12.5px] resize-none"
              />
            </div>
            <div>
              <label htmlFor={idGuidEn} className="block text-[11px] text-text-tertiary mb-1.5">
                {fr ? 'Conseil affiché (anglais)' : 'Guidance shown (English)'}
              </label>
              <textarea
                id={idGuidEn}
                rows={3}
                value={guidEn}
                onChange={(e) => setGuidEn(e.target.value)}
                onBlur={() => { if (guidEn !== etape.guidance_en) onEnregistrer(etape.id, { guidance_en: guidEn }); }}
                className="input-field w-full text-[12.5px] resize-none"
              />
            </div>
          </div>

          {/* Les actions d'étape n'existent pas encore côté base : rien n'est
              affiché de faux, on annonce simplement ce qui vient. */}
          <div className="rounded-lg border border-border-subtle bg-surface-secondary px-3.5 py-3">
            <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-secondary">
              <Workflow size={13} aria-hidden="true" />
              {fr ? 'Automatisations par étape' : 'Per-stage automations'}
            </p>
            <p className="text-[11.5px] text-text-muted mt-1 leading-relaxed">
              {fr
                ? "Bientôt : déclencher un courriel, un SMS ou une tâche à l'entrée dans cette étape, ou après quelques jours sans activité."
                : 'Coming soon: trigger an email, a text or a task when a deal enters this stage, or after a few days without activity.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Écran ──

export default function PipelineReglages({ pipelineId, etapes, deals, onChangement }: {
  pipelineId: string;
  etapes: PipelineStage[];
  deals: Deal[];
  onChangement: () => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const visibles = useMemo(
    () => [...etapes].filter((e) => e.archived_at === null).sort((a, b) => a.position - b.position),
    [etapes],
  );
  const archivees = useMemo(() => etapes.filter((e) => e.archived_at !== null), [etapes]);

  async function enregistrer(
    id: string,
    champs: Partial<Pick<PipelineStage, 'name_fr' | 'name_en' | 'guidance_fr' | 'guidance_en'>>,
  ) {
    try {
      await renommerEtape(id, champs);
      onChangement();
    } catch (e) {
      console.error('[PipelineReglages] renommage refusé', e);
      toast.error(messageErreur(e, fr));
      onChangement();
    }
  }

  async function bouger(id: string, delta: -1 | 1) {
    const ordre = [...visibles];
    const i = ordre.findIndex((e) => e.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ordre.length) return;
    [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
    try {
      await reordonnerEtapes(ordre.map((e, n) => ({ id: e.id, position: n + 1 })));
      onChangement();
    } catch (e) {
      console.error('[PipelineReglages] réordonnancement refusé', e);
      toast.error(messageErreur(e, fr));
      onChangement();
    }
  }

  async function archiver(id: string) {
    const etape = etapes.find((e) => e.id === id);
    if (!etape) return;

    const ok = await confirmer({
      title: fr ? "Archiver l'étape ?" : 'Archive the stage?',
      message: fr
        ? `« ${etape.name_fr} » disparaîtra du board mais reste comptée dans les statistiques. Rien n'est effacé.`
        : `“${etape.name_en}” will leave the board but stays counted in statistics. Nothing is deleted.`,
      confirmLabel: fr ? 'Archiver' : 'Archive',
    });
    if (!ok) return;

    try {
      // La base refuse elle-même une étape qui porte des deals ou la dernière
      // de son type : son message est plus précis que tout test fait ici.
      await archiverEtape(id);
      onChangement();
      toast.success(fr ? 'Étape archivée.' : 'Stage archived.');
    } catch (e) {
      console.error('[PipelineReglages] archivage refusé', e);
      toast.error(messageErreur(e, fr));
      onChangement();
    }
  }

  async function ajouter() {
    const position = visibles.filter((e) => e.kind === 'open').length + 1;
    try {
      await ajouterEtape(pipelineId, {
        name_fr: 'Nouvelle étape',
        name_en: 'New stage',
        position,
      });
      onChangement();
    } catch (e) {
      console.error('[PipelineReglages] ajout refusé', e);
      toast.error(messageErreur(e, fr));
      onChangement();
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold text-text-primary">
            {fr ? 'Étapes du pipeline' : 'Pipeline stages'}
          </h2>
          <p className="text-[12px] text-text-tertiary mt-0.5 max-w-xl leading-relaxed">
            {fr
              ? "Renomme, réordonne, ajoute ou archive. Rien ne dépend du nom d'une étape : renommer « Relance » ne change aucun comportement."
              : 'Rename, reorder, add or archive. Nothing depends on a stage name: renaming “Follow-up” changes no behaviour.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void ajouter(); }}
          className="btn-secondary text-[12.5px] inline-flex items-center gap-1.5"
        >
          <Plus size={14} aria-hidden="true" />
          {fr ? 'Ajouter une étape' : 'Add a stage'}
        </button>
      </div>

      <div className="space-y-2.5">
        {visibles.map((etape) => (
          <CarteEtape
            key={etape.id}
            etape={etape}
            etapes={etapes}
            deals={deals}
            fr={fr}
            onEnregistrer={(id, champs) => { void enregistrer(id, champs); }}
            onMonter={(id) => { void bouger(id, -1); }}
            onDescendre={(id) => { void bouger(id, 1); }}
            onArchiver={(id) => { void archiver(id); }}
          />
        ))}
      </div>

      {archivees.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">
            {fr ? 'Étapes archivées' : 'Archived stages'}
          </h3>
          <ul className="space-y-1.5">
            {archivees.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-secondary px-3 py-2 text-[12px] text-text-tertiary"
              >
                <Archive size={12} aria-hidden="true" />
                {fr ? e.name_fr : e.name_en}
                <span className="text-[10.5px] text-text-muted ml-auto">
                  {fr ? 'conservée dans les statistiques' : 'kept in statistics'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
