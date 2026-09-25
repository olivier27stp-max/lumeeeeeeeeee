/**
 * « Champs personnalisés : cette fonctionnalité n'est pas encore activée »
 * alors que le module est actif (Rafba, 2026-09-25). Compte à plusieurs
 * bureaux : au démarrage, /api/features partait SANS bureau → 400 « bureau
 * requis » → le hook concluait « désactivé » et ne relisait jamais.
 * Reproduit au navigateur sur le build prod (x-org-id absent → 400).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const lire = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('useModuleAccess', () => {
  const h = lire('src/hooks/useModuleAccess.ts');
  it('n’interroge pas le serveur tant que le bureau actif est inconnu', () => {
    expect(h).toContain('if (!bureauActifSync()) { setEchecLecture(true); return; }');
  });
  it('relit quand le bureau actif est posé ou change', () => {
    expect(h).toContain('return abonnerBureauActif(() => { void fetchFlag(); });');
  });
});

describe('page Champs personnalisés', () => {
  it('un état inconnu n’affiche jamais « pas encore activée »', () => {
    expect(lire('src/pages/settings/ChampsPersoSettings.tsx')).toContain('if (chargeDrapeau || indetermine) return null;');
  });
});
