/**
 * Les événements d'automatisation qui naissent d'un TRIGGER en base
 * (migration 20261003100000, lus par `server/lib/evenementsBase.ts`).
 *
 * Leur route (`server/routes/automation-events.ts`) est VIDE — elle répond
 * `{ ok: true, via: 'base' }` pour les onglets restés sur une ancienne version
 * de l'app — mais elle exige « Modifier les automatisations ». Un outil de Lumi
 * qui l'appelait après son écriture ne déclenchait donc rien, et un membre sans
 * ce droit (un technicien qui ajoute une visite) recevait « automatisations non
 * déclenchées » alors qu'elles étaient parties. Les outils ne les appellent plus.
 *
 * `tests/automation/lumi-evenements-nes-en-base.test.ts` croise cette liste avec
 * les routes vides : une route qui redevient active doit en sortir.
 */
export const EVENEMENTS_NES_EN_BASE: ReadonlySet<string> = new Set([
  '/automations/events/appointment-created',
  '/automations/events/appointment-cancelled',
  '/automations/events/quote-approved',
  '/automations/events/invoice-paid',
]);
