/**
 * Indices d'outils : le code fait la première recherche d'outils différés
 * (français, joual, anglais) et la nomme dans le bloc variable avec le motif
 * exact pour tool_search_tool_regex. Déterministe, 0 token d'API.
 */
import { describe, it, expect } from 'vitest';
import { motsCles, outilsSuggeres, indiceOutils } from '../server/lib/lumi/indices-outils';
import { OUTILS_DE_BASE } from '../server/lib/lumi/orchestrateur';

describe('indices d outils', () => {
  it('traduit le vocabulaire québécois vers les mots des outils', () => {
    const m = motsCles('Pointe-moi, je pars en pause');
    expect(m).toContain('punch');
    expect(m).toContain('break');
  });
  it('propose le bon outil différé pour des demandes que le modèle ratait', () => {
    const cas: Array<[string, string]> = [
      ['Pointe-moi, je commence ma journée.', 'punch_in'],
      ['Je pars en pause.', 'start_break'],
      ['Je reviens de pause.', 'end_break'],
      ['Crée une équipe « Équipe Nord ».', 'create_team'],
      ['C’est quoi mes taxes configurées ?', 'get_tax_config'],
      ['Ajoute une taxe personnalisée « Écofrais » à 2 %.', 'create_tax_config'],
      ['Crée une étiquette de job « Urgent » en rouge.', 'create_job_tag'],
      ['Marque la conversation texto avec Jean-Pierre Gagnon comme lue.', 'mark_conversation_read'],
      ['Passe mes périodes de paie aux deux semaines.', 'update_payroll_settings'],
      ['Remets la facture INV-000006 en brouillon.', 'revert_invoice_to_draft'],
      ['Montre-moi mon pipeline de ventes, les cartes par étape.', 'list_deals'],
      ['Quelles invitations d’équipe sont encore en attente ?', 'list_invitations'],
    ];
    for (const [q, outil] of cas) expect(outilsSuggeres(q), q).toContain(outil);
  });
  it('ne suggère jamais un outil déjà chargé, et au plus 6 noms', () => {
    for (const q of ['Combien de clients j’ai ?', 'Pointe-moi', 'Crée une facture pour Gagnon']) {
      const s = outilsSuggeres(q);
      expect(s.length).toBeLessThanOrEqual(6);
      for (const n of s) expect(OUTILS_DE_BASE.has(n), n).toBe(false);
    }
  });
  it('la ligne du bloc variable porte le motif exact, ou rien quand rien ne ressemble', () => {
    const l = indiceOutils('Pointe-moi, je commence ma journée.', 'fr');
    expect(l).toMatch(/tool_search_tool_regex, motif `\^\((punch_in|[a-z_|]+)\)\$`/);
    expect(l).toContain('punch_in');
    expect(indiceOutils('Bonjour', 'fr')).toBeNull();
    expect(indiceOutils('Clock me in', 'en')).toMatch(/^Deferred tools/);
  });
});
