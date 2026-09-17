/**
 * Un membre est payé à commission OU à l'heure (fiche Équipe). Le moteur de
 * commissions doit respecter ce choix : un membre « à l'heure » ne touche
 * jamais de commission, même avec un plan par défaut dans l'org.
 *
 * Bug réel (Coquin lavage, 2026-09-17) : un admin payé 50 $/h avait 3
 * entrées de commission parce que le moteur ne lisait pas compensation_mode.
 */
import { describe, it, expect, vi } from 'vitest';
import { membrePayeACommission } from '../server/lib/field-sales/commission-engine';

function fauxClient(reponse: { data: any; error: any }) {
  const chaine: any = {};
  for (const m of ['from', 'select', 'eq', 'neq', 'limit']) chaine[m] = vi.fn(() => chaine);
  chaine.maybeSingle = vi.fn(async () => reponse);
  return chaine;
}

describe('membrePayeACommission — le mode de paie de la fiche Équipe fait foi', () => {
  it('« à l’heure » → aucune commission', async () => {
    const c = fauxClient({ data: { compensation_mode: 'hourly' }, error: null });
    expect(await membrePayeACommission(c, 'org', 'u')).toBe(false);
    expect(c.from).toHaveBeenCalledWith('team_members');
    expect(c.neq).toHaveBeenCalledWith('status', 'inactive');
  });

  it('« commission » et « horaire + commission » → commission', async () => {
    expect(await membrePayeACommission(fauxClient({ data: { compensation_mode: 'commission' }, error: null }), 'org', 'u')).toBe(true);
    expect(await membrePayeACommission(fauxClient({ data: { compensation_mode: 'both' }, error: null }), 'org', 'u')).toBe(true);
  });

  it('sans fiche Équipe → on laisse passer (comportement historique)', async () => {
    expect(await membrePayeACommission(fauxClient({ data: null, error: null }), 'org', 'u')).toBe(true);
  });

  it('lecture en échec → on laisse passer et on journalise, jamais de commission perdue en silence', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await membrePayeACommission(fauxClient({ data: null, error: { message: 'boom' } }), 'org', 'u')).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('le moteur applique la garde aux deux chemins', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'server/lib/field-sales/commission-engine.ts'), 'utf8');
  it('projection à la création du job', () => {
    const bloc = src.slice(src.indexOf('export async function projectCommissionForJob'), src.indexOf('export async function voidProjectedCommissionForJob'));
    expect(bloc).toMatch(/membrePayeACommission\(supabase, orgId, repUserId\)[\s\S]*skipped: 'hourly_member'/);
  });
  it('confirmation quand la facture est payée', () => {
    const bloc = src.slice(src.indexOf('export async function generateCommissionsForInvoice'), src.indexOf('export async function handleInvoiceReversal'));
    expect(bloc).toMatch(/membrePayeACommission\(supabase, orgId, repUserId\)[\s\S]*skipped: 'hourly_member'/);
  });
});
