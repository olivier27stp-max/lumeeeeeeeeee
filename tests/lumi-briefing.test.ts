/**
 * Briefing du matin de Lumi (server/lib/lumi/briefing.ts) : le texte ne dit
 * que ce que les données contiennent, une section vide disparaît, rien n'est
 * envoyé quand il n'y a rien à dire, et l'heure locale décide du moment.
 */
import { describe, it, expect } from 'vitest';
import { composerBriefing, heureDansFuseau, HEURE_BRIEFING } from '../server/lib/lumi/briefing';

const vide = {
  date: '2026-09-11',
  overdue_invoices: { total_matching: 0, total_cents: 0, worst: [] },
  todays_visits: { total_matching: 0, visits: [] },
  tasks_due: { total_matching: 0, tasks: [] },
  new_requests_48h: { total_matching: 0, requests: [] },
  unread_sms: { total_matching: 0, conversations: [] },
};
const maintenant = new Date('2026-09-11T10:00:00Z');
const opts = { prenom: 'Will', fr: true, fuseau: 'America/Toronto', maintenant };

describe('composerBriefing', () => {
  it('rien à dire → null (pas de briefing, pas de bruit)', () => {
    expect(composerBriefing(vide, opts)).toBeNull();
  });

  it('visites, retards, tâches, demandes, textos : chaque section en une phrase, en heure locale', () => {
    const t = composerBriefing({
      ...vide,
      todays_visits: { total_matching: 2, visits: [{ start_at: '2026-09-11T13:00:00Z', client: 'Marie Tremblay' }, { start_at: '2026-09-11T18:30:00Z', client: 'Luc Lavoie' }] },
      overdue_invoices: { total_matching: 2, total_cents: 197182, worst: [{ client: 'Michel Lavoie', balance_cents: 21000, due_date: '2026-09-02' }, { client: 'Sophie Bouchard', balance_cents: 162690, due_date: '2026-08-20' }] },
      tasks_due: { total_matching: 1, tasks: [{ title: 'Rappeler Ginette' }] },
      new_requests_48h: { total_matching: 1, requests: [{ nom: 'Robert De St-Bruno', ville: 'Saint-Bruno', quand: '2026-09-10T15:00:00Z' }] },
      unread_sms: { total_matching: 3, conversations: [{ client: 'Marie Tremblay', non_lus: 3 }] },
    }, opts)!;
    expect(t.startsWith('Bonjour Will.')).toBe(true);
    expect(t).toContain('2 visites aujourd\'hui : 9 h Marie Tremblay, 14 h 30 Luc Lavoie.');
    expect(t).toContain('2 factures en retard pour 1 971,82 $, la plus vieille chez Sophie Bouchard (22 jours).');
    expect(t).toContain('1 tâche à faire d’ici demain : Rappeler Ginette.');
    expect(t).toContain('1 nouvelle demande depuis 48 h : Robert De St-Bruno (Saint-Bruno).');
    expect(t).toContain('3 textos non lus (Marie Tremblay).');
    expect(t).toContain('« relance les retards »');
    expect(t).toContain('« prépare la tournée »');
  });

  it('un jour calme mais un retard : la phrase « rien au calendrier » et la suite proposée', () => {
    const t = composerBriefing({ ...vide, overdue_invoices: { total_matching: 1, total_cents: 5000, worst: [{ client: 'X', balance_cents: 5000, due_date: null }] } }, opts)!;
    expect(t).toContain('Rien au calendrier aujourd’hui.');
    expect(t).toContain('1 facture en retard pour 50,00 $, la plus vieille chez X.');
    expect(t).not.toContain('tournée');
  });

  it('en anglais pour un membre anglophone', () => {
    const t = composerBriefing({ ...vide, todays_visits: { total_matching: 1, visits: [{ start_at: '2026-09-11T13:00:00Z', client: 'Marie' }] } }, { ...opts, fr: false })!;
    expect(t).toContain('Good morning Will.');
    expect(t).toContain('1 visit today: 9:00 a.m. Marie.');
  });
});

