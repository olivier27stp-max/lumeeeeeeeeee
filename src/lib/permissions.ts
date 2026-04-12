// ══════════════════════════════════════════════════════════════════════
// RBAC Permission System — Lume CRM
// Roles, Scopes, Permissions with overrides
// Single source of truth for access control
// ══════════════════════════════════════════════════════════════════════

// ── Roles ───────────────────────────────────────────────────────────

export type TeamRole = 'owner' | 'admin' | 'manager' | 'sales_rep' | 'technician' | 'support' | 'viewer';

export const ALL_ROLES: TeamRole[] = ['owner', 'admin', 'manager', 'sales_rep', 'technician', 'support', 'viewer'];

export const ROLE_LABELS: Record<TeamRole, { en: string; fr: string }> = {
  owner:      { en: 'Owner',      fr: 'Propriétaire' },
  admin:      { en: 'Admin',      fr: 'Administrateur' },
  manager:    { en: 'Manager',    fr: 'Gestionnaire' },
  sales_rep:  { en: 'Sales Rep',  fr: 'Représentant' },
  technician: { en: 'Technician', fr: 'Technicien' },
  support:    { en: 'Support',    fr: 'Support' },
  viewer:     { en: 'Viewer',     fr: 'Lecteur' },
};

/** Roles that can be assigned via invitation (not owner) */
export const ASSIGNABLE_ROLES: TeamRole[] = ['admin', 'manager', 'sales_rep', 'technician', 'support', 'viewer'];

// ── Scopes ──────────────────────────────────────────────────────────

export type Scope = 'self' | 'assigned' | 'team' | 'department' | 'company';

export const ALL_SCOPES: Scope[] = ['self', 'assigned', 'team', 'department', 'company'];

export const SCOPE_LABELS: Record<Scope, { en: string; fr: string }> = {
  self:       { en: 'Own data only',   fr: 'Ses données seulement' },
  assigned:   { en: 'Assigned only',   fr: 'Assigné seulement' },
  team:       { en: 'Team',            fr: 'Équipe' },
  department: { en: 'Department',      fr: 'Département' },
  company:    { en: 'Entire company',  fr: 'Toute la compagnie' },
};

/** Default scope per role */
export const DEFAULT_SCOPE: Record<TeamRole, Scope> = {
  owner:      'company',
  admin:      'company',
  manager:    'team',
  sales_rep:  'self',
  technician: 'assigned',
  support:    'company',
  viewer:     'company',
};

// ── Permission Keys ─────────────────────────────────────────────────

