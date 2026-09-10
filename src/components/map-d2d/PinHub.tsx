/**
 * PinHub — hub affiché quand on tape un pin existant sur la Vente Map.
 * Remplace la présentation de l'ancienne modale d'action (mêmes actions :
 * statut, modifier, fiche client, supprimer) avec trois variantes :
 *  - Vendu  → dossier client complet (toutes ses jobs, valeur cumulée, vendeurs)
 *  - Lead   → dossier du prospect (ses devis au lieu des jobs)
 *  - autres → pin de porte-à-porte sans client : adresse, note, placé par
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, Mail, Send, MapPin, ChevronRight, X, Pencil, User, Briefcase, FileText, Trash2, Navigation } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { clientDisplayName, getClientById, listClientJobs, type ClientRecord } from '../../lib/clientsApi';
import { getQuoteStatusLabel, type QuoteStatus } from '../../lib/quotesApi';
import { formatCurrency, formatDate } from '../../lib/utils';
import UnifiedAvatar from '../ui/UnifiedAvatar';
import { PIN_STATUS_CONFIG, pinStatusLabel, type LeadPinData, type PinStatus } from './lead-pin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HubVariant = 'closed' | 'lead' | 'plain';

interface HubItem {
  id: string;
  title: string;
  number: string | null;
  date: string | null;
  total_cents: number;
  seller_id: string | null;
  /** Devis seulement : statut affiché sous le titre */
  status_label?: string | null;
}

interface Seller {
  id: string;
  name: string;
  avatar_url: string | null;
}

interface HubData {
  clientId: string | null;
  client: ClientRecord | null;
  items: HubItem[];
  sellers: Seller[];
}

const STATUS_ORDER: PinStatus[] = ['no_answer', 'follow_up', 'rejected', 'lead', 'closed_won'];
const MAX_ITEMS_SHOWN = 4;

