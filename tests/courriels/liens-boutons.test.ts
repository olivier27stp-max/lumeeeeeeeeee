/**
 * Où pointe le bouton de chaque courriel (2026-09-23).
 *
 * Le bogue qui a motivé ce fichier, trouvé en vérifiant les liens en prod :
 * la route d'envoi de soumission construisait `/q/:token`. Or `/q/` a été
 * reconverti en redirection de FACTURES lors de l'audit du 2026-09-09 — elle
 * cherche le jeton dans `invoices`. Un jeton de devis n'y est pas, donc la
 * page répondait « Invoice not found », un 404 pur, sur le bouton de CHAQUE
 * soumission envoyée par courriel.
 *
 * Mesuré avant correction, contre lumecrm.net :
 *   /q/<jeton de devis>     → 404 « Invoice not found »
 *   /quote/<le même jeton>  → 200
 *
 * Ce qui l'a masqué : `send-mobile-quote` utilisait déjà `/quote/`. Deux
 * routes pour le même objet, un seul chemin correct.
 *
 * Statique : ni base, ni réseau. On vérifie que chaque bouton part vers un
 * chemin qui EXISTE dans les routes publiques.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHEMINS_PUBLICS } from '../../src/lib/mobileGate';

const racine = resolve(__dirname, '..', '..');
const lire = (p: string) => readFileSync(resolve(racine, p), 'utf8');

/** Les chemins qu'un lien de courriel peut viser, jeton compris. */
const CHEMINS_SERVIS = new Set<string>([
  ...CHEMINS_PUBLICS.map((p) => p.replace(/\/$/, '')),
  // Redirection courte, servie par le serveur (server/index.ts → /q/:token)
  // et non par le SPA : elle n'est donc pas dans CHEMINS_PUBLICS.
  '/q',
]);

describe('les boutons des courriels mènent quelque part', () => {
  const fichiers = [
    'server/routes/emails.ts',
    'server/routes/agreements.ts',
    'server/routes/payment-requests.ts',
    'server/routes/reminders-cron.ts',
  ];

  it('chaque lien construit vise un chemin public servi', () => {
    const inconnus: string[] = [];
    for (const f of fichiers) {
      const src = lire(f);
      // `${baseUrl}/quote/${…}` et compagnie : on relève le segment de tête.
      for (const m of src.matchAll(/\$\{(?:baseUrl|publicBase|base)\}\/([a-z][a-z0-9-]*)\//g)) {
        const chemin = `/${m[1]}`;
        if (!CHEMINS_SERVIS.has(chemin)) inconnus.push(`${f} : ${chemin}/…`);
      }
    }
    expect(inconnus.join('\n')).toBe('');
  });

  it('une soumission ne part JAMAIS vers /q/ — c’est la redirection des factures', () => {
    /* La règle qui a coûté un 404 sur chaque soumission. `/q/:token` cherche
       dans `invoices` ; un jeton de devis n'y est pas. */
    const emails = lire('server/routes/emails.ts');
    for (const m of emails.matchAll(/quote\.view_token \? `\$\{baseUrl\}(\/[a-z]+)\//g)) {
      expect(m[1], 'le lien d’une soumission doit viser /quote').toBe('/quote');
    }
    // Et l'inverse : la redirection /q/ reste bien celle des factures.
    const quotes = lire('server/routes/quotes.ts');
    const bloc = quotes.slice(quotes.indexOf("quoteRedirectRouter.get('/q/:token'"));
    expect(bloc.slice(0, 600)).toContain(".from('invoices')");
  });

  it('les deux routes d’envoi de soumission visent le même chemin', () => {
    /* C'est la divergence qui a masqué le bogue : `send-quote` utilisait
       `/q/`, `send-mobile-quote` utilisait `/quote/`. Un seul objet, deux
       liens — l'un marchait, l'autre non. */
    const emails = lire('server/routes/emails.ts');
    const chemins = new Set(
      [...emails.matchAll(/quote\.view_token \? `\$\{baseUrl\}(\/[a-z]+)\//g)].map((m) => m[1]),
    );
    expect([...chemins]).toEqual(['/quote']);
  });
});
