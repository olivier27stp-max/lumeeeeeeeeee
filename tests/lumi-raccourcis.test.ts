/**
 * Raccourcis déterministes (Lumi répond sans le modèle) et purge du contexte.
 * Tout est pur : aucune base, aucun appel réseau.
 */
import { describe, it, expect } from 'vitest';
import { detecterRaccourci, rendreRaccourci, bornesPeriode, minuitLocal, jourLocal, normaliser } from '../server/lib/lumi/raccourcis';
import { purgerVieuxResultats, NOTE_PURGE } from '../server/lib/lumi/orchestrateur';

const MTL = 'America/Toronto';
const opts = { fr: true, fuseau: MTL, prenom: 'Raf', maintenant: new Date('2026-09-11T14:00:00Z') };

describe('détection : strict, le message entier doit être connu', () => {
  it('compte des clients (fr, en, oral)', () => {
    for (const q of ['Combien de clients j’ai ?', 'cb de client jai', 'How many clients do I have?', 'nombre de clients', 'Combien j’ai de clients en tout ?']) {
      expect(detecterRaccourci(q)?.id, q).toBe('clients-total');
    }
  });
  it('agenda : aujourd’hui, demain, cette semaine — avec la période', () => {
    expect(detecterRaccourci('Qu’est-ce que j’ai demain ?')).toMatchObject({ id: 'agenda', periode: 'demain' });
    expect(detecterRaccourci('cb jai de job dmain pis c ou')).toMatchObject({ id: 'agenda', periode: 'demain' });
    expect(detecterRaccourci('mes jobs aujourd’hui')).toMatchObject({ id: 'agenda', periode: 'aujourdhui' });
    expect(detecterRaccourci('J’ai combien de jobs cette semaine ?')).toMatchObject({ id: 'agenda', periode: 'semaine' });
    expect(detecterRaccourci('What do I have tomorrow?')).toMatchObject({ id: 'agenda', periode: 'demain' });
  });
  it('revenu du mois, retards, briefing', () => {
    expect(detecterRaccourci('Combien j’ai encaissé ce mois-ci ?')?.id).toBe('revenu-mois');
    expect(detecterRaccourci('Combien j’ai facturé depuis le début du mois ?')?.id).toBe('revenu-mois');
    expect(detecterRaccourci('Qui me doit de l’argent ?')?.id).toBe('retards');
    expect(detecterRaccourci('Combien de factures en retard j’ai en ce moment ?')?.id).toBe('retards');
    expect(detecterRaccourci('mon briefing')?.id).toBe('briefing');
    expect(detecterRaccourci('quoi de neuf ?')?.id).toBe('briefing');
  });
  it('tombe (null) dès qu’un mot inconnu ou une précision apparaît : le modèle reprend', () => {
    for (const q of [
      'Combien de clients à Saint-Bruno ?', 'combien de nouveaux clients ce mois-ci',
      'Qu’est-ce que j’ai demain chez Ginette ?', 'qu’est-ce que j’avais hier',
      'Combien j’ai encaissé le mois dernier ?', 'combien j’ai encaissé cette année',
      'Relance les factures en retard', 'Envoie la facture.',
      'Robert de Saint-Bruno, je veux une soumission', 'Crée un job demain chez Luc',
      '?', '',
    ]) expect(detecterRaccourci(q), q).toBeNull();
  });
  it('normaliser : accents, apostrophes et ponctuation disparaissent', () => {
    expect(normaliser("Qu'est-ce que j’ai demain ?")).toEqual(['qu', 'est', 'ce', 'que', 'j', 'ai', 'demain']);
  });
});

describe('dates dans le fuseau de l’entreprise', () => {
  it('minuit à Montréal = 04:00 UTC en septembre ; « demain » vu de 23 h locale', () => {
    expect(minuitLocal('2026-09-12', MTL)).toBe('2026-09-12T04:00:00.000Z');
    // 11 sept. 23 h à Montréal = 12 sept. 03:00 UTC : « demain » doit rester le 12.
    expect(jourLocal(MTL, new Date('2026-09-12T03:00:00Z'), 1)).toBe('2026-09-12');
    const b = bornesPeriode('demain', MTL, new Date('2026-09-12T03:00:00Z'));
    expect(b.start_date).toBe('2026-09-12T04:00:00.000Z');
    expect(b.end_date).toBe('2026-09-13T03:59:59.999Z');
    expect(b.jours).toEqual(['2026-09-12']);
  });
  it('la semaine couvre 7 jours', () => {
    const b = bornesPeriode('semaine', MTL, opts.maintenant);
    expect(b.jours).toHaveLength(7);
    expect(b.jours[0]).toBe('2026-09-11');
  });
});

