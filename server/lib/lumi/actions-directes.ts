/**
 * Actions directes (étage 2 bis, 2026-09-17) — 0 token, 0 ¢.
 * ─────────────────────────────────────────────────────────────────────────
 * Les 11 raccourcis (raccourcis.ts) ne couvrent que des lectures. Ici, le code
 * reconnaît par motif, SANS modèle, trois familles de plus :
 *
 *  - LECTURES : une fiche par numéro ou par nom unique, et les listes de
 *    réglages (« mes taxes », « mes modèles de soumission », « mes équipes »…),
 *    rendues par un gabarit court ;
 *  - ÉCRITURES DIRECTES : ce qui ne touche que l'utilisateur et se défait en un
 *    clic (pointer, pause, retenir un fait, notifications lues) — exécutées
 *    tout de suite, avec reçu ;
 *  - CARTES : une écriture sans ambiguïté sur une entité identifiée par un
 *    numéro, un courriel ou un nom unique (job 33 terminé, envoie la facture 4,
 *    invite marc@… comme technicien, crée une tâche : …). Le code prépare la
 *    même carte que le modèle ; l'utilisateur confirme pareil ; /lumi/execute
 *    exécute pareil.
 *
 * Règle absolue : au moindre doute (deux fiches, nom introuvable, verbe ou
 * complément non prévu), null — et le modèle prend le relais comme avant.
 * Les gardes de rôle sont celles des outils (executerOutilGarde, PERMISSION_PAR_OUTIL).
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { executerOutilGarde, PERMISSION_PAR_OUTIL } from '../agent/garde';
import { masquerIds } from '../agent/refs';
import { cleSouvenir } from '../agent/tools-etendus';
import { executerEcriture, type ReçuExecution } from './execution';
import { fichesDuResultat, apercuProposition, type Fiche, type Apercu } from './fiches';
import { normaliser } from './normaliser';
import { fmtDollars, jourLocal } from './raccourcis';

export type GenreDirect = 'lecture' | 'directe' | 'carte';

export interface ActionDirecte {
  id: string;
  genre: GenreDirect;
  tool: string;
  args: Record<string, any>;
  /** Pour les cartes et fiches : ce qu'il faut retrouver avant d'agir (numéro, courriel, nom). */
  cible?: { numero?: string; courriel?: string; nom?: string; texte?: string };
}

export interface ContexteDirect {
  client: SupabaseClient;
  orgId: string;
  userId: string;
  accessToken?: string;
  language: 'fr' | 'en';
  fuseau: string;
  maintenant?: Date;
}

export type ReponseDirecte =
  | { genre: 'texte'; texte: string; fiches: Fiche[]; outils: string[]; messages: Array<Record<string, any>>; recu?: ReçuExecution }
  | { genre: 'carte'; tool_use_id: string; tool: string; args: Record<string, any>; capacite: string | null; apercu: Apercu | null; messages: Array<Record<string, any>> };

const MAX_MOTS = 14;
// Normalisé : « INV-000004 » → « inv 000004 », « #33 » → « 33 » (la ponctuation disparaît).
const NUM = '(?:numero |number |no |num |n )?(?:inv ?|q ?)?0*(\\d{1,7})';
const VOIR = '(?:(?:montre|montres|montre moi|montres moi|voir|ouvre|affiche|c est quoi|details? (?:de|du|de la)|show|show me|open) )?';

/* ── Lectures de listes : groupes de mots (au moins un par groupe), mots permis en plus, mots interdits ── */
interface Liste { id: string; tool: string; args?: Record<string, any>; groupes: string[][]; extras?: string[]; interdits?: string[]; nom: { fr: string; en: string } }
const MOTS_VIDES = new Set(('je j ai jai mes mon ma le la les l de d du des un une en au aux ce cet cette ci il elle est c s stp svp pls please tu peux me dire donne donnes moi montre montres voir vois quoi que qu quest kes ke qui et pis pi tout tous ok bah la ya tu y as ' +
  'hey lumi salut bonjour allo yo hi hello quel quelle quels quelles sont liste lister list the my i do have has what whats is are show tell there any of for in this all so we our me a on actuellement presentement configures configurees actifs actives').split(/\s+/));
