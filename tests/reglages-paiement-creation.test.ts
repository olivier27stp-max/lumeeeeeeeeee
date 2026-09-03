/**
 * LA LIGNE DE RÉGLAGES QUI NE POUVAIT PLUS NAÎTRE.
 *
 * Toute page Revenus / Paiements commence par s'assurer que l'org possède
 * sa ligne dans `payment_provider_settings`. Cette création empruntait le
 * client de L'UTILISATEUR.
 *
 * Or le durcissement du 2026-07-30 a révoqué insert/update sur cette table
 * pour `authenticated`, et la RPC `ensure_payment_settings_row()` — SECURITY
 * DEFINER, écrite pour ce cas précis — a perdu son droit d'exécution.
 * Les deux chemins fermés en même temps : 42501, puis 403.
 *
 * Mesuré le 2026-09-03 : 45 des 46 orgs de production n'avaient pas de
 * ligne. Trois routes mortes — payouts/summary, payouts/list,
 * providers/status.
 *
 * Ces tests figent la règle : un refus de PRIVILÈGE (42501) doit basculer
 * en service_role, jamais remonter en erreur à l'utilisateur.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const service = { from: vi.fn() };
vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => service }));

const { ensurePaymentSettingsRow, isPermissionDeniedError, isSchemaNotReadyError } =
  await import('../server/lib/payments');

const REFUS = { code: '42501', message: 'permission denied for table payment_provider_settings' };
const ORG = '11111111-2222-3333-4444-555555555555';

function clientQui(rpcErr: any, upsertErr: any = null) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertErr });
  return {
    rpc: vi.fn().mockResolvedValue({ error: rpcErr }),
    from: vi.fn(() => ({ upsert })),
    _upsert: upsert,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  service.from = vi.fn(() => ({ upsert: vi.fn().mockResolvedValue({ error: null }) }));
});

describe('reconnaître un refus de privilège', () => {
  it('42501 est un refus de privilège', () => {
    // insufficient_privilege — un GRANT manque.
    expect(isPermissionDeniedError(REFUS)).toBe(true);
  });

  it('42501 n est PAS un schéma absent', () => {
    // La confusion des deux ferait avaler l'erreur en silence.
    expect(isSchemaNotReadyError(REFUS)).toBe(false);
  });

  it('une table absente reste un schéma absent', () => {
    expect(isSchemaNotReadyError({ code: '42P01' })).toBe(true);
    expect(isPermissionDeniedError({ code: '42P01' })).toBe(false);
  });

  it('une erreur quelconque n est ni l un ni l autre', () => {
    expect(isPermissionDeniedError({ code: '23505' })).toBe(false);
  });
});

describe('la création de la ligne de réglages', () => {
  it('la RPC suffit quand elle est autorisée : aucune écriture directe', async () => {
    const c = clientQui(null);
    await ensurePaymentSettingsRow(c as any, ORG);
    expect(c.rpc).toHaveBeenCalledWith('ensure_payment_settings_row', { p_org: ORG });
    expect(c.from).not.toHaveBeenCalled();
    expect(service.from).not.toHaveBeenCalled();
  });

  it('LE BUG : RPC refusée (42501) → on bascule en service_role', async () => {
    // Le cœur du correctif. Avant, on réessayait avec le client de
    // l'utilisateur — qui n'a pas le droit non plus — d'où le 403.
    const c = clientQui(REFUS);
    await ensurePaymentSettingsRow(c as any, ORG);
    expect(service.from).toHaveBeenCalledWith('payment_provider_settings');
    expect(c._upsert).not.toHaveBeenCalled();
  });

  it('la bascule n avale pas l erreur : la ligne est bien écrite', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    service.from = vi.fn(() => ({ upsert }));
    await ensurePaymentSettingsRow(clientQui(REFUS) as any, ORG);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({ org_id: ORG, default_provider: 'none' });
  });

  it('RPC absente (42883) → on sort sans écrire, comportement d origine', async () => {
    // `isSchemaNotReadyError` couvre 42883 : une fonction absente signifie
    // un schéma pas encore migré, et la fonction sort AVANT tout repli.
    // Comportement antérieur au correctif, laissé intact.
    const c = clientQui({ code: '42883' });
    await ensurePaymentSettingsRow(c as any, ORG);
    expect(c.from).not.toHaveBeenCalled();
    expect(service.from).not.toHaveBeenCalled();
  });

  it('une table absente reste silencieuse (schéma pas encore migré)', async () => {
    await expect(
      ensurePaymentSettingsRow(clientQui({ code: '42P01' }) as any, ORG),
    ).resolves.toBeUndefined();
  });

  it('une VRAIE erreur de la RPC remonte — on ne masque rien', async () => {
    // Le correctif ne doit pas transformer toute panne en succès :
    // seul 42501 déclenche la bascule, le reste passe par l'upsert normal
    // et remonte son erreur.
    const c = clientQui({ code: '40001' }, { code: '23505', message: 'doublon' });
    await expect(ensurePaymentSettingsRow(c as any, ORG)).rejects.toMatchObject({ code: '23505' });
  });

  it('un refus de privilège sur l upsert bascule aussi en service_role', async () => {
    // Second chemin : la RPC échoue pour une raison quelconque, l'upsert
    // utilisateur se heurte au GRANT manquant → service_role.
    const upsert = vi.fn().mockResolvedValue({ error: null });
    service.from = vi.fn(() => ({ upsert }));
    await ensurePaymentSettingsRow(clientQui({ code: '40001' }, REFUS) as any, ORG);
    expect(upsert).toHaveBeenCalled();
  });
});
