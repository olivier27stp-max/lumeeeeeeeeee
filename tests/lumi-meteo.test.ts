/**
 * Météo de Lumi (2026-09-22) — la seule information hors CRM qu'il connaisse.
 *
 * Les clients de Lume lavent des vitres, posent des toitures, font du
 * paysagement : la pluie n'est pas un agrément, c'est ce qui décide si la
 * journée a lieu. La page d'accueil du site le promettait déjà (« Pluie
 * annoncée ? Lumi propose le déplacement ») alors que Lumi n'avait pas accès
 * à la météo — elle vivait uniquement côté navigateur.
 *
 * Ce qui compte ici : le VERDICT (peut-on travailler dehors) et le refus
 * d'inventer quand la prévision manque.
 */
import { describe, it, expect } from 'vitest';
import { verdictTravailExterieur, libelleCiel } from '../server/lib/agent/meteo';
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';
import { OUTILS_DE_BASE } from '../server/lib/lumi/orchestrateur';

describe('verdict travail extérieur', () => {
  it('beau temps → bon', () => {
    expect(verdictTravailExterieur(0, 10)).toBe('bon');
    expect(verdictTravailExterieur(0.5, 20)).toBe('bon');
  });

  it('un peu de pluie ou du vent → variable', () => {
    expect(verdictTravailExterieur(1, 10)).toBe('variable');
    expect(verdictTravailExterieur(0, 30)).toBe('variable');
  });

  it('vraie pluie ou grand vent → mauvais', () => {
    expect(verdictTravailExterieur(5, 10)).toBe('mauvais');
    expect(verdictTravailExterieur(0, 45)).toBe('mauvais');
    expect(verdictTravailExterieur(20, 60)).toBe('mauvais');
  });

  /**
   * Les seuils doivent rester ceux de `outdoorWorkVerdict` dans
   * src/lib/weatherApi.ts : si Lumi et le bandeau d'accueil divergeaient,
   * l'utilisateur verrait deux verdicts contradictoires sur le même écran.
   */
  it('mêmes seuils que le bandeau de l\'app (5 mm / 45 km/h, 1 mm / 30 km/h)', () => {
    expect(verdictTravailExterieur(4.9, 44)).toBe('variable');
    expect(verdictTravailExterieur(5, 0)).toBe('mauvais');
    expect(verdictTravailExterieur(0.9, 29)).toBe('bon');
  });
});

describe('libellés de ciel', () => {
  it('traduit les codes WMO en français courant', () => {
    expect(libelleCiel(0)).toBe('ciel dégagé');
    expect(libelleCiel(63)).toBe('pluie');
    expect(libelleCiel(73)).toBe('neige');
    expect(libelleCiel(95)).toBe('orage');
  });

  it('un code non répertorié retombe sur « variable »', () => {
    // 4 et 30 ne sont pas des codes WMO connus ; 999 non plus, mais il tombe
    // dans la branche « >= 95 » (orage) comme dans le bandeau de l'app —
    // comportement volontairement identique des deux côtés.
    expect(libelleCiel(4)).toBe('variable');
    expect(libelleCiel(30)).toBe('variable');
  });
});

describe('l\'outil est branché', () => {
  it('get_weather existe et ne fait que lire', () => {
    const t = TOOLS_BY_NAME['get_weather'];
    expect(t, 'outil absent du catalogue').toBeTruthy();
    expect(t.kind, 'la météo ne doit JAMAIS demander de confirmation').toBe('read');
  });

  it('il est dans les outils de base : question quotidienne pour un métier extérieur', () => {
    expect(OUTILS_DE_BASE.has('get_weather')).toBe(true);
  });

  it('il annonce clairement qu\'il ne couvre qu\'aujourd\'hui et demain', () => {
    const d = TOOLS_BY_NAME['get_weather'].declaration;
    expect(d.description).toMatch(/today and tomorrow/i);
    // Sans cette borne, le modèle promettrait une prévision à 5 jours.
    expect((d.parameters as any)?.properties?.jour?.enum).toEqual(['aujourdhui', 'demain']);
  });
});
