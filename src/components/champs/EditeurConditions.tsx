/**
 * Éditeur de conditions sur des champs personnalisés — une ligne par
 * condition : champ · opérateur · valeur(s). ET logique entre les lignes.
 *
 * Produit des `Condition` du moteur partagé (src/lib/champs/filtres.ts),
 * que le SQL (cf_filtrer) et le moteur d'automatisations comprennent tels
 * quels. Utilisé par les filtres du pipeline et l'étape « si » des
 * automatisations.
 *
 * Montant : saisi en dollars, stocké en cents dans la condition.
 */
import { useId } from 'react';
import { Plus, X } from 'lucide-react';
import DatePickerInput from '../ui/DatePickerInput';
import type { ChampPerso } from '../../lib/champs/types';
import {
  familleDuType, LIBELLES_OPERATEUR, OPERATEURS_DUREE, OPERATEURS_PAR_FAMILLE,
  type Condition, type Operateur, type UniteDuree,
} from '../../lib/champs/filtres';

interface Props {
  champs: ChampPerso[];
  conditions: Condition[];
  onChange: (c: Condition[]) => void;
  fr: boolean;
  max?: number;
}

const input = 'h-8 rounded-md border border-outline bg-surface-card px-2 text-[13px] text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

/** Une condition est-elle complète (prête à être envoyée) ? */
export function conditionComplete(c: Condition): boolean {
  if (c.op === 'is_empty' || c.op === 'is_not_empty' || c.op === 'today' || c.op === 'yesterday') return true;
  if (OPERATEURS_DUREE.includes(c.op)) return (c.n ?? 0) > 0;
  if (c.op === 'any_of' || c.op === 'none_of') return Array.isArray(c.value) && c.value.length > 0;
  if (c.op === 'between') return c.value != null && c.value !== '' && c.value2 != null && c.value2 !== '';
  return c.value != null && c.value !== '';
}

