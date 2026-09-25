/**
 * Suivi d'ouverture et de clic (2026-09-17) : lecture des évènements Resend
 * email.opened / email.clicked (pur), liste des courriels de compte jamais
 * suivis (Loi 25), migration, route de lecture, ligne d'état sur la facture
 * et la soumission, traductions des deux côtés.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { interpreterEvenementSuivi, ENTITES_SANS_SUIVI } from '../../server/routes/webhooks-email';

const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8');

// Charges utiles telles que documentées : resend.com/docs/webhooks/emails/{opened,clicked}
const OUVERT = { type: 'email.opened', created_at: '2026-09-17T18:12:00.000Z', data: { email_id: '56761188-7520-42d8-8898-ff6fc54ce618', to: ['x@y.z'] } };
const CLIQUE = { type: 'email.clicked', created_at: '2026-09-17T18:13:00.000Z', data: { email_id: '56761188-7520-42d8-8898-ff6fc54ce618', click: { link: 'https://lumecrm.net/invoice/abc', timestamp: '2026-09-17T18:13:05.000Z', ipAddress: '1.2.3.4', userAgent: 'x' } } };

describe('interpreterEvenementSuivi', () => {
  it('email.opened → opened, id du courriel, horodatage de l’évènement, pas d’URL', () => {
    expect(interpreterEvenementSuivi(OUVERT)).toEqual({ type: 'opened', emailId: '56761188-7520-42d8-8898-ff6fc54ce618', quand: '2026-09-17T18:12:00.000Z', url: null });
  });
  it('email.clicked → clicked, horodatage et lien du clic', () => {
    expect(interpreterEvenementSuivi(CLIQUE)).toEqual({ type: 'clicked', emailId: '56761188-7520-42d8-8898-ff6fc54ce618', quand: '2026-09-17T18:13:05.000Z', url: 'https://lumecrm.net/invoice/abc' });
  });
  it('les autres évènements (livré, rebond…) et un id manquant → null', () => {
    expect(interpreterEvenementSuivi({ type: 'email.delivered', data: { email_id: 'a' } })).toBeNull();
    expect(interpreterEvenementSuivi({ type: 'email.opened', data: {} })).toBeNull();
    expect(interpreterEvenementSuivi(null)).toBeNull();
  });
  it('un horodatage illisible retombe sur maintenant, jamais sur une date invalide', () => {
    const r = interpreterEvenementSuivi({ ...OUVERT, created_at: 'n/a' });
    expect(r && Number.isNaN(new Date(r.quand).getTime())).toBe(false);
  });
});

describe('Loi 25 — courriels de compte jamais suivis', () => {
  it('la liste couvre le compte, l’abonnement, le support, la sécurité et l’alerte de rebonds', () => {
    for (const t of ['user', 'team_member', 'invitation', 'subscription', 'billing', 'support', 'security', 'alerte_rebonds']) expect(ENTITES_SANS_SUIVI).toContain(t);
  });
  it('les documents clients (facture, soumission, contrat) restent suivis', () => {
    for (const t of ['invoice', 'quote', 'agreement', 'payment_request', 'reminder']) expect(ENTITES_SANS_SUIVI).not.toContain(t);
  });
  it('le webhook transmet la liste à la base, qui refuse aussi entity_type null', () => {
    expect(lire('server/routes/webhooks-email.ts')).toContain('p_types_exclus: [...ENTITES_SANS_SUIVI]');
    const sql = lire('supabase/migrations/20260917170000_email_deliveries_suivi.sql');
    expect(sql).toContain('d.entity_type is not null');
    expect(sql).toContain('not (d.entity_type = any');
  });
});

describe('migration', () => {
  const sql = lire('supabase/migrations/20260917170000_email_deliveries_suivi.sql');
  it('ajoute les cinq colonnes, l’index par entité et la fonction réservée au serveur', () => {
    for (const c of ['opened_at', 'open_count', 'clicked_at', 'click_count', 'last_clicked_url']) expect(sql).toContain(`add column if not exists ${c}`);
    expect(sql).toContain('on public.email_deliveries (entity_type, entity_id)');
    expect(sql).toContain('function public.email_deliveries_enregistrer_suivi');
    expect(sql).toMatch(/revoke all on function public\.email_deliveries_enregistrer_suivi\([^)]*\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.email_deliveries_enregistrer_suivi\([^)]*\) to service_role/);
  });
});

describe('route de lecture et interface', () => {
  it('GET /api/email-deliveries est montée et lit avec l’org du membre', () => {
    const index = lire('server/index.ts');
    expect(index).toContain("import emailDeliveriesRouter from './routes/email-deliveries'");
    expect(index).toContain("app.use('/api', emailDeliveriesRouter)");
    const route = lire('server/routes/email-deliveries.ts');
    expect(route).toContain("router.get('/email-deliveries'");
    expect(route).toContain('requireAuthedClient');
    expect(route).toContain(".eq('org_id', auth.orgId)");
    for (const c of ['opened_at', 'open_count', 'clicked_at', 'click_count']) expect(route).toContain(c);
  });
  it('la facture et la soumission affichent la ligne d’état, via l’API cliente', () => {
    expect(lire('src/pages/InvoiceDetails.tsx')).toContain('<EmailTrackingLine entityType="invoice"');
    expect(lire('src/pages/QuoteDetails.tsx')).toContain('<EmailTrackingLine entityType="quote"');
    const ligne = lire('src/components/EmailTrackingLine.tsx');
    expect(ligne).toContain("from '../lib/emailDeliveriesApi'");
    expect(ligne).toContain('useTranslation');
    expect(ligne).not.toMatch(/fetch\(/);
    expect(lire('src/lib/emailDeliveriesApi.ts')).toContain('/api/email-deliveries?');
  });
  it('les libellés existent en français et en anglais', () => {
    const fr = lire('src/i18n/fr.ts');
    const en = lire('src/i18n/en.ts');
    for (const cle of ['envoyeLe:', 'vuLe:', 'lienClique:', 'nonLivre:', 'pasEncoreOuvert:']) { expect(fr).toContain(cle); expect(en).toContain(cle); }
    expect(fr).toContain("nonLivre: 'Non livré'");
    expect(en).toContain("nonLivre: 'Not delivered'");
  });
});