export const PERMISSION_KEYS = [
  // Clients
  'clients.create', 'clients.read', 'clients.update', 'clients.delete',
  // Leads
  'leads.create', 'leads.read', 'leads.update', 'leads.delete', 'leads.assign',
  // Quotes
  'quotes.create', 'quotes.read', 'quotes.update', 'quotes.delete', 'quotes.send', 'quotes.approve',
  // Jobs
  'jobs.create', 'jobs.read', 'jobs.update', 'jobs.delete', 'jobs.assign', 'jobs.complete',
  // Invoices
  'invoices.create', 'invoices.read', 'invoices.update', 'invoices.delete',
  // Payments
  'payments.read', 'payments.create', 'payments.refund',
  // Messages
  'messages.read', 'messages.send',
  // Calendar
  'calendar.read', 'calendar.update',
  // Map
  'map.access',
  // Door-to-Door
  'door_to_door.access', 'door_to_door.edit', 'door_to_door.convert',
  // Users
  'users.invite', 'users.update_role', 'users.disable', 'users.delete',
  // Settings
  'settings.read', 'settings.update',
  // Automations
  'automations.read', 'automations.update',
  // Integrations
  'integrations.read', 'integrations.update',
  // Reports
  'reports.read',
  // Team
  'team.read', 'team.update',
  // GPS
  'gps.read',
  // Timesheets
  'timesheets.read', 'timesheets.update',
  // AI
  'ai.use', 'ai.review', 'ai.admin',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type PermissionsMap = Record<PermissionKey, boolean>;

// ── Permission Groups (UI display) ─────────────────────────────────

export interface PermissionGroup {
  key: string;
  label_en: string;
  label_fr: string;
  permissions: { key: PermissionKey; label_en: string; label_fr: string }[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: 'clients', label_en: 'Clients', label_fr: 'Clients',
    permissions: [
      { key: 'clients.create', label_en: 'Create clients', label_fr: 'Créer des clients' },
      { key: 'clients.read', label_en: 'View clients', label_fr: 'Voir les clients' },
      { key: 'clients.update', label_en: 'Edit clients', label_fr: 'Modifier les clients' },
      { key: 'clients.delete', label_en: 'Delete clients', label_fr: 'Supprimer les clients' },
    ],
  },
  {
    key: 'leads', label_en: 'Leads', label_fr: 'Prospects',
    permissions: [
      { key: 'leads.create', label_en: 'Create leads', label_fr: 'Créer des prospects' },
      { key: 'leads.read', label_en: 'View leads', label_fr: 'Voir les prospects' },
      { key: 'leads.update', label_en: 'Edit leads', label_fr: 'Modifier les prospects' },
      { key: 'leads.delete', label_en: 'Delete leads', label_fr: 'Supprimer les prospects' },
      { key: 'leads.assign', label_en: 'Assign leads', label_fr: 'Assigner des prospects' },
    ],
  },
  {
    key: 'quotes', label_en: 'Quotes', label_fr: 'Devis',
    permissions: [
      { key: 'quotes.create', label_en: 'Create quotes', label_fr: 'Créer des devis' },
      { key: 'quotes.read', label_en: 'View quotes', label_fr: 'Voir les devis' },
      { key: 'quotes.update', label_en: 'Edit quotes', label_fr: 'Modifier les devis' },
      { key: 'quotes.delete', label_en: 'Delete quotes', label_fr: 'Supprimer les devis' },
      { key: 'quotes.send', label_en: 'Send quotes', label_fr: 'Envoyer des devis' },
      { key: 'quotes.approve', label_en: 'Approve quotes', label_fr: 'Approuver des devis' },
    ],
  },
  {
    key: 'jobs', label_en: 'Jobs', label_fr: 'Travaux',
    permissions: [
      { key: 'jobs.create', label_en: 'Create jobs', label_fr: 'Créer des travaux' },
      { key: 'jobs.read', label_en: 'View jobs', label_fr: 'Voir les travaux' },
      { key: 'jobs.update', label_en: 'Edit jobs', label_fr: 'Modifier les travaux' },
      { key: 'jobs.delete', label_en: 'Delete jobs', label_fr: 'Supprimer les travaux' },
      { key: 'jobs.assign', label_en: 'Assign jobs', label_fr: 'Assigner des travaux' },
      { key: 'jobs.complete', label_en: 'Complete jobs', label_fr: 'Compléter des travaux' },
    ],
  },
  {
    key: 'invoices', label_en: 'Invoices', label_fr: 'Factures',
    permissions: [
      { key: 'invoices.create', label_en: 'Create invoices', label_fr: 'Créer des factures' },
      { key: 'invoices.read', label_en: 'View invoices', label_fr: 'Voir les factures' },
      { key: 'invoices.update', label_en: 'Edit invoices', label_fr: 'Modifier les factures' },
      { key: 'invoices.delete', label_en: 'Delete invoices', label_fr: 'Supprimer les factures' },
    ],
  },
  {
    key: 'payments', label_en: 'Payments', label_fr: 'Paiements',
    permissions: [
      { key: 'payments.read', label_en: 'View payments', label_fr: 'Voir les paiements' },
      { key: 'payments.create', label_en: 'Create payments', label_fr: 'Créer des paiements' },
      { key: 'payments.refund', label_en: 'Refund payments', label_fr: 'Rembourser des paiements' },
    ],
  },
  {
    key: 'messages', label_en: 'Messages', label_fr: 'Messages',
    permissions: [
      { key: 'messages.read', label_en: 'Read messages', label_fr: 'Lire les messages' },
      { key: 'messages.send', label_en: 'Send messages', label_fr: 'Envoyer des messages' },
    ],
  },
  {
    key: 'calendar', label_en: 'Calendar', label_fr: 'Calendrier',
    permissions: [
      { key: 'calendar.read', label_en: 'View calendar', label_fr: 'Voir le calendrier' },
      { key: 'calendar.update', label_en: 'Edit calendar', label_fr: 'Modifier le calendrier' },
    ],
  },
  {
    key: 'map_d2d', label_en: 'Map & Door-to-Door', label_fr: 'Carte & Porte-à-porte',
    permissions: [
      { key: 'map.access', label_en: 'Access map', label_fr: 'Accéder à la carte' },
      { key: 'door_to_door.access', label_en: 'Access D2D', label_fr: 'Accéder au D2D' },
      { key: 'door_to_door.edit', label_en: 'Edit D2D pins', label_fr: 'Modifier les pins D2D' },
      { key: 'door_to_door.convert', label_en: 'Convert D2D pins', label_fr: 'Convertir les pins D2D' },
    ],
  },
  {
    key: 'users', label_en: 'User Management', label_fr: 'Gestion des utilisateurs',
    permissions: [
      { key: 'users.invite', label_en: 'Invite users', label_fr: 'Inviter des utilisateurs' },
      { key: 'users.update_role', label_en: 'Change roles', label_fr: 'Changer les rôles' },
      { key: 'users.disable', label_en: 'Disable users', label_fr: 'Désactiver des utilisateurs' },
      { key: 'users.delete', label_en: 'Delete users', label_fr: 'Supprimer des utilisateurs' },
    ],
  },
  {
    key: 'settings', label_en: 'Settings', label_fr: 'Paramètres',
    permissions: [
      { key: 'settings.read', label_en: 'View settings', label_fr: 'Voir les paramètres' },
      { key: 'settings.update', label_en: 'Edit settings', label_fr: 'Modifier les paramètres' },
    ],
  },
  {
    key: 'automations', label_en: 'Automations', label_fr: 'Automatisations',
    permissions: [
      { key: 'automations.read', label_en: 'View automations', label_fr: 'Voir les automatisations' },
      { key: 'automations.update', label_en: 'Edit automations', label_fr: 'Modifier les automatisations' },
    ],
  },
  {
    key: 'integrations', label_en: 'Integrations', label_fr: 'Intégrations',
    permissions: [
      { key: 'integrations.read', label_en: 'View integrations', label_fr: 'Voir les intégrations' },
      { key: 'integrations.update', label_en: 'Edit integrations', label_fr: 'Modifier les intégrations' },
    ],
  },
  {
    key: 'reports', label_en: 'Reports', label_fr: 'Rapports',
    permissions: [
      { key: 'reports.read', label_en: 'View reports', label_fr: 'Voir les rapports' },
    ],
  },
  {
    key: 'team', label_en: 'Team', label_fr: 'Équipe',
    permissions: [
      { key: 'team.read', label_en: 'View team', label_fr: 'Voir l\'équipe' },
      { key: 'team.update', label_en: 'Manage team', label_fr: 'Gérer l\'équipe' },
    ],
  },
  {
    key: 'gps', label_en: 'GPS Tracking', label_fr: 'Suivi GPS',
    permissions: [
      { key: 'gps.read', label_en: 'View GPS', label_fr: 'Voir le GPS' },
    ],
  },
  {
    key: 'timesheets', label_en: 'Timesheets', label_fr: 'Feuilles de temps',
    permissions: [
      { key: 'timesheets.read', label_en: 'View timesheets', label_fr: 'Voir les feuilles de temps' },
      { key: 'timesheets.update', label_en: 'Edit timesheets', label_fr: 'Modifier les feuilles de temps' },
    ],
  },
  {
    key: 'ai', label_en: 'AI (Lia)', label_fr: 'IA (Lia)',
    permissions: [
      { key: 'ai.use', label_en: 'Use AI', label_fr: 'Utiliser l\'IA' },
      { key: 'ai.review', label_en: 'Review AI outputs', label_fr: 'Réviser les sorties IA' },
      { key: 'ai.admin', label_en: 'Administrate AI', label_fr: 'Administrer l\'IA' },
    ],
  },
];

// ── Role Presets (defaults) ─────────────────────────────────────────

function allTrue(): PermissionsMap {
  const map = {} as PermissionsMap;
  for (const k of PERMISSION_KEYS) map[k] = true;
  return map;
}

function allFalse(): PermissionsMap {
  const map = {} as PermissionsMap;
  for (const k of PERMISSION_KEYS) map[k] = false;
  return map;
}

function pick(keys: PermissionKey[]): PermissionsMap {
  const map = allFalse();
  for (const k of keys) map[k] = true;
  return map;
}

export const ROLE_PRESETS: Record<TeamRole, PermissionsMap> = {
  owner: allTrue(),

  admin: {
    ...allTrue(),
    'users.delete': false, // Cannot delete owner
  },

  manager: pick([
    'clients.create', 'clients.read', 'clients.update',
    'leads.create', 'leads.read', 'leads.update', 'leads.assign',
    'quotes.create', 'quotes.read', 'quotes.update', 'quotes.send', 'quotes.approve',
    'jobs.create', 'jobs.read', 'jobs.update', 'jobs.assign', 'jobs.complete',
    'invoices.create', 'invoices.read', 'invoices.update',
    'messages.read', 'messages.send',
    'calendar.read', 'calendar.update',
    'map.access',
    'door_to_door.access', 'door_to_door.edit', 'door_to_door.convert',
    'team.read', 'team.update',
    'gps.read',
    'timesheets.read', 'timesheets.update',
    'ai.use', 'ai.review',
    'settings.read',
  ]),

  sales_rep: pick([
    'clients.create', 'clients.read', 'clients.update',
    'leads.create', 'leads.read', 'leads.update',
    'quotes.create', 'quotes.read', 'quotes.update', 'quotes.send',
    'jobs.read',
    'messages.read', 'messages.send',
    'calendar.read', 'calendar.update',
    'map.access',
    'door_to_door.access', 'door_to_door.edit', 'door_to_door.convert',
    'ai.use',
    'settings.read',
  ]),

  technician: pick([
    'clients.read',
    'jobs.read', 'jobs.update', 'jobs.complete',
    'calendar.read', 'calendar.update',
    'messages.read', 'messages.send',
    'timesheets.read', 'timesheets.update',
    'gps.read',
    'settings.read',
  ]),

  support: pick([
    'clients.create', 'clients.read', 'clients.update',
    'leads.read',
    'quotes.read',
    'jobs.read',
    'invoices.read',
    'messages.read', 'messages.send',
    'calendar.read', 'calendar.update',
    'timesheets.read',
    'ai.use',
    'settings.read',
  ]),

  viewer: pick([
    'clients.read',
    'quotes.read',
    'jobs.read',
    'calendar.read',
  ]),
};

// ── Helpers ─────────────────────────────────────────────────────────

export function getDefaultPermissions(role: TeamRole): PermissionsMap {
  return { ...ROLE_PRESETS[role] };
}

export function getDefaultScope(role: TeamRole): Scope {
  return DEFAULT_SCOPE[role];
}

/**
 * Merge role defaults with user-specific overrides.
 * Overrides take precedence over role defaults.
 */
export function resolvePermissions(role: TeamRole, overrides?: Record<string, boolean> | null): PermissionsMap {
  const base = getDefaultPermissions(role);
  if (!overrides) return base;
  for (const [key, val] of Object.entries(overrides)) {
    if (key in base) (base as any)[key] = val;
  }
  return base;
}

/**
 * Check a single permission. Owner always returns true.
 */
export function hasPermission(
  permissions: PermissionsMap | null | undefined,
  key: PermissionKey,
  role?: TeamRole
): boolean {
  if (role === 'owner') return true;
  if (!permissions) return false;
  return permissions[key] === true;
}

/**
 * Check if user's scope allows access to a resource.
 */
export function checkScope(
  userScope: Scope,
  userId: string,
  userTeamId: string | null,
  userDeptId: string | null,
  resource: {
    owner_id?: string | null;
    team_id?: string | null;
    department_id?: string | null;
  }
): boolean {
  switch (userScope) {
    case 'company': return true;
    case 'department':
      return !resource.department_id || resource.department_id === userDeptId;
    case 'team':
      return !resource.team_id || resource.team_id === userTeamId;
    case 'assigned':
      return !resource.owner_id || resource.owner_id === userId;
    case 'self':
      return !resource.owner_id || resource.owner_id === userId;
    default: return false;
  }
}

/**
 * Combined check: permission + scope
 */
export function can(
  user: {
    role: TeamRole;
    permissions: PermissionsMap | null;
    scope: Scope;
    userId: string;
    teamId: string | null;
    departmentId: string | null;
  },
  action: PermissionKey,
  resource?: {
    owner_id?: string | null;
    team_id?: string | null;
    department_id?: string | null;
  }
): boolean {
  // Owner bypasses everything
  if (user.role === 'owner') return true;

  // Check permission
  const perms = user.permissions || getDefaultPermissions(user.role);
  if (!hasPermission(perms, action, user.role)) return false;

  // If no resource context, permission alone is enough
  if (!resource) return true;

  // Check scope
  return checkScope(user.scope, user.userId, user.teamId, user.departmentId, resource);
}

// ── Legacy helpers (backward compatibility) ─────────────────────────

export function canViewClients(p: PermissionsMap | null | undefined) { return hasPermission(p, 'clients.read'); }
export function canEditClients(p: PermissionsMap | null | undefined) { return hasPermission(p, 'clients.update'); }
export function canViewJobs(p: PermissionsMap | null | undefined) { return hasPermission(p, 'jobs.read'); }
export function canEditJobs(p: PermissionsMap | null | undefined) { return hasPermission(p, 'jobs.update'); }
export function canViewInvoices(p: PermissionsMap | null | undefined) { return hasPermission(p, 'invoices.read'); }
export function canEditInvoices(p: PermissionsMap | null | undefined) { return hasPermission(p, 'invoices.update'); }
export function canManageTeam(p: PermissionsMap | null | undefined) { return hasPermission(p, 'team.update'); }
export function canManagePermissions(p: PermissionsMap | null | undefined) { return hasPermission(p, 'users.update_role'); }
export function canViewTimesheets(p: PermissionsMap | null | undefined) { return hasPermission(p, 'timesheets.read'); }
export function canEditSettings(p: PermissionsMap | null | undefined) { return hasPermission(p, 'settings.update'); }

// ── Communication Preferences ───────────────────────────────────────

export interface CommunicationPreferences {
  surveys: boolean;
  errors: boolean;
  system: boolean;
  appointment_reminders: boolean;
  invoice_reminders: boolean;
}

export const DEFAULT_COMMUNICATION_PREFS: CommunicationPreferences = {
  surveys: true,
  errors: true,
  system: true,
  appointment_reminders: true,
  invoice_reminders: true,
};

// ── Working Hours ───────────────────────────────────────────────────

export interface DaySchedule {
  active: boolean;
  start: string;
  end: string;
}

export type WeeklySchedule = Record<string, DaySchedule>;

export const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export const DAY_LABELS: Record<string, { en: string; fr: string }> = {
  sunday:    { en: 'Sunday',    fr: 'Dimanche' },
  monday:    { en: 'Monday',    fr: 'Lundi' },
  tuesday:   { en: 'Tuesday',   fr: 'Mardi' },
  wednesday: { en: 'Wednesday', fr: 'Mercredi' },
  thursday:  { en: 'Thursday',  fr: 'Jeudi' },
  friday:    { en: 'Friday',    fr: 'Vendredi' },
  saturday:  { en: 'Saturday',  fr: 'Samedi' },
};

export function getDefaultSchedule(): WeeklySchedule {
  const schedule: WeeklySchedule = {};
  for (const day of DAYS_OF_WEEK) {
    const isWeekday = !['sunday', 'saturday'].includes(day);
    schedule[day] = { active: isWeekday, start: '08:00', end: '17:00' };
  }
  return schedule;
}

export function formatTime12h(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}