const LISTES: Liste[] = [
  { id: 'taxes', tool: 'get_tax_config', groupes: [['taxe', 'taxes', 'tps', 'tvq', 'tax', 'taxes']], nom: { fr: 'taxe', en: 'tax' } },
  { id: 'catalogue', tool: 'list_services', groupes: [['catalogue', 'services', 'service', 'tarifs', 'catalog']], extras: ['prix', 'produits'], interdits: ['facture', 'devis', 'job', 'cree', 'ajoute', 'modifie', 'supprime', 'archive'], nom: { fr: 'service', en: 'service' } },
  { id: 'modeles-devis', tool: 'list_quote_templates', groupes: [['modele', 'modeles', 'template', 'templates'], ['devis', 'soumission', 'soumissions', 'quote', 'quotes']], extras: ['avec', 'prix'], interdits: ['cree', 'ajoute', 'modifie', 'supprime', 'renomme'], nom: { fr: 'modèle de devis', en: 'quote template' } },
  { id: 'prereglages', tool: 'list_quote_presets', groupes: [['prereglage', 'prereglages', 'preset', 'presets']], extras: ['devis', 'soumission', 'soumissions'], interdits: ['cree', 'ajoute', 'modifie', 'supprime', 'renomme', 'duplique'], nom: { fr: 'préréglage', en: 'preset' } },
  { id: 'modeles-facture', tool: 'list_invoice_templates', groupes: [['modele', 'modeles', 'template', 'templates'], ['facture', 'factures', 'invoice', 'invoices']], interdits: ['cree', 'ajoute', 'modifie', 'supprime', 'renomme', 'defaut'], nom: { fr: 'modèle de facture', en: 'invoice template' } },
  { id: 'modeles-courriel', tool: 'list_email_templates', groupes: [['modele', 'modeles', 'template', 'templates'], ['courriel', 'courriels', 'email', 'emails']], interdits: ['cree', 'ajoute', 'modifie', 'supprime', 'renomme', 'defaut'], nom: { fr: 'modèle de courriel', en: 'email template' } },
  { id: 'automatisations', tool: 'list_automations', groupes: [['automatisation', 'automatisations', 'automation', 'automations', 'regles']], interdits: ['active', 'desactive', 'pause', 'cree', 'change', 'modifie', 'texte', 'langue'], nom: { fr: 'automatisation', en: 'automation' } },
  { id: 'objectifs', tool: 'list_goals', groupes: [['objectif', 'objectifs', 'goal', 'goals']], extras: ['revenus', 'mois'], interdits: ['cree', 'ajoute', 'mets', 'fixe', 'supprime'], nom: { fr: 'objectif', en: 'goal' } },
  { id: 'rapports-auto', tool: 'list_scheduled_reports', groupes: [['rapport', 'rapports', 'report', 'reports'], ['automatique', 'automatiques', 'planifie', 'planifies', 'programme', 'programmes', 'scheduled', 'envoyes']], extras: ['par', 'courriel'], interdits: ['cree', 'ajoute', 'supprime', 'envoie', 'change', 'modifie', 'pdf'], nom: { fr: 'rapport automatique', en: 'scheduled report' } },
  { id: 'relances-auto', tool: 'get_reminder_settings', groupes: [['relance', 'relances', 'rappel', 'rappels', 'reminder', 'reminders'], ['automatique', 'automatiques', 'reglage', 'reglages', 'reglee', 'reglees', 'configuration', 'settings', 'paiement', 'paiements']], interdits: ['change', 'modifie', 'mets', 'envoie', 'relance', 'retard', 'retards'], nom: { fr: 'relance', en: 'reminder' } },
  { id: 'equipes', tool: 'list_teams', groupes: [['equipes', 'crews', 'crew', 'groupes']], extras: ['nommees', 'j', 'ai'], interdits: ['cree', 'ajoute', 'supprime', 'renomme', 'membres', 'qui'], nom: { fr: 'équipe', en: 'team' } },
  { id: 'invitations', tool: 'list_invitations', groupes: [['invitation', 'invitations', 'invites']], extras: ['attente', 'encore', 'pending', 'equipe'], interdits: ['invite', 'renvoie', 'revoque', 'annule'], nom: { fr: 'invitation en attente', en: 'pending invitation' } },
  { id: 'recurrentes', tool: 'list_recurring_invoices', groupes: [['recurrente', 'recurrentes', 'recurring']], extras: ['facture', 'factures', 'place'], interdits: ['cree', 'ajoute', 'modifie', 'supprime', 'passe', 'genere'], nom: { fr: 'facture récurrente', en: 'recurring invoice' } },
  { id: 'territoires', tool: 'list_territories', groupes: [['territoire', 'territoires', 'territory', 'territories']], interdits: ['cree', 'ajoute', 'modifie', 'supprime', 'assigne'], nom: { fr: 'territoire', en: 'territory' } },
  { id: 'formations', tool: 'list_courses', groupes: [['formation', 'formations', 'cours', 'course', 'courses']], interdits: ['cree', 'ajoute', 'modifie', 'supprime', 'publie', 'assigne', 'lecon', 'module'], nom: { fr: 'formation', en: 'course' } },
  { id: 'notifications', tool: 'list_notifications', groupes: [['notification', 'notifications', 'notifs', 'notif']], interdits: ['lues', 'lue', 'read', 'marque', 'efface', 'supprime'], nom: { fr: 'notification', en: 'notification' } },
  { id: 'etiquettes', tool: 'list_job_tags', groupes: [['etiquette', 'etiquettes', 'tag', 'tags']], extras: ['job', 'jobs'], interdits: ['cree', 'ajoute', 'mets', 'supprime'], nom: { fr: 'étiquette', en: 'tag' } },
  { id: 'prospects', tool: 'search_leads', args: { limit: 20 }, groupes: [['prospect', 'prospects', 'leads', 'lead']], extras: ['pipeline', 'nouveaux'], interdits: ['cree', 'ajoute', 'convertis', 'supprime', 'combien', 'cb', 'cmb', 'nombre'], nom: { fr: 'prospect', en: 'lead' } },
  { id: 'demandes', tool: 'list_request_submissions', groupes: [['demande', 'demandes', 'formulaire', 'submissions', 'submission']], extras: ['recues', 'recue', 'web', 'entrantes', 'nouvelles', 'boite', 'reception'], interdits: ['traite', 'assigne', 'supprime'], nom: { fr: 'demande reçue', en: 'request' } },
  { id: 'heures', tool: 'get_timesheets', groupes: [['heures', 'hours', 'timesheet', 'timesheets', 'feuilles']], extras: ['temps', 'feuille', 'semaine', 'week', 'cette', 'travaillees', 'worked'], interdits: ['approuve', 'approve', 'hier', 'mois', 'derniere'], nom: { fr: 'feuille de temps', en: 'timesheet' } },
];

