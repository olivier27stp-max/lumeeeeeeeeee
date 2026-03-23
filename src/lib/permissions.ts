// ── Centralized Permission System for Lume CRM ──────────────────────
// Defines all permission keys, role presets, and helper functions.
// Designed to be reusable across the entire app.

export type TeamRole = 'owner' | 'admin' | 'sales_rep' | 'technician';

// ── All permission keys ──────────────────────────────────────────────
export const PERMISSION_KEYS = [
  // Client Management
  'clients.view',
  'clients.create',
  'clients.edit',
  'clients.archive',
  // Jobs
  'jobs.view',
  'jobs.create',
  'jobs.edit',
  'jobs.assign',
  'jobs.complete',
  // Quotes
  'quotes.view',
  'quotes.create',
  'quotes.edit',
  'quotes.send',
  // Invoices
  'invoices.view',
  'invoices.create',
  'invoices.edit',
  'invoices.send',
  'invoices.manage_payments',
  // Payments
  'payments.view_dashboard',
  'payments.view_transactions',
  'payments.manage_settings',
  // Team
  'team.view',
  'team.add',
  'team.edit',
  'team.deactivate',
  'team.manage_permissions',
  // Timesheets
  'timesheets.view_own',
  'timesheets.view_all',
  'timesheets.edit',
  'timesheets.approve',
  // Settings
  'settings.view',
  'settings.edit_company',
  'settings.edit_automations',
  'settings.edit_payments',
  // Automation / Communication
  'automations.manage_reminders',
  'automations.manage_templates',
  'automations.manage_email_sms',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type PermissionsMap = Record<PermissionKey, boolean>;

// ── Permission Groups (for UI display) ───────────────────────────────
export interface PermissionGroup {
  key: string;
  label_en: string;
  label_fr: string;
  permissions: { key: PermissionKey; label_en: string; label_fr: string }[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: 'clients',
    label_en: 'Client Management',
    label_fr: 'Gestion des clients',
    permissions: [
      { key: 'clients.view', label_en: 'View clients', label_fr: 'Voir les clients' },
      { key: 'clients.create', label_en: 'Create clients', label_fr: 'Créer des clients' },
      { key: 'clients.edit', label_en: 'Edit clients', label_fr: 'Modifier les clients' },
      { key: 'clients.archive', label_en: 'Archive / deactivate clients', label_fr: 'Archiver / désactiver les clients' },
    ],
  },
  {
    key: 'jobs',
    label_en: 'Jobs',
    label_fr: 'Travaux',
    permissions: [
      { key: 'jobs.view', label_en: 'View jobs', label_fr: 'Voir les travaux' },
      { key: 'jobs.create', label_en: 'Create jobs', label_fr: 'Créer des travaux' },
      { key: 'jobs.edit', label_en: 'Edit jobs', label_fr: 'Modifier les travaux' },
      { key: 'jobs.assign', label_en: 'Assign jobs', label_fr: 'Assigner des travaux' },
      { key: 'jobs.complete', label_en: 'Complete jobs', label_fr: 'Compléter des travaux' },
    ],
  },
  {
    key: 'quotes',
    label_en: 'Quotes',
    label_fr: 'Devis',
    permissions: [
      { key: 'quotes.view', label_en: 'View quotes', label_fr: 'Voir les devis' },
      { key: 'quotes.create', label_en: 'Create quotes', label_fr: 'Créer des devis' },
      { key: 'quotes.edit', label_en: 'Edit quotes', label_fr: 'Modifier les devis' },
      { key: 'quotes.send', label_en: 'Send quotes', label_fr: 'Envoyer des devis' },
    ],
  },
  {
    key: 'invoices',
    label_en: 'Invoices',
    label_fr: 'Factures',
    permissions: [
      { key: 'invoices.view', label_en: 'View invoices', label_fr: 'Voir les factures' },
      { key: 'invoices.create', label_en: 'Create invoices', label_fr: 'Créer des factures' },
      { key: 'invoices.edit', label_en: 'Edit invoices', label_fr: 'Modifier les factures' },
      { key: 'invoices.send', label_en: 'Send invoices', label_fr: 'Envoyer des factures' },
      { key: 'invoices.manage_payments', label_en: 'Mark paid / manage payments', label_fr: 'Marquer payé / gérer les paiements' },
    ],
  },
  {
    key: 'payments',
    label_en: 'Payments',
    label_fr: 'Paiements',
    permissions: [
      { key: 'payments.view_dashboard', label_en: 'View payments dashboard', label_fr: 'Voir le tableau de bord des paiements' },
      { key: 'payments.view_transactions', label_en: 'View transactions', label_fr: 'Voir les transactions' },
      { key: 'payments.manage_settings', label_en: 'Manage payment settings', label_fr: 'Gérer les paramètres de paiement' },
    ],
  },
  {
    key: 'team',
    label_en: 'Team',
    label_fr: 'Équipe',
    permissions: [
      { key: 'team.view', label_en: 'View team', label_fr: 'Voir l\'équipe' },
      { key: 'team.add', label_en: 'Add team members', label_fr: 'Ajouter des membres' },
      { key: 'team.edit', label_en: 'Edit team members', label_fr: 'Modifier les membres' },
      { key: 'team.deactivate', label_en: 'Deactivate team members', label_fr: 'Désactiver des membres' },
      { key: 'team.manage_permissions', label_en: 'Manage permissions', label_fr: 'Gérer les permissions' },
    ],
  },
  {
    key: 'timesheets',
    label_en: 'Timesheets',
    label_fr: 'Feuilles de temps',
    permissions: [
      { key: 'timesheets.view_own', label_en: 'View own timesheets', label_fr: 'Voir ses feuilles de temps' },
      { key: 'timesheets.view_all', label_en: 'View all timesheets', label_fr: 'Voir toutes les feuilles de temps' },
      { key: 'timesheets.edit', label_en: 'Edit timesheets', label_fr: 'Modifier les feuilles de temps' },
      { key: 'timesheets.approve', label_en: 'Approve timesheets', label_fr: 'Approuver les feuilles de temps' },
    ],
  },
  {
    key: 'settings',
    label_en: 'Settings',
    label_fr: 'Paramètres',
    permissions: [
      { key: 'settings.view', label_en: 'View settings', label_fr: 'Voir les paramètres' },
      { key: 'settings.edit_company', label_en: 'Edit company settings', label_fr: 'Modifier les paramètres de l\'entreprise' },
      { key: 'settings.edit_automations', label_en: 'Edit automations', label_fr: 'Modifier les automatisations' },
      { key: 'settings.edit_payments', label_en: 'Edit payment settings', label_fr: 'Modifier les paramètres de paiement' },
    ],
  },
  {
    key: 'automations',
    label_en: 'Automation & Communication',
    label_fr: 'Automatisation et communication',
    permissions: [
      { key: 'automations.manage_reminders', label_en: 'Manage reminders', label_fr: 'Gérer les rappels' },
      { key: 'automations.manage_templates', label_en: 'Manage templates', label_fr: 'Gérer les modèles' },
      { key: 'automations.manage_email_sms', label_en: 'Manage email / SMS automations', label_fr: 'Gérer les automatisations courriel / SMS' },
    ],
  },
];

// ── Role Presets ─────────────────────────────────────────────────────
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

const ADMIN_PRESET: PermissionsMap = {
  ...allTrue(),
  'team.manage_permissions': false,
};

const SALES_REP_PRESET: PermissionsMap = {
  ...allFalse(),
  'clients.view': true,
  'clients.create': true,
  'clients.edit': true,
  'quotes.view': true,
  'quotes.create': true,
  'quotes.edit': true,
  'quotes.send': true,
  'invoices.view': true,
  'invoices.create': true,
  'invoices.send': true,
  'payments.view_transactions': true,
  'settings.view': true,
  'timesheets.view_own': true,
  'timesheets.edit': true,
};

const TECHNICIAN_PRESET: PermissionsMap = {
  ...allFalse(),
  'clients.view': true,
  'jobs.view': true,
  'jobs.complete': true,
  'timesheets.view_own': true,
  'timesheets.edit': true,
  'settings.view': true,
};

export const ROLE_PRESETS: Record<TeamRole, PermissionsMap> = {
  owner: allTrue(),
  admin: ADMIN_PRESET,
  sales_rep: SALES_REP_PRESET,
  technician: TECHNICIAN_PRESET,
};

export function getDefaultPermissions(role: TeamRole): PermissionsMap {
  return { ...ROLE_PRESETS[role] };
}

// ── Helper functions for checking permissions ────────────────────────
export function hasPermission(permissions: PermissionsMap | null | undefined, key: PermissionKey): boolean {
  if (!permissions) return false;
  return permissions[key] === true;
}

export function canViewClients(p: PermissionsMap | null | undefined) { return hasPermission(p, 'clients.view'); }
export function canEditClients(p: PermissionsMap | null | undefined) { return hasPermission(p, 'clients.edit'); }
export function canViewJobs(p: PermissionsMap | null | undefined) { return hasPermission(p, 'jobs.view'); }
export function canEditJobs(p: PermissionsMap | null | undefined) { return hasPermission(p, 'jobs.edit'); }
export function canViewInvoices(p: PermissionsMap | null | undefined) { return hasPermission(p, 'invoices.view'); }
export function canEditInvoices(p: PermissionsMap | null | undefined) { return hasPermission(p, 'invoices.edit'); }
export function canManageTeam(p: PermissionsMap | null | undefined) { return hasPermission(p, 'team.edit'); }
export function canManagePermissions(p: PermissionsMap | null | undefined) { return hasPermission(p, 'team.manage_permissions'); }
export function canViewTimesheets(p: PermissionsMap | null | undefined) { return hasPermission(p, 'timesheets.view_all'); }
export function canEditSettings(p: PermissionsMap | null | undefined) { return hasPermission(p, 'settings.edit_company'); }

// ── Communication Preferences ────────────────────────────────────────
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

// ── Working Hours ────────────────────────────────────────────────────
export interface DaySchedule {
  active: boolean;
  start: string; // "HH:mm" format
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
    schedule[day] = {
      active: isWeekday,
      start: '08:00',
      end: '17:00',
    };
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
