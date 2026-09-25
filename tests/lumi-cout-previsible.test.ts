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
 * Quatre réponses, aucune ne retire une fonction :
 *  1. fenêtre de maintien du cache portée à 12 h (une journée ouvrable) ;
 *  2. le plafond par tour DÉGRADE au lieu de couper ;
 *  3. la dictée a sa propre source, pour ne jamais couper le chat ;
 *  4. les tarifs Gemini sont relevés à la source : elle est enfin chiffrée.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fenetreMaintienMs, DELAI_RAFRAICHISSEMENT_MS, doitPinger } from '../server/lib/lumi/cache-chaud';
import {
  verifierPlafond, ajouterAppel, ajouterDepense, plafondAppelsJour,
  etatPlafonds, reinitialiserPlafonds, BORNEES_EN_VOLUME,
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
  it('« voix » est une source à part, bornée AUSSI en volume', () => {
    expect(BORNEES_EN_VOLUME).toContain('voix');
    expect(plafondAppelsJour('voix', {} as NodeJS.ProcessEnv)).toBe(300);
  });

  it('la borne en volume arrête, même très loin du plafond en dollars', () => {
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

  it('l\'état montre les DEUX bornes pour la voix, une seule pour le reste', () => {
    const etat = etatPlafonds({} as NodeJS.ProcessEnv);
    const voix = etat.find((e) => e.source === 'voix')!;
    const lumi = etat.find((e) => e.source === 'lumi')!;
    expect(voix.plafond_appels).toBe(300);
    // Chiffrée depuis que les tarifs Gemini sont relevés (2026-09-22) : la
    // voix a aussi un plafond en dollars, comme toutes les autres sources.
    expect(voix.plafond_cents).toBeGreaterThan(0);
    expect(lumi.plafond_appels, 'pas de borne en volume ailleurs').toBeNull();
    expect(lumi.plafond_cents).toBeGreaterThan(0);
  });

  it('le compteur en dollars reste intact pour les sources chiffrées', () => {
    ajouterDepense('lumi', 42, {} as NodeJS.ProcessEnv);
    expect(verifierPlafond('lumi', {} as NodeJS.ProcessEnv).depense_cents).toBe(42);
  });
});

/**
 * Tarifs Gemini relevés le 2026-09-22 sur ai.google.dev/gemini-api/docs/pricing
 * (palier payant). Ce test les fige : si quelqu'un les change, il doit dire
 * d'où viennent les nouveaux — un prix inventé fausse tout ce qui en dépend.
 */
describe('4. la dictée est enfin chiffrée', () => {
  it('les tarifs Gemini publiés sont dans la table', async () => {
    const { TARIFS } = await import('../server/lib/lumi/tarifs');
    // 2.5 Pro ne distingue pas l'audio : 1,25 $/M en entrée, 10 $/M en sortie.
    expect(TARIFS['gemini-2.5-pro']).toEqual({ input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 });
    // 2.5 Flash facture l'audio à part : 1,00 $/M (contre 0,30 $ le texte).
    expect(TARIFS['gemini-2.5-flash']).toEqual({ input: 1, output: 2.5, cacheRead: 0.1, cacheWrite: 0 });
  });

  it('plus aucun modèle appelé par le code n\'est sans tarif', async () => {
    const { tarifInconnu } = await import('../server/lib/lumi/tarifs');
    for (const m of ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-embedding-001', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']) {
      expect(tarifInconnu(m), `${m} doit avoir un tarif`).toBe(false);
    }
    // Un modèle jamais vu reste signalé : c'est le garde-fou du prochain ajout.
    expect(tarifInconnu('modele-invente-2030')).toBe(true);
  });

  it('une dictée de 60 s coûte moins qu\'un tour Lumi', async () => {
    const { coutEnCents } = await import('../server/lib/lumi/tarifs');
    // 60 s d'audio ≈ 1 500 tokens (25 tok/s) + le prompt de transcription.
    const cout = coutEnCents('gemini-2.5-pro', {
      input_tokens: 1500 + 350, output_tokens: 200 + 512, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    });
    expect(cout).toBeGreaterThan(0);
    // Référence mesurée en prod : un tour Lumi à cache chaude = 2,06 ¢.
    expect(cout, 'une dictée ne doit pas coûter plus cher qu\'un tour de chat').toBeLessThan(2.06);
  });
});

/**
 * Démarrage à froid (2026-09-22) — le dernier poste de coût imprévisible.
 *
 * Mesuré en prod sur 70 tours d'agent :
 *   19 tours à froid  → 5,66 ¢ en moyenne
 *   51 tours à chaud  → 1,21 ¢
 *   surcoût du froid  → 0,84 $ (27 % des tours)
 *
 * Le préfixe fait 11 124 tokens : une écriture coûte 4,45 ¢ à elle seule.
 * Et comme chaque déploiement redémarre le serveur, ce froid revient
 * plusieurs fois par jour.
 */
describe('5. démarrage à froid', () => {
  it('le ping ne facture AUCUN token de sortie', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('server/lib/lumi/cache-chaud.ts', 'utf8'));
    // `max_tokens: 0` : l'API écrit le cache puis rend `content: []`.
    // L'ancien `max_tokens: 16` payait 16 tokens de sortie par réchauffement.
    // Les LIGNES DE CODE seulement (les commentaires citent l'ancienne valeur).
    const lignes = src.split(/\r?\n/).filter((l) => /max_tokens:/.test(l) && !/^\s*(\/\/|\*)/.test(l.trim()));
    expect(lignes, 'un seul max_tokens dans ce fichier').toHaveLength(1);
    expect(lignes[0]).toMatch(/max_tokens:\s*0\b/);
  });

  it('le ping ne demande pas au modèle de réfléchir', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('server/lib/lumi/cache-chaud.ts', 'utf8'));
    const ping = src.slice(src.indexOf('export async function pingerCache'), src.indexOf('export function demarrerMaintienCacheChaud'));
    // `thinking` / `output_config` ne font pas partie du préfixe caché : les
    // envoyer ne changeait rien à l'entrée écrite, et `max_tokens: 0` est
    // refusé avec certaines de leurs combinaisons.
    expect(ping).not.toMatch(/thinking:/);
    expect(ping).not.toMatch(/output_config:/);
  });

  it('le préchauffage au démarrage est désactivable', async () => {
    const { prechaufferCache } = await import('../server/lib/lumi/cache-chaud');
    // Sans clé d'API ni activation, il ne doit RIEN tenter (et ne pas jeter).
    await expect(prechaufferCache()).resolves.toBeUndefined();
  });
});