/* ── Écritures directes (ne touchent que l'utilisateur) ── */
const DIRECTES: Array<{ id: string; tool: string; motif: RegExp; fr: string; en: string }> = [
  { id: 'pointer', tool: 'punch_in', motif: /^(?:pointe|pointes|poinconne|punch|clock)(?: moi| me)?(?: in)?$|^(?:je |j )(?:commence|debute)(?: ma (?:journee|shift|job))?$|^(?:debut|start) (?:de )?(?:ma |la )?(?:journee|shift)$/, fr: 'Pointé. Bonne journée !', en: 'Clocked in. Have a good day!' },
  { id: 'depointer', tool: 'punch_out', motif: /^(?:depointe|depointes|de pointe)(?: moi)?$|^(?:pointe|punch|clock)(?: moi| me)? out$|^(?:je |j )(?:finis|termine|ai fini|ai termine)(?: ma (?:journee|shift))?$|^fin de (?:ma |la )?(?:journee|shift)$/, fr: 'Dépointé. Bonne soirée !', en: 'Clocked out. Enjoy your evening!' },
  { id: 'pause', tool: 'start_break', motif: /^(?:je (?:pars|prends|vais|suis|m en vais) )?(?:en |une |ma |a la )?pause$|^(?:debut|start) (?:de )?(?:la |ma )?pause$|^break$|^je pars diner$/, fr: 'Bonne pause !', en: 'Enjoy your break!' },
  { id: 'fin-pause', tool: 'end_break', motif: /^(?:je )?(?:reviens|suis de retour|suis revenu|suis revenue|retour)(?: de (?:ma |la )?(?:pause|diner))?$|^fin de (?:la |ma )?pause$|^(?:end|fin) break$|^je reprends$/, fr: 'Pause terminée, c’est reparti.', en: 'Break over, back at it.' },
  { id: 'notifs-lues', tool: 'mark_notifications_read', motif: /^(?:marque|marques|mets|met) (?:mes |les |toutes mes |toutes les )?notif(?:ication)?s? (?:comme )?lues?$|^(?:efface|vide|nettoie) (?:mes |les )?notifs?(?:ications)?$/, fr: 'Notifications marquées comme lues.', en: 'Notifications marked as read.' },
];

/* ── Cartes : écriture sur une entité identifiée ── */
const STATUTS_JOB: Record<string, string> = { termine: 'completed', terminee: 'completed', complete: 'completed', completee: 'completed', fini: 'completed', finie: 'completed', done: 'completed', completed: 'completed', 'en cours': 'in_progress', 'in progress': 'in_progress', commence: 'in_progress', annule: 'cancelled', annulee: 'cancelled', cancelled: 'cancelled', canceled: 'cancelled' };
const ROLES: Record<string, string> = { admin: 'admin', administrateur: 'admin', administratrice: 'admin', technicien: 'technician', technicienne: 'technician', technician: 'technician', tech: 'technician', vendeur: 'sales_rep', vendeuse: 'sales_rep', representant: 'sales_rep', representante: 'sales_rep', 'sales rep': 'sales_rep', 'sales_rep': 'sales_rep' };
const COURRIEL = "([^\\s@]+@[^\\s@]+\\.[a-z]{2,})";

