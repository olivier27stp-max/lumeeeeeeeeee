/**
 * LeadPin — Status config, marker builder, popup builder
 */

export type PinStatus =
  | 'closed_won'
  | 'lead'
  | 'follow_up'
  | 'appointment'
  | 'no_answer'
  | 'rejected'
  | 'other';

export interface LeadPinData {
  id: string;
  lat: number;
  lng: number;
  status: PinStatus;
  name: string;
  phone: string;
  email: string;
  address: string;
  note: string;
  /** CRM entity links */
  lead_id?: string | null;
  client_id?: string | null;
  job_id?: string | null;
  quote_id?: string | null;
  /** Legacy Lume integration */
  lume_customer_id?: string | null;
  lume_job_id?: string | null;
  lume_status?: 'not_created' | 'creating' | 'created' | 'failed';
  lume_error?: string | null;
  /** Rep qui a placé le pin (field_house_profiles.assigned_user_id, défaut = créateur) */
  assigned_user_id?: string | null;
  assigned_user_name?: string | null;
  assigned_user_avatar?: string | null;
  /** Date de placement (field_house_profiles.created_at) */
  created_at?: string | null;
}

export interface PinStatusConfig {
  color: string;
  gradientFrom: string;
  gradientTo: string;
  label: string;
  iconPaths: string;
}

// Single source of truth for pin statuses — colors AND labels. Every surface
// (map pins, visit modal, edit modal, filters, stats) reads from here so the
// vocabulary stays consistent app-wide.
export const PIN_STATUS_CONFIG: Record<PinStatus, PinStatusConfig> = {
  closed_won: {
    color: '#22C55E',
    gradientFrom: '#4ADE80',
    gradientTo: '#16A34A',
    label: 'Vendu ✓',
    iconPaths: '<polyline points="20 6 9 17 4 12"/>',
  },
  lead: {
    color: '#A855F7',
    gradientFrom: '#C084FC',
    gradientTo: '#9333EA',
    label: 'Lead',
    // Sniper target: scope circle + 4 crosshair ticks + center dot
    iconPaths: '<circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="5.5"/><line x1="12" y1="18.5" x2="12" y2="22"/><line x1="2" y1="12" x2="5.5" y2="12"/><line x1="18.5" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="1" fill="white" stroke="none"/>',
  },
  follow_up: {
    color: '#06B6D4',
    gradientFrom: '#22D3EE',
    gradientTo: '#0891B2',
    label: 'À repasser',
    iconPaths: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  },
  appointment: {
    color: '#6B7280',
    gradientFrom: '#9CA3AF',
    gradientTo: '#4B5563',
    label: 'Rendez-vous',
    iconPaths: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  },
  no_answer: {
    color: '#EAB308',
    gradientFrom: '#FDE047',
    gradientTo: '#CA8A04',
    label: 'Aucune réponse',
    iconPaths: '<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5"/>',
  },
  rejected: {
    color: '#EF4444',
    gradientFrom: '#F87171',
    gradientTo: '#DC2626',
    label: 'Pas intéressé',
    iconPaths: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  },
  other: {
    color: '#F97316',
    gradientFrom: '#FB923C',
    gradientTo: '#EA580C',
    label: 'Autre',
    iconPaths: '<circle cx="12" cy="12" r="4.5" fill="white" stroke="none"/>',
  },
};

