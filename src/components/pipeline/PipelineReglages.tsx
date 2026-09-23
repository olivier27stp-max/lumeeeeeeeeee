/**
 * Réglages du pipeline — étapes et actions, en blocs interchangeables.
 *
 * Deux garde-fous du chantier sont visibles ici :
 *  - archiver une étape qui contient des deals est REFUSÉ (il faut d'abord les
 *    déplacer) — et l'archivage n'efface jamais rien ;
 *  - supprimer une étape n'efface jamais ses actions en silence : on demande de
 *    les déplacer ou de les désactiver.
 * Les actions d'étape SONT des règles du moteur d'Automatisations, filtrées par
 * étape : la mention est affichée pour que ce ne soit pas une surprise.
 */
import { useId, useMemo, useState } from 'react';
import {
  Archive, ArrowDown, ArrowUp, Clock, Info, LogIn, LogOut, Plus, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { confirmer } from '../ui/ConfirmDialog';
import { useTranslation } from '../../i18n';
import type { MockDeal, MockStage, MockStageAction } from '../../lib/pipeline/mockData';
import {
  LIBELLE_ACTION, LIBELLE_DECLENCHEUR, LIBELLE_KIND, rangsOuverts, visuelEtape,
} from '../../lib/pipeline/presentation';

const ICONE_DECLENCHEUR = {
  stage_entered: LogIn,
  stage_exited: LogOut,
  stage_idle: Clock,
} as const;

function Aide({ texte }: { texte: string }) {
  return (
    <span className="inline-flex items-center text-text-muted" title={texte}>
      <Info size={12} aria-label={texte} />
    </span>
  );
}

// ── Une étape ──

function CarteEtape({
  etape, etapes, deals, actions, fr,
  onRenommer, onGuidance, onMonter, onDescendre, onArchiver, onDeplacerAction, onBasculerAction, onRetirerAction,
}: {
  etape: MockStage;
  etapes: MockStage[];
  deals: MockDeal[];
  actions: MockStageAction[];
  fr: boolean;
  onRenommer: (id: string, nomFr: string, nomEn: string) => void;
  onGuidance: (id: string, guidFr: string, guidEn: string) => void;
  onMonter: (id: string) => void;
  onDescendre: (id: string) => void;
  onArchiver: (id: string) => void;
  onDeplacerAction: (actionId: string, versEtapeId: string) => void;
  onBasculerAction: (actionId: string) => void;
  onRetirerAction: (actionId: string) => void;
}) {
  const idNomFr = useId();
  const idNomEn = useId();
  const idGuidFr = useId();
  const idGuidEn = useId();
  const [ouvert, setOuvert] = useState(false);

  const rangs = rangsOuverts(etapes);
  const v = visuelEtape(etape, rangs[etape.id] ?? 0);
  const nb = deals.filter((d) => d.stageId === etape.id).length;
  const mesActions = actions.filter((a) => a.stageId === etape.id).sort((a, b) => a.position - b.position);

  return (
    <div className="rounded-xl border border-outline bg-surface-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: v.teinte }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-text-primary truncate">
            {fr ? etape.nameFr : etape.nameEn}
          </p>
          <p className="text-[11px] text-text-muted">
            {fr ? LIBELLE_KIND[etape.kind].fr : LIBELLE_KIND[etape.kind].en}
            {' · '}
            {nb} {fr ? (nb > 1 ? 'deals' : 'deal') : nb > 1 ? 'deals' : 'deal'}
            {mesActions.length > 0 && ` · ${mesActions.length} ${fr ? 'action(s)' : 'action(s)'}`}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onMonter(etape.id)}
            aria-label={fr ? `Monter ${etape.nameFr}` : `Move ${etape.nameEn} up`}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            onClick={() => onDescendre(etape.id)}
            aria-label={fr ? `Descendre ${etape.nameFr}` : `Move ${etape.nameEn} down`}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
          >
            <ArrowDown size={14} />
          </button>
          <button
            type="button"
            onClick={() => onArchiver(etape.id)}
            aria-label={fr ? `Archiver ${etape.nameFr}` : `Archive ${etape.nameEn}`}
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
                value={etape.nameFr}
                onChange={(e) => onRenommer(etape.id, e.target.value, etape.nameEn)}
                className="input-field w-full text-[12.5px]"
              />
            </div>
            <div>
              <label htmlFor={idNomEn} className="block text-[11px] text-text-tertiary mb-1.5">
                {fr ? 'Nom (anglais)' : 'Name (English)'}
              </label>
              <input
                id={idNomEn}
                value={etape.nameEn}
                onChange={(e) => onRenommer(etape.id, etape.nameFr, e.target.value)}
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
                value={etape.guidanceFr}
                onChange={(e) => onGuidance(etape.id, e.target.value, etape.guidanceEn)}
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
                value={etape.guidanceEn}
                onChange={(e) => onGuidance(etape.id, etape.guidanceFr, e.target.value)}
                className="input-field w-full text-[12.5px] resize-none"
              />
            </div>
          </div>

          {/* Actions attachées */}
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">
              {fr ? 'Actions de cette étape' : 'Actions on this stage'}
              <Aide
                texte={
                  fr
                    ? "Ce sont des règles du moteur d'Automatisations, filtrées sur cette étape. Elles apparaissent aussi dans la page Automatisations."
                    : 'These are Automations-engine rules scoped to this stage. They also appear on the Automations page.'
                }
              />
            </p>

            <ul className="space-y-2">
              {mesActions.map((a) => {
                const IconeDecl = ICONE_DECLENCHEUR[a.trigger];
                return (
                  <li
                    key={a.id}
                    className="flex items-center gap-2.5 rounded-lg border border-border-subtle bg-surface-secondary px-3 py-2"
                  >
                    <IconeDecl size={13} className="text-text-muted shrink-0" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-text-primary truncate">
                        {fr ? a.labelFr : a.labelEn}
                      </p>
                      <p className="text-[10.5px] text-text-muted">
                        {fr ? LIBELLE_DECLENCHEUR[a.trigger].fr : LIBELLE_DECLENCHEUR[a.trigger].en}
                        {a.trigger === 'stage_idle' && a.idleDays !== null && ` ${a.idleDays} ${fr ? 'jours' : 'days'}`}
                        {' · '}
                        {fr ? LIBELLE_ACTION[a.actionType].fr : LIBELLE_ACTION[a.actionType].en}
                      </p>
                    </div>

                    <select
                      value={a.stageId}
                      onChange={(e) => onDeplacerAction(a.id, e.target.value)}
                      aria-label={fr ? `Déplacer l'action « ${a.labelFr} »` : `Move action “${a.labelEn}”`}
                      className="input-field text-[11px] py-1 max-w-[9rem]"
                    >
                      {etapes
                        .filter((e) => e.archivedAt === null)
                        .sort((x, y) => x.position - y.position)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {fr ? e.nameFr : e.nameEn}
                          </option>
                        ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => onBasculerAction(a.id)}
                      className={`text-[10.5px] font-medium px-2 py-1 rounded-full transition-colors ${
                        a.enabled
                          ? 'bg-green-500/15 text-green-700 dark:text-green-400'
                          : 'bg-surface-tertiary text-text-muted'
                      }`}
                    >
                      {a.enabled ? (fr ? 'Active' : 'On') : fr ? 'Inactive' : 'Off'}
                    </button>

                    <button
                      type="button"
                      onClick={() => onRetirerAction(a.id)}
                      aria-label={fr ? `Retirer l'action « ${a.labelFr} »` : `Remove action “${a.labelEn}”`}
                      className="p-1 rounded-md text-text-muted hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                );
              })}

              {mesActions.length === 0 && (
                <li className="text-[12px] text-text-muted py-1">
                  {fr ? 'Aucune action à cette étape.' : 'No action on this stage.'}
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Écran ──

export default function PipelineReglages({ etapes, deals, actions, onChangement }: {
  etapes: MockStage[];
  deals: MockDeal[];
  actions: MockStageAction[];
  onChangement: (etapes: MockStage[], actions: MockStageAction[]) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const visibles = useMemo(
    () => [...etapes].filter((e) => e.archivedAt === null).sort((a, b) => a.position - b.position),
    [etapes],
  );
  const archivees = useMemo(() => etapes.filter((e) => e.archivedAt !== null), [etapes]);

  function renommer(id: string, nomFr: string, nomEn: string) {
    onChangement(etapes.map((e) => (e.id === id ? { ...e, nameFr: nomFr, nameEn: nomEn } : e)), actions);
  }

  function guidance(id: string, guidFr: string, guidEn: string) {
    onChangement(etapes.map((e) => (e.id === id ? { ...e, guidanceFr: guidFr, guidanceEn: guidEn } : e)), actions);
  }

  function bouger(id: string, delta: -1 | 1) {
    const ordre = [...visibles];
    const i = ordre.findIndex((e) => e.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ordre.length) return;
    [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
    const positions = new Map(ordre.map((e, n) => [e.id, n + 1]));
    onChangement(
      etapes.map((e) => (positions.has(e.id) ? { ...e, position: positions.get(e.id) ?? e.position } : e)),
      actions,
    );
  }

  async function archiver(id: string) {
    const etape = etapes.find((e) => e.id === id);
    if (!etape) return;

    const nb = deals.filter((d) => d.stageId === id).length;
    if (nb > 0) {
      toast.error(
        fr
          ? `Impossible d'archiver : ${nb} deal(s) sont encore à cette étape. Déplace-les d'abord.`
          : `Cannot archive: ${nb} deal(s) still sit at this stage. Move them first.`,
      );
      return;
    }

    // Une étape ouverte/gagnée/perdue doit toujours rester représentée.
    const restantes = visibles.filter((e) => e.id !== id);
    if (!restantes.some((e) => e.kind === etape.kind)) {
      toast.error(
        fr
          ? `Il doit rester au moins une étape « ${LIBELLE_KIND[etape.kind].fr} ».`
          : `At least one “${LIBELLE_KIND[etape.kind].en}” stage must remain.`,
      );
      return;
    }

    const sesActions = actions.filter((a) => a.stageId === id);
    if (sesActions.length > 0) {
      const ok = await confirmer({
        title: fr ? "Et ses actions ?" : 'What about its actions?',
        message: fr
          ? `Cette étape porte ${sesActions.length} action(s). Elles seront DÉSACTIVÉES, pas supprimées — tu pourras les rattacher à une autre étape. Continuer ?`
          : `This stage carries ${sesActions.length} action(s). They will be DISABLED, not deleted — you can reattach them to another stage. Continue?`,
        confirmLabel: fr ? 'Archiver' : 'Archive',
      });
      if (!ok) return;
    }

    onChangement(
      etapes.map((e) => (e.id === id ? { ...e, archivedAt: new Date().toISOString() } : e)),
      actions.map((a) => (a.stageId === id ? { ...a, enabled: false } : a)),
    );
    toast.success(fr ? 'Étape archivée.' : 'Stage archived.');
  }

  function ajouterEtape() {
    const position = visibles.filter((e) => e.kind === 'open').length + 1;
    const nouvelle: MockStage = {
      id: `stg_${Date.now()}`,
      nameFr: 'Nouvelle étape',
      nameEn: 'New stage',
      guidanceFr: '',
      guidanceEn: '',
      position,
      kind: 'open',
      archivedAt: null,
    };
    // On insère avant les étapes terminales pour garder un ordre lisible.
    const reordonnees = [...visibles.filter((e) => e.kind === 'open'), nouvelle, ...visibles.filter((e) => e.kind !== 'open')];
    const positions = new Map(reordonnees.map((e, n) => [e.id, n + 1]));
    onChangement(
      [...etapes, nouvelle].map((e) => (positions.has(e.id) ? { ...e, position: positions.get(e.id) ?? e.position } : e)),
      actions,
    );
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
        <button type="button" onClick={ajouterEtape} className="btn-secondary text-[12.5px] inline-flex items-center gap-1.5">
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
            actions={actions}
            fr={fr}
            onRenommer={renommer}
            onGuidance={guidance}
            onMonter={(id) => bouger(id, -1)}
            onDescendre={(id) => bouger(id, 1)}
            onArchiver={archiver}
            onDeplacerAction={(actionId, vers) =>
              onChangement(etapes, actions.map((a) => (a.id === actionId ? { ...a, stageId: vers } : a)))
            }
            onBasculerAction={(actionId) =>
              onChangement(etapes, actions.map((a) => (a.id === actionId ? { ...a, enabled: !a.enabled } : a)))
            }
            onRetirerAction={async (actionId) => {
              const a = actions.find((x) => x.id === actionId);
              if (!a) return;
              const ok = await confirmer({
                title: fr ? "Retirer l'action ?" : 'Remove the action?',
                message: fr
                  ? `« ${a.labelFr} » ne se déclenchera plus à cette étape.`
                  : `“${a.labelEn}” will no longer run on this stage.`,
                confirmLabel: fr ? 'Retirer' : 'Remove',
                danger: true,
              });
              if (!ok) return;
              onChangement(etapes, actions.filter((x) => x.id !== actionId));
            }}
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
                {fr ? e.nameFr : e.nameEn}
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
