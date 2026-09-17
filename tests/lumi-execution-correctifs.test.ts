/**
 * Correctifs trouvés par la batterie d'EXÉCUTION réelle des outils
 * (scripts/qa/executer-outils-staging.mts, 2026-09-17). Chacun a cassé une
 * fois ; ces gardes statiques empêchent le retour en arrière.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STATUT_LEAD, cleSouvenir, traduireStatut } from '../server/lib/agent/tools-etendus';

const lu = (p: string) => readFileSync(resolve(__dirname, '..', ...p.split('/')), 'utf8');

describe('correctifs de la batterie d exécution', () => {
  it('search_leads découpe la recherche en mots (« Julie Fortin » trouve la fiche)', () => {
    const src = lu('server/lib/agent/tools.ts');
    const debut = src.indexOf("name: 'search_leads'");
    const bloc = src.slice(debut, debut + 3000);
    expect(bloc).toContain("const mots = t.replace(/[%,()]/g, ' ').split(/\\s+/)");
    expect(bloc).toContain('for (const mot of mots) q = q.or(');
  });
  it('add_note écrit dans l onglet Notes (specific_notes), là où list/update/delete lisent', () => {
    const src = lu('server/lib/agent/tools-etendus.ts');
    const debut = src.indexOf("name: 'add_note'");
    const bloc = src.slice(debut, debut + 2500);
    expect(bloc).toContain(".from('specific_notes')");
    expect(bloc).not.toContain(".from('activity_notes')");
    expect(bloc).toContain('created_by: ctx.userId');
  });
  it('remember_this et forget_note normalisent la clé de la même façon', () => {
    expect(cleSouvenir('Exec_Test Clé')).toBe('exec-test-clé');
    const src = lu('server/lib/agent/tools-etendus.ts');
    expect((src.match(/cleSouvenir\(champRequis\(args\.key/g) ?? []).length).toBe(2);
  });
  it('le moteur des factures récurrentes signe la facture (created_by NOT NULL)', () => {
    const src = lu('server/lib/recurringInvoicesEngine.ts');
    expect(src).toContain('created_by: auteur,');
    expect(src).toContain("find((m: any) => m.role === 'owner')");
  });
  it('get_job expose les visites avec leur identifiant (create_invoice_for_visit)', () => {
    const src = lu('server/lib/agent/tools.ts');
    expect(src).toContain('visits: (visites || []).map((v: any) => ({ visit_id: v.id');
  });
  it('les étapes canoniques du pipeline ont un libellé français', () => {
    expect(traduireStatut('new_prospect', STATUT_LEAD)).toBe('nouveau prospect');
    expect(traduireStatut('quote_sent', STATUT_LEAD)).toBe('devis envoyé');
    expect(traduireStatut('no_response', STATUT_LEAD)).toBe('sans réponse');
  });
});
