/**
 * L'HEURE QUE LE CLIENT LIT DANS SON MESSAGE.
 *
 * Railway tourne en UTC sans `TZ` : un `toLocale*` sans fuseau explicite
 * annonçait un rendez-vous de 9 h comme « 13 h 00 », et un rendez-vous de
 * 22 h le 13 comme « le 14 ». Corrigé en passant un fuseau — mais figé à
 * `America/Toronto`, alors que l'audit des automatisations (F2) demandait
 * `company_settings.timezone`.
 *
 * Invisible au Québec (Toronto et Montréal partagent offset et heure
 * avancée), faux d'une à quatre heures pour une org ailleurs. La colonne
 * est NOT NULL avec DEFAULT 'America/Toronto' : lire le réglage ne change
 * donc RIEN pour qui n'y a jamais touché.
 *
 * Test statique, comme `automatisations-apercu.test.ts` juste à côté : ce
 * qui casserait la règle, c'est qu'on retire `timezone` de la requête ou
 * qu'on reformate avec la constante. Les deux se voient dans le source.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(__dirname, '..', 'server/lib/actions/index.ts'),
  'utf8',
);

describe('l’heure du rendez-vous suit le fuseau de l’entreprise', () => {
  it('`timezone` est demandé avec les autres réglages', () => {
    /*
     * La requête `company_settings` existait déjà pour le nom, le téléphone
     * et la langue : le fuseau y tient sans aller-retour supplémentaire.
     * L'oublier ici rend `company.timezone` undefined et fait retomber tout
     * le monde sur le repli — en silence, puisque rien ne planterait.
     */
    const requete = source.slice(source.indexOf("from('company_settings')"));
    expect(requete.slice(0, 400), 'le select doit inclure timezone').toMatch(
      /\.select\('[^']*\btimezone\b[^']*'\)/,
    );
  });

  it('le formatage utilise le réglage de l’org, pas la constante', () => {
    expect(source, 'appointment_date doit prendre le fuseau résolu').toMatch(
      /vars\.appointment_date = d\.toLocaleDateString\((?:'fr-CA'|locale), \{ timeZone: fuseau \}\)/,
    );
    expect(source, 'appointment_time doit prendre le fuseau résolu').toMatch(
      /vars\.appointment_time = d\.toLocaleTimeString\([^)]*timeZone: fuseau[^)]*\)/,
    );
    // Le fuseau doit venir des réglages, avec la constante en simple repli.
    expect(source).toMatch(
      /const fuseau = \(company\?\.timezone as string \| undefined\) \|\| FUSEAU_CLIENT/,
    );
  });

  it('aucun formatage client ne reste figé sur la constante', () => {
    /*
     * `FUSEAU_CLIENT` n'est plus qu'un repli. S'il réapparaît dans un
     * `timeZone:`, c'est qu'une nouvelle variable a été formatée sans passer
     * par le réglage — exactement la régression que F2 décrivait.
     */
    expect(source, 'FUSEAU_CLIENT ne doit plus servir à formater directement')
      .not.toMatch(/timeZone: FUSEAU_CLIENT/);
  });
});
