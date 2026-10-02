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
import { useEffect, useId, useState } from 'react';
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

/**
 * Un nombre (ou un montant en dollars) saisi au clavier.
 *
 * Le champ garde SON TEXTE : avant, il réaffichait à chaque frappe le nombre
 * converti. Taper 1, 2, point donnait `Number('12.')` = 12 — le point
 * disparaissait de l'écran, et le 5 suivant faisait « 125 », enregistré tel
 * quel ; une lettre donnait `Number('abc')` → « NaN » à l'écran (triage
 * déclencheurs, 04-filtres-conditions:418). Ici la conversion ne touche plus à
 * ce qui est affiché, et une frappe qui n'est pas un nombre en cours de
 * saisie (« -12,5 ») est simplement ignorée.
 */
function SaisieNombre({ valeur, monetaire, onChange, libelle, className }: {
  valeur: Condition['value'] | undefined; monetaire: boolean; onChange: (v: number | null) => void; libelle: string; className: string;
}) {
  const versTexte = (v: Condition['value'] | undefined) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : String(monetaire ? Number(v) / 100 : v));
  const versValeur = (t: string): number | null => {
    const n = Number(t.replace(',', '.'));
    if (t.trim() === '' || !Number.isFinite(n)) return null;
    return monetaire ? Math.round(n * 100) : n;
  };
  const [texte, setTexte] = useState(() => versTexte(valeur));
  // La valeur a changé AILLEURS (autre champ, autre opérateur, ligne retirée) : on la reprend.
  const recue = valeur == null || valeur === '' || !Number.isFinite(Number(valeur)) ? null : Number(valeur);
  useEffect(() => {
    if (versValeur(texte) !== recue) setTexte(versTexte(valeur));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seule la valeur reçue compte : le texte en cours de frappe ne doit pas relancer la reprise.
  }, [recue]);
  return (
    <input
      aria-label={libelle} inputMode="decimal" className={className} value={texte}
      onChange={(e) => {
        const t = e.target.value;
        if (!/^-?\d*[.,]?\d*$/.test(t.trim())) return;
        setTexte(t);
        onChange(versValeur(t));
      }}
    />
  );
}

export default function EditeurConditions({ champs, conditions, onChange, fr, max = 10 }: Props) {
  const ids = useId();
  const actifs = champs.filter((c) => !c.archived_at);

  const maj = (i: number, patch: Partial<Condition>) =>
    onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const ajouter = () => {
    const premier = actifs[0];
    if (!premier) return;
    const f = familleDuType(premier.field_type);
    onChange([...conditions, { field_id: premier.id, op: OPERATEURS_PAR_FAMILLE[f][0], ...(f === 'case' ? { value: true } : {}) }]);
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
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-surface-secondary/60 p-2">
            <label htmlFor={`${id}-champ`} className="sr-only">{fr ? 'Champ' : 'Field'}</label>
            <select
              id={`${id}-champ`} className={input} value={c.field_id}
              onChange={(e) => {
                const nouveau = champs.find((x) => x.id === e.target.value);
                const f = nouveau ? familleDuType(nouveau.field_type) : 'texte';
                maj(i, { field_id: e.target.value, op: OPERATEURS_PAR_FAMILLE[f][0], value: f === 'case' ? true : null, value2: null, n: undefined, unit: undefined });
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
            {famille === 'case' && (
              <>
                <label htmlFor={`${id}-case`} className="sr-only">{fr ? 'Valeur' : 'Value'}</label>
                <select id={`${id}-case`} className={input} value={c.value === false || c.value === 'false' ? 'false' : 'true'}
                  onChange={(e) => maj(i, { value: e.target.value === 'true' })}>
                  <option value="true">{fr ? 'oui (cochée)' : 'yes (checked)'}</option>
                  <option value="false">{fr ? 'non (pas cochée)' : 'no (not checked)'}</option>
                </select>
              </>
            )}
            {famille === 'texte' && !['is_empty', 'is_not_empty'].includes(c.op) && (
              <input
                aria-label={fr ? 'Valeur' : 'Value'} className={input} value={String(c.value ?? '')}
                onChange={(e) => maj(i, { value: e.target.value })}
              />
            )}
            {famille === 'nombre' && !['is_empty', 'is_not_empty'].includes(c.op) && (
              <>
                <SaisieNombre
                  libelle={fr ? 'Valeur' : 'Value'} className={`${input} w-24`} monetaire={monetaire}
                  valeur={c.value} onChange={(v) => maj(i, { value: v })}
                />
                {c.op === 'between' && (
                  <>
                    <span className="text-[12px] text-text-tertiary">{fr ? 'et' : 'and'}</span>
                    <SaisieNombre
                      libelle={fr ? 'Deuxième valeur' : 'Second value'} className={`${input} w-24`} monetaire={monetaire}
                      valeur={c.value2} onChange={(v) => maj(i, { value2: v })}
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
