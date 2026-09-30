/**
 * Un préréglage se réenregistre depuis l'éditeur (audit V2, D-14), et
 * « Demander un avis » ne demande plus un texte que le moteur ignore.
 *
 * 36 préréglages sur 38 étaient refusés par la route : `log_activity`
 * inconnue du catalogue, clés que le moteur lit mais que la validation
 * refusait (`description`, `lien`, `depuis_role`/`vers_role`, `metadata`).
 * Les ouvrir dans l'éditeur et enregistrer échouait. Et « Demander un avis »
 * exigeait un texte que le moteur ignorait — réglé par #780 (champ retiré :
 * le texte vient de Réglages → Avis clients, 0 étape réelle n'en portait un).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../server/lib/mailer', async () => (await import('../quarantaine/_simulations')).mailerSimule(vi.fn(async () => ({ sent: true, messageId: 'x' }))));
vi.mock('../../server/routes/emails', async () => (await import('../quarantaine/_simulations')).emailsSimules());
vi.mock('../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));

import { AUTOMATION_PRESETS } from '../../server/lib/automationPresets.data';
import { automationRuleCreateSchema, automationRuleUpdateSchema } from '../../server/lib/validation';
import { trouverAction, trouverDeclencheur } from '../../src/lib/automationCatalogue';
import { executeRequestReview } from '../../server/lib/actions/index';
import { clientEnregistreur } from '../quarantaine/automation/_enregistreur';

describe('D-14 — chaque préréglage passe la validation de la route', () => {
  for (const p of AUTOMATION_PRESETS.filter((x) => trouverDeclencheur(x.trigger_event))) {
    it(p.preset_key, () => {
      const corps = { name: p.name, trigger_event: p.trigger_event, conditions: p.conditions, delay_seconds: p.delay_seconds, actions: p.actions };
      const c = automationRuleCreateSchema.safeParse(corps);
      const u = automationRuleUpdateSchema.safeParse({ actions: p.actions, conditions: p.conditions, trigger_event: p.trigger_event });
      expect(c.success ? [] : c.error.issues.map((i) => `${i.path.join('.')} ${i.message}`)).toEqual([]);
      expect(u.success ? [] : u.error.issues.map((i) => `${i.path.join('.')} ${i.message}`)).toEqual([]);
    });
  }

  it('une clé qui n’appartient pas à l’action reste refusée (ex. un destinataire imposé sur un texto)', () => {
    const r = automationRuleUpdateSchema.safeParse({ actions: [{ type: 'send_sms', config: { body: 'x', to: '+15145550000' } }] });
    expect(r.success).toBe(false);
  });

  it('une clé interne d’une autre action ne passe pas (lien sur un texto)', () => {
    const r = automationRuleUpdateSchema.safeParse({ actions: [{ type: 'send_sms', config: { body: 'x', lien: '/x' } }] });
    expect(r.success).toBe(false);
  });
});

describe('« Demander un avis » : aucun champ que le moteur ignorerait', () => {
  it('l’éditeur ne propose pas de texte ; la route n’en accepte pas', () => {
    expect(trouverAction('request_review')?.champs).toEqual([]);
    const r = automationRuleUpdateSchema.safeParse({ actions: [{ type: 'request_review', config: { body: 'Texte ignoré' } }] });
    expect(r.success).toBe(false);
  });
});

describe('D-10 — un texto sauté n’est pas journalisé « envoyé »', () => {
  it('sans numéro texto configuré : smsSent = false, emailSent = true', async () => {
    const ORG = '11111111-1111-4111-8111-111111111111';
    const { client, journal } = clientEnregistreur({
      company_settings: { data: { review_enabled: true, google_review_url: 'https://g.page/x', company_name: 'A inc.' } },
      satisfaction_surveys: { data: { id: 'sondage-1' } },
      review_requests: { data: null },
      clients: { data: [{ id: 'c1', email: 'marie@example.test', phone: '+15145550142', email_consent_at: '2026-01-01T00:00:00Z', sms_consent_at: null, email_opt_out_at: null }] },
    });
    // twilio: null = aucun numéro texto → le texto est SAUTÉ (M1), pas envoyé.
    const r = await executeRequestReview({}, { client_first_name: 'Marie', client_phone: '+15145550142', client_email: 'marie@example.test' },
      { supabase: client, orgId: ORG, entityType: 'client', entityId: 'c1', twilio: null, baseUrl: 'https://app.lume.test' } as never);
    expect((r.data as any)?.smsSent).toBe(false);
    expect((r.data as any)?.emailSent).toBe(true);
    const activite = journal.find((q) => q.table === 'activity_log' && q.op === 'insert' && (q.valeur as any)?.event_type === 'review_requested')?.valeur as any;
    expect(activite?.metadata?.sms_sent).toBe(false);
  });
});
