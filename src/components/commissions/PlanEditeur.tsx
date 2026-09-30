import { useEffect, useId, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Modal from '../ui/Modal';
import { createCommissionRule, updateCommissionRule, assignMemberToRule } from '../../lib/commissionsApi';
import type { FsCommissionRule, CommissionPerformanceTier, CommissionProductOverride, CommissionBonus } from '../../types';

/**
 * Créer / modifier un plan de commission (audit 2026-09-30). Avant, aucun écran
 * ne le permettait : un plan ne se créait que par l'API, et les paliers,
 * surcharges par catégorie, bonus et splits que le moteur sait calculer
 * n'étaient réglables par personne.
 *
 * Les montants se saisissent en dollars et partent en cents ; le serveur
 * revalide tout (Zod) : taux 0-100 %, split ≤ 100 %, bénéficiaires membres.
 */
export interface MembrePlan { user_id: string; nom: string }

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (regle: FsCommissionRule) => void;
  regle: FsCommissionRule | null; // null = nouveau plan
  membres: MembrePlan[];
  fr: boolean;
}

type Palier = { metric: CommissionPerformanceTier['metric']; seuil: string; pct: string; fixe: string };
type Surcharge = { category: string; kind: 'percent' | 'flat'; valeur: string };
type Bonus = { minimum: string; pct: string; fixe: string };
type Part = { user_id: string; pct: string };

const versCents = (dollars: string) => Math.round(Number(String(dollars).replace(',', '.')) * 100);
const versNombre = (v: string) => Number(String(v).replace(',', '.'));
const enDollars = (cents: number | null | undefined) => (cents == null ? '' : String(cents / 100));
const champ = 'w-full rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

