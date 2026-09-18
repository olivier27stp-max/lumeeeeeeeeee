/**
 * DEUX MIGRATIONS, LE MÊME HORODATAGE, UNE QUI DISPARAÎT (2026-09-18).
 *
 * `20260917100000_creator_space_notes.sql` partageait son horodatage avec
 * `20260917100000_company_settings_social_links.sql` et
 * `20260917100000_lumi_plafonds_20_45.sql`. Elle n'a jamais été appliquée :
 * ni en staging, ni en prod. La section « Notes internes » du Creator Space
 * a donc été mise en ligne avec trois routes qui répondaient 500 en
 * production — mesuré sur lumecrm.net avant correction.
 *
 * Une collision d'horodatage ne casse rien en soi ; ce qui casse, c'est
 * qu'une migration devienne invisible dans la liste ordonnée et passe entre
 * les mailles au moment d'appliquer. Ce test fige la règle pour les
 * migrations À VENIR : un horodatage, un fichier.
 *
 * Les collisions ANTÉRIEURES sont tolérées explicitement (elles sont déjà
 * appliquées, les renommer réécrirait l'histoire) : la liste ci-dessous est
 * figée et ne doit jamais s'allonger.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const dossier = resolve(__dirname, '..', 'supabase', 'migrations');

/** Dernier horodatage en collision toléré. Tout fichier APRÈS doit être unique. */
const SEUIL = '20260918000000';

describe('horodatages des migrations', () => {
  const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.sql'));

  it('aucune nouvelle collision d horodatage', () => {
    const parHorodatage = new Map<string, string[]>();
    for (const f of fichiers) {
      const h = f.slice(0, 14);
      if (!/^\d{14}$/.test(h)) continue;
      if (h < SEUIL) continue; // collisions historiques déjà appliquées
      parHorodatage.set(h, [...(parHorodatage.get(h) ?? []), f]);
    }
    const collisions = [...parHorodatage.entries()]
      .filter(([, liste]) => liste.length > 1)
      .map(([h, liste]) => `${h} → ${liste.join(', ')}`);
    expect(
      collisions,
      `\nDeux migrations partagent le même horodatage. L'une d'elles finira par\n`
      + `ne jamais être appliquée (incident 2026-09-18, creator_space_notes).\n`
      + `Renommer la plus récente avec un horodatage libre :\n${collisions.join('\n')}\n`,
    ).toEqual([]);
  });

  it('chaque migration porte un horodatage lisible', () => {
    const malFormes = fichiers.filter((f) => !/^\d{14}_/.test(f));
    expect(malFormes).toEqual([]);
  });
});