describe('gabarits (à partir du résultat brut de l’outil)', () => {
  it('clients', () => {
    expect(rendreRaccourci({ id: 'clients-total', tool: 'search_clients', args: {} }, { total_matching: 19 }, opts)).toBe('Tu as 19 clients.');
    expect(rendreRaccourci({ id: 'clients-total', tool: 'search_clients', args: {} }, { total_matching: 1 }, { ...opts, fr: false })).toBe('You have 1 client.');
  });
  it('agenda vide et agenda avec visites (heure locale, client, adresse)', () => {
    const r = { id: 'agenda' as const, tool: 'query_schedule', args: {}, periode: 'demain' as const };
    expect(rendreRaccourci(r, { count: 0, events: [] }, opts)).toBe('Rien de prévu demain : le calendrier est libre.');
    const texte = rendreRaccourci(r, { count: 1, events: [{ start_at: '2026-09-12T13:00:00Z', client_name: 'Luc Lavoie', job_title: 'Garde-gouttières', address: '12 rue des Pins' }] }, opts);
    expect(texte).toContain('1 visite demain');
    expect(texte).toContain('9 h · Luc Lavoie · Garde-gouttières — 12 rue des Pins');
  });
  it('revenu : encaissé, facturé, objectif', () => {
    const t = rendreRaccourci({ id: 'revenu-mois', tool: 'get_revenue_summary', args: {} }, { revenue_cents: 0, invoiced_cents: 162690, goal_cents: 500000, goal_progress_pct: 0 }, opts);
    expect(t).toBe('Encaissé ce mois-ci : 0,00 $. Facturé : 1 626,90 $. Objectif du mois : 5 000,00 $ (0 %).');
  });
  it('retards : total, tri par ancienneté, offre de relance', () => {
    const t = rendreRaccourci({ id: 'retards', tool: 'get_overdue_payments', args: {} }, {
      count: 2, sum_balance_cents: 35000,
      overdue: [{ invoice_number: 'F-101', client_name: 'A Inc.', balance_cents: 10000, days_overdue: 3 }, { invoice_number: 'F-099', client_name: 'B Ltée', balance_cents: 25000, days_overdue: 40 }],
    }, opts);
    expect(t.split('\n')[0]).toBe('2 factures en retard, 350,00 $ au total :');
    expect(t.split('\n')[1]).toBe('• F-099 · B Ltée · 250,00 $ · 40 jours');
    expect(t).toContain('relance-les');
    expect(rendreRaccourci({ id: 'retards', tool: 'get_overdue_payments', args: {} }, { count: 0, overdue: [] }, opts)).toBe('Aucune facture en retard. Tout le monde est à jour.');
  });
  it('briefing : composé par composerBriefing, ou « rien à signaler »', () => {
    const vide = { date: '2026-09-11', overdue_invoices: { total_matching: 0, total_cents: 0, worst: [] }, todays_visits: { total_matching: 0, visits: [] }, tasks_due: { total_matching: 0, tasks: [] }, new_requests_48h: { total_matching: 0, requests: [] }, unread_sms: { total_matching: 0, conversations: [] } };
    expect(rendreRaccourci({ id: 'briefing', tool: 'get_morning_briefing', args: {} }, vide, opts)).toMatch(/^Rien à signaler/);
    const plein = { ...vide, overdue_invoices: { total_matching: 1, total_cents: 12000, worst: [{ client: 'B Ltée', balance_cents: 12000, due_date: '2026-09-01' }] } };
    expect(rendreRaccourci({ id: 'briefing', tool: 'get_morning_briefing', args: {} }, plein, opts)).toContain('Bonjour Raf. Rien au calendrier aujourd’hui. 1 facture en retard pour 120,00 $');
  });
});

describe('purge des vieux résultats d’outils', () => {
  const gros = JSON.stringify({ jobs: Array.from({ length: 200 }, (_, i) => ({ id: `job-${i}`, title: `Lavage ${i}` })) });
  const tour = (n: number) => ([
    { role: 'user', content: `question ${n}` },
    { role: 'assistant', content: [{ type: 'tool_use', id: `tu${n}`, name: 'list_jobs', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu${n}`, content: gros }] },
    { role: 'assistant', content: [{ type: 'text', text: `réponse ${n}` }] },
  ]);
  it('sous le seuil : rien ne bouge (même référence)', () => {
    const msgs = tour(1);
    expect(purgerVieuxResultats(msgs, 1_000_000)).toBe(msgs);
  });
  it('au-delà : tous les résultats sauf les 3 derniers deviennent la note ; tool_use et base intacts', () => {
    const msgs = [...tour(1), ...tour(2), ...tour(3), ...tour(4), ...tour(5)];
    const out = purgerVieuxResultats(msgs, 10_000, 3);
    const resultats = out.filter((m) => Array.isArray(m.content) && (m.content as any[])[0]?.type === 'tool_result').map((m) => (m.content as any[])[0].content);
    expect(resultats.slice(0, 2)).toEqual([NOTE_PURGE, NOTE_PURGE]);
    expect(resultats.slice(2).every((c) => c === gros)).toBe(true);
    expect(out.filter((m) => Array.isArray(m.content) && (m.content as any[])[0]?.type === 'tool_use')).toHaveLength(5);
    // L'original n'est jamais muté (c'est lui qui vient de la base).
    expect((msgs[2].content as any[])[0].content).toBe(gros);
  });
  it('déterministe : deux appels sur le même historique donnent le même résultat (cache stable)', () => {
    const msgs = [...tour(1), ...tour(2), ...tour(3), ...tour(4), ...tour(5)];
    expect(JSON.stringify(purgerVieuxResultats(msgs, 10_000))).toBe(JSON.stringify(purgerVieuxResultats(msgs, 10_000)));
  });
});
