/**
 * Le titre de la carte dit l'ACTION (src/lib/lumiVerbes.ts).
 *
 * Avant : 161 outils d'écriture sur 181 affichaient la phrase de leur permission,
 * identique pour des actions contraires. Ici : chaque outil d'écriture a son verbe,
 * dans les deux langues, et deux actions différentes n'ont jamais le même titre.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AGENT_TOOLS } from '../server/lib/agent/tools';
import { VERBES_LUMI, verbeLumi } from '../src/lib/lumiVerbes';

const ECRITURES = AGENT_TOOLS.filter((t) => t.kind === 'write').map((t) => t.declaration.name);

describe('verbes des cartes de Lumi', () => {
  it('chaque outil d’écriture a un verbe, et aucun verbe ne vise un outil disparu', () => {
    expect(ECRITURES.filter((n) => !VERBES_LUMI[n]), 'outils d’écriture sans verbe').toEqual([]);
    expect(Object.keys(VERBES_LUMI).filter((n) => !ECRITURES.includes(n)), 'verbes sans outil').toEqual([]);
  });

  it('un verbe à l’infinitif, en minuscules, sans jargon ni nom d’outil', () => {
    for (const [outil, v] of Object.entries(VERBES_LUMI)) {
      for (const texte of [v.fr, v.en]) {
        expect(texte.length, outil).toBeGreaterThan(4);
        expect(texte, outil).toMatch(/^[a-zà-ÿ]/);
        expect(texte, outil).not.toMatch(/_|\bid\b|\buuid\b/i);
      }
    }
  });

  it('deux outils différents n’ont jamais le même titre', () => {
    for (const langue of ['fr', 'en'] as const) {
      const vus = new Map<string, string>();
      for (const [outil, v] of Object.entries(VERBES_LUMI)) {
        expect(vus.get(v[langue]), `« ${v[langue]} » : ${outil} et ${vus.get(v[langue])}`).toBeUndefined();
        vus.set(v[langue], outil);
      }
    }
  });

  it('les actions contraires se distinguent', () => {
    const fr = (o: string, a: Record<string, unknown> = {}) => verbeLumi(o, a)!.fr;
    expect(fr('mark_payroll_period_paid')).not.toBe(fr('unmark_payroll_period_paid'));
    expect(fr('add_client_tag')).not.toBe(fr('remove_client_tag'));
    expect(fr('create_payment_request')).not.toBe(fr('resend_payment_request'));
    expect(fr('send_agreement_email')).not.toBe(fr('send_agreement_sms'));
    expect(fr('delete_email_template')).not.toBe(fr('set_default_email_template'));
    expect(fr('punch_in')).not.toBe(fr('punch_out'));
    expect(fr('set_member_permissions')).not.toBe(fr('reset_member_permissions'));
    expect(fr('remove_card_on_file')).toBe('retirer la carte au dossier');
  });

  it('le verbe suit l’argument quand il change le sens', () => {
    const fr = (o: string, a: Record<string, unknown> = {}) => verbeLumi(o, a)!.fr;
    expect(fr('archive_job')).toBe('archiver un job');
    expect(fr('archive_job', { restore: true })).toBe('désarchiver un job');
    expect(fr('toggle_automation_rule', { is_active: false })).toBe('mettre une automatisation en pause');
    expect(fr('toggle_automation_rule', { is_active: true })).toBe('activer une automatisation');
    expect(fr('update_task_status', { status: 'done' })).toBe('terminer une tâche');
    expect(fr('bulk_update_task_status', { status: 'open' })).toBe('rouvrir plusieurs tâches');
    expect(fr('cancel_quote', { reason: 'declined' })).toBe('marquer une soumission refusée');
    expect(fr('cancel_quote')).toBe('archiver une soumission'); // le défaut de l'outil
    expect(fr('publish_course', { publish: false })).toBe('dépublier une formation');
    expect(fr('update_job_status', { status: 'completed' })).toBe('marquer un job terminé');
    expect(fr('update_job_status', { status: 'cancelled' })).toBe('annuler un job');
    expect(fr('refund_payment')).toBe('rembourser un paiement au complet');
    expect(fr('refund_payment', { amount_cents: 5000 })).toBe('rembourser une partie d’un paiement');
    expect(verbeLumi('outil_inconnu', {})).toBeNull();
  });

  it('la carte s’en sert pour son titre', () => {
    const src = readFileSync(resolve(__dirname, '..', 'src/components/lumi/CarteAutorisation.tsx'), 'utf8');
    expect(src).toContain("import { verbeLumi } from '../../lib/lumiVerbes';");
    expect(src).toContain('const exact = verbeLumi(p.tool, p.args);');
  });
});
