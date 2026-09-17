// Sélecteur de champ Lume pour une colonne de migration : menu en deux
// colonnes (entités à gauche, champs de l'entité à droite), recherche globale
// fixe en haut, « Ne pas importer » fixe en bas. Les entités et leurs champs
// viennent tels quels de FIELD_CATALOG (server/lib/migration/mapping.ts),
// servi dans `field_catalog` ; les regroupements ci-dessous n'organisent que
// l'affichage et ne changent jamais l'identifiant envoyé au serveur.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Ban, Briefcase, Building2, CalendarDays, Check, ChevronDown, CreditCard, FileText, Home,
  ListOrdered, Package, Percent, Receipt, Search, Users, type LucideIcon,
} from 'lucide-react';

export type FieldCatalog = Record<string, { field: string; labelFr: string; labelEn: string }[]>;

export interface FieldTarget { entity: string; field: string }

export const ENTITY_LABELS_FR: Record<string, string> = {
  tax_config: 'Noms de taxes', client: 'Clients', property: 'Propriétés', billing_property: 'Adresses de facturation',
  service: 'Produits et services', quote: 'Soumissions',
  job: 'Jobs', visit: 'Visites', invoice: 'Factures', line_item: 'Lignes', payment: 'Paiements',
};

const ENTITY_ORDER = ['client', 'property', 'billing_property', 'service', 'quote', 'job', 'visit', 'invoice', 'line_item', 'payment', 'tax_config'];

const ENTITY_ICONS: Record<string, LucideIcon> = {
  client: Users, property: Home, billing_property: Building2, service: Package, quote: FileText,
  job: Briefcase, visit: CalendarDays, invoice: Receipt, line_item: ListOrdered, payment: CreditCard, tax_config: Percent,
};

const CLIENT_REFS = ['client_ref', 'client_email_ref', 'client_name_ref', 'client_phone_ref'];
const ADDRESS = ['address', 'city', 'province', 'postal_code', 'country'];

// Regroupement visuel des champs existants ; un champ absent d'ici tombe dans « Autres ».
const FIELD_GROUPS: Record<string, { label: string; fields: string[] }[]> = {
  client: [
    { label: 'Identité', fields: ['first_name', 'last_name', 'full_name', 'company'] },
    { label: 'Coordonnées', fields: ['email', 'phone', 'phone_secondary'] },
    { label: 'Adresse', fields: ADDRESS },
    { label: 'Informations', fields: ['status', 'lead_source', 'notes', 'external_id', 'created_date'] },
  ],
  property: [
    { label: 'Adresse', fields: ADDRESS },
    { label: 'Informations', fields: ['name', 'notes'] },
    { label: 'Rattachement client', fields: CLIENT_REFS },
  ],
  billing_property: [
    { label: 'Adresse', fields: ADDRESS },
    { label: 'Informations', fields: ['notes'] },
    { label: 'Rattachement client', fields: CLIENT_REFS },
  ],
  service: [
    { label: 'Informations', fields: ['name', 'description', 'category', 'item_type', 'taxable'] },
    { label: 'Tarification', fields: ['price', 'cost'] },
  ],
  quote: [
    { label: 'Soumission', fields: ['quote_number', 'title', 'status', 'created_date', 'valid_until'] },
    { label: 'Montants', fields: ['subtotal', 'tax', 'total'] },
    { label: 'Rattachement', fields: [...CLIENT_REFS, 'job_ref'] },
  ],
  job: [
    { label: 'Job', fields: ['job_number', 'title', 'description', 'notes', 'status', 'salesperson', 'external_id'] },
    { label: 'Dates', fields: ['sale_date', 'start_date', 'end_date', 'created_date'] },
    { label: 'Montants', fields: ['subtotal', 'tax', 'total'] },
    { label: 'Rattachement', fields: [...CLIENT_REFS, 'property_ref'] },
  ],
  visit: [
    { label: 'Planification', fields: ['date', 'start_time', 'end_time', 'start_at', 'end_at'] },
    { label: 'Informations', fields: ['title', 'assigned_to', 'status', 'notes'] },
    { label: 'Rattachement', fields: ['job_ref'] },
  ],
  invoice: [
    { label: 'Facture', fields: ['invoice_number', 'status', 'salesperson', 'notes', 'external_id'] },
    { label: 'Dates', fields: ['issued_date', 'created_date', 'due_date'] },
    { label: 'Montants', fields: ['subtotal', 'tax', 'total', 'discount', 'paid_amount', 'balance'] },
    { label: 'Rattachement', fields: [...CLIENT_REFS, 'job_ref'] },
  ],
  line_item: [
    { label: 'Article', fields: ['item_name', 'item_description', 'quantity', 'unit_price', 'line_total'] },
    { label: 'Rattachement', fields: ['job_ref', 'invoice_ref'] },
  ],
  payment: [
    { label: 'Paiement', fields: ['amount', 'date', 'method', 'reference'] },
    { label: 'Rattachement', fields: ['invoice_ref', ...CLIENT_REFS] },
  ],
  tax_config: [
    { label: 'Taxe', fields: ['name', 'rate', 'is_compound', 'sort_order'] },
    { label: 'Juridiction', fields: ['region', 'country', 'registration_number'] },
  ],
};

