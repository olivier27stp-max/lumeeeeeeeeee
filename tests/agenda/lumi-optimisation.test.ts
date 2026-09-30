/**
 * « Optimiser la journée » dans Lumi (audit Agenda, 2026-09-30) : reconnaissance
 * du texte sans modèle, date visée, gabarit, empreinte liant l'état et les
 * changements, et carte TOUJOURS exigée.
 */
import { describe, it, expect } from 'vitest';
import { detecterOptimisation, dateVisee, texteProposition } from '../../server/lib/lumi/optimiserJournee';
import { empreinteDe, type PropositionJournee } from '../../server/lib/trajets/propositionJournee';
import { outilsAutorisesParMode, TOUJOURS_CARTE } from '../../server/lib/lumi/execution';
import { ECRITURES_SENSIBLES } from '../../server/lib/agent/registre';

describe('le texte « optimise ma journée » — sans modèle', () => {
  it.each([
    ['optimise ma journée', 'aujourdhui'],
    ['Optimise ma journée de demain', 'demain'],
    ['optimiser la tournée de demain stp', 'demain'],
    ['optimize my day tomorrow', 'demain'],
    ['optimise ma journée du 2026-10-08', '2026-10-08'],
  ])('« %s » → %s', (texte, quand) => {
    expect(detecterOptimisation(texte)).toEqual({ quand });
  });

  it.each(['quelle est ma journée demain', 'optimise mes prix', 'montre ma tournée', 'optimiser'])('« %s » → pas reconnu (le modèle prend le relais)', (texte) => {
    expect(detecterOptimisation(texte)).toBeNull();
  });

  it('« demain » au fuseau de l’entreprise, fin de mois comprise', () => {
    expect(dateVisee('demain', 'America/Toronto', new Date('2026-10-31T15:00:00Z'))).toBe('2026-11-01');
    // 22 h à Toronto le 5 = le 6 en UTC : « aujourd'hui » reste le 5.
    expect(dateVisee('aujourdhui', 'America/Toronto', new Date('2026-10-06T02:00:00Z'))).toBe('2026-10-05');
  });
});

const base: PropositionJournee = {
  date: '2026-10-07', fuseau: 'America/Toronto', empreinte: 'x', deja_optimisee: false, gain_total_minutes: 37,
  equipes: [{ team_id: 't', nom: 'Équipe Rurale', avant: { ordre: ['a', 'b'], km: 126.7, minutes_route: 127 }, apres: { ordre: ['b', 'a'], km: 89.4, minutes_route: 89 }, gain_minutes: 37, fixes: [{ visit_id: 'f', titre: 'Job fixe', raison: 'confirmee_client' }], impossibles: [], exact: true }],
  changements: [{ visit_id: 'a', job_id: 'j', titre: 'Lavage A', team_id: 't', avant_debut: '2026-10-07T12:00:00Z', avant_fin: '2026-10-07T12:45:00Z', apres_debut: '2026-10-07T14:00:00Z', apres_fin: '2026-10-07T14:45:00Z' }],
  sans_adresse: [], clients: { rappels_replanifies: true, automatisations_avis: 0 }, hypotheses: [],
};

describe('la réponse par gabarit', () => {
  it('avant/après par équipe, visites déplacées (heures de l’entreprise), fixes et pourquoi', () => {
    const t = texteProposition(base, true);
    expect(t).toContain('37 min de route en moins');
    expect(t).toContain('126,7 km');
    expect(t).toContain('Lavage A : 8 h 00 → 10 h 00');
    expect(t).toContain('Job fixe : fixe (heure déjà confirmée au client)');
    expect(t).toContain('Rien n’a bougé');
  });

  it('gain sous le seuil : « Ta journée est déjà optimisée »', () => {
    expect(texteProposition({ ...base, deja_optimisee: true, changements: [] }, true)).toContain('déjà optimisée');
  });
});

describe('empreinte : ce qui est appliqué = ce qui a été proposé, sur l’horaire vu', () => {
  const visites = [
    { id: 'a', job_id: 'j', team_id: 't', start_at: '2026-10-07T12:00:00Z', end_at: '2026-10-07T12:45:00Z', status: 'scheduled', title: 'A' },
    { id: 'b', job_id: 'k', team_id: 't', start_at: '2026-10-07T13:00:00Z', end_at: '2026-10-07T13:45:00Z', status: 'scheduled', title: 'B' },
  ];
  const ch = [{ visit_id: 'a', apres_debut: '2026-10-07T14:00:00.000Z', apres_fin: '2026-10-07T14:45:00.000Z' }];
  it('stable (ordre des visites indifférent)', () => {
    expect(empreinteDe('2026-10-07', 'org', visites, ch)).toBe(empreinteDe('2026-10-07', 'org', [...visites].reverse(), ch));
  });
  it('change si l’horaire bouge, si un changement est altéré, ou pour une autre entreprise', () => {
    const e = empreinteDe('2026-10-07', 'org', visites, ch);
    expect(empreinteDe('2026-10-07', 'org', [visites[0], { ...visites[1], start_at: '2026-10-07T13:05:00Z' }], ch)).not.toBe(e);
    expect(empreinteDe('2026-10-07', 'org', visites, [{ ...ch[0], apres_debut: '2026-10-07T14:05:00.000Z' }])).not.toBe(e);
    expect(empreinteDe('2026-10-07', 'autre', visites, ch)).not.toBe(e);
  });
});

describe('toujours une carte', () => {
  it('apply_day_optimization est une écriture sensible', () => {
    expect(ECRITURES_SENSIBLES.has('apply_day_optimization')).toBe(true);
  });
  it('jamais d’office, même en mode « tout »', () => {
    expect(TOUJOURS_CARTE.has('apply_day_optimization')).toBe(true);
    expect(outilsAutorisesParMode('tout', ['apply_day_optimization', 'create_task']).has('apply_day_optimization')).toBe(false);
    expect(outilsAutorisesParMode('argent', ['apply_day_optimization']).has('apply_day_optimization')).toBe(false);
  });
});
