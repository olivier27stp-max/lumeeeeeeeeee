/**
 * APPLE PAY — le fichier de vérification du domaine.
 *
 * Apple n'affiche le bouton Apple Pay que si
 * https://<domaine>/.well-known/apple-developer-merchantid-domain-association
 * renvoie le fichier fourni par Stripe. Constaté le 2026-09-17 sur
 * lumecrm.net : le chemin renvoyait index.html (200, text/html) — l'interrupteur
 * « Apple Pay & Google Pay » promettait un bouton qui ne pouvait pas apparaître.
 * express.static ignore les dossiers pointés : la route doit être explicite.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const racine = resolve(__dirname, '..');

describe('vérification de domaine Apple Pay', () => {
  it('le fichier Stripe est présent et intact (9094 octets, hexadécimal)', () => {
    const chemin = resolve(racine, 'server/assets/apple-developer-merchantid-domain-association');
    expect(statSync(chemin).size).toBe(9094);
    const contenu = readFileSync(chemin, 'utf8').trim();
    expect(contenu).toMatch(/^[0-9A-F]+$/);
  });

  it('le serveur le sert sur le chemin exact, en text/plain, avant le repli SPA', () => {
    const src = readFileSync(resolve(racine, 'server/index.ts'), 'utf8');
    const route = src.indexOf("app.get('/.well-known/apple-developer-merchantid-domain-association'");
    const repli = src.indexOf("res.sendFile(path.join(distPath, 'index.html'))");
    expect(route).toBeGreaterThan(-1);
    expect(repli).toBeGreaterThan(route);
    expect(src).toMatch(/FICHIER_APPLE_PAY[\s\S]*res\.type\('text\/plain'\)/);
  });
});