describe('« Le Reçu » — les soumissions qui dorment', () => {
  const dort = {
    total_cents: 1_231_000,
    devis_total_cents: 1_068_310,
    factures_total_cents: 162_690,
    devis: [{ id: 'q-1', client: 'Sophie Bouchard', montant_cents: 1_068_310, jours_sans_contact: 12 }],
    factures: [{ id: 'f-1', client: 'Michel Lavoie', solde_cents: 162_690, jours_de_retard: 35 }],
  };
  const retards = {
    total_matching: 4,
    total_cents: 278_958,
    worst: [{ id: 'f-1', client: 'Michel Lavoie', balance_cents: 162_690, due_date: '2026-08-19' }],
  };

  it('coupé (données absentes) : le briefing est identique au mot près', () => {
    const avec = { ...vide, todays_visits: { total_matching: 1, visits: [{ start_at: '2026-09-11T13:00:00Z', client: 'Marie' }] } };
    expect(composerBriefing({ ...avec, argent_qui_dort: undefined }, opts))
      .toBe(composerBriefing(avec, opts));
  });

  it('ne répète JAMAIS les factures en retard', () => {
    // Le défaut vu en production le 2026-09-24 : le même argent annoncé deux
    // fois (« 2 789 $ en retard » puis « 2 789 $ qui dorment »), donc un
    // entrepreneur qui croit en avoir le double. Cette section ne parle que
    // des soumissions.
    const t = composerBriefing({ ...vide, overdue_invoices: retards, argent_qui_dort: dort }, opts)!;
    expect(t).toContain('4 factures en retard pour 2 789,58 $');
    expect(t).not.toContain('qui dorment');
    // Le montant des factures n'apparaît qu'une seule fois dans tout le texte.
    expect(t.split('2 789,58 $').length - 1).toBe(1);
  });

  it('annonce les soumissions sans réponse et nomme la plus grosse', () => {
    const t = composerBriefing({ ...vide, argent_qui_dort: dort }, opts)!;
    expect(t).toContain('10 683,10 $ en soumissions sans réponse');
    expect(t).toContain('Sophie Bouchard');
    expect(t).toContain('sans suivi depuis 12 j');
  });

  it('n’écrit JAMAIS de lien Markdown : le rendu de Lumi ne les affiche pas', () => {
    // Le rendu de Lumi gère le gras, les puces, les titres et les tableaux,
    // pas `[texte](url)`. Un lien Markdown apparaîtrait en syntaxe brute —
    // pire que pas de lien. Les vrais liens passent par les « fiches ».
    const t = composerBriefing({ ...vide, overdue_invoices: retards, argent_qui_dort: dort }, opts)!;
    expect(t).not.toMatch(/\]\(\//);
    expect(t).toContain('Michel Lavoie');
    expect(t).toContain('Sophie Bouchard');
  });

  it('le nom est écrit tel quel, crochets compris', () => {
    // Les données de test portent des noms comme « [QA] Sophie Bouchard ».
    // Sans Markdown, aucune raison de les retirer : on affiche le vrai nom.
    const t = composerBriefing({
      ...vide,
      overdue_invoices: { ...retards, worst: [{ id: 'f-2', client: '[QA] Sophie', balance_cents: 1000, due_date: '2026-08-19' }] },
    }, opts)!;
    expect(t).toContain('chez [QA] Sophie');
  });

  it('les entités citées sont déclarées comme fiches, pour être cliquables', () => {
    // Lumi ne rend pas les liens Markdown : le front retrouve le nom dans la
    // phrase grâce à la fiche et le transforme en lien.
    const fiches: any[] = [];
    composerBriefing({ ...vide, overdue_invoices: retards, argent_qui_dort: dort }, { ...opts, fiches });
    expect(fiches).toContainEqual({ type: 'invoice', id: 'f-1', label: 'Michel Lavoie', href: '/invoices/f-1' });
    expect(fiches).toContainEqual({ type: 'quote', id: 'q-1', label: 'Sophie Bouchard', href: '/quotes/q-1' });
  });

  it('aucune fiche sans identifiant : pas de lien mort', () => {
    const fiches: any[] = [];
    const sansId = { ...retards, worst: [{ client: 'Michel Lavoie', balance_cents: 162_690, due_date: '2026-08-19' }] };
    const t = composerBriefing({ ...vide, overdue_invoices: sansId }, { ...opts, fiches })!;
    expect(t).toContain('chez Michel Lavoie');
    expect(fiches).toHaveLength(0);
  });

  it('aucune soumission dormante → aucune phrase', () => {
    const t = composerBriefing({
      ...vide,
      todays_visits: { total_matching: 1, visits: [{ start_at: '2026-09-11T13:00:00Z', client: 'Marie' }] },
      argent_qui_dort: { ...dort, devis: [], devis_total_cents: 0 },
    }, opts)!;
    expect(t).not.toContain('soumissions sans réponse');
  });

  it('des soumissions dormantes suffisent à déclencher un briefing un jour vide', () => {
    const t = composerBriefing({ ...vide, argent_qui_dort: dort }, opts);
    expect(t).not.toBeNull();
    expect(t).toContain('soumissions sans réponse');
  });

  it('propose de relancer les devis quand il n’y a pas de facture en retard', () => {
    const t = composerBriefing({ ...vide, argent_qui_dort: { ...dort, factures: [], factures_total_cents: 0 } }, opts)!;
    expect(t).toContain('« relance les devis qui dorment »');
  });

  it('en anglais', () => {
    const t = composerBriefing({ ...vide, argent_qui_dort: dort }, { ...opts, fr: false })!;
    expect(t).toContain('in quotes with no reply');
    expect(t).toContain('no follow-up for 12 days');
  });
});

describe('heureDansFuseau', () => {
  it('donne l heure locale et le jour de l org, et retombe sur Toronto si le fuseau est inconnu', () => {
    expect(heureDansFuseau('America/Toronto', new Date('2026-09-11T10:15:00Z'))).toEqual({ heure: 6, jour: '2026-09-11' });
    expect(heureDansFuseau('America/Vancouver', new Date('2026-09-11T10:15:00Z')).heure).toBe(3);
    expect(heureDansFuseau('Pas/Un-Fuseau', new Date('2026-09-11T10:15:00Z')).heure).toBe(6);
    expect(HEURE_BRIEFING).toBe(6);
  });
});