export function entityLabelFr(entity: string): string {
  return ENTITY_LABELS_FR[entity] ?? entity;
}

function normaliser(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

type FieldDef = FieldCatalog[string][number];
interface FieldGroup { label: string | null; fields: FieldDef[] }
interface SearchHit { entity: string; def: FieldDef }

function groupsFor(entity: string, fields: FieldDef[]): FieldGroup[] {
  const byId = new Map(fields.map((f) => [f.field, f]));
  const placed = new Set<string>();
  const groups: FieldGroup[] = [];
  for (const g of FIELD_GROUPS[entity] ?? []) {
    const defs = g.fields.flatMap((id) => { const d = byId.get(id); if (!d || placed.has(id)) return []; placed.add(id); return [d]; });
    if (defs.length) groups.push({ label: g.label, fields: defs });
  }
  const rest = fields.filter((f) => !placed.has(f.field));
  if (rest.length) groups.push({ label: groups.length ? 'Autres' : null, fields: rest });
  if (groups.length === 1) groups[0].label = null;
  return groups;
}

const PANEL_WIDTH = 560;
const PANEL_MAX_HEIGHT = 440;
const GAP = 4;
const MARGIN = 8;

function panelPosition(rect: DOMRect): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(PANEL_WIDTH, vw - MARGIN * 2);
  const left = rect.left + width > vw - MARGIN ? Math.max(MARGIN, vw - MARGIN - width) : Math.max(MARGIN, rect.left);
  const below = vh - rect.bottom - GAP - MARGIN;
  const above = rect.top - GAP - MARGIN;
  const placeBelow = below >= Math.min(PANEL_MAX_HEIGHT, 280) || below >= above;
  const maxHeight = Math.max(200, Math.min(PANEL_MAX_HEIGHT, placeBelow ? below : above));
  return placeBelow
    ? { position: 'fixed', left, width, maxHeight, top: rect.bottom + GAP }
    : { position: 'fixed', left, width, maxHeight, bottom: vh - rect.top + GAP };
}

const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface FieldTargetPickerProps {
  catalog: FieldCatalog;
  /** Correspondance actuelle (null = aucune). */
  value: FieldTarget | null;
  /** Vrai quand la colonne est explicitement exclue (statut « rejected »). */
  excluded: boolean;
  /** Entité ouverte par défaut quand aucune correspondance n'existe (catégorie du fichier). */
  defaultEntity?: string | null;
  /** Nom de la colonne source, pour les libellés accessibles. */
  columnLabel: string;
  /** (null, null) = ne pas importer. */
  onChange: (entity: string | null, field: string | null) => void;
}

