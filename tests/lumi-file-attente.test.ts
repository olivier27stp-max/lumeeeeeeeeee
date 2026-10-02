/**
 * Garde de charge de Lumi : un nombre borné de tours d'agent en même temps.
 *
 * 2026-10-01 : huit conversations Lumi en parallèle ont couché la base de
 * production pendant 65 minutes — et avec elle tout le CRM. Au-delà de quatre
 * tours en cours, les suivants attendent ; sans place dans le délai, la personne
 * lit un message clair et rien ne part au modèle.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { creerFile, placesSimultanees, attenteMaxMs, LumiOccupe, messageLumiOccupe } from '../server/lib/lumi/file-attente';

afterEach(() => { vi.useRealTimers(); });

describe('la file des tours de Lumi', () => {
  it('sous la limite, chaque tour passe tout de suite', async () => {
    const file = creerFile(() => 2, () => 1000);
    const a = await file.prendre();
    const b = await file.prendre();
    expect(file.etat()).toEqual({ en_cours: 2, en_attente: 0 });
    a(); b();
    expect(file.etat()).toEqual({ en_cours: 0, en_attente: 0 });
  });

  it('au-delà, un tour attend — et passe dès qu’une place se libère, premier arrivé, premier servi', async () => {
    const file = creerFile(() => 2, () => 60_000);
    const a = await file.prendre();
    const b = await file.prendre();
    const ordre: string[] = [];
    const c = file.prendre().then((l) => { ordre.push('c'); return l; });
    const d = file.prendre().then((l) => { ordre.push('d'); return l; });
    await Promise.resolve();
    expect(file.etat()).toEqual({ en_cours: 2, en_attente: 2 });
    expect(ordre).toEqual([]);
    a();
    const lc = await c;
    expect(ordre).toEqual(['c']);
    // La place est passée de main en main : jamais plus de deux tours en cours.
    expect(file.etat()).toEqual({ en_cours: 2, en_attente: 1 });
    b();
    const ld = await d;
    expect(ordre).toEqual(['c', 'd']);
    lc(); ld();
    expect(file.etat()).toEqual({ en_cours: 0, en_attente: 0 });
  });

  it('sans place dans le délai : LumiOccupe, et la file ne garde aucune trace de ce tour', async () => {
    vi.useFakeTimers();
    const file = creerFile(() => 1, () => 20_000);
    const a = await file.prendre();
    const refus = file.prendre().then(() => 'passé', (e) => e);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(file.etat().en_attente).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(await refus).toBeInstanceOf(LumiOccupe);
    expect(file.etat()).toEqual({ en_cours: 1, en_attente: 0 });
    // La place rendue ensuite n'est donnée à personne : elle redevient libre.
    a();
    expect(file.etat()).toEqual({ en_cours: 0, en_attente: 0 });
    const b = await file.prendre();
    expect(file.etat().en_cours).toBe(1);
    b();
  });

  it('rendre deux fois la même place n’en libère qu’une', async () => {
    const file = creerFile(() => 2, () => 1000);
    const a = await file.prendre();
    await file.prendre();
    a(); a(); a();
    expect(file.etat().en_cours).toBe(1);
  });

  it('réglages : 4 tours et 20 secondes par défaut, bornés, jamais zéro', () => {
    expect(placesSimultanees({} as NodeJS.ProcessEnv)).toBe(4);
    expect(placesSimultanees({ LUMI_TOURS_SIMULTANES: '8' } as NodeJS.ProcessEnv)).toBe(8);
    expect(placesSimultanees({ LUMI_TOURS_SIMULTANES: '0' } as NodeJS.ProcessEnv)).toBe(1);
    expect(placesSimultanees({ LUMI_TOURS_SIMULTANES: 'beaucoup' } as NodeJS.ProcessEnv)).toBe(4);
    expect(attenteMaxMs({} as NodeJS.ProcessEnv)).toBe(20_000);
    expect(attenteMaxMs({ LUMI_ATTENTE_PLACE_MS: '5' } as NodeJS.ProcessEnv)).toBe(1_000);
  });

  it('le message dit que rien n’a été fait, sans chiffre ni jargon, au « tu »', () => {
    const fr = messageLumiOccupe('fr');
    expect(fr).toContain('rien n’a été fait');
    expect(fr).toContain('Réessaie dans une minute');
    expect(fr).not.toMatch(/vous|votre|crédit|\$|serveur|base/i);
    expect(messageLumiOccupe('en')).toContain('nothing was done');
  });
});

describe('la route de Lumi passe par la file', () => {
  const route = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8').replace(/\r\n/g, '\n');

  it('la place est prise avant le tour d’agent et rendue quoi qu’il arrive', () => {
    const prise = route.indexOf('liberer = await fileLumi.prendre();');
    const tour = route.indexOf('await tourLumi({');
    expect(prise).toBeGreaterThan(0);
    expect(prise).toBeLessThan(tour);
    expect(route).toContain('}).finally(() => liberer?.());');
    // Un seul point d'entrée vers le modèle : s'il y en a un deuxième un jour, il doit passer par la file aussi.
    expect(route.match(/await tourLumi\(/g)).toHaveLength(1);
  });

  it('sans place : aucun appel au modèle, le gabarit est servi, et la trace le dit', () => {
    expect(route).toContain("!reglages.modele_autorise || occupe ? { nouveauxMessages: [], proposition: null, texte: '', cost_cents: 0, plafond: true }");
    expect(route).toContain("const texte = occupe ? messageLumiOccupe(");
    expect(route).toContain("occupe ? 'file_pleine' :");
  });
});
