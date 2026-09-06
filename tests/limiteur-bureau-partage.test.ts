/**
 * UN BUREAU ENTIER NE DOIT PAS ÊTRE BLOQUÉ PARCE QUE QUATRE PERSONNES
 * OUVRENT LUME EN MÊME TEMPS.
 *
 * MESURÉ LE 2026-09-06 (front propre, staging)
 * Un chargement de page déclenche 7 à 8 appels /api, tous dans les 3
 * premières secondes. Le limiteur global était par ADRESSE IP : 30
 * requêtes par 3 s, puis blocage de 2 minutes, et liste noire d'un
 * quart d'heure après 10 infractions.
 *
 * Or une entreprise sort sur Internet par une seule IP publique. Quatre
 * employés qui ouvrent l'application à 8 h depuis le Wi-Fi du garage —
 * ou un seul qui appuie quatre fois sur F5 — bloquaient tout le monde :
 * courriels, factures, géocodage, tout échouait pendant deux minutes.
 * Le robot de recette l'a déclenché tout seul à mi-campagne : 69 clics
 * en « erreur silencieuse », tous des 429.
 *
 * CE QUE CES TESTS FIGENT
 * Deux couches : par utilisateur (serrée, freine un compte seul, jamais
 * de liste noire d'IP) et par IP (filet anti-inondation, hors de portée
 * d'un usage normal). Le scénario du bureau passe ; celui du script qui
 * martèle est toujours arrêté.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '..', 'server/lib/security.ts'), 'utf8');

/* ── 1. Comportement réel, à travers les middlewares montés ─────── */

type Mw = (req: any, res: any, next: () => void) => void;

/** Monte les middlewares de sécurité dans un faux `app` et ne garde que les limiteurs. */
async function limiteurs(): Promise<Mw[]> {
  const mod = await import('../server/lib/security');
  const empiles: Mw[] = [];
  mod.applySecurityMiddleware({ use: (mw: Mw) => empiles.push(mw) });
  // Les limiteurs sont les middlewares qui lisent `Retry-After`/429 ; on les
  // reconnaît en les faisant tourner : les autres appellent next() sans état.
  return empiles;
}

/** Fabrique une requête minimale : IP + jeton (sub non vérifié, comme en prod). */
function requete(ip: string, sub: string | null) {
  const payload = sub ? Buffer.from(JSON.stringify({ sub })).toString('base64') : '';
  return {
    ip,
    path: '/api/features',
    method: 'GET',
    headers: sub ? { authorization: `Bearer x.${payload}.y` } : {},
    body: {},
    query: {},
    params: {},
    socket: { remoteAddress: ip },
    get: () => undefined,
  };
}

/** Passe une requête à travers la chaîne ; renvoie le statut refusé, ou null. */
function passer(chaine: Mw[], req: any): number | null {
  let statut: number | null = null;
  const res: any = {
    set: () => res, setHeader: () => res, getHeader: () => undefined,
    status: (s: number) => { statut = s; return res; },
    json: () => res, send: () => res, end: () => res, on: () => res,
    locals: {},
  };
  for (const mw of chaine) {
    let suivant = false;
    mw(req, res, () => { suivant = true; });
    if (!suivant) break;
  }
  return statut;
}

describe('cinq employés derrière la même IP', () => {
  let chaine: Mw[];
  beforeEach(async () => { chaine = await limiteurs(); });

  it('ouvrent Lume en même temps sans qu aucun ne soit bloqué', () => {
    // 5 comptes × 8 appels = 40 requêtes depuis une seule IP, en rafale.
    // Sous l'ancienne règle (30 par IP), le cinquième employé — et tous
    // les suivants — recevaient 429.
    const IP = '203.0.113.10';
    const refus: number[] = [];
    for (let u = 0; u < 5; u++) {
      for (let k = 0; k < 8; k++) {
        const s = passer(chaine, requete(IP, `employe-${u}`));
        if (s) refus.push(s);
      }
    }
    expect(refus).toEqual([]);
  });

  it('un seul qui appuie quatre fois sur F5 n est pas bloqué non plus', () => {
    const refus: number[] = [];
    for (let k = 0; k < 32; k++) {
      const s = passer(chaine, requete('203.0.113.11', 'impatient'));
      if (s) refus.push(s);
    }
    expect(refus).toEqual([]);
  });
});

describe('les abus sont toujours arrêtés', () => {
  let chaine: Mw[];
  beforeEach(async () => { chaine = await limiteurs(); });

  it('un compte qui martèle est freiné — seul', () => {
    const IP = '203.0.113.20';
    let bloque = false;
    for (let k = 0; k < 60 && !bloque; k++) bloque = passer(chaine, requete(IP, 'script')) === 429;
    expect(bloque).toBe(true);
    // Son collègue sur la même IP continue de travailler.
    expect(passer(chaine, requete(IP, 'collegue'))).toBeNull();
  });

  it('une inondation anonyme depuis une IP est arrêtée', () => {
    let bloque = false;
    for (let k = 0; k < 200 && !bloque; k++) bloque = passer(chaine, requete('198.51.100.5', null)) === 429;
    expect(bloque).toBe(true);
  });

  it('une inondation multi-comptes depuis une IP est arrêtée par le filet IP', () => {
    // Un attaquant qui forge un `sub` différent à chaque requête contourne
    // la couche par utilisateur ; la couche par IP doit le rattraper.
    let bloque = false;
    for (let k = 0; k < 400 && !bloque; k++) bloque = passer(chaine, requete('198.51.100.6', `forge-${k}`)) === 429;
    expect(bloque).toBe(true);
  });
});

/* ── 2. La forme du code, pour que la structure ne régresse pas ──── */

describe('la structure du limiteur global', () => {
  const bloc = SRC.slice(SRC.indexOf('export function applySecurityMiddleware'));

  it('la première couche est par utilisateur', () => {
    expect(bloc).toMatch(/keyFn:\s*\(req\)\s*=>\s*userKey\(req\)/);
  });

  it('elle ne met jamais un identifiant d utilisateur en liste noire d adresses', () => {
    const i = bloc.indexOf('userKey(req)');
    expect(bloc.slice(i, i + 500)).toMatch(/if \(key\.startsWith\('ip:'\)\)/);
  });

  it('la couche IP tolère au moins 100 requêtes par rafale', () => {
    const m = /keyFn:\s*\(req\)\s*=>\s*`ipg:/.exec(bloc);
    expect(m).not.toBeNull();
    const avant = bloc.slice(Math.max(0, m!.index - 300), m!.index);
    const burst = /burstMax:\s*(\d[\d_]*)/.exec(avant);
    expect(Number(burst![1].replace(/_/g, ''))).toBeGreaterThanOrEqual(100);
  });
});