export default function PlanEditeur({ open, onClose, onSaved, regle, membres, fr }: Props) {
  const id = useId();
  const [nom, setNom] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'percent' | 'flat'>('percent');
  const [taux, setTaux] = useState('');
  const [forfait, setForfait] = useState('');
  const [actif, setActif] = useState(true);
  const [assignes, setAssignes] = useState<string[]>([]);
  const [paliers, setPaliers] = useState<Palier[]>([]);
  const [surcharges, setSurcharges] = useState<Surcharge[]>([]);
  const [bonus, setBonus] = useState<Bonus[]>([]);
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState<Part[]>([]);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNom(regle?.name ?? '');
    setDescription(regle?.description ?? '');
    setKind(regle?.base_kind === 'flat' ? 'flat' : 'percent');
    setTaux(regle?.base_percent != null ? String(regle.base_percent) : regle?.percentage != null ? String(regle.percentage) : '');
    setForfait(enDollars(regle?.base_value_cents));
    setActif(regle?.is_active ?? true);
    setAssignes(regle?.assigned_user_ids ?? []);
    setPaliers((regle?.performance_tiers ?? []).map((t) => ({
      metric: t.metric,
      seuil: t.metric === 'revenue_cents' ? enDollars(t.threshold) : String(t.threshold),
      pct: t.modifier_percent != null ? String(t.modifier_percent) : '',
      fixe: enDollars(t.modifier_flat_cents),
    })));
    setSurcharges((regle?.product_overrides ?? []).map((o) => ({
      category: o.category, kind: o.base_kind,
      valeur: o.base_kind === 'flat' ? enDollars(o.base_value_cents) : String(o.base_percent ?? ''),
    })));
    setBonus((regle?.bonuses ?? []).filter((b) => b.condition === 'min_sale_amount').map((b) => ({
      minimum: enDollars(b.value), pct: b.modifier_percent != null ? String(b.modifier_percent) : '', fixe: enDollars(b.modifier_flat_cents),
    })));
    setSplit(regle?.attribution?.mode === 'split');
    setParts((regle?.attribution?.splits ?? []).filter((s) => s.user_id).map((s) => ({ user_id: s.user_id as string, pct: String(s.pct) })));
  }, [open, regle]);

  const totalSplit = useMemo(() => parts.reduce((s, p) => s + (versNombre(p.pct) || 0), 0), [parts]);
  const nomDe = (uid: string) => membres.find((m) => m.user_id === uid)?.nom ?? uid;

  const erreurs: string[] = [];
  if (!nom.trim()) erreurs.push(fr ? 'Donne un nom au plan.' : 'Give the plan a name.');
  if (kind === 'percent' && !(versNombre(taux) >= 0 && versNombre(taux) <= 100)) erreurs.push(fr ? 'Le taux doit être entre 0 et 100 %.' : 'Rate must be between 0 and 100%.');
  if (kind === 'flat' && !(versNombre(forfait) >= 0)) erreurs.push(fr ? 'Le forfait doit être un montant positif.' : 'Flat amount must be positive.');
  if (split && parts.length === 0) erreurs.push(fr ? 'Ajoute au moins un bénéficiaire au partage.' : 'Add at least one split recipient.');
  if (split && totalSplit > 100) erreurs.push(fr ? `Le partage dépasse 100 % (${totalSplit} %).` : `Split exceeds 100% (${totalSplit}%).`);

  async function enregistrer() {
    if (erreurs.length) { toast.error(erreurs[0]); return; }
    const corps: Partial<FsCommissionRule> = {
      name: nom.trim(),
      description: description.trim() || null,
      is_active: actif,
      base_kind: kind,
      base_percent: kind === 'percent' ? versNombre(taux) : null,
      base_value_cents: kind === 'flat' ? versCents(forfait) : null,
      assigned_user_ids: assignes,
      performance_tiers: paliers.filter((p) => p.seuil !== '').map<CommissionPerformanceTier>((p) => ({
        metric: p.metric,
        threshold: p.metric === 'revenue_cents' ? versCents(p.seuil) : Math.round(versNombre(p.seuil)),
        modifier_percent: p.pct !== '' ? versNombre(p.pct) : null,
        modifier_flat_cents: p.fixe !== '' ? versCents(p.fixe) : null,
      })),
      product_overrides: surcharges.filter((s) => s.category.trim()).map<CommissionProductOverride>((s) => ({
        category: s.category.trim(), base_kind: s.kind,
        base_percent: s.kind === 'percent' ? versNombre(s.valeur) : null,
        base_value_cents: s.kind === 'flat' ? versCents(s.valeur) : null,
      })),
      bonuses: bonus.filter((b) => b.minimum !== '').map<CommissionBonus>((b) => ({
        condition: 'min_sale_amount', value: versCents(b.minimum),
        modifier_percent: b.pct !== '' ? versNombre(b.pct) : null,
        modifier_flat_cents: b.fixe !== '' ? versCents(b.fixe) : null,
      })),
      attribution: split ? { mode: 'split', splits: parts.map((p) => ({ user_id: p.user_id, pct: versNombre(p.pct) })) } : { mode: 'solo' },
    };
    setEnvoi(true);
    try {
      const sauve = regle ? await updateCommissionRule(regle.id, corps) : await createCommissionRule(corps);
      // Un membre ne suit qu'UN plan : ceux qu'on vient de cocher quittent leur
      // ancien plan (même route atomique que le menu de l'onglet Taux).
      const nouveaux = assignes.filter((u) => !(regle?.assigned_user_ids ?? []).includes(u));
      for (const u of nouveaux) await assignMemberToRule(u, sauve.id);
      toast.success(regle ? (fr ? 'Plan mis à jour' : 'Plan updated') : (fr ? 'Plan créé' : 'Plan created'));
      onSaved(sauve);
      onClose();
    } catch (err: any) {
      console.error('[commissions] enregistrement du plan refusé', err);
      toast.error(err?.message || (fr ? "Échec de l'enregistrement" : 'Save failed'));
    } finally {
      setEnvoi(false);
    }
  }

  const titreSection = 'text-xs font-semibold uppercase tracking-wide text-text-muted';
  const boutonAjout = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';
  const boutonRetirer = 'rounded p-1 text-text-muted hover:bg-error/10 hover:text-error focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      title={regle ? (fr ? 'Modifier le plan de commission' : 'Edit commission plan') : (fr ? 'Nouveau plan de commission' : 'New commission plan')}
      description={fr
        ? 'Calculé sur le montant AVANT taxes (sous-total moins rabais), au paiement complet de la facture.'
        : 'Calculated on the PRE-TAX amount (subtotal minus discount), when the invoice is fully paid.'}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border-subtle px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button type="button" onClick={enregistrer} disabled={envoi} className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            {envoi ? (fr ? 'Enregistrement…' : 'Saving…') : (fr ? 'Enregistrer' : 'Save')}
          </button>
        </div>
      )}
    >
      <div className="space-y-5">
        {/* Identité */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-nom`} className="mb-1 block text-xs font-medium text-text-secondary">{fr ? 'Nom du plan' : 'Plan name'}</label>
            <input id={`${id}-nom`} value={nom} onChange={(e) => setNom(e.target.value)} className={champ} maxLength={200} />
          </div>
          <div className="flex items-end gap-2">
            <input id={`${id}-actif`} type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} className="h-4 w-4" />
            <label htmlFor={`${id}-actif`} className="text-sm text-text-primary">{fr ? 'Plan actif' : 'Active plan'}</label>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-desc`} className="mb-1 block text-xs font-medium text-text-secondary">{fr ? 'Description (facultatif)' : 'Description (optional)'}</label>
            <input id={`${id}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} className={champ} maxLength={2000} />
          </div>
        </div>

        {/* Base */}
        <fieldset className="space-y-2">
          <legend className={titreSection}>{fr ? 'Commission de base' : 'Base commission'}</legend>
          <div className="flex flex-wrap items-center gap-4">
            <label htmlFor={`${id}-pct`} className="inline-flex items-center gap-2 text-sm">
              <input id={`${id}-pct`} type="radio" name={`${id}-kind`} checked={kind === 'percent'} onChange={() => setKind('percent')} />
              {fr ? 'Pourcentage de la vente' : 'Percent of the sale'}
            </label>
            <label htmlFor={`${id}-flat`} className="inline-flex items-center gap-2 text-sm">
              <input id={`${id}-flat`} type="radio" name={`${id}-kind`} checked={kind === 'flat'} onChange={() => setKind('flat')} />
              {fr ? 'Montant fixe par facture' : 'Flat amount per invoice'}
            </label>
          </div>
          {kind === 'percent' ? (
            <div className="max-w-[12rem]">
              <label htmlFor={`${id}-taux`} className="mb-1 block text-xs font-medium text-text-secondary">{fr ? 'Taux (%)' : 'Rate (%)'}</label>
              <input id={`${id}-taux`} inputMode="decimal" value={taux} onChange={(e) => setTaux(e.target.value)} className={champ} placeholder="10" />
            </div>
          ) : (
            <div className="max-w-[12rem]">
              <label htmlFor={`${id}-forfait`} className="mb-1 block text-xs font-medium text-text-secondary">{fr ? 'Montant ($)' : 'Amount ($)'}</label>
              <input id={`${id}-forfait`} inputMode="decimal" value={forfait} onChange={(e) => setForfait(e.target.value)} className={champ} placeholder="150" />
            </div>
          )}
        </fieldset>

        {/* Membres */}
        <fieldset className="space-y-2">
          <legend className={titreSection}>{fr ? 'Membres payés avec ce plan' : 'Members paid with this plan'}</legend>
          <p className="text-xs text-text-tertiary">{fr ? 'Un membre ne suit qu’un plan : le cocher ici le retire de son plan actuel à l’enregistrement.' : 'A member follows one plan only: ticking them here moves them onto this plan.'}</p>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {membres.map((m) => (
              <label key={m.user_id} htmlFor={`${id}-m-${m.user_id}`} className="inline-flex items-center gap-2 text-sm">
                <input
                  id={`${id}-m-${m.user_id}`}
                  type="checkbox"
                  checked={assignes.includes(m.user_id)}
                  onChange={(e) => setAssignes((prev) => (e.target.checked ? [...prev, m.user_id] : prev.filter((u) => u !== m.user_id)))}
                />
                {m.nom}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Paliers */}
        <fieldset className="space-y-2">
          <legend className={titreSection}>{fr ? 'Paliers du mois (facultatif)' : 'Monthly tiers (optional)'}</legend>
          <p className="text-xs text-text-tertiary">{fr ? 'Quand le cumul du mois du représentant atteint le seuil, le bonus s’ajoute à chaque vente qui le franchit ou le dépasse.' : 'When the rep’s monthly total reaches the threshold, the bonus is added to each sale at or above it.'}</p>
          {paliers.map((p, i) => (
            <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1.3fr_1fr_1fr_1fr_auto]">
              <div>
                <label htmlFor={`${id}-pm-${i}`} className="mb-1 block text-xs text-text-secondary">{fr ? 'Mesure' : 'Metric'}</label>
                <select id={`${id}-pm-${i}`} value={p.metric} onChange={(e) => setPaliers((l) => l.map((x, j) => (j === i ? { ...x, metric: e.target.value as Palier['metric'] } : x)))} className={champ}>
                  <option value="revenue_cents">{fr ? 'Ventes du mois ($)' : 'Monthly sales ($)'}</option>
                  <option value="sale_count">{fr ? 'Nombre de ventes' : 'Number of sales'}</option>
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-ps-${i}`} className="mb-1 block text-xs text-text-secondary">{fr ? 'Seuil' : 'Threshold'}</label>
                <input id={`${id}-ps-${i}`} inputMode="decimal" value={p.seuil} onChange={(e) => setPaliers((l) => l.map((x, j) => (j === i ? { ...x, seuil: e.target.value } : x)))} className={champ} />
              </div>
              <div>
                <label htmlFor={`${id}-pp-${i}`} className="mb-1 block text-xs text-text-secondary">{fr ? '+ % en plus' : '+ extra %'}</label>
                <input id={`${id}-pp-${i}`} inputMode="decimal" value={p.pct} onChange={(e) => setPaliers((l) => l.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} className={champ} />
              </div>
              <div>
                <label htmlFor={`${id}-pf-${i}`} className="mb-1 block text-xs text-text-secondary">{fr ? '+ $ par vente' : '+ $ per sale'}</label>
                <input id={`${id}-pf-${i}`} inputMode="decimal" value={p.fixe} onChange={(e) => setPaliers((l) => l.map((x, j) => (j === i ? { ...x, fixe: e.target.value } : x)))} className={champ} />
              </div>
              <button type="button" onClick={() => setPaliers((l) => l.filter((_, j) => j !== i))} className={boutonRetirer} aria-label={fr ? 'Retirer ce palier' : 'Remove this tier'}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setPaliers((l) => [...l, { metric: 'revenue_cents', seuil: '', pct: '', fixe: '' }])} className={boutonAjout}>
            <Plus className="h-3.5 w-3.5" /> {fr ? 'Ajouter un palier' : 'Add a tier'}
          </button>
        </fieldset>

        {/* Surcharges par catégorie */}
        <fieldset className="space-y-2">
          <legend className={titreSection}>{fr ? 'Taux par catégorie de service (facultatif)' : 'Rate per service category (optional)'}</legend>
          {surcharges.map((s, i) => (
            <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1.6fr_1.2fr_1fr_auto]">
              <div>
                <label htmlFor={`${id}-sc-${i}`} className="mb-1 block text-xs text-text-secondary">{fr ? 'Catégorie' : 'Category'}</label>
                <input id={`${id}-sc-${i}`} value={s.category} onChange={(e) => setSurcharges((l) => l.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))} className={champ} />
              </div>
              <div>
                <label htmlFor={`${id}-sk-${i}`} className="mb-1 block text-xs text-text-secondary">{fr ? 'Type' : 'Type'}</label>
                <select id={`${id}-sk-${i}`} value={s.kind} onChange={(e) => setSurcharges((l) => l.map((x, j) => (j === i ? { ...x, kind: e.target.value as Surcharge['kind'] } : x)))} className={champ}>
                  <option value="percent">%</option>
                  <option value="flat">{fr ? '$ fixe' : 'Flat $'}</option>
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-sv-${i}`} className="mb-1 block text-xs text-text-secondary">{fr ? 'Valeur' : 'Value'}</label>
                <input id={`${id}-sv-${i}`} inputMode="decimal" value={s.valeur} onChange={(e) => setSurcharges((l) => l.map((x, j) => (j === i ? { ...x, valeur: e.target.value } : x)))} className={champ} />
              </div>
              <button type="button" onClick={() => setSurcharges((l) => l.filter((_, j) => j !== i))} className={boutonRetirer} aria-label={fr ? 'Retirer cette catégorie' : 'Remove this category'}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setSurcharges((l) => [...l, { category: '', kind: 'percent', valeur: '' }])} className={boutonAjout}>
            <Plus className="h-3.5 w-3.5" /> {fr ? 'Ajouter une catégorie' : 'Add a category'}
          </button>
        </fieldset>

        {/* Bonus grosse vente */}
        <fieldset className="space-y-2">
          <legend className={titreSection}>{fr ? 'Bonus grosse vente (facultatif)' : 'Big-sale bonus (optional)'}</legend>
          {bonus.map((b, i) => (
            <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
              <div>
                <label htmlFor={`${id}-bm-${i}`} className="mb-1 block text-xs text-text-secondary">{fr ? 'Vente d’au moins ($, avant taxes)' : 'Sale of at least ($, pre-tax)'}</label>
                <input id={`${id}-bm-${i}`} inputMode="decimal" value={b.minimum} onChange={(e) => setBonus((l) => l.map((x, j) => (j === i ? { ...x, minimum: e.target.value } : x)))} className={champ} />
              </div>
              <div>
                <label htmlFor={`${id}-bp-${i}`} className="mb-1 block text-xs text-text-secondary">{fr ? '+ %' : '+ %'}</label>
                <input id={`${id}-bp-${i}`} inputMode="decimal" value={b.pct} onChange={(e) => setBonus((l) => l.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} className={champ} />
              </div>
              <div>
                <label htmlFor={`${id}-bf-${i}`} className="mb-1 block text-xs text-text-secondary">{fr ? '+ $' : '+ $'}</label>
                <input id={`${id}-bf-${i}`} inputMode="decimal" value={b.fixe} onChange={(e) => setBonus((l) => l.map((x, j) => (j === i ? { ...x, fixe: e.target.value } : x)))} className={champ} />
              </div>
              <button type="button" onClick={() => setBonus((l) => l.filter((_, j) => j !== i))} className={boutonRetirer} aria-label={fr ? 'Retirer ce bonus' : 'Remove this bonus'}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setBonus((l) => [...l, { minimum: '', pct: '', fixe: '' }])} className={boutonAjout}>
            <Plus className="h-3.5 w-3.5" /> {fr ? 'Ajouter un bonus' : 'Add a bonus'}
          </button>
        </fieldset>

        {/* Partage */}
        <fieldset className="space-y-2">
          <legend className={titreSection}>{fr ? 'Partage entre plusieurs personnes (facultatif)' : 'Split between several people (optional)'}</legend>
          <div className="flex items-center gap-2">
            <input id={`${id}-split`} type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} className="h-4 w-4" />
            <label htmlFor={`${id}-split`} className="text-sm">{fr ? 'Partager chaque commission de ce plan' : 'Split every commission of this plan'}</label>
          </div>
          {split && (
            <>
              <p className="text-xs text-text-tertiary">{fr ? 'Seules les personnes listées sont payées. Total maximum : 100 %.' : 'Only the people listed are paid. Maximum total: 100%.'}</p>
              {parts.map((p, i) => (
                <div key={i} className="grid grid-cols-[1.6fr_1fr_auto] items-end gap-2">
                  <div>
                    <label htmlFor={`${id}-su-${i}`} className="mb-1 block text-xs text-text-secondary">{fr ? 'Personne' : 'Person'}</label>
                    <select id={`${id}-su-${i}`} value={p.user_id} onChange={(e) => setParts((l) => l.map((x, j) => (j === i ? { ...x, user_id: e.target.value } : x)))} className={champ}>
                      {membres.map((m) => <option key={m.user_id} value={m.user_id}>{m.nom}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`${id}-sp-${i}`} className="mb-1 block text-xs text-text-secondary">%</label>
                    <input id={`${id}-sp-${i}`} inputMode="decimal" value={p.pct} onChange={(e) => setParts((l) => l.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} className={champ} />
                  </div>
                  <button type="button" onClick={() => setParts((l) => l.filter((_, j) => j !== i))} className={boutonRetirer} aria-label={`${fr ? 'Retirer' : 'Remove'} ${nomDe(p.user_id)}`}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <button type="button" disabled={membres.length === 0} onClick={() => setParts((l) => [...l, { user_id: membres[0]?.user_id ?? '', pct: '' }])} className={boutonAjout}>
                  <Plus className="h-3.5 w-3.5" /> {fr ? 'Ajouter une personne' : 'Add a person'}
                </button>
                <span className={`text-xs font-semibold ${totalSplit > 100 ? 'text-error' : 'text-text-secondary'}`}>{fr ? `Total : ${totalSplit} %` : `Total: ${totalSplit}%`}</span>
              </div>
            </>
          )}
        </fieldset>

        {erreurs.length > 0 && (
          <ul className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            {erreurs.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
      </div>
    </Modal>
  );
}
