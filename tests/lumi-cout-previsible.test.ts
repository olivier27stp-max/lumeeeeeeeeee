/**
 * Rendre le coût PRÉVISIBLE sans jamais bloquer une fonction (2026-09-22).
 *
 * Mesuré en prod : le coût d'un tour Lumi va de 0,27 ¢ à 9,33 ¢, soit 7× la
 * médiane. En cherchant d'où vient l'écart, la réponse est contre-intuitive —
 * ce ne sont ni les outils ni la longueur des réponses :
 *
 *   sur les 10 tours les plus chers : 56 ¢ d'ÉCRITURE de cache, 2 ¢ de sortie
 *   un tour à cache froide : 5,25 ¢   un tour à cache chaude : 2,06 ¢  (4,8×)
 *   25 % des tours partaient à froid
 *
 * Trois réponses, aucune ne retire une fonction :
 *  1. fenêtre de maintien du cache portée à 12 h (une journée ouvrable) ;
 *  2. le plafond par tour DÉGRADE au lieu de couper ;
 *  3. la dictée a sa propre source, bornée en volume faute de tarif connu.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fenetreMaintienMs, DELAI_RAFRAICHISSEMENT_MS, doitPinger } from '../server/lib/lumi/cache-chaud';
import {
  verifierPlafond, ajouterAppel, ajouterDepense, plafondAppelsJour,
  etatPlafonds, reinitialiserPlafonds, SOURCES_SANS_TARIF,
} from '../server/lib/lumi/plafond-journalier';

beforeEach(() => reinitialiserPlafonds());

describe('1. le cache reste chaud une journée ouvrable', () => {
  it('la fenêtre par défaut couvre 12 h', () => {
    expect(fenetreMaintienMs({} as NodeJS.ProcessEnv)).toBe(12 * 60 * 60_000);
  });

  it('une personne qui revient après le dîner retrouve un cache chaud', () => {
    // Le cas mesuré le plus coûteux : plusieurs heures entre deux tours,
    // froid à 100 % avec l'ancienne fenêtre de 2 h.
    // `dernierAppelReel` doit être non nul : 0 signifie « aucun appel réel
    // depuis le démarrage » et le maintien ne s'arme pas (voir doitPinger).
    const fenetreMs = fenetreMaintienMs({} as NodeJS.ProcessEnv);
    const dernierAppelReel = 1;
    const maintenant = dernierAppelReel + 5 * 60 * 60_000; // 5 h plus tard
    expect(doitPinger({ dernierAppelReel, dernierPing: 0, maintenant, fenetreMs })).toBe(true);

    // L'ancienne fenêtre de 2 h ne couvrait PAS ce cas : c'est la régression
    // que ce changement corrige.
    expect(doitPinger({ dernierAppelReel, dernierPing: 0, maintenant, fenetreMs: 2 * 60 * 60_000 })).toBe(false);
  });

  it('sans activité, rien n\'est dépensé (la nuit, le week-end)', () => {
    const fenetreMs = fenetreMaintienMs({} as NodeJS.ProcessEnv);
    // Aucun appel réel : le maintien ne s'arme pas.
    expect(doitPinger({ dernierAppelReel: 0, dernierPing: 0, maintenant: 3 * 60 * 60_000, fenetreMs })).toBe(false);
    // Au-delà de la fenêtre : on laisse refroidir plutôt que de pinger dans le vide.
    expect(doitPinger({ dernierAppelReel: 1, dernierPing: 0, maintenant: 1 + fenetreMs + 60_000, fenetreMs })).toBe(false);
  });

  it('reste désactivable et réglable', () => {
    expect(fenetreMaintienMs({ LUMI_CACHE_CHAUD_MINUTES: '0' } as unknown as NodeJS.ProcessEnv)).toBe(0);
    expect(fenetreMaintienMs({ LUMI_CACHE_CHAUD_MINUTES: '60' } as unknown as NodeJS.ProcessEnv)).toBe(60 * 60_000);
  });

  it('on rafraîchit avant l\'expiration d\'une heure, avec de la marge', () => {
    expect(DELAI_RAFRAICHISSEMENT_MS).toBeLessThan(60 * 60_000);
  });
});

describe('3. la dictée : bornée en volume, jamais confondue avec le chat', () => {
  it('« voix » est une source à part, sans tarif connu', () => {
    expect(SOURCES_SANS_TARIF).toContain('voix');
    expect(plafondAppelsJour('voix', {} as NodeJS.ProcessEnv)).toBe(300);
  });

  it('le plafond porte sur les APPELS, pas sur des dollars', () => {
    const env = { LUMI_PLAFOND_JOUR_VOIX_APPELS: '3' } as unknown as NodeJS.ProcessEnv;
    for (let i = 0; i < 3; i++) {
      expect(verifierPlafond('voix', env).autorise).toBe(true);
      ajouterAppel('voix', env);
    }
    expect(verifierPlafond('voix', env).autorise).toBe(false);
  });

  it('saturer la dictée NE COUPE PAS le chat : ce sont deux usages', () => {
    const env = { LUMI_PLAFOND_JOUR_VOIX_APPELS: '1' } as unknown as NodeJS.ProcessEnv;
    ajouterAppel('voix', env);
    expect(verifierPlafond('voix', env).autorise).toBe(false);
    expect(verifierPlafond('lumi', env).autorise, 'le chat doit rester disponible').toBe(true);
  });

  it('l\'état montre un plafond d\'appels pour la voix, en dollars pour le reste', () => {
    const etat = etatPlafonds({} as NodeJS.ProcessEnv);
    const voix = etat.find((e) => e.source === 'voix')!;
    const lumi = etat.find((e) => e.source === 'lumi')!;
    expect(voix.plafond_appels).toBe(300);
    expect(voix.plafond_cents, 'pas de plafond en dollars sans tarif connu').toBe(0);
    expect(lumi.plafond_appels).toBeNull();
    expect(lumi.plafond_cents).toBeGreaterThan(0);
  });

  it('le compteur en dollars reste intact pour les sources chiffrées', () => {
    ajouterDepense('lumi', 42, {} as NodeJS.ProcessEnv);
    expect(verifierPlafond('lumi', {} as NodeJS.ProcessEnv).depense_cents).toBe(42);
  });
});