export default function EditeurConditions({ champs, conditions, onChange, fr, max = 10 }: Props) {
  const ids = useId();
  const actifs = champs.filter((c) => !c.archived_at);

  const maj = (i: number, patch: Partial<Condition>) =>
    onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const ajouter = () => {
    const premier = actifs[0];
    if (!premier) return;
    onChange([...conditions, { field_id: premier.id, op: OPERATEURS_PAR_FAMILLE[familleDuType(premier.field_type)][0] }]);
  };

  if (actifs.length === 0) {
    return <p className="text-[12px] text-text-tertiary">{fr ? 'Aucun champ personnalisé pour cet objet.' : 'No custom fields for this object.'}</p>;
  }

  return (
    <div className="space-y-2">
      {conditions.map((c, i) => {
        const champ = champs.find((x) => x.id === c.field_id);
        const famille = champ ? familleDuType(champ.field_type) : 'texte';
        const ops = OPERATEURS_PAR_FAMILLE[famille];
        const monetaire = champ?.field_type === 'monetary';
        const id = `${ids}-${i}`;
        const nombre = (v: Condition['value']) => (v == null || v === '' ? '' : String(monetaire ? Number(v) / 100 : v));
        const versValeur = (t: string) => (t === '' ? null : monetaire ? Math.round(Number(t.replace(',', '.')) * 100) : Number(t.replace(',', '.')));
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-surface-secondary/60 p-2">
            <label htmlFor={`${id}-champ`} className="sr-only">{fr ? 'Champ' : 'Field'}</label>
            <select
              id={`${id}-champ`} className={input} value={c.field_id}
              onChange={(e) => {
                const nouveau = champs.find((x) => x.id === e.target.value);
                const f = nouveau ? familleDuType(nouveau.field_type) : 'texte';
                maj(i, { field_id: e.target.value, op: OPERATEURS_PAR_FAMILLE[f][0], value: null, value2: null, n: undefined, unit: undefined });
              }}
            >
              {actifs.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            <label htmlFor={`${id}-op`} className="sr-only">{fr ? 'Opérateur' : 'Operator'}</label>
            <select
              id={`${id}-op`} className={input} value={c.op}
              onChange={(e) => maj(i, { op: e.target.value as Operateur, value: null, value2: null })}
            >
              {ops.map((o) => <option key={o} value={o}>{fr ? LIBELLES_OPERATEUR[o].fr : LIBELLES_OPERATEUR[o].en}</option>)}
            </select>

            {/* Valeurs selon la famille et l'opérateur */}
            {famille === 'texte' && !['is_empty', 'is_not_empty'].includes(c.op) && (
              <input
                aria-label={fr ? 'Valeur' : 'Value'} className={input} value={String(c.value ?? '')}
                onChange={(e) => maj(i, { value: e.target.value })}
              />
            )}
            {famille === 'nombre' && !['is_empty', 'is_not_empty'].includes(c.op) && (
              <>
                <input
                  aria-label={fr ? 'Valeur' : 'Value'} inputMode="decimal" className={`${input} w-24`} value={nombre(c.value)}
                  onChange={(e) => maj(i, { value: versValeur(e.target.value) })}
                />
                {c.op === 'between' && (
                  <>
                    <span className="text-[12px] text-text-tertiary">{fr ? 'et' : 'and'}</span>
                    <input
                      aria-label={fr ? 'Deuxième valeur' : 'Second value'} inputMode="decimal" className={`${input} w-24`} value={nombre(c.value2 ?? null)}
                      onChange={(e) => maj(i, { value2: versValeur(e.target.value) })}
                    />
                  </>
                )}
                {monetaire && <span className="text-[12px] text-text-tertiary">$</span>}
              </>
            )}
            {famille === 'liste' && (c.op === 'any_of' || c.op === 'none_of') && champ && (
              <div role="group" aria-label={fr ? 'Options' : 'Options'} className="flex flex-wrap gap-1">
                {champ.options.map((o) => {
                  const choisies = Array.isArray(c.value) ? c.value : [];
                  const actif = choisies.includes(o.id);
                  return (
                    <button
                      key={o.id} type="button" aria-pressed={actif}
                      onClick={() => maj(i, { value: actif ? choisies.filter((x) => x !== o.id) : [...choisies, o.id] })}
                      className={`rounded-full border px-2 py-0.5 text-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${actif ? 'border-primary bg-primary/10 text-text-primary' : 'border-outline text-text-secondary'}`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            )}
            {famille === 'date' && OPERATEURS_DUREE.includes(c.op) && (
              <>
                <input
                  aria-label={fr ? 'Nombre' : 'Number'} type="number" min={1} max={3650} className={`${input} w-16`}
                  value={c.n ?? ''} onChange={(e) => maj(i, { n: e.target.value ? Math.max(1, Math.min(3650, Number(e.target.value))) : undefined })}
                />
                <label htmlFor={`${id}-unite`} className="sr-only">{fr ? 'Unité' : 'Unit'}</label>
                <select
                  id={`${id}-unite`} className={input} value={c.unit ?? 'days'}
                  onChange={(e) => maj(i, { unit: e.target.value as UniteDuree })}
                >
                  <option value="days">{fr ? 'jours' : 'days'}</option>
                  <option value="weeks">{fr ? 'semaines' : 'weeks'}</option>
                  <option value="months">{fr ? 'mois' : 'months'}</option>
                </select>
              </>
            )}
            {famille === 'date' && (c.op === 'before' || c.op === 'after' || c.op === 'between') && (
              <>
                <div className="w-36">
                  <DatePickerInput value={String(c.value ?? '')} onChange={(v: string) => maj(i, { value: v || null })} language={fr ? 'fr' : 'en'} />
                </div>
                {c.op === 'between' && (
                  <>
                    <span className="text-[12px] text-text-tertiary">{fr ? 'et' : 'and'}</span>
                    <div className="w-36">
                      <DatePickerInput value={String(c.value2 ?? '')} onChange={(v: string) => maj(i, { value2: v || null })} language={fr ? 'fr' : 'en'} />
                    </div>
                  </>
                )}
              </>
            )}

            <button
              type="button" aria-label={fr ? 'Retirer la condition' : 'Remove condition'}
              onClick={() => onChange(conditions.filter((_, j) => j !== i))}
              className="ml-auto rounded p-1 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
      {conditions.length < max && (
        <button
          type="button" onClick={ajouter}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Plus size={13} aria-hidden /> {fr ? 'Ajouter une condition' : 'Add a condition'}
        </button>
      )}
    </div>
  );
}
