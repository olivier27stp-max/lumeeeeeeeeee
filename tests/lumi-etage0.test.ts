/**
 * Étage 0 de la couche zéro-appel (item 5, AGENTFORCE_GAP.md B3) :
 * - une action d'interface arrive nommée, avec ses paramètres validés ;
 * - Confirmer / Annuler produisent un reçu gabarit, sans modèle ;
 * - les suggestions du widget public ont une réponse fixe, sans Gemini ;
 * - les 4 suggestions de Lumi sont des actions, plus du texte libre.
 * Pur et statique : aucune base, aucun réseau.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { raccourciDepuisAction, detecterRaccourci, rendreRaccourci, IDS_RACCOURCIS } from '../server/lib/lumi/raccourcis';
import { texteRecus } from '../server/lib/lumi/recus';
import { reponseFixePour, REPONSES_FIXES } from '../server/lib/agent/reponsesFixes';

const lu = (p: string) => readFileSync(resolve(__dirname, '..', ...p.split('/')), 'utf8');
const opts = { fr: true, fuseau: 'America/Toronto', prenom: 'Raf', maintenant: new Date('2026-09-13T14:00:00Z') };

describe('raccourciDepuisAction : nommé, validé, jamais deviné', () => {
  it('accepte chaque action connue avec ses paramètres', () => {
    expect(raccourciDepuisAction('revenu-mois')).toMatchObject({ id: 'revenu-mois', tool: 'get_revenue_summary' });
    expect(raccourciDepuisAction('agenda', { periode: 'demain' })).toMatchObject({ id: 'agenda', periode: 'demain' });
    expect(raccourciDepuisAction('agenda')).toMatchObject({ periode: 'aujourdhui' });
    expect(raccourciDepuisAction('top-clients', { limit: 5 })).toMatchObject({ tool: 'get_top_clients', args: { limit: 5 } });
    for (const id of IDS_RACCOURCIS) expect(raccourciDepuisAction(id, id === 'job-numero' ? { numero: '7' } : {}), id).not.toBeNull();
  });
  it('refuse une action ou un paramètre hors liste (null, pas une approximation)', () => {
    expect(raccourciDepuisAction('envoyer-sms')).toBeNull();
    expect(raccourciDepuisAction('agenda', { periode: 'hier' })).toBeNull();
    expect(raccourciDepuisAction('top-clients', { limit: 500 })).toBeNull();
    expect(raccourciDepuisAction('top-clients', { limit: 'beaucoup' })).toBeNull();
  });
  it('le texte libre « meilleurs clients » et « quelles factures sont en retard » tombent aussi sur un raccourci', () => {
    expect(detecterRaccourci('Qui sont mes meilleurs clients ?')?.id).toBe('top-clients');
    expect(detecterRaccourci('Quelles factures sont en retard ?')?.id).toBe('retards');
    expect(detecterRaccourci('Quel est mon chiffre du mois ?')?.id).toBe('revenu-mois');
    expect(detecterRaccourci('mes meilleurs clients à Québec')).toBeNull();
  });
  it('gabarit top-clients', () => {
    const t = rendreRaccourci({ id: 'top-clients', tool: 'get_top_clients', args: {} }, { clients: [{ nom: 'A Inc.', total_cents: 123456, nombre_de_jobs: 3 }, { nom: 'B', total_cents: 5000, nombre_de_jobs: 1 }] }, opts);
    expect(t).toBe('Tes 2 meilleurs clients :\n1. A Inc. · 1 234,56 $ · 3 jobs\n2. B · 50,00 $ · 1 job');
    expect(rendreRaccourci({ id: 'top-clients', tool: 'get_top_clients', args: {} }, { clients: [] }, opts)).toBe('Aucun client avec des revenus pour l’instant.');
  });
});

describe('reçu sans modèle après Confirmer / Annuler', () => {
  it('une phrase par action, au vocabulaire d affichage ; annulation = rien fait', () => {
    const lignes = [
      { recu: { tool_use_id: 'a', ok: true, fiche: { type: 'quote' as const, id: 'q', label: 'Devis Q-0043', href: '/quotes/q', montant_cents: 162690 } }, erreur: null, outil: 'create_quote' },
      { recu: { tool_use_id: 'b', ok: true, fiche: null }, erreur: null, outil: 'assign_job' },
      { recu: { tool_use_id: 'c', ok: false, fiche: null }, erreur: 'Le devis n’est pas accepté.', outil: 'convert_quote_to_job' },
    ];
    expect(texteRecus(lignes, 'confirm', true)).toBe("C'est fait : Devis Q-0043 (1 626,90 $).\nC'est fait : l’assignation.\nLa conversion du devis en job n’a pas fonctionné. Le devis n’est pas accepté.");
    // Un titre nu est nommé par son action : c'est ce que la batterie appelle « confirmer en mots simples ».
    expect(texteRecus([{ recu: { tool_use_id: 't', ok: true, fiche: { type: 'task', id: 't', label: 'Rappeler Marie', href: '/tasks' } }, erreur: null, outil: 'create_task' }], 'confirm', true)).toBe("C'est fait : la tâche « Rappeler Marie ».");
    expect(texteRecus(lignes, 'cancel', true)).toBe('Annulé, rien n’a été fait.');
    expect(texteRecus([lignes[1]], 'confirm', false)).toBe('Done: the assignment.');
    expect(texteRecus(lignes, 'confirm', true)).not.toMatch(/create_quote|assign_job|tool_use/);
  });
  it('la route ne rappelle plus le modèle après une décision : reçu, texte, done, trace étage 0', () => {
    const r = lu('server/routes/lumi.ts');
    const bloc = r.slice(r.indexOf("router.post('/lumi/execute'"), r.indexOf('// ── Mode de confirmation'));
    expect(bloc).not.toContain('executerTourSse(');
    expect(bloc).toContain('texteRecus(lignes, decision');
    expect(bloc).toContain("emettreSse('done', { conversation_id, cost_cents: 0");
    expect(bloc).toContain("origine: 'carte'");
    expect(bloc).toContain('etage: ETAGE.interface');
  });
});

describe('réponses fixes du widget public', () => {
  it('les 3 suggestions du widget ont une réponse fixe, exacte ou normalisée seulement', () => {
    const widget = lu('src/components/marketing/LumiAgent.tsx');
    const suggestions = [...widget.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]);
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    for (const s of suggestions.slice(0, 3)) expect(reponseFixePour(s), s).not.toBeNull();
    expect(reponseFixePour('combien ca coute lume')).not.toBeNull();
    expect(reponseFixePour('Ça coûte combien pour 12 utilisateurs ?')).toBeNull();
    for (const r of REPONSES_FIXES) { expect(r.reponse).toMatch(/démo|Tu fais quoi|métier/); expect(r.reponse).not.toMatch(/essai gratuit/i); }
  });
  it('la route publique répond sans Gemini et trace l étage 0', () => {
    const s = lu('server/routes/sales-chat.ts');
    expect(s.indexOf('reponseFixePour(dernier)')).toBeLessThan(s.indexOf('await repondreSupportIA('));
    expect(s).toContain("return res.json({ reply: fixe.reponse, fixe: fixe.id });");
    expect(s).toContain('etage: 0, action: fixe.id');
  });
});

describe('les suggestions de Lumi sont des actions', () => {
  it('chaque suggestion porte une action connue ; le clic ne passe plus par envoyer(texte) ; repli sur le texte si 422', () => {
    const page = lu('src/pages/Lumi.tsx');
    const actions = [...page.matchAll(/action: '([a-z-]+)'/g)].map((m) => m[1]);
    expect(actions.length).toBe(8);
    for (const a of actions) expect(IDS_RACCOURCIS).toContain(a);
    expect(page).toContain('onClick={() => lancerAction(s)}');
    expect(page).not.toContain("envoyer(s, { origine: 'suggestion' })");
    expect(page).toContain("if (issue.valeur === 'indisponible')");
    const api = lu('src/lib/lumiApi.ts');
    expect(api).toContain("if (res.status === 422) return 'indisponible';");
    const route = lu('server/routes/lumi.ts');
    expect(route).toContain("router.post('/lumi/action', validate(actionSchema)");
    expect(route).toContain("code: 'action_indisponible'");
  });
});
