/**
 * Créer ou renvoyer un lien de paiement passe par la page Rôles : le préfixe
 * public /api/payment-requests/ ne couvre que la consultation (GET) — audit 2026-09-30.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('préfixe public des demandes de paiement', () => {
  it('POST create / resend ont une clé ; le préfixe public est limité à GET', () => {
    const src = readFileSync(resolve(__dirname, '..', 'server', 'lib', 'route-permissions.ts'), 'utf8');
    expect(src).toContain("'POST /api/payment-requests/create': 'financial.view_payments'");
    expect(src).toContain("'POST /api/payment-requests/resend': 'financial.view_payments'");
    expect(src).toContain("if (prefix === '/api/payment-requests/' && req.method.toUpperCase() !== 'GET') continue;");
  });
  it('un GET de statut reste public (aucune vérification de rôle)', async () => {
    const { rbacMiddleware } = await import('../server/lib/route-permissions');
    const next = vi.fn();
    await rbacMiddleware()({ path: '/api/payment-requests/abc/status', method: 'GET', headers: {} } as any, {} as any, next);
    expect(next).toHaveBeenCalled();
  });
});
