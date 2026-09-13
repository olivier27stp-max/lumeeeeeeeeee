/**
 * Garde-fous de Lumi (item 3, AGENTFORCE_GAP.md B6) :
 * - plafond d'écritures par conversation (cran d'arrêt, pas un quota) ;
 * - « terminer une job » redevient sensible quand une automatisation active
 *   envoie quelque chose au client ;
 * - la mémoire de Lumi et le journal des actions sont sous permission ;
 * - le mode « tout » est réservé au propriétaire.
 * Tout est pur ou simulé : aucune base.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../server/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { compterEcritures, ecrituresSensiblesPour, outilsAutorisesParMode, ECRITURES_SENSIBLES, PLAFOND_ECRITURES_PAR_CONVERSATION } from '../server/lib/lumi/execution';
import { PERMISSION_PAR_OUTIL } from '../server/lib/agent/garde';
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';

const lu = (p: string) => readFileSync(resolve(__dirname, '..', ...p.split('/')), 'utf8');

function adminAvecRegles(regles: Array<{ actions: unknown }> | Error) {
  const chaine: any = {};
  for (const m of ['select', 'eq', 'is']) chaine[m] = vi.fn(() => chaine);
  chaine.then = (ok: any, ko: any) => (regles instanceof Error ? Promise.resolve({ data: null, error: regles }) : Promise.resolve({ data: regles, error: null })).then(ok, ko);
  return { from: vi.fn(() => chaine) } as any;
}

describe('plafond d écritures par conversation', () => {
  it('compte les reçus executed dans les tool_result, rien d autre', () => {
    const msgs = [
      { role: 'user', content: 'crée un job' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'create_job', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: JSON.stringify({ executed: true, result: {} }) }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: JSON.stringify({ cancelled: true }) }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c', content: JSON.stringify({ jobs: [], note: 'executed":true dans une note ne compte pas' }) }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'd', content: JSON.stringify({ executed: true, auto: true }) }] },
    ];
    expect(compterEcritures(msgs)).toBe(2);
    expect(compterEcritures([])).toBe(0);
    expect(PLAFOND_ECRITURES_PAR_CONVERSATION).toBe(20);
  });

  it('la route refuse Confirmer au-delà du plafond (409 plafond_ecritures) et l orchestrateur cesse l exécution d office', () => {
    const route = lu('server/routes/lumi.ts');
    expect(route).toContain("code: 'plafond_ecritures'");
    expect(route).toContain('faites + enAttente.length > PLAFOND_ECRITURES_PAR_CONVERSATION');
    expect(route).toContain('ecrituresRestantes: Math.max(0, PLAFOND_ECRITURES_PAR_CONVERSATION - compterEcritures(');
    const orch = lu('server/lib/lumi/orchestrateur.ts');
    expect(orch).toContain('const sousLePlafond = opts.ecrituresRestantes === undefined || opts.ecrituresRestantes > 0;');
    expect(orch).toContain("if (outil.kind === 'write' && dOffice && sousLePlafond)");
  });
});

describe('terminer une job devient sensible quand une automatisation parle au client', () => {
  it('règle job.completed active avec request_review / send_sms / send_email → update_job_status sensible', async () => {
    const s = await ecrituresSensiblesPour(adminAvecRegles([{ actions: [{ type: 'request_review', config: {} }, { type: 'log_activity' }] }]), 'org');
    expect(s.has('update_job_status')).toBe(true);
    for (const t of ECRITURES_SENSIBLES) expect(s.has(t)).toBe(true);
  });
  it('sans règle vers le client (ou règle interne seulement) → pas sensible ; base illisible → sensible (en doute, on demande)', async () => {
    expect((await ecrituresSensiblesPour(adminAvecRegles([]), 'org')).has('update_job_status')).toBe(false);
    expect((await ecrituresSensiblesPour(adminAvecRegles([{ actions: [{ type: 'create_task' }] }]), 'org')).has('update_job_status')).toBe(false);
    expect((await ecrituresSensiblesPour(adminAvecRegles(new Error('boom')), 'org')).has('update_job_status')).toBe(true);
  });
  it('le mode « argent » respecte la liste dynamique ; « demander » ne laisse rien passer ; « tout » tout', () => {
    const outils = ['create_task', 'update_job_status', 'send_sms'];
    const sensibles = new Set([...ECRITURES_SENSIBLES, 'update_job_status']);
    expect([...outilsAutorisesParMode('argent', outils, sensibles)]).toEqual(['create_task']);
    expect([...outilsAutorisesParMode('argent', outils)]).toEqual(['create_task', 'update_job_status']);
    expect(outilsAutorisesParMode('demander', outils, sensibles).size).toBe(0);
    expect(outilsAutorisesParMode('tout', outils, sensibles).size).toBe(3);
  });
});

describe('permissions et rôles', () => {
  it('toute écriture a une clé de la page Rôles ; la mémoire de Lumi est un réglage d entreprise', () => {
    const ecritures = Object.keys(TOOLS_BY_NAME).filter((n) => TOOLS_BY_NAME[n].kind === 'write');
    const sansCle = ecritures.filter((n) => !PERMISSION_PAR_OUTIL[n]);
    expect(sansCle).toEqual([]);
    expect(PERMISSION_PAR_OUTIL.remember_this.cle).toBe('settings.update');
    expect(PERMISSION_PAR_OUTIL.forget_note.cle).toBe('settings.update');
    expect(PERMISSION_PAR_OUTIL.get_recent_agent_actions.cle).toBe('reports.read');
  });
  it('le mode « tout » est refusé à qui n est pas propriétaire (403 mode_reserve_proprietaire), et l interface le dit', () => {
    const route = lu('server/routes/lumi.ts');
    expect(route).toContain("if (mode === 'tout') {");
    expect(route).toContain("ctxRole?.role !== 'owner'");
    expect(route).toContain("code: 'mode_reserve_proprietaire'");
    expect(lu('src/pages/Lumi.tsx')).toContain('mode_reserve_proprietaire');
    expect(lu('src/lib/lumiApi.ts')).toContain("throw new ErreurLumi(body?.code || `http_${res.status}`, body?.error || 'Unable to update mode')");
  });
  it('delete_task est un soft delete (deleted_at), jamais un DELETE (R8)', () => {
    const src = lu('server/lib/agent/tools-etendus.ts');
    const bloc = src.slice(src.indexOf("name: 'delete_task'"), src.indexOf("name: 'delete_task'") + 2500);
    expect(bloc).toContain('deleted_at: new Date().toISOString()');
    expect(bloc).not.toMatch(/from\('tasks'\)\s*\.delete\(\)/);
  });
});