function variantOf(status: PinStatus): HubVariant {
  if (status === 'closed_won') return 'closed';
  if (status === 'lead') return 'lead';
  return 'plain';
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** Même résolution que D2DMap.handleOpenClient : pin → client, sinon via la job liée. */
async function resolveClientId(pin: LeadPinData): Promise<string | null> {
  if (pin.client_id || pin.lead_id) return pin.client_id || pin.lead_id || null;
  const jobId = pin.job_id || pin.lume_job_id || null;
  if (!jobId) return null;
  const { data } = await supabase.from('jobs').select('client_id, lead_id').eq('id', jobId).maybeSingle();
  return (data?.client_id as string) || (data?.lead_id as string) || null;
}

/** Vendeur = même règle que le leaderboard (salesperson_id, sinon créateur). */
function sellerIdOf(row: any): string | null {
  return (row.salesperson_id as string) || (row.created_by as string) || null;
}

async function loadSellers(ids: string[]): Promise<Seller[]> {
  if (ids.length === 0) return [];
  const orgId = await getCurrentOrgIdOrThrow();
  const [{ data: members }, { data: profiles }] = await Promise.all([
    supabase.from('memberships').select('user_id, full_name').eq('org_id', orgId).in('user_id', ids),
    supabase.from('profiles').select('id, full_name, avatar_url').in('id', ids),
  ]);
  const names = new Map<string, string>();
  const avatars = new Map<string, string>();
  for (const p of profiles || []) {
    if (p.full_name) names.set(p.id, p.full_name);
    if (p.avatar_url) avatars.set(p.id, p.avatar_url);
  }
  // memberships.full_name a priorité (nom tel qu'affiché dans l'org)
  for (const m of members || []) if (m.full_name) names.set(m.user_id, m.full_name);
  return ids.map((id) => ({ id, name: names.get(id) || `User ${id.slice(0, 6)}`, avatar_url: avatars.get(id) || null }));
}

/** Devis du prospect : les colonnes lead_id des quotes contiennent des ids de clients (fusion leads → clients). */
async function listClientQuotes(clientId: string): Promise<any[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('quotes')
    .select('id, quote_number, title, status, total_cents, created_at, salesperson_id, created_by')
    .eq('org_id', orgId)
    .or(`client_id.eq.${clientId},lead_id.eq.${clientId}`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadHub(pin: LeadPinData, variant: HubVariant, fr: boolean): Promise<HubData> {
  if (variant === 'plain') return { clientId: null, client: null, items: [], sellers: [] };
  const clientId = await resolveClientId(pin);
  if (!clientId) return { clientId: null, client: null, items: [], sellers: [] };

  const [client, rows] = await Promise.all([
    getClientById(clientId),
    variant === 'closed' ? listClientJobs(clientId) : listClientQuotes(clientId),
  ]);
  const items: HubItem[] = (rows as any[]).map((row) => variant === 'closed'
    ? {
        id: row.id,
        title: row.title || (row.job_number ? `Job #${row.job_number}` : 'Job'),
        number: row.job_number ?? null,
        date: row.scheduled_at || row.start_at || row.sale_date || row.created_at || null,
        total_cents: Number(row.total_cents ?? 0) || 0,
        seller_id: sellerIdOf(row),
      }
    : {
        id: row.id,
        title: row.title || (fr ? 'Devis' : 'Quote'),
        number: row.quote_number ?? null,
        date: row.created_at || null,
        total_cents: Number(row.total_cents ?? 0) || 0,
        seller_id: sellerIdOf(row),
        status_label: row.status ? getQuoteStatusLabel(row.status as QuoteStatus, fr ? 'fr' : 'en') : null,
      });
  const sellerIds = Array.from(new Set(items.map((i) => i.seller_id).filter(Boolean) as string[]));
  const sellers = await loadSellers(sellerIds).catch(() => [] as Seller[]);
  return { clientId, client, items, sellers };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clientFullAddress(client: ClientRecord | null): string {
  if (!client) return '';
  return [
    client.address || [client.street_number, client.street_name].filter(Boolean).join(' '),
    client.city,
    client.province,
    client.postal_code,
  ].filter(Boolean).join(', ');
}

/** Même service que la fiche client (Google Maps « dir »), coordonnées d'abord. */
function directionsUrl(client: ClientRecord | null, pin: LeadPinData, address: string): string {
  const lat = client?.latitude ?? pin.lat;
  const lng = client?.longitude ?? pin.lng;
  if (lat && lng) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

/** Adresses placeholder d'un pin fraîchement posé (« 46.34321, -72.54770 »). */
function isCoordinatePlaceholder(address: string): boolean {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(address.trim());
}

function initialsOf(name: string): string {
  return name.split(' ').map((w) => w?.[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

function RepAvatar({ name, avatarUrl, size = 22 }: { name: string; avatarUrl: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover ring-2 ring-white"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-slate-200 font-bold text-slate-600 ring-2 ring-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Pastille de statut du pin (même glyphe que le marqueur sur la map). */
function StatusGlyph({ status, size = 48 }: { status: PinStatus; size?: number }) {
  const cfg = PIN_STATUS_CONFIG[status];
  const icon = Math.round(size * 0.42);
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full ring-2 ring-white"
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${cfg.gradientFrom}, ${cfg.gradientTo})`, boxShadow: `0 0 0 1px ${cfg.color}33` }}
      dangerouslySetInnerHTML={{ __html: `<svg xmlns="http://www.w3.org/2000/svg" width="${icon}" height="${icon}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${cfg.iconPaths}</svg>` }}
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PinHubProps {
  pin: LeadPinData;
  fr: boolean;
  onClose: () => void;
  onChangeStatus: (status: PinStatus) => void;
  onEdit: () => void;
  onOpenClient: () => void;
  onDelete: () => void;
  /** « Fiche client » n'apparaît que si un client peut être résolu (même règle que l'ancienne modale). */
  canOpenClient: boolean;
}

export function PinHub({ pin, fr, onClose, onChangeStatus, onEdit, onOpenClient, onDelete, canOpenClient }: PinHubProps) {
  const navigate = useNavigate();
  const variant = variantOf(pin.status);
  const [data, setData] = useState<HubData | null>(null);
  const [loading, setLoading] = useState(variant !== 'plain');
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (variant === 'plain') { setData({ clientId: null, client: null, items: [], sellers: [] }); setLoading(false); setError(false); return; }
    setLoading(true);
    setError(false);
    loadHub(pin, variant, fr)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) { setError(true); setData({ clientId: pin.client_id || pin.lead_id || null, client: null, items: [], sellers: [] }); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Recharger seulement si le pin, son statut ou ses liens CRM changent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin.id, variant, pin.client_id, pin.lead_id, pin.job_id, pin.lume_job_id, fr]);

  // Échap ferme le hub
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const client = data?.client ?? null;
  const clientId = data?.clientId ?? null;
  const items = data?.items ?? [];
  const sellers = data?.sellers ?? [];
  const isPlain = variant === 'plain';
  const statusLabel = pin.status === 'closed_won' ? (fr ? 'Vendu' : 'Sold') : pinStatusLabel(pin.status, fr);

  // Titre : client/prospect pour Vendu et Lead ; les autres pins n'ont pas de nom → libellé du statut.
  const pinName = pin.name && !isCoordinatePlaceholder(pin.name) && pin.name !== pin.address && pin.name !== 'Nouveau lead' && pin.name !== 'New lead' ? pin.name : '';
  const name = isPlain ? statusLabel : (clientDisplayName(client) || pinName || (fr ? 'Client' : 'Client'));
  const phone = client?.phone || pin.phone || '';
  const email = client?.email || pin.email || '';
  const rawAddress = clientFullAddress(client) || pin.address || '';
  const address = isCoordinatePlaceholder(rawAddress) ? '' : rawAddress;
  const totalValue = useMemo(() => items.reduce((sum, i) => sum + i.total_cents, 0) / 100, [items]);
  const shownItems = items.slice(0, MAX_ITEMS_SHOWN);
  const listTab = variant === 'lead' ? 'quotes' : 'jobs';

  const L = {
    section: variant === 'lead' ? (fr ? 'Devis' : 'Quotes') : 'Jobs',
    empty: variant === 'lead' ? (fr ? 'Aucun devis pour ce prospect.' : 'No quotes for this lead.') : (fr ? 'Aucune job pour ce client.' : 'No jobs for this client.'),
    seeAll: variant === 'lead' ? (fr ? 'Voir tous les devis' : 'See all quotes') : (fr ? 'Voir toutes les jobs' : 'See all jobs'),
    primary: variant === 'lead' ? (fr ? 'Voir les devis' : 'View quotes') : (fr ? 'Voir les jobs' : 'View jobs'),
    noClient: variant === 'lead' ? (fr ? 'Aucune fiche prospect liée à ce pin.' : 'No lead record linked to this pin.') : (fr ? 'Aucune fiche client liée à ce pin.' : 'No client record linked to this pin.'),
  };

  const openList = () => {
    if (!clientId) return;
    onClose();
    navigate(`/clients/${clientId}?tab=${listTab}`);
  };
  const openItem = (id: string) => {
    onClose();
    navigate(variant === 'lead' ? `/quotes/${id}` : `/jobs/${id}`);
  };
  const openMessages = () => {
    if (!phone) return;
    const params = new URLSearchParams({ phone, ...(clientId ? { clientId } : {}), ...(!isPlain && name ? { name } : {}) });
    onClose();
    navigate(`/messages?${params.toString()}`);
  };

  const iconBtn = 'grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900';
  const iconBtnDisabled = 'grid h-9 w-9 place-items-center rounded-full border border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed';
  const secondaryBtn = 'inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-700 transition-colors hover:bg-slate-50';
  const primaryBtn = 'inline-flex h-9 flex-[1.15] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-900 px-2 text-[12px] font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300';
  const ItemIcon = variant === 'lead' ? FileText : Briefcase;

  const badge = pin.status === 'closed_won'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : pin.status === 'lead'
      ? 'bg-purple-50 text-purple-700 ring-purple-200'
      : '';
  const badgeDot = pin.status === 'closed_won' ? 'bg-emerald-500' : 'bg-purple-500';

  return (
    <div
      className="absolute inset-0 z-[60] flex items-end justify-center bg-slate-900/35 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      tabIndex={-1}
    >
      <div
        role="presentation"
        tabIndex={-1}
        className="flex max-h-[calc(100%-0.75rem)] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200/80 bg-white text-slate-800 shadow-xl sm:max-h-[calc(100%-2rem)] sm:w-[440px] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── En-tête ─────────────────────────────────────────────── */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4">
          {isPlain ? (
            <StatusGlyph status={pin.status} />
          ) : clientId ? (
            <UnifiedAvatar id={clientId} name={name} size={48} />
          ) : (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-400">
              <MapPin size={20} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="truncate text-[17px] font-bold leading-tight text-slate-900">
                {loading && !client ? <span className="inline-block h-4 w-32 animate-pulse rounded bg-slate-100 align-middle" /> : name}
              </h3>
              {!isPlain && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${badge}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${badgeDot}`} />
                  {statusLabel}
                </span>
              )}
            </div>
            {isPlain && (pin.assigned_user_name || pin.created_at) && (
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-slate-500">
                {pin.assigned_user_name && <RepAvatar name={pin.assigned_user_name} avatarUrl={pin.assigned_user_avatar ?? null} size={16} />}
                <span className="truncate">
                  {pin.assigned_user_name ? `${fr ? 'Placé par' : 'Placed by'} ${pin.assigned_user_name}` : ''}
                  {pin.assigned_user_name && pin.created_at ? ' · ' : ''}
                  {pin.created_at ? formatDate(pin.created_at) : ''}
                </span>
              </div>
            )}
            {(!isPlain || phone || email) && (
              <div className="mt-2.5 flex items-center gap-2">
                {phone ? (
                  <a href={`tel:${phone}`} className={iconBtn} title={fr ? 'Appeler' : 'Call'} aria-label={fr ? 'Appeler' : 'Call'}><Phone size={15} /></a>
                ) : (
                  <span className={iconBtnDisabled} title={fr ? 'Aucun téléphone' : 'No phone'}><Phone size={15} /></span>
                )}
                {phone ? (
                  <button type="button" onClick={openMessages} className={iconBtn} title={fr ? 'Envoyer un message' : 'Send a message'} aria-label={fr ? 'Envoyer un message' : 'Send a message'}><Send size={15} /></button>
                ) : (
                  <span className={iconBtnDisabled} title={fr ? 'Aucun téléphone' : 'No phone'}><Send size={15} /></span>
                )}
                {email ? (
                  <a href={`mailto:${email}`} className={iconBtn} title={fr ? 'Envoyer un courriel' : 'Send an email'} aria-label={fr ? 'Envoyer un courriel' : 'Send an email'}><Mail size={15} /></a>
                ) : (
                  <span className={iconBtnDisabled} title={fr ? 'Aucun courriel' : 'No email'}><Mail size={15} /></span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1.5 -mt-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label={fr ? 'Fermer' : 'Close'}
          >
            <X size={17} />
          </button>
        </div>

        {/* ── Corps défilant ───────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {/* Résumé (Vendu + Lead) : valeur totale · date de création · vendeur(s) */}
          {!isPlain && (
            <div className="grid grid-cols-3 gap-3 border-y border-slate-100 py-3.5">
              <div className="min-w-0">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{fr ? 'Valeur totale' : 'Total value'}</p>
                {loading ? (
                  <span className="mt-1.5 block h-4 w-16 animate-pulse rounded bg-slate-100" />
                ) : (
                  <p className="mt-1 truncate text-[15px] font-bold text-slate-900">{formatCurrency(totalValue)}</p>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{fr ? 'Date de création' : 'Created'}</p>
                {loading ? (
                  <span className="mt-1.5 block h-4 w-20 animate-pulse rounded bg-slate-100" />
                ) : (
                  <p className="mt-1 truncate text-[13.5px] font-semibold text-slate-800">{client?.created_at ? formatDate(client.created_at) : '—'}</p>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{fr ? 'Vendeur(s)' : 'Seller(s)'}</p>
                {loading ? (
                  <span className="mt-1.5 block h-4 w-20 animate-pulse rounded bg-slate-100" />
                ) : sellers.length === 0 ? (
                  <p className="mt-1 truncate text-[13px] font-medium text-slate-400">{fr ? 'Aucun vendeur' : 'No seller'}</p>
                ) : (
                  <div className="mt-1 space-y-1" title={sellers.map((s) => s.name).join(', ')}>
                    {sellers.slice(0, 3).map((s) => (
                      <div key={s.id} className="flex min-w-0 items-center gap-1.5">
                        <RepAvatar name={s.name} avatarUrl={s.avatar_url} size={18} />
                        <span className="truncate text-[12px] font-semibold text-slate-800">{s.name}</span>
                      </div>
                    ))}
                    {sellers.length > 3 && (
                      <p className="text-[11.5px] font-medium text-slate-400">
                        {fr ? `+${sellers.length - 3} autre${sellers.length - 3 > 1 ? 's' : ''}` : `+${sellers.length - 3} more`}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] font-medium text-red-600">
              {fr ? 'Impossible de charger le dossier.' : 'Could not load the record.'}
            </p>
          )}
          {!isPlain && !loading && !error && !clientId && (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12px] font-medium text-slate-500 ring-1 ring-slate-100">{L.noClient}</p>
          )}

          {/* Adresse (+ note du rep) */}
          {(address || pin.note) && (
            <div className={`${isPlain ? 'mt-1' : 'mt-4'} flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3.5 ring-1 ring-slate-100`}>
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200">
                <MapPin size={15} />
              </span>
              <div className="min-w-0 flex-1">
                {address ? (
                  <p className="text-[13.5px] font-semibold leading-snug text-slate-800">{address}</p>
                ) : (
                  <p className="text-[13px] font-medium text-slate-400">{fr ? 'Adresse inconnue' : 'Unknown address'}</p>
                )}
                {pin.note && <p className="mt-1 text-[12px] leading-snug text-slate-500">{pin.note}</p>}
                <a
                  href={directionsUrl(client, pin, address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
                >
                  <Navigation size={12} /> {fr ? "Voir l'itinéraire" : 'Get directions'}
                </a>
              </div>
            </div>
          )}

          {/* Jobs (Vendu) / Devis (Lead) */}
          {!isPlain && (
            <div className="mt-4">
              <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                {L.section}{!loading && ` (${items.length})`}
              </p>
              {loading ? (
                <div className="space-y-1.5">
                  {[0, 1].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-50 ring-1 ring-slate-100" />)}
                </div>
              ) : items.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-3 text-[12.5px] font-medium text-slate-400 ring-1 ring-slate-100">{L.empty}</p>
              ) : (
                <div className="overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-100">
                  {shownItems.map((item, i) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openItem(item.id)}
                      className={`group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-100 ${i > 0 ? 'border-t border-slate-100' : ''}`}
                    >
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white ring-1 ring-slate-200 ${variant === 'lead' ? 'text-purple-700' : 'text-emerald-700'}`}>
                        <ItemIcon size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-slate-800">
                          {item.number && <span className="mr-1.5 text-[11px] font-bold text-slate-400">#{item.number}</span>}
                          {item.title}
                        </span>
                        <span className="block truncate text-[11.5px] text-slate-500">
                          {item.date ? formatDate(item.date) : (fr ? 'Non planifiée' : 'Not scheduled')}
                          {item.status_label ? ` · ${item.status_label}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-[13px] font-bold text-slate-900">{formatCurrency(item.total_cents / 100)}</span>
                      <ChevronRight size={15} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-500" />
                    </button>
                  ))}
                </div>
              )}
              {clientId && !loading && (
                <button
                  type="button"
                  onClick={openList}
                  className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
                >
                  {L.seeAll}
                  {items.length > shownItems.length && ` (${items.length})`}
                  <ChevronRight size={13} />
                </button>
              )}
            </div>
          )}

          {/* Statut */}
          <div className="mt-4">
            <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{fr ? 'Statut' : 'Status'}</p>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_ORDER.map((status) => {
                const cfg = PIN_STATUS_CONFIG[status];
                const active = pin.status === status;
                const label = status === 'closed_won' ? (fr ? 'Vendu' : 'Sold') : (fr ? cfg.label : cfg.label_en);
                const activeCls = status === 'closed_won'
                  ? 'bg-emerald-600 text-white ring-emerald-600'
                  : 'text-white';
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => onChangeStatus(status)}
                    aria-pressed={active}
                    className={`whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold ring-1 ring-inset transition-colors ${active ? activeCls : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900'}`}
                    style={active && status !== 'closed_won' ? { backgroundColor: cfg.color, ['--tw-ring-color' as string]: cfg.color } as React.CSSProperties : undefined}
                  >
                    {active && '✓ '}{label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Barre d'actions ─────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 border-t border-slate-100 bg-white px-4 py-3">
          <button
            type="button"
            onClick={onDelete}
            className="grid h-9 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
            title={fr ? 'Supprimer le pin' : 'Delete pin'}
            aria-label={fr ? 'Supprimer le pin' : 'Delete pin'}
          >
            <Trash2 size={15} />
          </button>
          <button type="button" onClick={onEdit} className={isPlain ? primaryBtn : secondaryBtn}>
            <Pencil size={13} /> {fr ? 'Modifier' : 'Edit'}
          </button>
          {canOpenClient && (
            <button type="button" onClick={onOpenClient} className={secondaryBtn}>
              <User size={13} /> {variant === 'lead' ? (fr ? 'Fiche prospect' : 'Lead') : (fr ? 'Fiche client' : 'Client')}
            </button>
          )}
          {!isPlain && (
            <button
              type="button"
              onClick={openList}
              disabled={!clientId}
              className={primaryBtn}
            >
              <ItemIcon size={13} /> {L.primary}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default PinHub;
