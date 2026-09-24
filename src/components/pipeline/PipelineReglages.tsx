/**
 * Réglages du pipeline — pipelines, étapes, conseils, ordre, archivage.
 *
 * Les garde-fous ne sont pas ici : ils sont EN BASE (une étape qui contient des
 * deals, ou la dernière étape de son type, refuse d'être archivée). L'écran se
 * contente de relayer le message que la base renvoie — c'est ce qui garantit
 * qu'un même refus vaut aussi pour Lumi, le MCP ou un script.
 *
 * Les champs texte sont sauvés au `blur`, jamais à la frappe : une écriture par
 * caractère saturerait PostgREST pour rien. Le nom d'une étape est un champ
 * VISIBLE, pas caché derrière un bouton « Modifier » : personne ne devine un
 * réglage qu'il ne voit pas.
 */
import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import {
  Archive, ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, Info, Layers,
  Loader2, Plus, Star, Workflow, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { confirmer } from '../ui/ConfirmDialog';
import CreerPipelineModal from './CreerPipelineModal';
import PipelinesTableau from './PipelinesTableau';
import { useTranslation } from '../../i18n';
import {
  ajouterEtape, ajouterRaisonProposee, archiverEtape, archiverRaisonProposee,
  donnerAccesPipeline, fetchAccesPipeline, fetchMembres, retirerAccesPipeline, rouvrirPipeline,
  creerPipeline, definirParDefaut, fetchPipelines, fetchRaisonsProposees,
  renommerEtape, renommerPipeline, reordonnerEtapes,
  type Deal, type ModelePipeline, type PipelineResume, type PipelineStage,
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

function Section({ titre, sousTitre, action, children }: {
  titre: string;
  sousTitre: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold text-text-primary">{titre}</h2>
          <p className="text-[12px] text-text-tertiary mt-0.5 max-w-xl leading-relaxed">{sousTitre}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const MODELES: { valeur: ModelePipeline; fr: string; en: string; aideFr: string; aideEn: string }[] = [
  {
    valeur: 'generique',
    fr: 'Générique',
    en: 'Generic',
    aideFr: 'Nouveau lead → Contacté → Soumission → Relance → Gagné / Perdu.',
    aideEn: 'New lead → Contacted → Quote sent → Follow-up → Won / Lost.',
  },
  {
    valeur: 'nettoyage',
    fr: 'Nettoyage',
    en: 'Cleaning',
    aideFr: 'Même ossature, avec des conseils écrits pour le nettoyage.',
    aideEn: 'Same backbone, with guidance written for cleaning work.',
  },
  {
    valeur: 'construction',
    fr: 'Construction',
    en: 'Construction',
    aideFr: 'Visite planifiée et Estimation remplacent l’étape Soumission.',
    aideEn: 'Site visit and Estimate replace the Quote stage.',
  },
];

// ── Une étape ──────────────────────────────────────────────

function LigneEtape({
  etape, etapes, deals, fr, onEnregistrer, onMonter, onDescendre, onArchiver, premiere, derniere,
}: {
  etape: PipelineStage;
  etapes: PipelineStage[];
  deals: Deal[];
  fr: boolean;
  onEnregistrer: (
    id: string,
    champs: Partial<Pick<PipelineStage, 'name_fr' | 'name_en' | 'guidance_fr' | 'guidance_en' | 'probability' | 'show_in_reports'>>,
  ) => void;
  onMonter: (id: string) => void;
  onDescendre: (id: string) => void;
  onArchiver: (id: string) => void;
  premiere: boolean;
  derniere: boolean;
}) {
  const idNomFr = useId();
  const idNomEn = useId();
  const idGuidFr = useId();
  const idGuidEn = useId();
  const [conseilsOuverts, setConseilsOuverts] = useState(false);

  // Brouillon local : la frappe reste fluide, l'écriture part au `blur`.
  const [nomFr, setNomFr] = useState(etape.name_fr);
  const [nomEn, setNomEn] = useState(etape.name_en);
  const idProba = useId();
  const [proba, setProba] = useState(etape.probability === null ? '' : String(etape.probability));
  const [guidFr, setGuidFr] = useState(etape.guidance_fr);
  const [guidEn, setGuidEn] = useState(etape.guidance_en);

  // Une écriture refusée par la base laisse le brouillon désynchronisé : on le
  // recale sur la valeur réelle dès que le parent recharge les étapes.
  useEffect(() => {
    setNomFr(etape.name_fr);
    setNomEn(etape.name_en);
    setProba(etape.probability === null ? '' : String(etape.probability));
    setGuidFr(etape.guidance_fr);
    setGuidEn(etape.guidance_en);
  }, [etape.name_fr, etape.name_en, etape.guidance_fr, etape.guidance_en]);

  const rangs = rangsOuverts(etapes.map(pourVisuel));
  const v = visuelEtape(pourVisuel(etape), rangs[etape.id] ?? 0);
  const nb = deals.filter((d) => d.stage_id === etape.id).length;

  const aideType = fr
    ? "Le type décide du comportement : « Gagné » propose de créer la job, « Perdu » demande la raison. Toute la logique s'accroche au type, jamais au nom — renommer une étape ne change rien."
    : 'The type drives behaviour: “Won” offers to create the job, “Lost” asks for the reason. All logic hangs off the type, never the name — renaming a stage changes nothing.';

  const conseilRempli = guidFr.trim() !== '' || guidEn.trim() !== '';

  return (
    <div className="rounded-xl border border-outline bg-surface-card overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0 mt-2.5"
          style={{ background: v.teinte }}
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label htmlFor={idNomFr} className="block text-[10.5px] uppercase tracking-wide text-text-muted mb-1">
                {fr ? 'Nom (français)' : 'Name (French)'}
              </label>
              <input
                id={idNomFr}
                value={nomFr}
                onChange={(e) => setNomFr(e.target.value)}
                onBlur={() => { if (nomFr !== etape.name_fr) onEnregistrer(etape.id, { name_fr: nomFr }); }}
                className="input-field w-full text-[13px] font-medium"
              />
            </div>
            <div>
              <label htmlFor={idNomEn} className="block text-[10.5px] uppercase tracking-wide text-text-muted mb-1">
                {fr ? 'Nom (anglais)' : 'Name (English)'}
              </label>
              <input
                id={idNomEn}
                value={nomEn}
                onChange={(e) => setNomEn(e.target.value)}
                onBlur={() => { if (nomEn !== etape.name_en) onEnregistrer(etape.id, { name_en: nomEn }); }}
                className="input-field w-full text-[13px] font-medium"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-[11px] text-text-muted">
            <span className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-secondary px-2 py-0.5 font-medium text-text-secondary">
              {fr ? LIBELLE_KIND[etape.kind].fr : LIBELLE_KIND[etape.kind].en}
              <Aide texte={aideType} />
            </span>
            <span>
              {nb} {fr ? (nb > 1 ? 'deals à cette étape' : 'deal à cette étape') : nb > 1 ? 'deals here' : 'deal here'}
            </span>
            <button
              type="button"
              onClick={() => setConseilsOuverts((o) => !o)}
              aria-expanded={conseilsOuverts}
              className="inline-flex items-center gap-1 text-text-secondary hover:text-text-primary rounded focus-visible:outline-2 focus-visible:outline-primary transition-colors"
            >
              <ChevronDown
                size={12}
                aria-hidden="true"
                className={conseilsOuverts ? 'rotate-180 transition-transform' : 'transition-transform'}
              />
              {fr ? 'Conseil au vendeur' : 'Rep guidance'}
              {conseilRempli && !conseilsOuverts && (
                <span className="text-text-muted">{fr ? '· rempli' : '· set'}</span>
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onMonter(etape.id)}
            disabled={premiere}
            aria-label={fr ? `Monter ${etape.name_fr}` : `Move ${etape.name_en} up`}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-secondary disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ArrowUp size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onDescendre(etape.id)}
            disabled={derniere}
            aria-label={fr ? `Descendre ${etape.name_fr}` : `Move ${etape.name_en} down`}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-secondary disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ArrowDown size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onArchiver(etape.id)}
            aria-label={fr ? `Archiver ${etape.name_fr}` : `Archive ${etape.name_en}`}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
          >
            <Archive size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {conseilsOuverts && (
        <div className="px-4 pb-4 pt-3 border-t border-border-subtle space-y-3">
          <p className="text-[11.5px] text-text-muted leading-relaxed">
            {fr
              ? "Ce texte s'affiche dans la fiche du deal, uniquement quand il est à cette étape. C'est le rappel que le vendeur a sous les yeux au moment d'agir — une phrase concrète vaut mieux qu'un paragraphe."
              : 'This text shows in the deal panel, only while the deal sits at this stage. It is the reminder the rep reads right before acting — one concrete sentence beats a paragraph.'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={idGuidFr} className="block text-[10.5px] uppercase tracking-wide text-text-muted mb-1">
                {fr ? 'Conseil (français)' : 'Guidance (French)'}
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
              <label htmlFor={idGuidEn} className="block text-[10.5px] uppercase tracking-wide text-text-muted mb-1">
                {fr ? 'Conseil (anglais)' : 'Guidance (English)'}
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

          {/*
            La probabilité sert au « revenu attendu » des prévisions :
            valeur x probabilité. Laissée VIDE, l'étape est absente de ce
            calcul — jamais comptée à zéro. La différence compte : un
            pipeline non configuré afficherait sinon « 0 $ attendu » tout en
            ayant des deals bien vivants.
            Les étapes gagnée et perdue valent 100 % et 0 % : ce sont des
            faits, pas des estimations, donc elles ne se modifient pas.
          */}
          <div className="mt-2.5 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor={idProba} className="block text-[10.5px] uppercase tracking-wide text-text-muted mb-1">
                {fr ? 'Probabilité (%)' : 'Probability (%)'}
              </label>
              <input
                id={idProba}
                type="number"
                min={0}
                max={100}
                value={proba}
                disabled={etape.kind !== 'open'}
                onChange={(e) => setProba(e.target.value)}
                onBlur={() => {
                  const brut = proba.trim();
                  const n = brut === '' ? null : Number(brut);
                  if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) {
                    setProba(etape.probability === null ? '' : String(etape.probability));
                    return;
                  }
                  if (n !== etape.probability) onEnregistrer(etape.id, { probability: n });
                }}
                placeholder={fr ? 'non renseignée' : 'not set'}
                className="input-field w-[130px] text-[12.5px] disabled:opacity-50"
              />
            </div>

            <label className="flex items-center gap-2 pb-2 text-[12px] text-text-secondary">
              <input
                type="checkbox"
                checked={etape.show_in_reports}
                onChange={(e) => onEnregistrer(etape.id, { show_in_reports: e.target.checked })}
              />
              {fr ? 'Compter dans les rapports' : 'Show in reports'}
              <span className="text-[11px] text-text-muted">
                {fr ? '(décocher pour « Spam », « Doublon »…)' : '(uncheck for “Spam”, “Duplicate”…)'}
              </span>
            </label>
          </div>

          {/*
            Ces automatisations EXISTENT et tournent : le pipeline émet
            « entre dans une étape », « sort d'une étape » et « dort depuis
            X jours », et une règle peut viser une étape précise. Le texte
            disait « Bientôt » — il annonçait comme à venir une fonction déjà
            livrée, et personne n'allait la chercher.

            Elles se règlent depuis Automatisations, pas ici : une règle peut
            enchaîner plusieurs actions et plusieurs délais, ce qu'un encart
            dans les réglages d'étape ne saurait pas montrer.
          */}
          <div className="rounded-lg border border-border-subtle bg-surface-secondary px-3.5 py-3">
            <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-secondary">
              <Workflow size={13} aria-hidden="true" />
              {fr ? 'Automatisations par étape' : 'Per-stage automations'}
            </p>
            <p className="text-[11.5px] text-text-muted mt-1 leading-relaxed">
              {fr
                ? "Déclenche un courriel, un SMS ou une tâche quand un deal entre dans cette étape, ou quand il y dort depuis quelques jours. Ça se règle dans Automatisations, où une règle peut enchaîner plusieurs actions."
                : 'Trigger an email, a text or a task when a deal enters this stage, or when it has been sitting there for a few days. Set it up in Automations, where one rule can chain several actions.'}
            </p>
            <Link
              to="/automations"
              className="mt-2 inline-flex items-center gap-1 rounded text-[11.5px] font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
            >
              {fr ? 'Ouvrir les automatisations' : 'Open automations'}
              <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Formulaire d'ajout d'étape ─────────────────────────────

function AjoutEtape({ fr, onAjouter, onAnnuler }: {
  fr: boolean;
  onAjouter: (nomFr: string, nomEn: string) => void;
  onAnnuler: () => void;
}) {
  const idFr = useId();
  const idEn = useId();
  const [nomFr, setNomFr] = useState('');
  const [nomEn, setNomEn] = useState('');
  const pret = nomFr.trim() !== '' && nomEn.trim() !== '';

  return (
    <form
      className="rounded-xl border border-dashed border-outline bg-surface-secondary px-4 py-3.5 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pret) onAjouter(nomFr.trim(), nomEn.trim());
      }}
    >
      <p className="text-[11.5px] text-text-muted leading-relaxed">
        {fr
          ? "La nouvelle étape est de type « Ouverte » et se place à la fin des étapes ouvertes, juste avant Gagné. Tu pourras la déplacer ensuite."
          : 'The new stage is of type “Open” and lands at the end of the open stages, just before Won. You can move it afterwards.'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={idFr} className="block text-[10.5px] uppercase tracking-wide text-text-muted mb-1">
            {fr ? 'Nom (français)' : 'Name (French)'}
          </label>
          <input
            id={idFr}
            value={nomFr}
            onChange={(e) => setNomFr(e.target.value)}
            placeholder={fr ? 'Ex. : Visite planifiée' : 'e.g. Site visit booked'}
            className="input-field w-full text-[13px]"
          />
        </div>
        <div>
          <label htmlFor={idEn} className="block text-[10.5px] uppercase tracking-wide text-text-muted mb-1">
            {fr ? 'Nom (anglais)' : 'Name (English)'}
          </label>
          <input
            id={idEn}
            value={nomEn}
            onChange={(e) => setNomEn(e.target.value)}
            placeholder={fr ? 'Ex. : Site visit booked' : 'e.g. Site visit booked'}
            className="input-field w-full text-[13px]"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={!pret} className="btn-primary text-[12.5px] disabled:opacity-40">
          {fr ? "Ajouter l'étape" : 'Add the stage'}
        </button>
        <button type="button" onClick={onAnnuler} className="btn-secondary text-[12.5px]">
          {fr ? 'Annuler' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}

// ── Formulaire de création de pipeline ─────────────────────

function AjoutPipeline({ fr, occupe, onCreer, onAnnuler }: {
  fr: boolean;
  occupe: boolean;
  onCreer: (nom: string, modele: ModelePipeline) => void;
  onAnnuler: () => void;
}) {
  const idNom = useId();
  const idModele = useId();
  const [nom, setNom] = useState('');
  const [modele, setModele] = useState<ModelePipeline>('generique');
  const choisi = MODELES.find((m) => m.valeur === modele) ?? MODELES[0];

  return (
    <form
      className="rounded-xl border border-dashed border-outline bg-surface-secondary px-4 py-3.5 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (nom.trim() !== '' && !occupe) onCreer(nom.trim(), modele);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={idNom} className="block text-[10.5px] uppercase tracking-wide text-text-muted mb-1">
            {fr ? 'Nom du pipeline' : 'Pipeline name'}
          </label>
          <input
            id={idNom}
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder={fr ? 'Ex. : Contrats commerciaux' : 'e.g. Commercial contracts'}
            className="input-field w-full text-[13px]"
          />
        </div>
        <div>
          <label htmlFor={idModele} className="block text-[10.5px] uppercase tracking-wide text-text-muted mb-1">
            {fr ? 'Modèle de départ' : 'Starting template'}
          </label>
          <select
            id={idModele}
            value={modele}
            onChange={(e) => setModele(e.target.value as ModelePipeline)}
            className="input-field w-full text-[13px]"
          >
            {MODELES.map((m) => (
              <option key={m.valeur} value={m.valeur}>{fr ? m.fr : m.en}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-[11.5px] text-text-muted leading-relaxed">
        {fr ? choisi.aideFr : choisi.aideEn}
        {' '}
        {fr
          ? 'Tout est modifiable après coup : le modèle sert seulement à ne pas partir d’une page blanche.'
          : 'Everything stays editable afterwards: the template only saves you from a blank page.'}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={nom.trim() === '' || occupe}
          className="btn-primary text-[12.5px] inline-flex items-center gap-1.5 disabled:opacity-40"
        >
          {occupe && <Loader2 size={13} aria-hidden="true" className="animate-spin" />}
          {fr ? 'Créer le pipeline' : 'Create the pipeline'}
        </button>
        <button type="button" onClick={onAnnuler} className="btn-secondary text-[12.5px]">
          {fr ? 'Annuler' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}

// ── Une ligne de la liste des pipelines ────────────────────

function LignePipeline({ pipeline, fr, actif, membres, onRenommer, onDefaut }: {
  pipeline: PipelineResume;
  fr: boolean;
  actif: boolean;
  /** Pour proposer qui peut voir ce pipeline. */
  membres: { id: string; name: string }[];
  onRenommer: (id: string, nom: string) => void;
  onDefaut: (id: string) => void;
}) {
  const idNom = useId();
  const [nom, setNom] = useState(pipeline.name);
  useEffect(() => { setNom(pipeline.name); }, [pipeline.name]);

  return (
    <div className="rounded-xl border border-outline bg-surface-card px-4 py-3">
      <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={idNom} className="flex items-center gap-2 text-[10.5px] uppercase tracking-wide text-text-muted mb-1">
          {fr ? 'Nom du pipeline' : 'Pipeline name'}
          {pipeline.is_default && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-semibold normal-case tracking-normal text-primary">
              <Star size={9} aria-hidden="true" />
              {fr ? 'Par défaut' : 'Default'}
            </span>
          )}
          {actif && !pipeline.is_default && (
            <span className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[9.5px] font-semibold normal-case tracking-normal text-text-secondary">
              {fr ? 'Affiché' : 'Shown'}
            </span>
          )}
        </label>
        <input
          id={idNom}
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          onBlur={() => { if (nom.trim() !== '' && nom !== pipeline.name) onRenommer(pipeline.id, nom.trim()); }}
          className="input-field w-full text-[13px] font-medium"
        />
      </div>
      {pipeline.is_default ? (
        <span className="inline-flex items-center gap-1.5 shrink-0 px-2.5 py-2 text-[11.5px] text-text-muted">
          <Check size={13} aria-hidden="true" />
          {fr ? 'Pipeline par défaut' : 'Default pipeline'}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onDefaut(pipeline.id)}
          className="btn-secondary shrink-0 text-[12px]"
        >
          {fr ? 'Définir par défaut' : 'Set as default'}
        </button>
      )}
      </div>

      {/* Qui voit ce pipeline. Replié : la plupart des équipes n'y touchent
          jamais, et un pipeline ouvert à tous est le bon défaut. */}
      <PartagePipeline pipelineId={pipeline.id} membres={membres} fr={fr} />
    </div>
  );
}

/**
 * Le partage d'un pipeline.
 *
 * AUCUN membre nommé = visible de toute l'équipe, ce qui est l'état de
 * départ. Dés qu'on nomme quelqu'un, le pipeline se FERME aux autres —
 * l'écran le dit avant le premier ajout, pas aprés.
 *
 * Les administrateurs ne figurent pas dans la liste : ils voient tout de
 * toute façon, et les proposer laisserait croire qu'on peut les exclure.
 */
function PartagePipeline({ pipelineId, membres, fr }: {
  pipelineId: string;
  membres: { id: string; name: string }[];
  fr: boolean;
}) {
  const idAjout = useId();
  const [ouvert, setOuvert] = useState(false);

  const { data: acces = [], refetch } = useQuery({
    queryKey: ['pipeline-acces', pipelineId],
    queryFn: () => fetchAccesPipeline(pipelineId),
    enabled: ouvert,
    staleTime: 60_000,
  });

  const nommes = acces.map((a) => a.user_id);
  const restants = membres.filter((m) => !nommes.includes(m.id));

  async function ajouter(userId: string) {
    try {
      await donnerAccesPipeline(pipelineId, userId);
      await refetch();
      toast.success(fr ? 'Accés accordé.' : 'Access granted.');
    } catch (e) {
      console.error('[PipelineReglages] partage', e);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function retirer(accesId: string) {
    try {
      await retirerAccesPipeline(accesId);
      await refetch();
    } catch (e) {
      console.error('[PipelineReglages] retrait de partage', e);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function rouvrir() {
    const ok = await confirmer({
      title: fr ? 'Rouvrir à toute l’équipe ?' : 'Reopen to the whole team?',
      message: fr
        ? 'Tous les membres pourront voir ce pipeline et ses deals.'
        : 'Every member will be able to see this pipeline and its deals.',
      confirmLabel: fr ? 'Rouvrir' : 'Reopen',
    });
    if (!ok) return;
    try {
      await rouvrirPipeline(pipelineId);
      await refetch();
      toast.success(fr ? 'Pipeline rouvert.' : 'Pipeline reopened.');
    } catch (e) {
      console.error('[PipelineReglages] réouverture', e);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mt-2.5 border-t border-border-subtle pt-2.5">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="text-[11.5px] text-text-tertiary underline-offset-2 hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary rounded"
      >
        {fr ? 'Qui voit ce pipeline' : 'Who can see this pipeline'}
      </button>

      {ouvert && (
        <div className="mt-2 space-y-2">
          {acces.length === 0 ? (
            <p className="text-[11.5px] text-text-muted">
              {fr
                ? 'Visible de toute l’équipe. Nommer quelqu’un le réservera à cette personne et aux administrateurs.'
                : 'Visible to the whole team. Naming someone will restrict it to them and to admins.'}
            </p>
          ) : (
            <>
              <p className="text-[11.5px]" style={{ color: 'var(--color-warning)' }}>
                {fr
                  ? 'Réservé aux personnes ci-dessous. Les administrateurs le voient toujours.'
                  : 'Restricted to the people below. Admins can always see it.'}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {acces.map((a) => (
                  <li
                    key={a.id}
                    className="inline-flex items-center gap-1 rounded-full border border-outline bg-surface-secondary py-1 pl-2.5 pr-1.5 text-[11.5px] text-text-primary"
                  >
                    {membres.find((m) => m.id === a.user_id)?.name ?? (fr ? 'Membre' : 'Member')}
                    <button
                      type="button"
                      onClick={() => { void retirer(a.id); }}
                      aria-label={fr ? 'Retirer l’accés' : 'Remove access'}
                      className="rounded-full p-0.5 text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
                    >
                      <X size={11} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={idAjout} className="sr-only">
              {fr ? 'Donner accés à' : 'Grant access to'}
            </label>
            <select
              id={idAjout}
              value=""
              onChange={(e) => { if (e.target.value) void ajouter(e.target.value); }}
              disabled={restants.length === 0}
              className="input-field max-w-[220px] text-[12px] disabled:opacity-50"
            >
              <option value="">{fr ? 'Donner accés à…' : 'Grant access to…'}</option>
              {restants.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>

            {acces.length > 0 && (
              <button
                type="button"
                onClick={() => { void rouvrir(); }}
                className="text-[11.5px] text-text-tertiary underline-offset-2 hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary rounded"
              >
                {fr ? 'Rouvrir à toute l’équipe' : 'Reopen to the whole team'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Écran ──────────────────────────────────────────────────

export default function PipelineReglages({
  pipelineId, etapes, deals, onChangement, onOuvrirPipeline,
}: {
  pipelineId: string;
  etapes: PipelineStage[];
  deals: Deal[];
  onChangement: () => void;
  /** Afficher ce pipeline sur le board, depuis le tableau. */
  onOuvrirPipeline: (pipelineId: string) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const [pipelines, setPipelines] = useState<PipelineResume[] | null>(null);
  const [creation, setCreation] = useState(false);
  const [surMesure, setSurMesure] = useState(false);

  // Les membres de l'organisation, pour proposer qui peut voir un pipeline.
  const { data: membresOrg = [] } = useQuery({
    queryKey: ['pipeline-membres'],
    queryFn: fetchMembres,
    staleTime: 300_000,
  });
  const [enCreation, setEnCreation] = useState(false);
  const [ajoutEtape, setAjoutEtape] = useState(false);

  const rechargerPipelines = useCallback(async () => {
    try {
      setPipelines(await fetchPipelines());
    } catch (e) {
      console.error('[PipelineReglages] liste des pipelines indisponible', e);
      toast.error(messageErreur(e, fr));
      setPipelines([]);
    }
  }, [fr]);

  useEffect(() => { void rechargerPipelines(); }, [rechargerPipelines]);

  const visibles = useMemo(
    () => [...etapes].filter((e) => e.archived_at === null).sort((a, b) => a.position - b.position),
    [etapes],
  );
  const archivees = useMemo(() => etapes.filter((e) => e.archived_at !== null), [etapes]);
  const courant = useMemo(
    () => pipelines?.find((p) => p.id === pipelineId) ?? null,
    [pipelines, pipelineId],
  );

  async function enregistrer(
    id: string,
    champs: Partial<Pick<PipelineStage, 'name_fr' | 'name_en' | 'guidance_fr' | 'guidance_en' | 'probability' | 'show_in_reports'>>,
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

  async function ajouter(nomFr: string, nomEn: string) {
    const position = visibles.filter((e) => e.kind === 'open').length + 1;
    try {
      await ajouterEtape(pipelineId, { name_fr: nomFr, name_en: nomEn, position });
      setAjoutEtape(false);
      onChangement();
      toast.success(fr ? 'Étape ajoutée.' : 'Stage added.');
    } catch (e) {
      console.error('[PipelineReglages] ajout refusé', e);
      toast.error(messageErreur(e, fr));
      onChangement();
    }
  }

  async function renommerLePipeline(id: string, nom: string) {
    try {
      await renommerPipeline(id, nom);
      await rechargerPipelines();
    } catch (e) {
      console.error('[PipelineReglages] renommage du pipeline refusé', e);
      toast.error(messageErreur(e, fr));
      await rechargerPipelines();
    }
  }

  async function creer(nom: string, modele: ModelePipeline) {
    setEnCreation(true);
    try {
      await creerPipeline(nom, modele);
      setCreation(false);
      await rechargerPipelines();
      toast.success(fr ? 'Pipeline créé.' : 'Pipeline created.');
    } catch (e) {
      console.error('[PipelineReglages] création de pipeline refusée', e);
      toast.error(messageErreur(e, fr));
    } finally {
      setEnCreation(false);
    }
  }

  async function basculerDefaut(id: string) {
    const cible = pipelines?.find((p) => p.id === id);
    if (!cible) return;

    const ok = await confirmer({
      title: fr ? 'Changer le pipeline par défaut ?' : 'Change the default pipeline?',
      message: fr
        ? `« ${cible.name} » deviendra le pipeline ouvert par défaut, et celui où atterrissent les nouveaux leads (formulaires web, Meta, import). Les deals existants ne bougent pas.`
        : `“${cible.name}” becomes the pipeline opened by default, and where new leads land (web forms, Meta, imports). Existing deals do not move.`,
      confirmLabel: fr ? 'Définir par défaut' : 'Set as default',
    });
    if (!ok) return;

    try {
      await definirParDefaut(id);
      await rechargerPipelines();
      toast.success(fr ? 'Pipeline par défaut mis à jour.' : 'Default pipeline updated.');
    } catch (e) {
      console.error('[PipelineReglages] changement de défaut refusé', e);
      toast.error(messageErreur(e, fr));
      await rechargerPipelines();
    }
  }

  return (
    <div className="space-y-7">
      {/* Bannière : ce que la page permet, en une phrase. */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border-subtle bg-surface-secondary px-4 py-3">
        <Layers size={15} aria-hidden="true" className="text-text-secondary mt-0.5 shrink-0" />
        <p className="text-[12px] text-text-secondary leading-relaxed">
          {fr
            ? "Règle ici le parcours que suivent tes leads : les étapes du board, le conseil affiché au vendeur à chacune, et le nombre de pipelines si tu vends plusieurs choses différentes. Aucun comportement ne dépend du nom d'une étape — seulement de son type."
            : 'Set up the path your leads follow: the board stages, the guidance shown to the rep at each one, and how many pipelines you keep if you sell different things. No behaviour depends on a stage name — only on its type.'}
        </p>
      </div>

      {/* ── Étapes ── */}
      <Section
        titre={fr ? 'Étapes' : 'Stages'}
        sousTitre={
          fr
            ? "Modifie un nom directement dans son champ : il est enregistré quand tu en sors. Réordonne avec les flèches, archive ce que tu n'utilises plus."
            : 'Edit a name right in its field: it saves when you leave it. Reorder with the arrows, archive what you no longer use.'
        }
        action={
          !ajoutEtape ? (
            <button
              type="button"
              onClick={() => setAjoutEtape(true)}
              className="btn-secondary text-[12.5px] inline-flex items-center gap-1.5"
            >
              <Plus size={14} aria-hidden="true" />
              {fr ? 'Ajouter une étape' : 'Add a stage'}
            </button>
          ) : undefined
        }
      >
        <div className="space-y-2.5">
          {visibles.map((etape, i) => (
            <LigneEtape
              key={etape.id}
              etape={etape}
              etapes={etapes}
              deals={deals}
              fr={fr}
              premiere={i === 0}
              derniere={i === visibles.length - 1}
              onEnregistrer={(id, champs) => { void enregistrer(id, champs); }}
              onMonter={(id) => { void bouger(id, -1); }}
              onDescendre={(id) => { void bouger(id, 1); }}
              onArchiver={(id) => { void archiver(id); }}
            />
          ))}

          {visibles.length === 0 && !ajoutEtape && (
            <div className="rounded-xl border border-dashed border-outline px-4 py-8 text-center">
              <p className="text-[12.5px] text-text-tertiary">
                {fr
                  ? "Ce pipeline n'a aucune étape active. Ajoute-en une pour que le board affiche quelque chose."
                  : 'This pipeline has no active stage. Add one so the board has something to show.'}
              </p>
            </div>
          )}

          {ajoutEtape && (
            <AjoutEtape
              fr={fr}
              onAjouter={(nomFr, nomEn) => { void ajouter(nomFr, nomEn); }}
              onAnnuler={() => setAjoutEtape(false)}
            />
          )}
        </div>

        {archivees.length > 0 && (
          <div className="pt-1">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">
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
      </Section>

      {/* ── Ce pipeline ── */}
      <Section
        titre={fr ? 'Ce pipeline' : 'This pipeline'}
        sousTitre={
          fr
            ? "Le nom du pipeline actuellement affiché sur le board. Il n'apparaît pas aux clients."
            : 'The name of the pipeline currently shown on the board. Clients never see it.'
        }
      >
        {pipelines === null ? (
          <div className="flex items-center gap-2 text-[12px] text-text-tertiary py-3">
            <Loader2 size={14} aria-hidden="true" className="animate-spin" />
            {fr ? 'Chargement…' : 'Loading…'}
          </div>
        ) : courant ? (
          <LignePipeline
            pipeline={courant}
            fr={fr}
            membres={membresOrg}
            actif
            onRenommer={(id, nom) => { void renommerLePipeline(id, nom); }}
            onDefaut={(id) => { void basculerDefaut(id); }}
          />
        ) : (
          <p className="text-[12px] text-text-tertiary">
            {fr ? 'Pipeline introuvable.' : 'Pipeline not found.'}
          </p>
        )}
      </Section>

      {/* ── Mes pipelines ── */}
      <Section
        titre={fr ? 'Mes pipelines' : 'My pipelines'}
        sousTitre={
          fr
            ? "Un pipeline par type de vente qui n'a pas le même parcours — résidentiel et commercial, par exemple. Les nouveaux leads arrivent dans le pipeline par défaut."
            : 'One pipeline per kind of sale that follows a different path — residential and commercial, say. New leads land in the default pipeline.'
        }
        action={
          !creation ? (
            <div className="flex flex-wrap items-center gap-2">
              {/*
                Deux portes : partir d'un modèle (rapide) ou écrire ses
                propres étapes. Choisir entre trois modèles ne remplace pas
                de pouvoir décrire son parcours.
              */}
              <button
                type="button"
                onClick={() => setCreation(true)}
                className="btn-secondary text-[12.5px] inline-flex items-center gap-1.5"
              >
                <Plus size={14} aria-hidden="true" />
                {fr ? "Partir d'un modèle" : 'From a template'}
              </button>
              <button
                type="button"
                onClick={() => setSurMesure(true)}
                className="btn-primary text-[12.5px] inline-flex items-center gap-1.5"
              >
                <Plus size={14} aria-hidden="true" />
                {fr ? 'Créer un pipeline' : 'Create pipeline'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreation(false)}
              aria-label={fr ? 'Fermer le formulaire de création' : 'Close the creation form'}
              className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )
        }
      >
        {creation && (
          <AjoutPipeline
            fr={fr}
            occupe={enCreation}
            onCreer={(nom, modele) => { void creer(nom, modele); }}
            onAnnuler={() => setCreation(false)}
          />
        )}

        {pipelines === null ? (
          <div className="flex items-center gap-2 text-[12px] text-text-tertiary py-3">
            <Loader2 size={14} aria-hidden="true" className="animate-spin" />
            {fr ? 'Chargement des pipelines…' : 'Loading pipelines…'}
          </div>
        ) : pipelines.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline px-4 py-8 text-center">
            <p className="text-[12.5px] text-text-tertiary">
              {fr ? 'Aucun pipeline pour le moment.' : 'No pipeline yet.'}
            </p>
          </div>
        ) : (
          <PipelinesTableau
            pipelines={pipelines}
            pipelineActif={pipelineId}
            onChangement={() => { void rechargerPipelines(); onChangement(); }}
            onOuvrir={onOuvrirPipeline}
            onDefaut={(id) => { void basculerDefaut(id); }}
            detail={(p) => (
              <LignePipeline
                pipeline={p}
                fr={fr}
                membres={membresOrg}
                actif={p.id === pipelineId}
                onRenommer={(id, nom) => { void renommerLePipeline(id, nom); }}
                onDefaut={(id) => { void basculerDefaut(id); }}
              />
            )}
          />
        )}
      </Section>

      <CreerPipelineModal
        ouvert={surMesure}
        onFermer={() => setSurMesure(false)}
        onCree={() => { void rechargerPipelines(); onChangement(); }}
      />

      {/* ── Raisons de perte ── */}
      <Section
        titre={fr ? 'Raisons de perte' : 'Loss reasons'}
        sousTitre={
          fr
            ? "Les motifs proposés quand on marque un deal perdu. Sans liste, « trop cher », « prix » et « trop dispendieux » comptent pour trois raisons différentes dans les statistiques — et on ne voit plus pourquoi on perd."
            : 'The reasons offered when marking a deal lost. Without a list, “too expensive”, “price” and “too pricey” count as three different reasons in the stats — and why you lose becomes unreadable.'
        }
      >
        <ListeRaisonsPerte fr={fr} />
      </Section>
    </div>
  );
}

/**
 * La liste des motifs de perte.
 *
 * Un motif n'est jamais SUPPRIMÉ, seulement archivé : les deals perdus le
 * citent encore, et l'historique ne doit pas changer parce qu'on a nettoyé
 * une liste. Il cesse simplement d'être proposé à la saisie.
 */
function ListeRaisonsPerte({ fr }: { fr: boolean }) {
  const idNouveau = useId();
  const [nouveau, setNouveau] = useState('');
  const [enCours, setEnCours] = useState(false);
  const { data: raisons = [], refetch, isLoading } = useQuery({
    queryKey: ['pipeline-raisons-proposees'],
    queryFn: fetchRaisonsProposees,
    staleTime: 600_000,
  });

  async function ajouter(e: FormEvent) {
    e.preventDefault();
    const libelle = nouveau.trim();
    if (!libelle || enCours) return;
    setEnCours(true);
    try {
      await ajouterRaisonProposee(libelle);
      setNouveau('');
      await refetch();
      toast.success(fr ? 'Motif ajouté.' : 'Reason added.');
    } catch (err) {
      console.error('[PipelineReglages] ajout de motif', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnCours(false);
    }
  }

  async function retirer(id: string, libelle: string) {
    const ok = await confirmer({
      title: fr ? `Retirer « ${libelle} » ?` : `Remove “${libelle}”?`,
      message: fr
        ? "Le motif ne sera plus proposé. Les deals qui le citent déjà ne changent pas."
        : 'The reason will no longer be offered. Deals already citing it are unchanged.',
      confirmLabel: fr ? 'Retirer' : 'Remove',
    });
    if (!ok) return;
    try {
      await archiverRaisonProposee(id);
      await refetch();
      toast.success(fr ? 'Motif retiré.' : 'Reason removed.');
    } catch (err) {
      console.error('[PipelineReglages] archivage de motif', err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-[12px] text-text-muted">{fr ? 'Chargement…' : 'Loading…'}</p>}

      {!isLoading && raisons.length === 0 && (
        <p className="text-[12px] text-text-muted">
          {fr
            ? 'Aucun motif. Les vendeurs écriront du texte libre.'
            : 'No reason yet. Reps will type free text.'}
        </p>
      )}

      {raisons.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {raisons.map((r) => (
            <li
              key={r.id}
              className="inline-flex items-center gap-1 rounded-full border border-outline bg-surface-card py-1 pl-3 pr-1.5 text-[12px] text-text-primary"
            >
              {r.libelle}
              <button
                type="button"
                onClick={() => { void retirer(r.id, r.libelle); }}
                aria-label={fr ? `Retirer ${r.libelle}` : `Remove ${r.libelle}`}
                className="rounded-full p-0.5 text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => { void ajouter(e); }} className="flex items-center gap-2">
        <label htmlFor={idNouveau} className="sr-only">
          {fr ? 'Nouveau motif' : 'New reason'}
        </label>
        <input
          id={idNouveau}
          value={nouveau}
          maxLength={80}
          onChange={(e) => setNouveau(e.target.value)}
          placeholder={fr ? 'Ajouter un motif…' : 'Add a reason…'}
          className="input-field w-full max-w-xs text-[12.5px]"
        />
        <button
          type="submit"
          disabled={!nouveau.trim() || enCours}
          className="btn-secondary whitespace-nowrap text-[12px] disabled:opacity-50"
        >
          {fr ? 'Ajouter' : 'Add'}
        </button>
      </form>
    </div>
  );
}
