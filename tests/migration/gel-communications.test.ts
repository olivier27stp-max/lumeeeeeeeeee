// « Activer le compte » : après un import final, aucun courriel, SMS ni automatisation ne part
// vers un client du bureau tant que l'admin n'a pas activé le compte. La garde vit dans les
// fonctions d'envoi (au destinataire), pas dans les appelants — un client importé ne peut être
// contacté par aucun chemin. Le personnel n'est jamais bloqué.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cacheDelete } from '../../server/lib/cache';
const viderCaches = () => { cacheDelete('gel-communications:orgs'); cacheDelete('gel-communications:contacts'); };
import { destinataireGele, FEATURE_GEL } from '../../server/lib/migration/gel-communications';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Faux client Supabase : org_features gelées + clients du bureau, chaînage minimal. */
function fauxAdmin(gelees: string[], clients: Array<{ org_id: string; email: string | null; phone: string | null }>) {
  const chaine = (rows: any[]) => {
    const q: any = { rows };
    for (const m of ['select', 'eq', 'is', 'in', 'limit', 'or', 'ilike', 'range', 'not']) q[m] = vi.fn(() => q);
    q.then = (res: any) => Promise.resolve({ data: rows, error: null }).then(res);
    return q;
  };
  return {
    from: vi.fn((table: string) => {
      if (table === 'org_features') return chaine(gelees.map((org_id) => ({ org_id, feature: FEATURE_GEL, enabled: true })));
      if (table === 'clients') return chaine(clients);
      throw new Error(`table inattendue ${table}`);
    }),
  } as any;
}

describe('destinataireGele', () => {
  it('sans bureau gelé : rien n\'est bloqué et la table clients n\'est même pas lue', async () => {
    viderCaches();
    const admin = fauxAdmin([], []);
    expect(await destinataireGele(admin, { email: 'a@b.ca' })).toBeNull();
    expect(admin.from).toHaveBeenCalledTimes(1); // org_features seulement
  });
  it('client d\'un bureau gelé : bloqué par courriel (insensible à la casse) et par téléphone (10 derniers chiffres)', async () => {
    viderCaches();
    const admin = fauxAdmin(['org-gelee'], [{ org_id: 'org-gelee', email: 'Denise@Ex.ca', phone: '(819) 555-0101' }]);
    expect(await destinataireGele(admin, { email: 'denise@ex.ca' })).toBe('org-gelee');
    expect(await destinataireGele(admin, { phone: '+1 819-555-0101' })).toBe('org-gelee');
  });
  it('un destinataire qui n\'est pas client du bureau gelé (ex. le personnel) passe', async () => {
    viderCaches();
    const admin = fauxAdmin(['org-gelee'], [{ org_id: 'org-gelee', email: 'client@ex.ca', phone: null }]);
    expect(await destinataireGele(admin, { email: 'employe@vision-lavage.ca' })).toBeNull();
  });
  it('un bureau connu et NON gelé n\'est jamais vérifié plus loin', async () => {
    viderCaches();
    const admin = fauxAdmin(['autre-org'], [{ org_id: 'autre-org', email: 'x@y.ca', phone: null }]);
    expect(await destinataireGele(admin, { email: 'x@y.ca' }, 'org-libre')).toBeNull();
  });
});

describe('la garde est branchée sur TOUS les canaux sortants vers les clients', () => {
  it('courriel central, SMS central, SMS manuel, agent, automatisations', () => {
    for (const f of ['server/lib/mailer.ts', 'server/lib/notificationHelpers.ts', 'server/routes/communications.ts', 'server/lib/agent/tools-etendus.ts', 'server/lib/actions/index.ts']) {
      expect(read(f), f).toContain('destinataireGele');
    }
  });
  it('tout envoi Twilio vers un client passe par la garde (le MFA du personnel est le seul hors champ)', () => {
    const fichiers = ['server/routes/communications.ts', 'server/lib/notificationHelpers.ts', 'server/lib/agent/tools-etendus.ts', 'server/lib/actions/index.ts'];
    for (const f of fichiers) {
      const src = read(f);
      const envois = src.split('messages.create(').length - 1;
      expect(envois, f).toBeGreaterThan(0);
      expect(src.indexOf('destinataireGele'), f).toBeLessThan(src.indexOf('messages.create('));
    }
  });
  it('l\'import final gèle le bureau, et seule la route « activer le compte » lève le gel', () => {
    const admin = read('server/routes/migration-admin.ts');
    const importFinal = admin.slice(admin.indexOf("'/migration-admin/migrations/:id/final-import'"), admin.indexOf("'/migration-admin/migrations/:id/rollback'"));
    expect(importFinal).toContain('gelerCommunications');
    expect(admin).toContain("'/migration-admin/migrations/:id/activate-account'");
    expect(admin.split('activerCommunications(').length - 1).toBe(1);
    expect(admin.slice(admin.indexOf("'/migration-admin/migrations/:id/activate-account'"))).toContain('requirePlatformAdmin');
  });
});
