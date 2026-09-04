/**
 * AUCUN CHAMP TEXTE NE DOIT ÊTRE SANS FOND.
 *
 * CONSTAT DU 2026-09-04 (prod, session réelle d'un membre)
 * Sur 113 colonnes texte des tables cœur, aucune n'avait de borne. Un
 * prénom de 10 Mo a été accepté. Après quoi, ouvrir la liste des clients
 * transférait 10 Mo à chaque membre de l'organisation — 1,4 s au lieu
 * de 40 ms — jusqu'à ce que quelqu'un retrouve et corrige la fiche.
 *
 * POURQUOI LA BASE, ET PAS LE FORMULAIRE
 * L'application écrit directement dans Supabase depuis le navigateur. La
 * validation Zod du serveur Express n'est pas sur ce chemin, et un
 * `maxLength` HTML se contourne en une ligne de console. Seule une
 * contrainte CHECK tient dans tous les cas : collage accidentel, import
 * CSV mal formé, membre malveillant.
 *
 * CE QUE CES TESTS FIGENT
 * La migration existe, couvre les colonnes que les listes affichent, et
 * choisit des bornes larges — jamais une saisie légitime refusée.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '..', 'supabase/migrations/20260904170000_bornes_longueur_texte.sql'),
  'utf8',
);

/** Extrait les triplets (table, colonne, borne) déclarés dans la migration. */
const BORNES = (() => {
  const out = new Map<string, number>();
  for (const m of SRC.matchAll(/\('(\w+)',\s*'(\w+)',\s*(\d+)\)/g)) {
    out.set(`${m[1]}.${m[2]}`, Number(m[3]));
  }
  return out;
})();

describe('la migration pose des bornes de longueur', () => {
  it('elle passe par un CHECK sur length(), pas par varchar(n)', () => {
    // varchar(n) tronque ou refuse selon le contexte et force un type ;
    // un CHECK est explicite, nommé, et retirable sans toucher au type.
    expect(SRC).toContain('check (length(%I) <= %s)');
    expect(SRC).not.toMatch(/alter column .* type varchar/i);
  });

  it('elle est réexécutable', () => {
    // Rejouer une migration ne doit jamais échouer sur « existe déjà ».
    expect(SRC).toContain('drop constraint if exists');
  });

  it('elle nomme chaque contrainte <table>_<colonne>_len', () => {
    // Un nom prévisible : quand la base refuse une écriture, le message
    // dit exactement quelle colonne, et le code peut le traduire.
    expect(SRC).toContain("format('%s_%s_len', r.tbl, r.col)");
  });
});

describe('les colonnes affichées dans les listes sont couvertes', () => {
  // Ce sont celles qu'une valeur monstrueuse ferait transférer à tout le
  // monde, à chaque ouverture de page.
  const ATTENDUES = [
    'clients.first_name', 'clients.last_name', 'clients.company',
    'clients.email', 'clients.phone', 'clients.address',
    'jobs.title', 'jobs.client_name', 'jobs.property_address',
    'invoices.subject', 'invoices.client_name_snapshot',
    'quotes.title',
    'tasks.title',
    'team_members.first_name', 'team_members.last_name', 'team_members.email',
    'company_settings.company_name',
    'properties.address',
  ];

  for (const c of ATTENDUES) {
    it(`${c} a une borne`, () => {
      expect(BORNES.has(c)).toBe(true);
    });
  }

  it('les champs de texte libre sont couverts aussi, avec une borne large', () => {
    for (const c of ['clients.notes', 'jobs.description', 'invoices.notes', 'quotes.notes', 'notes.content']) {
      expect(BORNES.get(c)).toBe(20000);
    }
  });
});

describe('les bornes sont larges — jamais une saisie légitime refusée', () => {
  it('un nom accepte au moins 100 caractères', () => {
    // Mesuré en prod avant la migration : le plus long prénom fait 39.
    for (const c of ['clients.first_name', 'clients.last_name', 'team_members.first_name']) {
      expect(BORNES.get(c)!).toBeGreaterThanOrEqual(100);
    }
  });

  it('un courriel accepte la longueur maximale de la RFC 5321', () => {
    for (const c of ['clients.email', 'team_members.email', 'company_settings.email']) {
      expect(BORNES.get(c)!).toBeGreaterThanOrEqual(254);
    }
  });

  it('une adresse accepte au moins 300 caractères', () => {
    // La plus longue en prod fait 86 ; certaines adresses rurales avec
    // lot et concession dépassent 150.
    for (const c of ['clients.address', 'jobs.property_address', 'properties.address']) {
      expect(BORNES.get(c)!).toBeGreaterThanOrEqual(300);
    }
  });

  it('aucune borne n est ridicule', () => {
    // Un code postal de 20 est déjà le plus serré ; en dessous, on
    // refuserait des formats étrangers.
    for (const [col, n] of BORNES) {
      expect(n, col).toBeGreaterThanOrEqual(20);
    }
  });

  it('aucune borne ne dépasse 20 000 — au-delà, ce n est plus un champ, c est un fichier', () => {
    for (const [col, n] of BORNES) {
      expect(n, col).toBeLessThanOrEqual(20000);
    }
  });
});
