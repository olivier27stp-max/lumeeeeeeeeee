/**
 * Règles de coût strictes (audit Lumi B) : valeurs par défaut, réglage par
 * variable d'environnement, bornes, et branchement réel dans le code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { reglesCout, messagePlafondConversation } from '../server/lib/lumi/regles-cout';

const lu = (p: string) => readFileSync(p, 'utf8');

describe('reglesCout', () => {
  it('valeurs par défaut strictes', () => {
    expect(reglesCout({})).toEqual({
      max_tokens_sortie: 2048, plafond_cout_tour_cents: 6, plafond_cout_conversation_cents: 40,
      part_budget_par_jour: 0.15, effort_defaut: 'low', plafond_public_par_jour: 300,
    });
  });
  it('se règlent par l environnement, dans des bornes (jamais 0, jamais l infini)', () => {
    const r = reglesCout({ LUMI_MAX_TOKENS_SORTIE: '100000', LUMI_PLAFOND_TOUR_CENTS: '0', LUMI_PLAFOND_CONVERSATION_CENTS: '12.5', LUMI_PART_BUDGET_PAR_JOUR: '5', LUMI_EFFORT: 'medium', LUMI_PLAFOND_PUBLIC_PAR_JOUR: 'abc' });
    expect(r.max_tokens_sortie).toBe(8192);
    expect(r.plafond_cout_tour_cents).toBe(1);
    expect(r.plafond_cout_conversation_cents).toBe(12.5);
    expect(r.part_budget_par_jour).toBe(1);
    expect(r.effort_defaut).toBe('medium');
    expect(r.plafond_public_par_jour).toBe(300);
    expect(reglesCout({ LUMI_EFFORT: 'high' }).effort_defaut).toBe('low');
  });
  it('gabarit de plafond de conversation en fr et en', () => {
    expect(messagePlafondConversation('fr')).toMatch(/nouvelle conversation/);
    expect(messagePlafondConversation('en')).toMatch(/new conversation/);
  });
});

describe('les règles sont branchées dans le code (pas seulement écrites)', () => {
  it('orchestrateur : max_tokens et effort viennent des règles ; le plafond par tour arrête la boucle', () => {
    const s = lu('server/lib/lumi/orchestrateur.ts');
    expect(s).toContain('const MAX_TOKENS = reglesCout().max_tokens_sortie;');
    expect(s).toContain("opts.reglages?.effort ?? reglesCout().effort_defaut");
    expect(s).toContain('if (coutTotal >= reglesCout().plafond_cout_tour_cents)');
    expect(s).toContain("message: 'plafond_tour'");
  });
  it('route : plafond de conversation servi en gabarit et escalade sur plafond_tour', () => {
    const s = lu('server/routes/lumi.ts');
    expect(s).toContain('depense >= reglesCout().plafond_cout_conversation_cents');
    expect(s).toContain("action: 'plafond_conversation'");
    expect(s).toContain("erreurModele === 'plafond_tour'");
  });
  it('budget : garde-fou journalier → palier restreint', () => {
    const s = lu('server/lib/lumi/budget.ts');
    expect(s).toContain('reglesCout().part_budget_par_jour');
    expect(s).toContain("depenseJour >= plafondJour ? 'restreint'");
  });
  it('chat public : plafond global par jour', () => {
    const s = lu('server/routes/sales-chat.ts');
    expect(s).toContain('reponsesPubliquesAujourdhui(getServiceClient())) >= reglesCout().plafond_public_par_jour');
  });
  it('portail de migration : même plafond par entreprise et par jour que le support (faille fermée)', () => {
    const s = lu('server/lib/support/portail.ts');
    expect(s).toContain('reponsesModeleAujourdhui(admin, migration.org_id)) >= PLAFOND_MODELE_PAR_JOUR');
    expect(s).toContain("if (isSupportIAConfigured() && !auPlafond)");
  });
  it('B9 : une proposition expire après 15 minutes', () => {
    const s = lu('server/routes/lumi.ts');
    expect(s).toContain('export const EXPIRATION_PROPOSITION_MS = 15 * 60_000;');
    expect(s).toContain("code: 'proposition_expiree'");
  });
});