export default function FieldTargetPicker({ catalog, value, excluded, defaultEntity, columnLabel, onChange }: FieldTargetPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string>('');
  const [style, setStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const catsRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const excludeRef = useRef<HTMLButtonElement>(null);

  const entities = useMemo(() => {
    const rank = (e: string) => { const i = ENTITY_ORDER.indexOf(e); return i === -1 ? ENTITY_ORDER.length : i; };
    return Object.keys(catalog).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [catalog]);

  const selectedDef = value ? (catalog[value.entity] ?? []).find((f) => f.field === value.field) ?? null : null;
  const isSelected = (entity: string, field: string) => !!value && value.entity === entity && value.field === field;

  const tokens = useMemo(() => normaliser(query).split(/\s+/).filter(Boolean), [query]);
  const searching = tokens.length > 0;
  const hits = useMemo<SearchHit[]>(() => {
    if (!searching) return [];
    const out: SearchHit[] = [];
    for (const entity of entities) {
      const entityLabel = normaliser(entityLabelFr(entity));
      for (const def of catalog[entity] ?? []) {
        const hay = `${entityLabel} ${normaliser(def.labelFr)} ${normaliser(def.labelEn)} ${normaliser(def.field.replace(/_/g, ' '))}`;
        if (tokens.every((t) => hay.includes(t))) out.push({ entity, def });
      }
    }
    return out;
  }, [searching, tokens, entities, catalog]);
  const hitsByEntity = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of hits) m.set(h.entity, (m.get(h.entity) ?? 0) + 1);
    return m;
  }, [hits]);

  const groups = useMemo(() => (active && catalog[active] ? groupsFor(active, catalog[active]) : []), [active, catalog]);

  const reposition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setStyle(panelPosition(rect));
  };

  const openMenu = () => {
    const initial = (value && catalog[value.entity] ? value.entity : null)
      ?? (defaultEntity && catalog[defaultEntity] ? defaultEntity : null)
      ?? entities[0] ?? '';
    setActive(initial);
    setQuery('');
    setOpen(true);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (entity: string | null, field: string | null) => {
    onChange(entity, field);
    close(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reposition ne lit que des refs
  }, [open]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    catsRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    fieldsRef.current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView({ block: 'center' });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      const landsOnFocusable = t instanceof Element && !!t.closest(focusableSelector);
      close(!landsOnFocusable);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close est stable pour un `open` donné
  }, [open]);

  const fieldButtons = () => Array.from(fieldsRef.current?.querySelectorAll<HTMLElement>('[data-zone="field"]') ?? []);
  const categoryButtons = () => Array.from(catsRef.current?.querySelectorAll<HTMLElement>('[data-zone="category"]') ?? []);
  const focusFields = () => {
    const list = fieldButtons();
    const target = list.find((el) => el.dataset.selected === 'true') ?? list[0] ?? excludeRef.current;
    target?.focus();
  };
  const moveWithin = (list: HTMLElement[], current: HTMLElement, delta: number): boolean => {
    const i = list.indexOf(current);
    const next = list[i + delta];
    if (!next) return false;
    next.focus();
    return true;
  };

  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === 'Tab') return;
    const target = e.target as HTMLElement;
    const zone = target.dataset.zone;
    if (zone === 'search') {
      if (e.key === 'ArrowDown') { e.preventDefault(); focusFields(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (searching) fieldButtons()[0]?.click(); else focusFields(); }
      return;
    }
    if (zone === 'category') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveWithin(categoryButtons(), target, e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); focusFields(); }
      else if (e.key === 'Home') { e.preventDefault(); categoryButtons()[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); categoryButtons().at(-1)?.focus(); }
    } else if (zone === 'field') {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!moveWithin(fieldButtons(), target, 1)) excludeRef.current?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (!moveWithin(fieldButtons(), target, -1)) searchRef.current?.focus(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); (catsRef.current?.querySelector<HTMLElement>('[data-active="true"]') ?? categoryButtons()[0])?.focus(); }
      else if (e.key === 'Home') { e.preventDefault(); fieldButtons()[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); fieldButtons().at(-1)?.focus(); }
    } else if (zone === 'exclude') {
      if (e.key === 'ArrowUp') { e.preventDefault(); (fieldButtons().at(-1) ?? searchRef.current)?.focus(); }
    }
    // Frappe d'un caractère hors de la recherche : le focus y va et le caractère s'y écrit.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) searchRef.current?.focus();
  };

  const triggerText = selectedDef
    ? `${entityLabelFr(value!.entity)} → ${selectedDef.labelFr}`
    : value
      ? `${entityLabelFr(value.entity)} → ${value.field}`
      : excluded ? 'Ne pas importer cette colonne' : 'Choisir un champ…';

  // Le champ sélectionné (s'il est visible) porte le tabIndex 0, sinon le premier de la liste.
  const visibleFieldKeys = searching ? hits.map((h) => `${h.entity}:${h.def.field}`) : groups.flatMap((g) => g.fields.map((f) => `${active}:${f.field}`));
  const selectedKey = value ? `${value.entity}:${value.field}` : '';
  const tabStopKey = visibleFieldKeys.includes(selectedKey) ? selectedKey : visibleFieldKeys[0] ?? '';

  const fieldRow = (entity: string, def: FieldDef, showEntity: boolean) => {
    const key = `${entity}:${def.field}`;
    const selected = isSelected(entity, def.field);
    return (
      <button
        key={key}
        type="button"
        role="option"
        aria-selected={selected}
        data-zone="field"
        data-selected={selected ? 'true' : undefined}
        tabIndex={key === tabStopKey ? 0 : -1}
        onClick={() => choose(entity, def.field)}
        className={`w-full flex items-center gap-2 pl-3 pr-2.5 h-8 text-left rounded-md outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#94a3b8] ${
          selected ? 'bg-surface-tertiary font-medium text-text-primary' : 'text-text-primary hover:bg-surface-secondary'
        }`}
      >
        <span className="truncate flex-1">{def.labelFr}</span>
        {showEntity && <span className="shrink-0 text-[11px] text-text-tertiary truncate max-w-[45%]">{entityLabelFr(entity)}</span>}
        {selected && <Check size={14} className="shrink-0 text-text-primary" aria-hidden="true" />}
      </button>
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Champ Lume pour ${columnLabel} : ${triggerText}`}
        title={triggerText}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); openMenu(); } }}
        className={`w-full h-8 pl-2.5 pr-1.5 inline-flex items-center gap-1.5 text-[12px] bg-surface-card border border-outline rounded-md text-left outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-1 focus-visible:ring-[#94a3b8] ${
          selectedDef || value ? 'text-text-primary' : 'text-text-tertiary'
        }`}
      >
        {excluded && !value && <Ban size={12} className="shrink-0" aria-hidden="true" />}
        <span className="truncate flex-1">
          {selectedDef ? (
            <>
              <span className="text-text-secondary">{entityLabelFr(value!.entity)}</span>
              <span className="text-text-tertiary mx-1" aria-hidden="true">→</span>
              <span className="font-medium">{selectedDef.labelFr}</span>
            </>
          ) : triggerText}
        </span>
        <ChevronDown size={13} className="shrink-0 text-text-tertiary" aria-hidden="true" />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`Champ Lume pour ${columnLabel}`}
          style={style}
          onKeyDown={onPanelKeyDown}
          className="z-[100] flex flex-col bg-surface-card border border-outline rounded-lg shadow-xl overflow-hidden text-[12.5px] text-text-primary"
        >
          <div className="p-2 border-b border-outline shrink-0">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
              <input
                ref={searchRef}
                data-zone="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher dans toutes les catégories…"
                aria-label="Rechercher un champ Lume"
                autoComplete="off"
                className="w-full h-8 pl-8 pr-2.5 text-[12.5px] bg-surface border border-outline rounded-md text-text-primary placeholder:text-text-tertiary outline-none focus-visible:ring-1 focus-visible:ring-[#94a3b8]"
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <div ref={catsRef} className="w-[196px] shrink-0 border-r border-outline overflow-y-auto p-1.5 bg-surface-secondary/40" aria-label="Catégories">
              {entities.map((entity) => {
                const Icon = ENTITY_ICONS[entity];
                const isActive = entity === active;
                const count = hitsByEntity.get(entity);
                return (
                  <button
                    key={entity}
                    type="button"
                    data-zone="category"
                    data-active={isActive ? 'true' : undefined}
                    aria-current={isActive ? 'true' : undefined}
                    tabIndex={isActive ? 0 : -1}
                    onFocus={() => { if (!searching) setActive(entity); }}
                    onClick={() => { setQuery(''); setActive(entity); }}
                    className={`w-full flex items-center gap-2 px-2.5 h-8 text-left rounded-md outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#94a3b8] ${
                      isActive ? 'bg-[#d8d0c2] text-black font-medium' : searching && !count ? 'text-text-tertiary hover:bg-surface-secondary' : 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
                    }`}
                  >
                    {Icon ? <Icon size={14} className="shrink-0" aria-hidden="true" /> : <span className="w-3.5 shrink-0" aria-hidden="true" />}
                    <span className="truncate flex-1">{entityLabelFr(entity)}</span>
                    {searching && count ? <span className={`text-[11px] tabular-nums ${isActive ? 'text-black/60' : 'text-text-tertiary'}`}>{count}</span> : null}
                  </button>
                );
              })}
            </div>

            <div ref={fieldsRef} role="listbox" aria-label={searching ? 'Résultats de la recherche' : `Champs de ${entityLabelFr(active)}`} className="flex-1 min-w-0 overflow-y-auto p-1.5">
              {searching ? (
                hits.length === 0 ? (
                  <div className="px-3 py-8 text-center text-text-tertiary">
                    <p>Aucun champ ne correspond à « {query.trim()} ».</p>
                    <p className="text-[11.5px] mt-1">Essayez un autre mot, ou parcourez les catégories à gauche.</p>
                  </div>
                ) : hits.map((h) => fieldRow(h.entity, h.def, true))
              ) : groups.length === 0 ? (
                <div className="px-3 py-8 text-center text-text-tertiary">Aucun champ dans cette catégorie.</div>
              ) : groups.map((g, i) => (
                <div key={g.label ?? 'all'} className={i > 0 ? 'mt-1.5' : undefined}>
                  {g.label && <div className="px-3 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary">{g.label}</div>}
                  {g.fields.map((f) => fieldRow(active, f, false))}
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-outline p-1.5 shrink-0">
            <button
              ref={excludeRef}
              type="button"
              data-zone="exclude"
              onClick={() => choose(null, null)}
              className={`w-full h-8 pl-3 pr-2.5 inline-flex items-center gap-2 rounded-md text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#94a3b8] ${
                excluded && !value ? 'bg-surface-tertiary font-medium text-text-primary' : 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
              }`}
            >
              <Ban size={13} className="shrink-0" aria-hidden="true" />
              <span className="flex-1">Ne pas importer cette colonne</span>
              {excluded && !value && <Check size={14} className="shrink-0" aria-hidden="true" />}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
