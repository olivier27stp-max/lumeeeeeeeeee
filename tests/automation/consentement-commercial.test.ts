/**
 * F7 — consentement avant tout message commercial d'automatisation.
 *
 * Au Canada, un message électronique commercial exige le consentement du
 * destinataire (LCAP ; loi 25 au Québec). Avant ce correctif, les presets
 * `cross_sell_30d`, `seasonal_reminder_6m` et `lost_lead_reengagement`
 * partaient à tout le monde avec `"conditions": {}`, et le seeder les activait
 * d'office à la création de chaque org.
 *
 * Ce que ces tests figent :
 *  - un message COMMERCIAL exige un consentement enregistré sur le canal ;
 *  - un message TRANSACTIONNEL passe sans (il répond à une demande du client) ;
 *  - un désabonnement courriel bloque même le transactionnel ;
 *  - en cas d'erreur technique, un commercial ne part PAS (à l'inverse du
 *    plafond de fréquence : un message de trop est un désagrément, un envoi
 *    sans consentement est une infraction) ;
 *  - les presets de sollicitation ne sont jamais activés d'office.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const envois: Array<{ to: string }> = [];
vi.mock('../../server/lib/mailer', () => ({
  isMailerConfigured: () => true,
  adresseInjoignable: async () => false,
  sendEmail: vi.fn(async (p: any) => { envois.push({ to: p?.to }); return { sent: true, messageId: 'x' }; }),
}));
vi.mock('../../server/routes/emails', () => ({
  // Nom et adresse : sans eux, un courriel commercial est sauté avant même
  // le consentement (LCAP, audit V2 L8) — ce n'est pas ce qu'on teste ici.
  getCompanySettings: async () => ({ company_name: 'Entreprise test', company_address: '120 rue Principale, Granby, QC' }),
  // `bouton` est le 3e argument depuis que les automatisations en portent un.
  buildEmailLayout: (_c: unknown, b: string) => b,
  senderFor: () => ({ from: 'test@lume.test' }),
  // `senderForOrg` depuis que les relances honorent le domaine vérifié de
  // l'entreprise. Il lit la base, d'où la version simulée ici.
  senderForOrg: async () => ({ from: 'test@lume.test' }),
  // Sans cette entrée, l'import du module réel échoue et AUCUN courriel ne
  // part — le test accusait le consentement alors que la cause était ici.
  langueEntreprise: () => 'fr',
}));
vi.mock('../../server/lib/notificationHelpers', () => ({
  isEmailUnsubscribed: async () => false,
  getUnsubscribeUrl: async () => 'https://lume.test/unsub',
}));

const { executeSendEmail } = await import('../../server/lib/actions/index');

/** Faux Supabase : rend le client demandé, ou une erreur si `erreur` est vrai. */
function faketSupabase(client: Record<string, unknown> | null, opts: { erreur?: boolean } = {}) {
  const chaine: any = {
    select: () => chaine,
    eq: () => chaine,
    is: () => chaine,
    limit: () => chaine,
    // Le plafond de fréquence compte les envois récents (`gte` sur une date)
    // et le bouton d'automatisation lit l'entité : sans ces maillons, le faux
    // client casse la chaîne et le courriel semble bloqué alors que le code
    // réel laisse passer.
    gte: () => chaine,
    order: () => chaine,
    not: () => chaine,
    maybeSingle: async () => (opts.erreur ? { data: null, error: { message: 'panne' } } : { data: client, error: null }),
    insert: async () => ({ error: null }),
  };
  return { from: () => chaine } as any;
}

const contexte = (client: Record<string, unknown> | null, commercial: boolean, opts: { erreur?: boolean } = {}) => ({
  supabase: faketSupabase(client, opts),
  orgId: 'org-1',
  entityType: 'job',
  entityId: 'job-1',
  twilio: null,
  baseUrl: 'http://test',
  commercial,
});

const config = { subject: 'Bonjour', body: 'Un message' };
const vars = { client_email: 'alice@exemple.test' };

/**
 * Le contexte tel que le MOTEUR le pose pour un envoi IMMÉDIAT, drapeau
 * `auto_desabonnement_canal` éteint : `marketing` (le type de l'envoi) est
 * renseigné, `commercial` ne l'est pas.
 */
function contexteImmediat(client: Record<string, unknown> | null, marketing: boolean, dejaEnvoyes = 0) {
  const base = faketSupabase(client);
  const compte: any = { select: () => compte, eq: () => compte, is: () => compte, gte: () => compte, then: (res: any) => Promise.resolve({ count: dejaEnvoyes, data: null, error: null }).then(res) };
  return {
    supabase: { from: (table: string) => (table === 'activity_log' ? { ...compte, insert: async () => ({ error: null }) } : base.from(table)), rpc: async () => ({ error: null }) } as any,
    orgId: 'org-1', entityType: 'client', entityId: 'client-1', twilio: null, baseUrl: 'http://test', marketing,
  };
}
const SANS_CONSENTEMENT = { id: 'client-1', email_consent_at: null, sms_consent_at: null, email_opt_out_at: null };
const AVEC_CONSENTEMENT = { id: 'client-1', email_consent_at: '2026-01-01', sms_consent_at: null, email_opt_out_at: null };

beforeEach(() => { envois.length = 0; });

