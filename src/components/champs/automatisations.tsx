/**
 * Champs personnalisés × builder d'automatisations.
 *
 *   · useChampsTous : tous les champs (drapeau `custom_fields_v2` requis) ;
 *   · SelecteurChamp : choisir un champ (déclencheur « champ modifié »,
 *     action « mettre à jour un champ ») ;
 *   · BoutonsVariablesChamps : insérer {{client.superficie}}… ;
 *   · ConditionsChampsEtape : conditions `champs_perso` d'une étape « si ».
 * Coupé par le drapeau, rien de tout ça ne s'affiche.
 */
import { useId, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ENTITE_PAR_DECLENCHEUR } from '../../lib/automationCatalogue';
import { useChampsPersoActifs } from '../../hooks/useChampsPersoActifs';
import { listerChamps } from '../../lib/champsPersoApi';
import { LIBELLES_OBJET, OBJETS, variableAffichee, variableModele, type ChampPerso, type ObjetChamp } from '../../lib/champs/types';
import type { Condition } from '../../lib/champs/filtres';
import EditeurConditions, { conditionComplete } from './EditeurConditions';
import { champsSysteme } from '../../lib/champs/standard';

/** Objets dont les champs sont citables dans un message (une propriété ne l'est pas encore). */
const OBJETS_VARIABLES = OBJETS.filter((o) => o !== 'property');

/**
 * Champs SYSTÈME citables : ce que les formulaires enregistrent déjà
 * ({{client.first_name}}, {{job.salesperson}}…), rempli par le serveur
 * (server/lib/champs/variablesSysteme.ts).
 */
export function variablesSysteme(objets: ObjetChamp[] = OBJETS_VARIABLES) {
  return objets.flatMap((o) => champsSysteme(o).map((c) => ({ objet: o, key: c.key, label: c.label })));
}

export function useChampsTous(): ChampPerso[] {
  const { isEnabled } = useChampsPersoActifs();
  const { data } = useQuery({
    queryKey: ['champs-perso', 'tous'],
    queryFn: () => listerChamps(),
    enabled: isEnabled,
    staleTime: 60_000,
  });
  // Aucun déclencheur ne porte encore une propriété : ses champs ne seraient jamais remplis ici.
  return useMemo(() => (data?.fields ?? []).filter((c) => !c.archived_at && c.object_type !== 'property'), [data]);
}

/** L'objet d'un déclencheur du catalogue (champ `entite`). */
export function objetDuDeclencheur(entite: string | undefined): ObjetChamp | null {
  switch (entite) {
    case 'lead': return 'client';
    case 'deal': return 'deal';
    case 'job': return 'job';
    case 'quote': return 'quote';
    case 'invoice': return 'invoice';
    default: return null;
  }
}

/**
 * L'objet des champs d'une ENTITÉ du moteur (`ENTITE_PAR_DECLENCHEUR`) :
 * un prospect est une fiche client ; un rendez-vous n'a pas de champs.
 */
export function objetDeLEntiteMoteur(entite: string | null | undefined): ObjetChamp | null {
  switch (entite) {
    case 'client': case 'lead': return 'client';
    case 'deal': return 'deal';
    case 'job': return 'job';
    case 'quote': return 'quote';
    case 'invoice': return 'invoice';
    default: return null;
  }
}

/**
 * Le champ surveillé par « Champ modifié ». L'éditeur l'écrit
 * `{ field_id: { eq: id } }` ; une règle plus ancienne peut le porter à plat.
 */
export function champSurveille(conditions: Record<string, unknown> | null | undefined): string {
  const v = conditions?.field_id;
  if (v && typeof v === 'object' && !Array.isArray(v)) return String((v as { eq?: unknown }).eq ?? '');
  return typeof v === 'string' ? v : '';
}

/**
 * L'objet dont une règle peut lire et écrire les champs : celui de l'entité
 * que l'événement fera arriver.
 *
 * Deux déclencheurs ont une entité VARIABLE (`'*'`) qui dépend du champ
 * choisi : « Champ modifié » (le champ surveillé) et « Date atteinte » (le
 * champ date, client ou deal). Sans champ choisi, on ne sait pas : `null`.
 */
export function objetDeLaRegle(
  cleDeclencheur: string | null | undefined,
  conditions: Record<string, unknown> | null | undefined,
  champs: ChampPerso[],
): ObjetChamp | null {
  if (!cleDeclencheur) return null;
  const id = cleDeclencheur === 'custom_field.changed' ? champSurveille(conditions)
    : cleDeclencheur === 'date.reached' ? String(conditions?.champ_id ?? '') : '';
  if (id) {
    const objet = champs.find((c) => c.id === id)?.object_type;
    if (objet && objet !== 'property') return objet;
  }
  const entite = ENTITE_PAR_DECLENCHEUR[cleDeclencheur];
  return entite === '*' ? null : objetDeLEntiteMoteur(entite);
}

