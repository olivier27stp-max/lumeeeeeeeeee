/**
 * B-19 — le tick du planificateur laisse une trace datée de son dernier
 * passage terminé, et le dit quand il dépasse son bail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { etatDepuisTrace, etatDuTick, noterTickTermine, BAIL_TICK_MS, TICK_EN_RETARD_MS } from '../../../server/lib/scheduler';

const source = readFileSync(resolve(__dirname, '../../../server/lib/scheduler.ts'), 'utf8').replace(/\r\n/g, '\n');
const T = Date.parse('2026-10-05T12:00:00Z');

describe('[B-19] l’état du tick, lu depuis sa trace', () => {
  it('jamais de trace : en retard (le planificateur n’a jamais fini un tick)', () => {
    expect(etatDepuisTrace(null, T)).toEqual({ dernier_tick_debut: null, dernier_tick_fin: null, duree_ms: null, age_s: null, en_retard: true });
  });

  it('tick fini il y a 2 minutes : à l’heure, avec sa durée', () => {
    const e = etatDepuisTrace({ locked_at: new Date(T - 150_000).toISOString(), locked_until: new Date(T - 120_000).toISOString() }, T);
    expect(e).toMatchObject({ duree_ms: 30_000, age_s: 120, en_retard: false });
  });

  it('aucun tick fini depuis 25 minutes : en retard (deux passages manqués + un bail)', () => {
    expect(TICK_EN_RETARD_MS).toBe(20 * 60_000);
    const e = etatDepuisTrace({ locked_at: new Date(T - 26 * 60_000).toISOString(), locked_until: new Date(T - 25 * 60_000).toISOString() }, T);
    expect(e.en_retard).toBe(true);
  });
});

describe('[B-19] la trace s’écrit et se relit dans `cron_locks`, sans jamais être un verrou', () => {
  it('écrit début et fin (deux dates passées) sur une clé dédiée, et relit la même ligne', async () => {
    const lignes = new Map<number, { key: number; locked_at: string; locked_until: string }>();
    const sb = {
      from: (table: string) => {
        expect(table).toBe('cron_locks');
        let cle: number | null = null;
        const b: Record<string, unknown> = {
          upsert: async (v: { key: number; locked_at: string; locked_until: string }, o: { onConflict: string }) => {
            expect(o.onConflict).toBe('key');
            lignes.set(v.key, v);
            return { error: null };
          },
          select: () => b,
          eq: (_c: string, v: number) => { cle = v; return b; },
          maybeSingle: async () => ({ data: cle === null ? null : lignes.get(cle) ?? null, error: null }),
        };
        return b;
      },
    } as never;
    await noterTickTermine(sb, T - 40_000, T - 10_000);
    const [ligne] = [...lignes.values()];
    // Les deux dates sont PASSÉES : `try_advisory_lock` ne tient jamais cette ligne pour un verrou pris.
    expect(Date.parse(ligne.locked_until)).toBeLessThanOrEqual(T);
    expect(await etatDuTick(sb, T)).toMatchObject({ duree_ms: 30_000, age_s: 10, en_retard: false });
  });

  it('une écriture refusée ne fait pas tomber le tick', async () => {
    const sb = { from: () => ({ upsert: async () => ({ error: { message: 'refus' } }) }) } as never;
    await expect(noterTickTermine(sb, T - 1000, T)).resolves.toBeUndefined();
  });
});

describe('[B-19] le tick est branché sur ses trois traces', () => {
  const protege = source.slice(source.indexOf('async function tickProtege'));

  it('passage Sentry (check-in) autour du tick, sous le verrou', () => {
    expect(protege).toMatch(/withAdvisoryLock\('automation-scheduler'/);
    expect(protege).toMatch(/withCronCheckIn\('automation-scheduler'/);
  });

  it('la trace est écrite après le tick, et pas quand il a été interrompu', () => {
    expect(protege.indexOf('await tick(supabase, twilio)')).toBeLessThan(protege.indexOf('await noterTickTermine('));
    expect(protege).toMatch(/if \(tickInterrompu\) throw/);
  });

  it('un tick qui dépasse le bail du verrou (10 min) est signalé en erreur, pendant ET après', () => {
    expect(BAIL_TICK_MS).toBe(10 * 60_000);
    expect(protege).toMatch(/setTimeout\(\(\) => signalerTickTropLong\(Date\.now\(\) - debut, true\), BAIL_TICK_MS\)/);
    expect(protege).toMatch(/Date\.now\(\) - debut > BAIL_TICK_MS/);
    expect(source).toMatch(/logger\.error\(message/);
  });
});