function svgIcon(paths: string, size = 12, bold = false): string {
  const sw = bold ? '3' : '2.5';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

/**
 * Creates a 28x28 circular marker DOM element with gradient background.
 */
export function createLeadPinElement(status: PinStatus): HTMLDivElement {
  const cfg = PIN_STATUS_CONFIG[status];

  const el = document.createElement('div');
  el.setAttribute('style', [
    'box-sizing:border-box',
    'width:28px',
    'height:28px',
    'border-radius:50%',
    `background:linear-gradient(135deg,${cfg.gradientFrom},${cfg.gradientTo})`,
    'border:2px solid rgba(255,255,255,0.92)',
    `box-shadow:0 0 8px ${cfg.color}66,0 2px 6px rgba(0,0,0,0.4)`,
    'cursor:pointer',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'line-height:0',
  ].join(';'));

  el.innerHTML = svgIcon(cfg.iconPaths, 12, true);

  setTimeout(() => {
    el.addEventListener('mouseenter', () => {
      el.style.boxShadow = `0 0 14px ${cfg.color}88,0 4px 12px rgba(0,0,0,0.5)`;
      el.style.borderColor = 'white';
    });
    el.addEventListener('mouseleave', () => {
      el.style.boxShadow = `0 0 8px ${cfg.color}66,0 2px 6px rgba(0,0,0,0.4)`;
      el.style.borderColor = 'rgba(255,255,255,0.92)';
    });
  }, 500);

  return el;
}

// ---------------------------------------------------------------------------
// Popup — refonte light (blanc, palette neutre beige/gris)
// ---------------------------------------------------------------------------

/** IDs DOM des contrôles internes de la popup — map-container s'y branche. */
export const popupCloseBtnId = (pinId: string) => `ppx-${pinId}`;
export const popupStatusDotId = (pinId: string, status: PinStatus) => `ppst-${pinId}-${status}`;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function icStroke(paths: string, size = 12, sw = 2): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const IC = {
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  sms: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/>',
  nav: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  chevron: '<polyline points="9 18 15 12 9 6"/>',
  pencil: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

function timeAgoLabel(iso: string, fr: boolean): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return fr ? "à l'instant" : 'just now';
  if (mins < 60) return fr ? `il y a ${mins} min` : `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return fr ? `il y a ${hours} h` : `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return fr ? 'hier' : 'yesterday';
  if (days < 7) return fr ? `il y a ${days} j` : `${days} d ago`;
  return new Date(iso).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short' });
}

export function createLeadPinPopupHTML(
  pin: LeadPinData,
  editBtnId: string,
  deleteBtnId: string,
  lang: 'fr' | 'en' = 'fr',
  clientBtnId?: string,
): string {
  const fr = lang === 'fr';
  const L = {
    close: fr ? 'Fermer' : 'Close',
    call: fr ? 'Appeler' : 'Call',
    text: fr ? 'Texto' : 'Text',
    email: fr ? 'Courriel' : 'Email',
    directions: fr ? 'Itinéraire' : 'Directions',
    noPhone: fr ? 'Aucun numéro' : 'No phone number',
    noEmail: fr ? 'Aucun courriel' : 'No email',
    status: fr ? 'Statut' : 'Status',
    client: 'Client',
    openHub: fr ? 'Ouvrir le hub client' : 'Open client hub',
    noClient: fr ? 'Aucun client lié' : 'No linked client',
    noClientSub: fr
      ? 'Une job ou un devis créé depuis ce pin liera le client automatiquement.'
      : 'Creating a job or quote from this pin links the client automatically.',
    placedBy: fr ? 'Placé par' : 'Placed by',
    editPin: fr ? 'Modifier le pin' : 'Edit pin',
    deletePin: fr ? 'Supprimer le pin' : 'Delete pin',
  };

  // Adresse : la rue en titre, le reste (ville, province) en sous-ligne
  const addr = (pin.address || '').trim();
  const commaAt = addr.indexOf(',');
  const street = commaAt > 0 ? addr.slice(0, commaAt).trim() : addr;
  const locality = commaAt > 0 ? addr.slice(commaAt + 1).trim() : '';
  const title = street || pin.name || (fr ? 'Pin sans adresse' : 'Pin without address');

  const telDigits = pin.phone ? pin.phone.replace(/[^\d+]/g, '') : '';
  const telHref = telDigits ? `tel:${telDigits}` : null;
  const smsHref = telDigits ? `sms:${telDigits}` : null;
  const mailHref = pin.email ? `mailto:${esc(pin.email)}` : null;
  const mapsHref = addr ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}` : null;

  const qBase = 'flex:1;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:#f1f2f6;border:1px solid #e3e5ec;color:#3a4257;text-decoration:none;';
  const quick = (href: string | null, lbl: string, disabledLbl: string, icon: string, external = false) =>
    href
      ? `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ''} class="ppq" title="${lbl}" aria-label="${lbl}" style="${qBase}cursor:pointer;">${icStroke(icon, 14)}</a>`
      : `<span title="${disabledLbl}" aria-disabled="true" style="${qBase}opacity:.3;">${icStroke(icon, 14)}</span>`;

  const label = (txt: string) =>
    `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:rgba(26,29,41,.38);margin:14px 0 7px;">${txt}</div>`;

  // Rangée des 7 statuts — un tap change le statut (bindé dans map-container)
  const statusDots = (Object.keys(PIN_STATUS_CONFIG) as PinStatus[]).map((st) => {
    const c = PIN_STATUS_CONFIG[st];
    const active = st === pin.status;
    return `<button type="button" id="${popupStatusDotId(pin.id, st)}" class="ppsd" title="${c.label}" aria-label="${c.label}" aria-pressed="${active}" style="width:30px;height:30px;border-radius:50%;flex:none;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;background:linear-gradient(135deg,${c.gradientFrom},${c.gradientTo});border:2px solid ${active ? '#fff' : 'transparent'};${active ? `box-shadow:0 0 0 2px ${c.color},0 4px 10px rgba(20,25,50,.18);transform:scale(1.08);opacity:1;` : 'opacity:.4;'}">${svgIcon(c.iconPaths, 12, true)}</button>`;
  }).join('');

  // Bloc client — le pin appartient au client ; la carte ouvre son hub.
  // pin.name retombe parfois sur l'adresse ou un libellé de placement — dans
  // ces cas on ne le traite pas comme un nom de client.
  const hasClient = !!(pin.client_id || pin.lead_id || pin.job_id || pin.lume_job_id);
  const rawName = (pin.name || '').trim();
  const placeholderNames = ['Pin', 'Nouveau lead', 'New lead'];
  const isRealName = !!rawName && rawName !== title && rawName !== addr && !placeholderNames.includes(rawName);
  const clientName = isRealName ? rawName : '';
  const cardInner = (nm: string, sub: string, chevron: boolean) => `
    <span style="width:34px;height:34px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;color:#fff;background:#2b2f3a;">${esc(initials(nm))}</span>
    <span style="flex:1;min-width:0;">
      <b style="display:block;font-size:12.5px;font-weight:650;color:#1a1d29;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(nm)}</b>
      <span style="display:block;font-size:10.5px;color:rgba(26,29,41,.55);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sub}</span>
    </span>
    ${chevron ? `<span style="color:rgba(26,29,41,.45);flex:none;display:flex;">${icStroke(IC.chevron, 14, 2.5)}</span>` : ''}`;
  const cardBase = 'width:100%;margin-top:4px;border-radius:12px;padding:10px 11px;display:flex;align-items:center;gap:10px;text-align:left;background:#f2efe9;border:1px solid #e1dccf;';
  let clientBlock: string;
  if (hasClient && clientBtnId) {
    const sub = esc(pin.phone || pin.email || '') || L.openHub;
    clientBlock = `<button type="button" id="${clientBtnId}" class="ppcc" title="${L.openHub}" style="${cardBase}cursor:pointer;">${cardInner(clientName || 'Client', sub, true)}</button>`;
  } else if (clientName) {
    clientBlock = `<div style="${cardBase}">${cardInner(clientName, esc(pin.phone || pin.email || ''), false)}</div>`;
  } else {
    clientBlock = `
      <div style="width:100%;margin-top:4px;border-radius:12px;padding:11px 12px;display:flex;align-items:flex-start;gap:10px;border:1px dashed rgba(20,24,40,.22);">
        <span style="width:34px;height:34px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;background:#f1f2f6;border:1px dashed #b9bdc9;color:#8b91a3;">${icStroke(IC.user, 14)}</span>
        <span style="min-width:0;">
          <b style="display:block;font-size:12.5px;font-weight:650;color:#1a1d29;">${L.noClient}</b>
          <span style="display:block;font-size:10.5px;color:rgba(26,29,41,.48);margin-top:1px;line-height:1.45;">${L.noClientSub}</span>
        </span>
      </div>`;
  }

  // « Placé par » — chaque pin appartient au rep qui l'a posé (assigned_user_id)
  let placedBy = '';
  if (pin.assigned_user_name) {
    const av = pin.assigned_user_avatar
      ? `<img src="${esc(pin.assigned_user_avatar)}" alt="" style="width:22px;height:22px;border-radius:50%;flex:none;object-fit:cover;border:1px solid #dfe2e9;"/>`
      : `<span style="width:22px;height:22px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#fff;background:#6b7280;">${esc(initials(pin.assigned_user_name))}</span>`;
    const when = pin.created_at ? timeAgoLabel(pin.created_at, fr) : '';
    placedBy = `
      <div style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:11px;color:rgba(26,29,41,.55);">
        ${av}
        <span style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${L.placedBy} <b style="color:#1a1d29;font-weight:650;">${esc(pin.assigned_user_name)}</b></span>
        ${when ? `<span style="margin-left:auto;flex:none;color:rgba(26,29,41,.4);font-size:10.5px;">${when}</span>` : ''}
      </div>`;
  }

  return `
    <div style="font-family:Inter,system-ui,sans-serif;width:290px;max-width:100%;color:#1a1d29;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="min-width:0;">
          <div style="font-size:15.5px;font-weight:700;letter-spacing:-.01em;line-height:1.25;">${esc(title)}</div>
          ${locality ? `<div style="display:flex;align-items:center;gap:5px;margin-top:3px;font-size:11.5px;color:rgba(26,29,41,.55);"><span style="display:flex;color:rgba(26,29,41,.35);">${icStroke(IC.pin, 11)}</span><span style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(locality)}</span></div>` : ''}
        </div>
        <button type="button" id="${popupCloseBtnId(pin.id)}" class="ppx" title="${L.close}" aria-label="${L.close}" style="width:26px;height:26px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;background:#f1f2f6;border:1px solid #e3e5ec;color:#5d6373;cursor:pointer;padding:0;">${icStroke(IC.x, 12, 2.5)}</button>
      </div>

      ${pin.note ? `<div style="margin-top:10px;padding:9px 11px;border-radius:10px;background:#f4f5f8;border:1px solid #e7e9ef;display:flex;gap:8px;font-size:11.5px;line-height:1.45;color:rgba(26,29,41,.72);"><span style="flex:none;margin-top:2px;color:rgba(26,29,41,.35);display:flex;">${icStroke(IC.note, 12)}</span><span>${esc(pin.note)}</span></div>` : ''}

      <div style="display:flex;gap:8px;margin-top:12px;">
        ${quick(telHref, L.call, L.noPhone, IC.phone)}
        ${quick(smsHref, L.text, L.noPhone, IC.sms)}
        ${quick(mailHref, L.email, L.noEmail, IC.mail)}
        ${quick(mapsHref, L.directions, L.directions, IC.nav, true)}
      </div>

      ${label(L.status)}
      <div style="display:flex;justify-content:space-between;gap:4px;">${statusDots}</div>

      ${label(L.client)}
      ${clientBlock}
      ${placedBy}

      <div style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(20,24,40,.08);">
        <button type="button" id="${editBtnId}" class="pped" style="flex:1;padding:8px 0;border-radius:9px;cursor:pointer;background:#1a1d29;border:1px solid #1a1d29;color:#fff;font-size:11.5px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;">${icStroke(IC.pencil, 12)}${L.editPin}</button>
        <button type="button" id="${deleteBtnId}" class="ppdel" title="${L.deletePin}" aria-label="${L.deletePin}" style="width:38px;border-radius:9px;cursor:pointer;flex:none;background:#eceef2;border:1px solid #dfe2e9;color:#5d6373;display:flex;align-items:center;justify-content:center;">${icStroke(IC.trash, 13)}</button>
      </div>
    </div>
  `;
}