/** Le message entier correspond-il à une action directe ? Pur, sans base. */
export function detecterActionDirecte(message: string): ActionDirecte | null {
  const mots = normaliser(message);
  if (mots.length === 0 || mots.length > MAX_MOTS) return null;
  const s = mots.join(' ');
  const brut = message.trim();

  // Écritures directes
  for (const d of DIRECTES) if (d.motif.test(s)) return { id: d.id, genre: 'directe', tool: d.tool, args: {} };
  // « Retiens que … » : le texte brut, avec ses accents
  const retiens = /^(?:retiens|retenir|note|souviens[- ]toi|rappelle[- ]toi|n[’']?oublie pas|remember|note that)\s*(?:que|that|:)?\s+(.{4,300})$/i.exec(brut);
  if (retiens && !/\bjob \d|\bfacture\b|\bdevis\b/i.test(retiens[1])) {
    const note = retiens[1].trim().replace(/\s+/g, ' ');
    return { id: 'retiens', genre: 'directe', tool: 'remember_this', args: { key: cleSouvenir(normaliser(note).slice(0, 5).join('-') || 'note'), note } };
  }

  // Fiches par numéro
  let m = new RegExp(`^${VOIR}(?:la |the )?(?:facture|invoice) ${NUM}$`).exec(s);
  if (m) return { id: 'facture-numero', genre: 'lecture', tool: 'list_invoices', args: { status: 'all', limit: 30 }, cible: { numero: m[1] } };
  m = new RegExp(`^${VOIR}(?:le |la |the )?(?:devis|soumission|quote|estimate) ${NUM}$`).exec(s);
  if (m) return { id: 'devis-numero', genre: 'lecture', tool: 'list_quotes', args: { query: m[1], limit: 10 }, cible: { numero: m[1] } };
  m = /^(?:(?:montre moi|montres moi|montre|voir|ouvre|affiche|show me|show|open) )?(?:le |la |the )?(?:client|cliente|customer|fiche(?: de| du| de la)?|dossier(?: de| du| de la)?) ([a-z][a-z' -]{1,40})$/.exec(s);
  if (m && !['actif', 'actifs', 'inactif', 'inactifs', 'total', 'liste', 'list', 'nouveau', 'nouveaux'].includes(m[1])) return { id: 'client-nom', genre: 'lecture', tool: 'search_clients', args: { query: m[1], limit: 3 }, cible: { nom: m[1] } };

  // Cartes sur un job numéroté
  m = new RegExp(`^(?:marque|marques|mets|met|passe|passes|mark|set) (?:le |la |the )?job ${NUM} (?:comme |as |en )?(termine|terminee|complete|completee|fini|finie|done|completed|en cours|in progress|commence|annule|annulee|cancelled|canceled)$`).exec(s);
  if (m) return { id: 'job-statut', genre: 'carte', tool: 'update_job_status', args: { status: STATUTS_JOB[m[2]] }, cible: { numero: m[1] } };
  m = new RegExp(`^(?:archive|archives|archive moi) (?:le |la |the )?job ${NUM}$`).exec(s);
  if (m) return { id: 'job-archive', genre: 'carte', tool: 'archive_job', args: {}, cible: { numero: m[1] } };
  m = new RegExp(`^(?:supprime|supprimes|efface|delete) (?:le |la |the )?job ${NUM}$`).exec(s);
  if (m) return { id: 'job-supprime', genre: 'carte', tool: 'delete_job', args: {}, cible: { numero: m[1] } };
  m = new RegExp(`^(?:assigne|assignes|donne|assign) (?:le |la |the )?job ${NUM} (?:a|to) ([a-z][a-z' -]{1,40})$`).exec(s);
  if (m) return { id: 'job-assigne', genre: 'carte', tool: 'assign_job', args: {}, cible: { numero: m[1], nom: m[2] } };
  const note = /^(?:ajoute|ajoutes|mets|met|add)\s+(?:une\s+)?note\s+(?:sur|au|à|a|on|to)\s+(?:le\s+|la\s+|the\s+)?job\s+(?:numéro\s+|numero\s+|no\s+|n°\s*|#)?(\d{1,7})\s*[:\-–—]\s*(.{2,2000})$/i.exec(brut);
  if (note) return { id: 'job-note', genre: 'carte', tool: 'add_note', args: { entity_type: 'job', note: note[2].trim() }, cible: { numero: note[1] } };

  // Cartes sur une facture ou un devis numéroté
  m = new RegExp(`^(?:envoie|envoies|envoyer|send) (?:la |the )?(?:facture|invoice) ${NUM}(?: (?:au|to) client)?$`).exec(s);
  if (m) return { id: 'facture-envoie', genre: 'carte', tool: 'send_invoice', args: {}, cible: { numero: m[1] } };
  m = new RegExp(`^(?:marque|marques|mets|met|mark) (?:la |the )?(?:facture|invoice) ${NUM} (?:comme )?(?:payee|paid)$`).exec(s);
  if (m) return { id: 'facture-payee', genre: 'carte', tool: 'mark_invoice_paid', args: {}, cible: { numero: m[1] } };
  m = new RegExp(`^(?:annule|annules|void) (?:la |the )?(?:facture|invoice) ${NUM}$`).exec(s);
  if (m) return { id: 'facture-annule', genre: 'carte', tool: 'void_invoice', args: {}, cible: { numero: m[1] } };
  m = new RegExp(`^(?:envoie|envoies|envoyer|send) (?:le |la |the )?(?:devis|soumission|quote) ${NUM}(?: (?:au|to) client)?$`).exec(s);
  if (m) return { id: 'devis-envoie', genre: 'carte', tool: 'send_quote', args: {}, cible: { numero: m[1] } };
  m = new RegExp(`^(?:annule|annules|cancel) (?:le |la |the )?(?:devis|soumission|quote) ${NUM}$`).exec(s);
  if (m) return { id: 'devis-annule', genre: 'carte', tool: 'cancel_quote', args: {}, cible: { numero: m[1] } };

  // Invitations (courriel dans le texte brut)
  let c = new RegExp(`^invite[sz]?\\s+${COURRIEL}\\s+(?:comme|en tant que|as)\\s+(admin|administrateur|administratrice|technicien|technicienne|technician|tech|vendeur|vendeuse|représentant|representant|représentante|representante|sales rep|sales_rep)$`, 'i').exec(brut);
  if (c) return { id: 'invite', genre: 'carte', tool: 'invite_member', args: { email: c[1].toLowerCase(), role: ROLES[c[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')] }, cible: { courriel: c[1].toLowerCase() } };
  c = new RegExp(`^(?:renvoie|renvoies|resend)\\s+l[’']?invitation\\s+(?:à|a|to)\\s+${COURRIEL}$`, 'i').exec(brut);
  if (c) return { id: 'invitation-renvoie', genre: 'carte', tool: 'resend_invitation', args: {}, cible: { courriel: c[1].toLowerCase() } };
  c = new RegExp(`^(?:révoque|revoque|annule|retire|revoke)\\s+l[’']?invitation\\s+(?:de|à|a|of|to|pour|for)\\s+${COURRIEL}$`, 'i').exec(brut);
  if (c) return { id: 'invitation-revoque', genre: 'carte', tool: 'revoke_invitation', args: {}, cible: { courriel: c[1].toLowerCase() } };

  // Tâche : « crée une tâche : rappeler le fournisseur demain »
  const tache = /^(?:crée|cree|crées|ajoute|ajoutes|add|create)\s+(?:une\s+|a\s+)?(?:tâche|tache|task)\s*[:\-–—]\s*(.{2,200})$/i.exec(brut);
  if (tache) {
    let titre = tache[1].trim();
    let quand: 'aujourdhui' | 'demain' | null = null;
    const q = /\s+(?:pour\s+|for\s+)?(demain|tomorrow|aujourd'?hui|today)\s*$/i.exec(titre);
    if (q) { quand = /demain|tomorrow/i.test(q[1]) ? 'demain' : 'aujourdhui'; titre = titre.slice(0, q.index).trim(); }
    return { id: 'tache-cree', genre: 'carte', tool: 'create_task', args: { title: titre.charAt(0).toUpperCase() + titre.slice(1) }, cible: { texte: quand ?? undefined } };
  }

  // Automatisation par nom : « désactive l'automatisation Rappel de rendez-vous »
  const auto = /^(?:active|réactive|reactive|désactive|desactive|mets en pause|met en pause|enable|disable|pause)\s+l[’']?automatisation\s+(.{2,80})$/i.exec(brut);
  if (auto) return { id: 'automatisation-bascule', genre: 'carte', tool: 'toggle_automation_rule', args: { is_active: /^(?:active|réactive|reactive|enable)/i.test(brut) }, cible: { nom: auto[1].trim() } };

  // Listes de réglages
  for (const l of LISTES) {
    if (l.interdits?.some((x) => mots.includes(x))) continue;
    if (!l.groupes.every((g) => g.some((x) => mots.includes(x)))) continue;
    const permis = new Set([...MOTS_VIDES, ...l.groupes.flat(), ...(l.extras ?? [])]);
    if (!mots.every((x) => permis.has(x))) continue;
    return { id: l.id, genre: 'lecture', tool: l.tool, args: { ...(l.args ?? {}) } };
  }
  return null;
}

/* ── Rendu ── */
const chiffres = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const premierTableau = (r: any): any[] => { for (const v of Object.values(r ?? {})) if (Array.isArray(v)) return v; return []; };
const libelle = (x: any): string => String(x?.nom ?? x?.name ?? x?.title ?? x?.titre ?? x?.label ?? x?.email ?? x?.subject ?? x?.recipient_email ?? x?.address ?? x?.name_fr ?? '—');
function secondaire(x: any, fr: boolean): string {
  const parts: string[] = [];
  const statut = x?.statut ?? x?.status ?? x?.etape;
  if (typeof statut === 'string' && statut) parts.push(statut);
  if (typeof x?.role === 'string') parts.push(x.role);
  if (typeof x?.frequency === 'string') parts.push(x.frequency);
  if (typeof x?.rate === 'number') parts.push(`${x.rate} %`);
  for (const k of ['prix_cents', 'total_cents', 'amount_cents', 'balance_cents', 'unit_price_cents']) if (typeof x?.[k] === 'number') { parts.push(fmtDollars(x[k], fr)); break; }
  if (typeof x?.hours === 'number' || typeof x?.total_hours === 'number') parts.push(`${x.hours ?? x.total_hours} h`);
  if (typeof x?.is_active === 'boolean') parts.push(x.is_active ? (fr ? 'active' : 'active') : (fr ? 'en pause' : 'paused'));
  return parts.join(' · ');
}
/** « 2 modèles de devis », « 2 quote templates » : le pluriel porte sur le premier mot en français, le dernier en anglais. */
const pluriel = (n: number, nom: string, fr: boolean) => {
  if (fr) { const [tete, ...reste] = nom.split(' '); const t = n > 1 && !tete.endsWith('s') && !tete.endsWith('x') ? `${tete}s` : tete; return `${n} ${[t, ...reste].join(' ')}`; }
  return `${n} ${nom}${n === 1 ? '' : 's'}`;
};

export function rendreActionDirecte(a: ActionDirecte, resultat: any, opts: { fr: boolean; fuseau: string }): string | null {
  const { fr } = opts;
  if (a.genre !== 'lecture') return null;
  if (a.id === 'facture-numero' || a.id === 'devis-numero') {
    const rows = premierTableau(resultat);
    const cle = a.id === 'facture-numero' ? 'invoice_number' : 'quote_number';
    const trouve = rows.filter((x) => chiffres(x?.[cle] ?? x?.number).endsWith(String(a.cible?.numero).padStart(1, '0')) && Number(chiffres(x?.[cle] ?? x?.number)) === Number(a.cible?.numero));
    if (trouve.length !== 1) return null;
    const x = trouve[0];
    const lignes = [
      `${a.id === 'facture-numero' ? (fr ? 'Facture' : 'Invoice') : (fr ? 'Devis' : 'Quote')} ${x[cle] ?? x.number}${x.title || x.subject ? ` · ${x.title ?? x.subject}` : ''}`,
      `${fr ? 'Client' : 'Client'} : ${x.client_name ?? x.client ?? '—'}`,
      `${fr ? 'Statut' : 'Status'} : ${x.statut ?? x.status ?? '—'}`,
    ];
    if (typeof x.total_cents === 'number') lignes.push(`${fr ? 'Total' : 'Total'} : ${fmtDollars(x.total_cents, fr)}`);
    if (typeof x.balance_cents === 'number' && a.id === 'facture-numero') lignes.push(`${fr ? 'Solde' : 'Balance'} : ${fmtDollars(x.balance_cents, fr)}`);
    if (x.due_date) lignes.push(`${fr ? 'Échéance' : 'Due'} : ${String(x.due_date).slice(0, 10)}`);
    return lignes.join('\n');
  }
  if (a.id === 'client-nom') {
    const rows = premierTableau(resultat);
    if (rows.length !== 1) return null;
    const x = rows[0];
    const lignes = [`${x.name ?? x.nom ?? '—'}${x.company ? ` · ${x.company}` : ''}`];
    if (x.phone) lignes.push(`${fr ? 'Téléphone' : 'Phone'} : ${x.phone}`);
    if (x.email) lignes.push(`${fr ? 'Courriel' : 'Email'} : ${x.email}`);
    if (x.address || x.city) lignes.push(`${fr ? 'Adresse' : 'Address'} : ${[x.address, x.city].filter(Boolean).join(', ')}`);
    if (x.statut ?? x.status) lignes.push(`${fr ? 'Statut' : 'Status'} : ${x.statut ?? x.status}`);
    return lignes.join('\n');
  }
  if (a.id === 'taxes') {
    const taxes = premierTableau(resultat);
    if (!taxes.length) return fr ? 'Aucune taxe configurée pour l’instant.' : 'No tax configured yet.';
    const lignes = taxes.slice(0, 10).map((t) => `• ${libelle(t)}${typeof t.rate === 'number' ? ` · ${t.rate} %` : ''}${t.is_default ? (fr ? ' · par défaut' : ' · default') : ''}`);
    return `${fr ? 'Tes taxes :' : 'Your taxes:'}\n${lignes.join('\n')}`;
  }
  if (a.id === 'relances-auto') {
    const r = resultat ?? {};
    const etapes: any[] = Array.isArray(r.schedule) ? r.schedule : [];
    const etat = r.enabled === false ? (fr ? 'désactivées' : 'off') : (fr ? 'actives' : 'on');
    const lignes = etapes.map((e) => `• ${fr ? `${e.jours_apres_echeance ?? e.days_after_due} jour(s) après l’échéance` : `${e.jours_apres_echeance ?? e.days_after_due} day(s) after due`} · ${e.canal ?? e.channel}`);
    return `${fr ? `Relances automatiques ${etat}` : `Automatic reminders ${etat}`}${lignes.length ? ` :\n${lignes.join('\n')}` : '.'}`;
  }
  const l = LISTES.find((x) => x.id === a.id);
  if (!l) return null;
  const rows = premierTableau(resultat);
  const nom = fr ? l.nom.fr : l.nom.en;
  if (!rows.length) return fr ? `Aucun${/^[aeéiou]/i.test(nom) ? 'e' : ''} ${nom} pour l’instant.` : `No ${nom} yet.`;
  const total = Number(resultat?.total_matching ?? resultat?.count ?? rows.length);
  const lignes = rows.slice(0, 15).map((x) => { const s = secondaire(x, fr); return `• ${libelle(x)}${s ? ` · ${s}` : ''}`; });
  const reste = total - Math.min(15, rows.length);
  return `${pluriel(total, nom, fr)} :\n${lignes.join('\n')}${reste > 0 ? (fr ? `\n… et ${reste} autre${reste > 1 ? 's' : ''}.` : `\n… and ${reste} more.`) : ''}`;
}

/* ── Résolution des cibles (lectures, 0 ¢) ── */
async function lire(tool: string, args: Record<string, any>, ctx: ContexteDirect): Promise<any | null> {
  const r = await executerOutilGarde({ name: tool, args, userId: ctx.userId, orgId: ctx.orgId, client: ctx.client, accessToken: ctx.accessToken });
  if ('refus' in r) return null;
  const res = r.result;
  return res && typeof res === 'object' && !res.error ? res : null;
}
const unique = <T,>(xs: T[]): T | null => (xs.length === 1 ? xs[0] : null);

async function resoudre(a: ActionDirecte, ctx: ContexteDirect): Promise<Record<string, any> | null> {
  const args = { ...a.args };
  const num = a.cible?.numero;
  if (a.id.startsWith('job-')) {
    const r = await lire('list_jobs', { query: num, limit: 5 }, ctx);
    const job = unique(premierTableau(r).filter((j) => String(j.job_number) === String(num)));
    if (!job?.id) return null;
    args.job_id = job.id;
    if (a.id === 'job-note') args.entity_id = job.id;
    if (a.id === 'job-assigne') {
      const equipe = await lire('get_team', {}, ctx);
      const nom = normaliser(a.cible?.nom ?? '').join(' ');
      const membres = premierTableau(equipe).filter((m) => (m.statut === 'actif' || m.statut === 'active' || !m.statut) && normaliser(String(m.name ?? '')).join(' ').includes(nom));
      const membre = unique(membres);
      if (!membre?.user_id && !membre?.id) return null;
      args.assignee_user_id = membre.user_id ?? membre.id;
    }
    return args;
  }
  if (a.id.startsWith('facture-')) {
    const r = await lire('list_invoices', { status: 'all', limit: 30 }, ctx);
    const inv = unique(premierTableau(r).filter((x) => Number(chiffres(x.invoice_number ?? x.number)) === Number(num)));
    if (!inv?.id) return null;
    args.invoice_id = inv.id;
    return args;
  }
  if (a.id.startsWith('devis-')) {
    const r = await lire('list_quotes', { query: num, limit: 10 }, ctx);
    const q = unique(premierTableau(r).filter((x) => Number(chiffres(x.quote_number ?? x.number)) === Number(num)));
    if (!q?.id) return null;
    args.quote_id = q.id;
    return args;
  }
  if (a.id === 'invitation-renvoie' || a.id === 'invitation-revoque') {
    const r = await lire('list_invitations', { status: 'all' }, ctx);
    const inv = unique(premierTableau(r).filter((x) => String(x.email ?? '').toLowerCase() === a.cible?.courriel && !['accepted', 'revoked', 'acceptée', 'révoquée'].includes(String(x.statut ?? x.status ?? '').toLowerCase())));
    if (!inv?.id) return null;
    args.invitation_id = inv.id;
    return args;
  }
  if (a.id === 'automatisation-bascule') {
    const r = await lire('list_automations', {}, ctx);
    const nom = normaliser(a.cible?.nom ?? '').join(' ');
    const regle = unique(premierTableau(r).filter((x) => normaliser(String(x.name ?? '')).join(' ').includes(nom)));
    if (!regle?.id) return null;
    args.rule_id = regle.id;
    return args;
  }
  if (a.id === 'tache-cree') {
    if (a.cible?.texte === 'demain') args.due_date = jourLocal(ctx.fuseau, ctx.maintenant ?? new Date(), 1);
    if (a.cible?.texte === 'aujourdhui') args.due_date = jourLocal(ctx.fuseau, ctx.maintenant ?? new Date(), 0);
    return args;
  }
  return args; // invite : rien à résoudre
}

/** Répond à l'action : lecture rendue, écriture directe exécutée, ou carte préparée. null = le modèle prend le relais. */
export async function repondreActionDirecte(a: ActionDirecte, ctx: ContexteDirect): Promise<ReponseDirecte | null> {
  const fr = ctx.language !== 'en';
  const espace = `${ctx.orgId}:${ctx.userId}`;
  try {
    if (a.genre === 'lecture') {
      const resultat = await lire(a.tool, a.args, ctx);
      if (!resultat) return null;
      const texte = rendreActionDirecte(a, resultat, { fr, fuseau: ctx.fuseau });
      if (!texte) return null;
      const fiches = a.id === 'client-nom' || a.id === 'facture-numero' || a.id === 'devis-numero' ? fichesDuResultat(a.tool, a.args, resultat) : [];
      return { genre: 'texte', texte, fiches, outils: [a.tool], messages: [{ role: 'assistant', content: [{ type: 'text', text: texte }] }] };
    }
    if (a.genre === 'directe') {
      const toolUseId = `direct_${randomUUID()}`;
      const r = await executerEcriture({ tool: a.tool, toolUseId, args: a.args, userId: ctx.userId, orgId: ctx.orgId, client: ctx.client, accessToken: ctx.accessToken, auto: true });
      if (!r.recu.ok) return null; // refus de rôle, erreur métier (« déjà pointé »…) : le modèle explique
      const d = DIRECTES.find((x) => x.id === a.id);
      const contenu = JSON.parse(r.contenu);
      const noteOutil = typeof contenu?.result?.note === 'string' ? contenu.result.note : null;
      const texte = a.id === 'retiens' ? (fr ? 'C’est noté.' : 'Noted.') : (noteOutil || (d ? (fr ? d.fr : d.en) : (fr ? 'C’est fait.' : 'Done.')));
      return {
        genre: 'texte', texte, fiches: r.recu.fiche ? [r.recu.fiche] : [], outils: [a.tool], recu: r.recu,
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: a.tool, input: masquerIds(espace, a.args) }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: r.contenu }] },
          { role: 'assistant', content: [{ type: 'text', text: texte }] },
        ],
      };
    }
    // Carte
    const args = await resoudre(a, ctx);
    if (!args) return null;
    const toolUseId = `direct_${randomUUID()}`;
    const apercu = await apercuProposition(a.tool, args, { client: ctx.client, orgId: ctx.orgId, userId: ctx.userId });
    const masques = masquerIds(espace, args);
    return {
      genre: 'carte', tool_use_id: toolUseId, tool: a.tool, args: masques, capacite: PERMISSION_PAR_OUTIL[a.tool]?.capacite ?? null, apercu,
      messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: a.tool, input: masques }] }],
    };
  } catch (err: any) {
    console.error(`[lumi:direct:${a.id}]`, err?.message || err);
    return null;
  }
}
