/**
 * Le plafond journalier de la plateforme ne dit plus « tes crédits sont épuisés ».
 *
 * Constat de l'inventaire (R4), confirmé en prod le 2026-10-01 : la plateforme a
 * un plafond de dépense par jour pour TOUS les clients réunis (50 $ pour Lumi).
 * Quand il arrêtait un tour, le client lisait « Tes crédits Lumi sont épuisés
 * jusqu'au <date de renouvellement> » — alors que ses crédits étaient intacts
 * et que la pause finit à minuit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { messagePause, messagePausePlateforme } from '../server/lib/lumi/budget';

describe('message du plafond de la plateforme', () => {
  it('ne parle ni de crédits épuisés ni de date de renouvellement, et rassure sur les crédits', () => {
    const fr = messagePausePlateforme('fr');
    const en = messagePausePlateforme('en');
    expect(fr).not.toMatch(/épuisés/);
    expect(fr).toMatch(/Tes crédits ne sont pas touchés/);
    expect(fr).not.toMatch(/\d/);
    expect(en).not.toMatch(/used up/);
    expect(en).toMatch(/Your credits are untouched/);
    // Jamais un montant : le client ne voit que des crédits.
    for (const t of [fr, en]) expect(t).not.toMatch(/\$|dollar/i);
    // Lumi tutoie.
    expect(fr).not.toMatch(/\b(vous|votre|vos)\b/i);
  });

  it('reste distinct du message des crédits de l’entreprise', () => {
    expect(messagePausePlateforme('fr')).not.toBe(messagePause('fr', '2026-11-12'));
    expect(messagePause('fr', '2026-11-12')).toMatch(/épuisés jusqu'au 12 novembre/);
  });

  it('la route choisit le message et la trace selon le plafond qui a arrêté le tour', () => {
    const r = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8');
    expect(r).toContain('const texte = !plafondJour.autorise ? messagePausePlateforme(ctx.language) : messagePause(ctx.language, ctx.credits.renouvellement_le || new Date());');
    expect(r).toContain("resultat.plafond ? (!plafondJour.autorise ? 'plafond_plateforme' : 'budget_epuise')");
    // Chaque refus de la plateforme est journalisé en erreur : il arrête tous les clients.
    expect(r).toContain("logger.error('[lumi] tour refusé par le plafond journalier de la plateforme'");
  });
});
