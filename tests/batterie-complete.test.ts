/**
 * TOUT D'UN COUP — la batterie existe et couvre les trois familles.
 *
 * Le 2026-09-06, après quatre jours à sortir les bugs au compte-gouttes
 * (une couche par question), tous les instruments ont été regroupés
 * dans `npm run qa:tout`. Ce test empêche qu'un instrument disparaisse
 * de la liste sans qu'on le voie, et que la liste des angles morts
 * (Stripe en prod, envois réels, app native) soit effacée.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const TOUT = lire('scripts/qa/tout.mjs');
const PKG = JSON.parse(lire('package.json'));

describe('npm run qa:tout', () => {
  it('existe', () => { expect(PKG.scripts['qa:tout']).toContain('tout.mjs'); });

  it('couvre les trois familles', () => {
    for (const f of ["famille: 'statique'", "famille: 'base'", "famille: 'comportement'"]) expect(TOUT).toContain(f);
  });

  for (const instrument of ['tsconfig.server.json', "'vitest', 'run'", 'check:schema-refs', 'check:broken-objects', 'check:db-coherence', 'qa:invariants', 'qa:fuite', 'qa:parcours', 'qa:liens', 'qa:formulaires', 'verifier-inscription.mjs', 'mobile.mjs', 'qa:boutons']) {
    it(`inclut ${instrument}`, () => { expect(TOUT).toContain(instrument); });
  }

  it('lit la prod en lecture seule, jamais en écriture', () => {
    expect(TOUT).toContain("'--prod'");
    expect(TOUT).not.toMatch(/db:apply:prod/);
  });

  it('écrit noir sur blanc ce qu elle ne couvre pas', () => {
    expect(TOUT).toContain('Non couvert par cette batterie');
    expect(TOUT).toMatch(/Stripe en production/);
    expect(TOUT).toMatch(/SMS et de courriels/);
  });

  it('sonde IPv4 ET IPv6 avant de déclarer le front injoignable', () => {
    // Vite peut n'écouter qu'en ::1 ; ne sonder que 127.0.0.1 faisait
    // échouer toute la famille « comportement » sur ce poste.
    expect(TOUT).toContain("ecouteSur(port, '::1')");
  });
});

describe('les robots ajoutés le 2026-09-06', () => {
  it('mobile : deux passes, 390 px, débordement horizontal mesuré', () => {
    const m = lire('scripts/qa/mobile.mjs');
    expect(m).toContain('width: 390');
    expect(m).toContain('scrollWidth - document.documentElement.clientWidth');
    expect(m).toContain('iPhone');
  });

  it('fuite : repli par l API de gestion quand listUsers renvoie 0 compte', () => {
    expect(lire('scripts/qa/fuite-entre-organisations.mjs')).toContain('select id, email from auth.users');
  });
});
