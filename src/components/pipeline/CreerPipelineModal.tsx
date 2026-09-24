/**
 * Créer un pipeline, avec ses étapes.
 *
 * L'ancienne création partait d'un modèle figé (générique, nettoyage,
 * construction). C'est un bon défaut pour démarrer, et il reste — mais
 * choisir entre trois modèles ne remplace pas de pouvoir écrire son propre
 * parcours : les contrats saisonniers ne passent pas par les mêmes étapes
 * que les soumissions résidentielles.
 *
 * CE QU'ON N'IMPOSE PAS : les étapes « Gagné » et « Perdu ». Elles sont
 * proposées d'emblée, et si l'utilisateur les retire, la base les rajoute.
 * Un pipeline qu'on ne peut pas terminer casse le taux de closing, le badge
 * « Job à créer » et la raison de perte — c'est un état dont on ne sort pas.
 */
import { useId, useState, type FormEvent } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Modal from '../ui/Modal';
import { useTranslation } from '../../i18n';
import { creerPipelineSurMesure, type EtapeSurMesure, type ModeCouleur } from '../../lib/pipelineVentesApi';

/** Une ligne en cours de saisie — la probabilité reste du texte tant qu'on tape. */
interface LigneEtape {
  cle: string;
  nom: string;
  kind: 'open' | 'won' | 'lost';
  proba: string;
  rapports: boolean;
}

