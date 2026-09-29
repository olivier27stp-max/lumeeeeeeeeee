/**
 * Launch 2026-09-28 — bloc 4 : les limites de débit de /api/automations/*
 * s'appliquent que Redis soit configuré ou non. Elles étaient dans le bloc
 * `if (!useRedis)` sans équivalent Redis : avec Upstash, aucune limite
 * (générations Lumi comprises, chacune facturée).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('server/index.ts', 'utf8');
const debutBloc = src.indexOf('if (!useRedis) {');
const finBloc = src.indexOf('\n}\n', debutBloc);

describe('limiteurs des automatisations', () => {
  it.each(["app.use('/api/automations/events', automationLimiter)", "app.use('/api/automations/rules', reglesLimiter)"])('%s est posé HORS du bloc « sans Redis »', (ligne) => {
    const i = src.indexOf(ligne);
    expect(i).toBeGreaterThan(-1);
    expect(i > debutBloc && i < finBloc, 'posé seulement quand Redis est absent').toBe(false);
  });
});
