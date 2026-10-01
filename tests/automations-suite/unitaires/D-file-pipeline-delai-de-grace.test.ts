/**
 * D-042 / B-504 — la file des événements de pipeline ne lit un événement
 * qu'après son délai de grâce : l'action qui a déplacé le deal a le temps d'y
 * poser la chaîne anti-boucle avant qu'un passage ne le lise.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DELAI_GRACE_MS } from '../../../server/lib/pipelineEvenements';

describe('[D-042] file du pipeline — délai de grâce', () => {
  it('[D-042] le délai laisse le temps à une action (bien plus que ~150 ms) sans retarder un passage de 5 min', () => {
    expect(DELAI_GRACE_MS).toBeGreaterThanOrEqual(2_000);
    expect(DELAI_GRACE_MS).toBeLessThanOrEqual(30_000);
  });

  it('[D-042] la lecture de la file écarte les événements plus récents que le délai', () => {
    const source = readFileSync(resolve(__dirname, '../../../server/lib/pipelineEvenements.ts'), 'utf8').replace(/\r\n/g, '\n');
    const lecture = source.slice(source.indexOf('export async function traiterEvenementsPipeline'));
    expect(lecture).toMatch(/\.is\('processed_at', null\)[\s\S]{0,160}\.lt\('created_at', new Date\(Date\.now\(\) - DELAI_GRACE_MS\)\.toISOString\(\)\)/);
  });
});