function nouvelleCle(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Les trois rendus possibles, montrés tels quels dans le choix. */
const MODES_COULEUR: { cle: ModeCouleur; fr: string; en: string }[] = [
  { cle: 'none', fr: 'Par défaut (aucune couleur)', en: 'Default (no color)' },
  { cle: 'dot',  fr: 'Pastille colorée',            en: 'Colored dot' },
  { cle: 'tint', fr: 'Fond teinté',                 en: 'Background tint' },
];

/** Le départ : un parcours court et complet, que l'utilisateur ajuste. */
function etapesParDefaut(fr: boolean): LigneEtape[] {
  return [
    { cle: nouvelleCle(), nom: fr ? 'Nouveau lead' : 'New lead', kind: 'open', proba: '20', rapports: true },
    { cle: nouvelleCle(), nom: fr ? 'Contacté' : 'Contacted', kind: 'open', proba: '40', rapports: true },
    { cle: nouvelleCle(), nom: fr ? 'Soumission envoyée' : 'Proposal sent', kind: 'open', proba: '60', rapports: true },
    { cle: nouvelleCle(), nom: fr ? 'Gagné' : 'Won', kind: 'won', proba: '100', rapports: true },
    { cle: nouvelleCle(), nom: fr ? 'Perdu' : 'Lost', kind: 'lost', proba: '0', rapports: true },
  ];
}

export default function CreerPipelineModal({ ouvert, onFermer, onCree }: {
  ouvert: boolean;
  onFermer: () => void;
  /** Reçoit l'identifiant du pipeline créé. */
  onCree: (pipelineId: string) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const idNom = useId();
  const idEtapes = useId();

  const idProbaDeal = useId();

  const [nom, setNom] = useState('');
  const [etapes, setEtapes] = useState<LigneEtape[]>(() => etapesParDefaut(fr));
  const [couleur, setCouleur] = useState<ModeCouleur>('none');
  const [probaParDeal, setProbaParDeal] = useState(false);
  const [enCours, setEnCours] = useState(false);

  if (!ouvert) return null;

  function majEtape(cle: string, champs: Partial<LigneEtape>) {
    setEtapes((liste) => liste.map((e) => (e.cle === cle ? { ...e, ...champs } : e)));
  }

  function ajouter() {
    // La nouvelle étape s'insère AVANT les terminales : une étape ouverte
    // après « Gagné » ne serait jamais atteinte.
    setEtapes((liste) => {
      const i = liste.findIndex((e) => e.kind !== 'open');
      const neuve: LigneEtape = { cle: nouvelleCle(), nom: '', kind: 'open', proba: '', rapports: true };
      if (i < 0) return [...liste, neuve];
      return [...liste.slice(0, i), neuve, ...liste.slice(i)];
    });
  }

  function retirer(cle: string) {
    setEtapes((liste) => liste.filter((e) => e.cle !== cle));
  }

  function deplacer(cle: string, sens: -1 | 1) {
    setEtapes((liste) => {
      const i = liste.findIndex((e) => e.cle === cle);
      const j = i + sens;
      if (i < 0 || j < 0 || j >= liste.length) return liste;
      const copie = [...liste];
      [copie[i], copie[j]] = [copie[j], copie[i]];
      return copie;
    });
  }

  const nommees = etapes.filter((e) => e.nom.trim() !== '');
  const pretARemplir = nom.trim() !== '' && nommees.length > 0;

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    if (!pretARemplir || enCours) return;
    setEnCours(true);
    try {
      const charge: EtapeSurMesure[] = nommees.map((x) => {
        const n = x.proba.trim() === '' ? null : Number(x.proba);
        return {
          nom_fr: x.nom.trim(),
          kind: x.kind,
          probability: n !== null && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null,
          show_in_reports: x.rapports,
        };
      });
      const id = await creerPipelineSurMesure(nom, charge, {
        color_mode: couleur,
        use_deal_probability: probaParDeal,
      });
      toast.success(fr ? `Pipeline « ${nom.trim()} » créé.` : `Pipeline “${nom.trim()}” created.`);
      onCree(id);
      setNom('');
      setEtapes(etapesParDefaut(fr));
      setCouleur('none');
      setProbaParDeal(false);
      onFermer();
    } catch (err) {
      console.error('[CreerPipeline] création', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnCours(false);
    }
  }

  const LIBELLE_KIND = {
    open: fr ? 'En cours' : 'Open',
    won: fr ? 'Gagné' : 'Won',
    lost: fr ? 'Perdu' : 'Lost',
  };

  return (
    <Modal open onClose={onFermer} size="lg" title={fr ? 'Créer un pipeline' : 'Create pipeline'}>
      <form onSubmit={(e) => { void soumettre(e); }} className="space-y-4">
        <div>
          <label htmlFor={idNom} className="mb-1 block text-[12px] text-text-secondary">
            {fr ? 'Nom du pipeline' : 'Pipeline name'} *
          </label>
          <input
            id={idNom}
            value={nom}
            maxLength={80}
            autoFocus
            onChange={(e) => setNom(e.target.value)}
            placeholder={fr ? 'Ex. : Contrats saisonniers' : 'e.g. Seasonal contracts'}
            className="input-field w-full text-[13px]"
          />
          <p className="mt-1 text-[11px] text-text-muted">
            {fr
              ? 'Un nom unique et descriptif, pour retrouver ce pipeline plus tard.'
              : 'Use a unique, descriptive name so you can find this pipeline later.'}
          </p>
        </div>

        {/*
          L'ordre suit celui de GoHighLevel : on règle le pipeline AVANT de
          décrire ses étapes. Les deux réglages tiennent en un coup d'oeil,
          alors que la liste d'étapes s'allonge — la reléguer sous une liste
          de dix lignes revenait à la cacher.
        */}
        <div className="rounded-xl border border-outline bg-surface-secondary px-3.5 py-3">
          <div className="flex items-start justify-between gap-3">
            <label htmlFor={idProbaDeal} className="text-[12.5px] font-medium text-text-primary">
              {fr ? 'Probabilité propre à chaque deal' : 'Use opportunity-level probability'}
              <span className="mt-0.5 block text-[11px] font-normal text-text-muted">
                {fr
                  ? "Activé, chaque deal utilise sa propre probabilité. Désactivé, c'est celle de l'étape."
                  : 'When enabled, each opportunity uses its own probability. When disabled, probability is based on the stage.'}
              </span>
            </label>
            {/*
              Un vrai interrupteur, pas une case : c'est un réglage qu'on
              bascule, et la capture de GHL en montre un.
            */}
            <button
              type="button"
              id={idProbaDeal}
              role="switch"
              aria-checked={probaParDeal}
              onClick={() => setProbaParDeal((v) => !v)}
              className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary ${probaParDeal ? 'bg-primary' : 'bg-surface-tertiary'}`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${probaParDeal ? 'left-[18px]' : 'left-0.5'}`}
              />
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-outline bg-surface-secondary px-3.5 py-3">
          <p className="text-[12.5px] font-medium text-text-primary">
            {fr ? "Couleur des étapes" : 'Set pipeline display colors'}
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {fr
              ? "Comment la couleur d'une étape apparaît sur le board."
              : 'Choose how stage colors appear across your pipeline views.'}
          </p>

          {/*
            Trois cartes qui MONTRENT le rendu, au lieu d'un menu déroulant
            qui le nomme : on choisit une apparence en la voyant.
          */}
          <div role="radiogroup" aria-label={fr ? 'Couleur des étapes' : 'Stage colors'} className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {MODES_COULEUR.map((m) => {
              const actif = couleur === m.cle;
              return (
                <button
                  key={m.cle}
                  type="button"
                  role="radio"
                  aria-checked={actif}
                  onClick={() => setCouleur(m.cle)}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary ${actif ? 'border-primary bg-primary/5' : 'border-outline bg-surface-card hover:bg-surface-secondary'}`}
                >
                  <span
                    className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[12px] font-medium text-text-primary"
                    style={m.cle === 'tint' ? { background: 'color-mix(in srgb, var(--color-info) 16%, transparent)' } : undefined}
                  >
                    {m.cle === 'dot' && (
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--color-info)' }} aria-hidden="true" />
                    )}
                    {fr ? "Nom d'étape" : 'Stage name'}
                  </span>
                  <span className="mt-1 block text-[11px] text-text-tertiary">
                    {fr ? m.fr : m.en}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span id={idEtapes} className="text-[12px] text-text-secondary">
              {fr ? `Étapes (${etapes.length})` : `Stages (${etapes.length})`}
            </span>
            <button type="button" onClick={ajouter} className="btn-secondary inline-flex items-center gap-1 text-[12px]">
              <Plus size={13} aria-hidden="true" />
              {fr ? 'Ajouter une étape' : 'Add stage'}
            </button>
          </div>

          {/*
            La probabilité sert au revenu attendu des prévisions. Laissée
            VIDE, l'étape est absente de ce calcul — jamais comptée à zéro.
            Gagné et perdu valent 100 % et 0 % : des faits, pas des
            estimations, donc non modifiables.
          */}
          <ul aria-labelledby={idEtapes} className="space-y-1.5">
            {etapes.map((e, i) => (
              <li
                key={e.cle}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-outline bg-surface-card px-2.5 py-2"
              >
                <span className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => deplacer(e.cle, -1)}
                    disabled={i === 0}
                    aria-label={fr ? 'Monter' : 'Move up'}
                    className="text-text-muted hover:text-text-primary disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary rounded"
                  >
                    <GripVertical size={13} aria-hidden="true" />
                  </button>
                </span>

                <input
                  value={e.nom}
                  maxLength={60}
                  onChange={(ev) => majEtape(e.cle, { nom: ev.target.value })}
                  aria-label={fr ? `Nom de l'étape ${i + 1}` : `Stage ${i + 1} name`}
                  placeholder={fr ? "Nom de l'étape" : 'Stage name'}
                  className="input-field min-w-[160px] flex-1 text-[12.5px]"
                />

                <select
                  value={e.kind}
                  onChange={(ev) => {
                    const k = ev.target.value as LigneEtape['kind'];
                    majEtape(e.cle, {
                      kind: k,
                      proba: k === 'won' ? '100' : k === 'lost' ? '0' : e.proba,
                    });
                  }}
                  aria-label={fr ? `Type de l'étape ${i + 1}` : `Stage ${i + 1} type`}
                  className="input-field w-[110px] text-[12px]"
                >
                  <option value="open">{LIBELLE_KIND.open}</option>
                  <option value="won">{LIBELLE_KIND.won}</option>
                  <option value="lost">{LIBELLE_KIND.lost}</option>
                </select>

                <input
                  type="number"
                  min={0}
                  max={100}
                  value={e.proba}
                  disabled={e.kind !== 'open'}
                  onChange={(ev) => majEtape(e.cle, { proba: ev.target.value })}
                  aria-label={fr ? `Probabilité de l'étape ${i + 1}` : `Stage ${i + 1} probability`}
                  placeholder="%"
                  className="input-field w-[80px] text-[12px] disabled:opacity-50"
                />

                <label className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                  <input
                    type="checkbox"
                    checked={e.rapports}
                    onChange={(ev) => majEtape(e.cle, { rapports: ev.target.checked })}
                  />
                  {fr ? 'Rapports' : 'Reports'}
                </label>

                <button
                  type="button"
                  onClick={() => retirer(e.cle)}
                  disabled={etapes.length <= 1}
                  aria-label={fr ? `Retirer l'étape ${i + 1}` : `Remove stage ${i + 1}`}
                  className="shrink-0 rounded p-1 text-text-muted hover:text-text-primary disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-1.5 text-[11px] text-text-muted">
            {fr
              ? "Sans étape « Gagné » ou « Perdu », elles sont ajoutées : un pipeline qu'on ne peut pas terminer casse le taux de closing et la raison de perte."
              : 'Without a Won or Lost stage, they are added: a pipeline you cannot close breaks the close rate and the loss reason.'}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-[12.5px]" onClick={onFermer}>
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button
            type="submit"
            disabled={!pretARemplir || enCours}
            className="btn-primary text-[12.5px] disabled:opacity-50"
          >
            {enCours ? (fr ? 'Création…' : 'Creating…') : fr ? 'Créer' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