describe('message COMMERCIAL', () => {
  it('part quand le client a consenti au courriel', async () => {
    const r = await executeSendEmail(config as any, vars, contexte({ email_consent_at: '2026-01-01', sms_consent_at: null, email_opt_out_at: null }, true) as any);
    expect(r.success).toBe(true);
    expect(envois).toHaveLength(1);
  });

  it('NE PART PAS sans consentement enregistré', async () => {
    const r = await executeSendEmail(config as any, vars, contexte({ email_consent_at: null, sms_consent_at: null, email_opt_out_at: null }, true) as any);
    // Launch M1 : une impossibilité est un SAUT (le parcours continue), jamais un envoi.
    expect((r.data as any)?.saute).toMatch(/[Cc]onsentement/);
    expect((r.data as any)?.saute_code).toBe('sans_consentement');
    expect(envois).toHaveLength(0);
  });

  it('NE PART PAS vers un destinataire inconnu du carnet de clients', async () => {
    const r = await executeSendEmail(config as any, vars, contexte(null, true) as any);
    // Launch M1 : une impossibilité est un SAUT (le parcours continue), jamais un envoi.
    expect((r.data as any)?.saute).toMatch(/inconnu du carnet/);
    expect(envois).toHaveLength(0);
  });

  it('NE PART PAS si le consentement est invérifiable (erreur technique)', async () => {
    const r = await executeSendEmail(config as any, vars, contexte(null, true, { erreur: true }) as any);
    // Une lecture ratée reste un VRAI échec (repris plus tard), jamais un saut.
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/erreur technique/i);
    expect(r.error).not.toMatch(/consent/i); // sinon le moteur la jugerait définitive
    expect(envois).toHaveLength(0);
  });
});

describe('[G-015] envoi MARKETING immédiat, drapeau éteint (le moteur ne pose que `marketing`)', () => {
  it('[G-015] sans base légale : NE PART PAS — sauté avec le motif « consentement »', async () => {
    const r = await executeSendEmail(config as any, vars, contexteImmediat(SANS_CONSENTEMENT, true) as any);
    expect((r.data as any)?.saute_code).toBe('sans_consentement');
    expect(r.success).toBe(true); // un saut : le parcours continue
    expect(envois).toHaveLength(0);
  });

  it('[G-015] avec consentement exprès : part', async () => {
    const r = await executeSendEmail(config as any, vars, contexteImmediat(AVEC_CONSENTEMENT, true) as any);
    expect(r.success).toBe(true);
    expect(envois).toHaveLength(1);
  });

  it('[G-015] plafond appliqué : le client déjà à 3 messages commerciaux en 24 h ne reçoit pas le 4e', async () => {
    const r = await executeSendEmail(config as any, vars, contexteImmediat(AVEC_CONSENTEMENT, true, 3) as any);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Frequency cap/);
    expect(envois).toHaveLength(0);
  });

  it('[G-015] un envoi TRANSACTIONNEL immédiat ne change pas : il part sans consentement, sans plafond', async () => {
    const r = await executeSendEmail(config as any, vars, contexteImmediat(SANS_CONSENTEMENT, false, 3) as any);
    expect(r.success).toBe(true);
    expect(envois).toHaveLength(1);
  });
});

describe('message TRANSACTIONNEL', () => {
  it('part sans consentement : il répond à une demande du client', async () => {
    const r = await executeSendEmail(config as any, vars, contexte({ email_consent_at: null, sms_consent_at: null, email_opt_out_at: null }, false) as any);
    expect(r.success).toBe(true);
    expect(envois).toHaveLength(1);
  });

  it('part même si le client est inconnu du carnet', async () => {
    const r = await executeSendEmail(config as any, vars, contexte(null, false) as any);
    expect(r.success).toBe(true);
  });

  it('NE PART PAS si le client s\'est désabonné : un retrait vaut pour tout', async () => {
    const r = await executeSendEmail(config as any, vars, contexte({ email_consent_at: '2026-01-01', sms_consent_at: null, email_opt_out_at: '2026-06-01' }, false) as any);
    // Launch M1 : une impossibilité est un SAUT (le parcours continue), jamais un envoi.
    expect((r.data as any)?.saute).toMatch(/désabonn/i);
    expect((r.data as any)?.saute_code).toBe('desabonne');
    expect(envois).toHaveLength(0);
  });
});

describe('presets de sollicitation', () => {
  it('les cinq presets de sollicitation sont recensés', async () => {
    const { PRESETS_SOLLICITATION } = await import('../../server/lib/automationPresetSeeder');
    for (const k of ['cross_sell_30d', 'seasonal_reminder_6m', 'lost_lead_reengagement', 'reengagement_90d', 'client_anniversary']) {
      expect(PRESETS_SOLLICITATION.has(k), `${k} doit être traité comme une sollicitation`).toBe(true);
    }
  });

  it('une relance de devis ou de facture n\'en est PAS une : le client a engagé l\'échange', async () => {
    const { PRESETS_SOLLICITATION } = await import('../../server/lib/automationPresetSeeder');
    for (const k of ['quote_followup_3d', 'invoice_sent_reminder_7d', 'job_reminder_1d', 'appointment_confirmation', 'payment_confirmation']) {
      expect(PRESETS_SOLLICITATION.has(k), `${k} est transactionnel, il doit rester actif`).toBe(false);
    }
  });

  it('chaque preset de sollicitation existe vraiment dans le catalogue', async () => {
    const { PRESETS_SOLLICITATION } = await import('../../server/lib/automationPresetSeeder');
    const { AUTOMATION_PRESETS } = await import('../../server/lib/automationPresets.data');
    const connus = new Set(AUTOMATION_PRESETS.map((p: { preset_key: string }) => p.preset_key));
    for (const k of PRESETS_SOLLICITATION) {
      expect(connus.has(k), `${k} n'existe pas dans automationPresets.data.ts`).toBe(true);
    }
  });
});