/**
 * Types dont on peut dire « quand il devient … ». Le texte long, le
 * téléphone (normalisé en +1…) et le fichier ne se comparent pas utilement à
 * une valeur tapée ; une date AVEC heure ne tomberait jamais pile.
 */
export function champComparable(champ: ChampPerso): boolean {
  if (champ.field_type === 'date') return !champ.config.include_time;
  return !['multi_line', 'phone', 'file'].includes(champ.field_type);
}

/**
 * Saisie (texte du formulaire) → valeur de condition comparée à
 * `metadata.new_value`, que le serveur émet NORMALISÉE (`lireValeur`) :
 * id d'option, booléen, nombre, montant en CENTS, date AAAA-MM-JJ.
 */
export function valeurConditionDepuisSaisie(champ: ChampPerso, texte: string): string | number | boolean | null {
  const t = texte.trim();
  if (t === '') return null;
  switch (champ.field_type) {
    case 'checkbox': return t === 'true';
    case 'number': {
      const n = Number(t.replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    case 'monetary': {
      const n = Number(t.replace(/[\s$]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? Math.round(n * 100) : null;
    }
    default: return t;
  }
}

/** L'inverse : la valeur stockée → le texte du formulaire. */
export function saisieDepuisValeurCondition(champ: ChampPerso | undefined, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (champ?.field_type === 'monetary' && typeof v === 'number') return String(v / 100);
  return String(v);
}

/** Retire les conditions de champs INCOMPLÈTES : une ligne sans valeur bloquerait la règle pour toujours. */
export function sansConditionsIncompletes(conditions: Record<string, unknown>): Record<string, unknown> {
  const liste = conditions.champs_perso;
  if (!Array.isArray(liste)) return conditions;
  const completes = (liste as Condition[]).filter(conditionComplete);
  const { champs_perso: _ancien, ...reste } = conditions;
  return completes.length ? { ...reste, champs_perso: completes } : reste;
}

/**
 * Une valeur de champ saisie selon son TYPE — liste, case, nombre, montant,
 * date, texte. Toujours en TEXTE (c'est ce que `config` porte) : montant en
 * dollars, case « true » / « false », liste multiple = ids séparés par « , ».
 */
export function SaisieValeurChamp({ id, champ, valeur, onChange, fr, multiple = false, libelleVide }: {
  id: string; champ: ChampPerso; valeur: string; onChange: (v: string) => void; fr: boolean;
  /** Liste multiple : cocher plusieurs options (action) ; sinon une seule (condition « contient »). */
  multiple?: boolean;
  /** Libellé de l'option vide d'une liste. */
  libelleVide?: string;
}) {
  const classe = 'w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  const options = champ.options.filter((o) => !o.archived_at);
  const vide = libelleVide ?? (fr ? '— Aucune —' : '— None —');
  switch (champ.field_type) {
    case 'dropdown_multi':
      if (multiple) {
        const choisies = new Set(valeur.split(',').map((x) => x.trim()).filter(Boolean));
        return (
          <fieldset id={id} className="space-y-1 rounded-lg border border-border px-3 py-2">
            <legend className="sr-only">{champ.label}</legend>
            {options.map((o) => (
              <label key={o.id} htmlFor={`${id}-${o.id}`} className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                <input
                  id={`${id}-${o.id}`} type="checkbox" checked={choisies.has(o.id)}
                  onChange={(e) => {
                    const suite = new Set(choisies);
                    if (e.target.checked) suite.add(o.id); else suite.delete(o.id);
                    // Dans l'ordre de la liste, pas l'ordre des clics : relu identique.
                    onChange(options.filter((x) => suite.has(x.id)).map((x) => x.id).join(','));
                  }}
                  className="h-4 w-4 rounded border-border accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                {o.label}
              </label>
            ))}
          </fieldset>
        );
      }
      return (
        <select id={id} value={valeur} onChange={(e) => onChange(e.target.value)} className={classe}>
          <option value="">{vide}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      );
    case 'dropdown_single':
      return (
        <select id={id} value={valeur} onChange={(e) => onChange(e.target.value)} className={classe}>
          <option value="">{vide}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      );
    case 'checkbox':
      return (
        <select id={id} value={valeur} onChange={(e) => onChange(e.target.value)} className={classe}>
          <option value="">{vide}</option>
          <option value="true">{fr ? 'Oui (cochée)' : 'Yes (checked)'}</option>
          <option value="false">{fr ? 'Non (décochée)' : 'No (unchecked)'}</option>
        </select>
      );
    case 'number':
      return <input id={id} type="number" inputMode="decimal" value={valeur} onChange={(e) => onChange(e.target.value)} className={classe} />;
    case 'monetary':
      return (
        <div className="relative">
          <input id={id} type="number" inputMode="decimal" step="0.01" value={valeur}
            onChange={(e) => onChange(e.target.value)} className={`${classe} pr-8`} />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-tertiary" aria-hidden="true">$</span>
        </div>
      );
    case 'date':
      return <input id={id} type="date" value={valeur.slice(0, 10)} onChange={(e) => onChange(e.target.value)} className={classe} />;
    case 'multi_line':
      return <textarea id={id} rows={3} maxLength={5000} value={valeur} onChange={(e) => onChange(e.target.value)} className={classe} />;
    default:
      return (
        <input id={id} type={champ.field_type === 'email' ? 'email' : champ.field_type === 'url' ? 'url' : 'text'}
          maxLength={500} value={valeur} onChange={(e) => onChange(e.target.value)} className={classe} />
      );
  }
}

/**
 * L'action « Mettre à jour un champ » : une LISTE des champs de l'objet de
 * l'événement (plus d'identifiant à taper) et une valeur adaptée au type.
 * Stocke `{ field_id, value }` en texte, ce que `executerMajChamp` relit.
 */
export function EditeurMajChamp({ fieldId, valeur, onChange, champs, objet, fr }: {
  fieldId: string; valeur: string;
  onChange: (cle: 'field_id' | 'value', v: string) => void;
  champs: ChampPerso[];
  /** L'objet de l'événement ; `null` = inconnu (tous les objets, groupés). */
  objet: ObjetChamp | null; fr: boolean;
}) {
  const id = useId();
  const champ = champs.find((c) => c.id === fieldId);
  const classe = 'w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  const disponibles = objet ? champs.filter((c) => c.object_type === objet) : champs;
  return (
    <>
      <div>
        <label htmlFor={`${id}-champ`} className="mb-1 block text-xs font-medium text-text-primary">
          {fr ? 'Champ' : 'Field'}<span className="text-red-500"> *</span>
        </label>
        {disponibles.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[13px] text-text-secondary">
            {objet
              ? (fr ? `Aucun champ personnalisé sur l’objet « ${LIBELLES_OBJET[objet].fr} ». Créez-en un dans Paramètres → Champs personnalisés.`
                : `No custom field on “${LIBELLES_OBJET[objet].en}”. Create one in Settings → Custom fields.`)
              : (fr ? 'Aucun champ personnalisé. Créez-en un dans Paramètres → Champs personnalisés.' : 'No custom field yet. Create one in Settings → Custom fields.')}
          </p>
        ) : (
          <SelecteurChamp id={`${id}-champ`} valeur={fieldId} champs={champs} fr={fr} objet={objet} className={classe}
            // Changer de champ vide la valeur : une option d'un autre champ n'aurait aucun sens.
            onChange={(v) => { onChange('field_id', v); onChange('value', ''); }} />
        )}
        {fieldId && !champ && (
          <p className="mt-1 text-[11px] text-danger">
            {fr ? 'Ce champ n’existe plus (archivé ou supprimé) : choisissez-en un autre.' : 'This field no longer exists (archived or deleted): pick another one.'}
          </p>
        )}
      </div>
      {champ && (
        <div>
          <label htmlFor={`${id}-valeur`} className="mb-1 block text-xs font-medium text-text-primary">
            {fr ? 'Nouvelle valeur' : 'New value'}
            <span className="font-normal text-text-tertiary"> {fr ? '(facultatif)' : '(optional)'}</span>
          </label>
          <SaisieValeurChamp id={`${id}-valeur`} champ={champ} valeur={valeur} fr={fr} multiple
            libelleVide={fr ? '— Effacer le champ —' : '— Clear the field —'}
            onChange={(v) => onChange('value', v)} />
          <p className="mt-1 text-[11px] text-text-tertiary">
            {champ.field_type === 'monetary'
              ? (fr ? 'En dollars. Vide = effacer le champ.' : 'In dollars. Empty = clear the field.')
              : (fr ? 'Vide = effacer le champ.' : 'Empty = clear the field.')}
          </p>
        </div>
      )}
    </>
  );
}

/** Variables de modèle des champs : [client_cf_superficie], … */
export function variablesDesChamps(champs: ChampPerso[]): string[] {
  return [
    ...champs.map((c) => variableModele(c.object_type, c.key)),
    ...variablesSysteme().map((v) => variableModele(v.objet, v.key)),
  ];
}

export function SelecteurChamp({ id, valeur, onChange, champs, fr, objet, className }: {
  id: string; valeur: string; onChange: (id: string) => void; champs: ChampPerso[]; fr: boolean;
  /** Restreindre à un objet (celui de l'événement), sinon tous groupés. */
  objet?: ObjetChamp | null; className?: string;
}) {
  const objets = objet ? [objet] : OBJETS.filter((o) => o !== 'property');
  return (
    <select id={id} value={valeur} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{fr ? '— Choisir un champ —' : '— Choose a field —'}</option>
      {objets.map((o) => {
        const liste = champs.filter((c) => c.object_type === o);
        return liste.length ? (
          <optgroup key={o} label={fr ? LIBELLES_OBJET[o].fr : LIBELLES_OBJET[o].en}>
            {liste.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}

export function BoutonsVariablesChamps({ champs, fr, onInserer }: { champs: ChampPerso[]; fr: boolean; onInserer: (variable: string) => void }) {
  const classe = 'rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  return (
    <>
      {/* Champs des formulaires (système), repliés : une quarantaine de variables. */}
      <details className="w-full">
        <summary className="cursor-pointer text-[11px] font-medium text-text-secondary hover:text-text-primary">
          {fr ? 'Champs de base' : 'Base fields'}
        </summary>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {variablesSysteme().map((v) => (
            <button key={`${v.objet}.${v.key}`} type="button" onClick={() => onInserer(variableAffichee(v.objet, v.key))}
              title={variableAffichee(v.objet, v.key)} className={classe}>
              {(fr ? LIBELLES_OBJET[v.objet].fr : LIBELLES_OBJET[v.objet].en)} · {fr ? v.label.fr : v.label.en}
            </button>
          ))}
        </div>
      </details>
      {champs.map((c) => (
        <button
          key={c.id} type="button"
          onClick={() => onInserer(variableAffichee(c.object_type, c.key))}
          title={variableAffichee(c.object_type, c.key)}
          className={classe}
        >
          {(fr ? LIBELLES_OBJET[c.object_type].fr : LIBELLES_OBJET[c.object_type].en)} · {c.label}
        </button>
      ))}
    </>
  );
}

/** Conditions sur les champs d'une étape « si » (clé réservée `champs_perso`). */
export function ConditionsChampsEtape({ conditions, onChange, champs, objet, fr }: {
  conditions: Record<string, unknown> | undefined; onChange: (c: Record<string, unknown>) => void;
  champs: ChampPerso[]; objet: ObjetChamp | null; fr: boolean;
}) {
  if (!objet) return null;
  const duObjet = champs.filter((c) => c.object_type === objet);
  if (duObjet.length === 0) return null;
  const actuelles = (Array.isArray(conditions?.champs_perso) ? conditions!.champs_perso : []) as Condition[];
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-xs font-medium text-text-primary">
        {fr ? '… et si les champs personnalisés sont :' : '… and if the custom fields are:'}
      </p>
      <EditeurConditions champs={duObjet} conditions={actuelles} fr={fr}
        onChange={(liste) => {
          const { champs_perso: _ancien, ...reste } = conditions ?? {};
          onChange(liste.length ? { ...reste, champs_perso: liste } : reste);
        }} />
    </div>
  );
}

/**
 * Variables de champs proposées dans un éditeur de courriel.
 *   · modèle de facture (invoice_sent, invoice_reminder) : champs du client
 *     et de la facture ; modèle de soumission (quote_sent) : client et devis —
 *     ce que le serveur sait remplir pour ce poste ;
 *   · autre modèle d'entreprise : aucun (le serveur ne les remplirait pas) ;
 *   · automatisation (pas de type) : tous les objets.
 */
export function variablesChampsPourCourriel(
  typeCourriel: string | undefined, champs: ChampPerso[],
): Array<{ cle: string; fr: string; en: string; jeton: string }> {
  const objets: ObjetChamp[] = !typeCourriel
    ? OBJETS.filter((o) => o !== 'property')
    : typeCourriel === 'invoice_sent' || typeCourriel === 'invoice_reminder' ? ['client', 'invoice']
    : typeCourriel === 'quote_sent' ? ['client', 'quote'] : [];
  return [
    // Champs des formulaires (système) d'abord, puis les champs personnalisés.
    ...variablesSysteme(objets).map((v) => ({
      cle: variableModele(v.objet, v.key),
      jeton: variableAffichee(v.objet, v.key),
      fr: `${LIBELLES_OBJET[v.objet].fr} · ${v.label.fr}`,
      en: `${LIBELLES_OBJET[v.objet].en} · ${v.label.en}`,
    })),
    ...champs.filter((c) => objets.includes(c.object_type)).map((c) => ({
      cle: variableModele(c.object_type, c.key),
      // Ce qu'on écrit dans le courriel : le format GoHighLevel. `cle` reste le
      // nom interne, celui que le serveur résout et que la détection compare.
      jeton: variableAffichee(c.object_type, c.key),
      fr: `${LIBELLES_OBJET[c.object_type].fr} · ${c.label}`,
      en: `${LIBELLES_OBJET[c.object_type].en} · ${c.label}`,
    })),
  ];
}
