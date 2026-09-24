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

describe('« Le Reçu » — l’argent qui dort dans le briefing', () => {
  const dort = {
    total_cents: 1_231_000,
    devis_total_cents: 1_068_310,
    factures_total_cents: 162_690,
    devis: [{ client: 'Sophie Bouchard', montant_cents: 1_068_310, jours_sans_contact: 12 }],
    factures: [{ client: 'Michel Lavoie', solde_cents: 162_690, jours_de_retard: 35 }],
  };

  it('coupé (données absentes) : le briefing est identique au mot près', () => {
    // La garantie du drapeau : sans la section, rien ne change nulle part.
    const avec = { ...vide, todays_visits: { total_matching: 1, visits: [{ start_at: '2026-09-11T13:00:00Z', client: 'Marie' }] } };
    expect(composerBriefing({ ...avec, argent_qui_dort: undefined }, opts))
      .toBe(composerBriefing(avec, opts));
  });

  it('annonce le total et nomme le plus gros gisement', () => {
    const t = composerBriefing({ ...vide, argent_qui_dort: dort }, opts)!;
    expect(t).toContain('12 310,00 $ qui dorment');
    expect(t).toContain('chez Sophie Bouchard');
    expect(t).toContain('10 683,10 $');
    expect(t).toContain('sans suivi depuis 12 j');
  });

  it('le plus gros peut être une facture', () => {
    const t = composerBriefing({
      ...vide,
      argent_qui_dort: { ...dort, devis: [{ client: 'Petit', montant_cents: 10_000, jours_sans_contact: 9 }], devis_total_cents: 10_000, total_cents: 172_690 },
    }, opts)!;
    expect(t).toContain('chez Michel Lavoie');
    expect(t).toContain('35 j de retard');
  });

  it('un total à zéro ne produit aucune phrase', () => {
    const t = composerBriefing({
      ...vide,
      todays_visits: { total_matching: 1, visits: [{ start_at: '2026-09-11T13:00:00Z', client: 'Marie' }] },
      argent_qui_dort: { total_cents: 0, devis_total_cents: 0, factures_total_cents: 0, devis: [], factures: [] },
    }, opts)!;
    expect(t).not.toContain('dorment');
  });

  it('de l’argent qui dort suffit à déclencher un briefing un jour vide', () => {
    // Sans cette garde, un jour calme avec 12 000 $ dormants ne dirait rien.
    const t = composerBriefing({ ...vide, argent_qui_dort: dort }, opts);
    expect(t).not.toBeNull();
    expect(t).toContain('qui dorment');
  });

  it('propose de relancer les devis quand il n’y a pas de facture en retard', () => {
    const t = composerBriefing({ ...vide, argent_qui_dort: { ...dort, factures: [], factures_total_cents: 0 } }, opts)!;
    expect(t).toContain('« relance les devis qui dorment »');
  });

  it('en anglais', () => {
    const t = composerBriefing({ ...vide, argent_qui_dort: dort }, { ...opts, fr: false })!;
    expect(t).toContain('sitting idle');
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
