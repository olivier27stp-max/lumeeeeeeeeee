/**
 * T14 — GOLDEN SET des 35 presets d'automatisation, et T3.11 — vocabulaire.
 *
 * Pour chaque preset, le banc (`golden/_banc-golden.ts`) rejoue l'événement sur
 * un jeu de données fixe, dépile les tâches différées à leur échéance, et
 * capture TOUT ce qui sort : SMS, courriels, notifications, tâches, activité,
 * planifications. Le résultat est comparé, à l'octet près, au fichier
 * `golden/<preset_key>.json`.
 *
 *   - Fichier absent → rouge, avec la marche à suivre.
 *   - Différence → rouge : un texte, un délai ou un canal a changé. Si c'est
 *     voulu, régénérer SCIEMMENT ce seul fichier avec
 *         GOLDEN_UPDATE=<preset_key> npx vitest run tests/automation/golden.test.ts
 *     (ou GOLDEN_UPDATE=1 pour tout) et relire le diff dans le commit.
 *
 * T3.11 relit les mêmes sorties et vérifie qu'elles sont présentables pour un
 * client : pas de variable orpheline, pas de « Bonjour , », pas de statut
 * anglais, montants en dollars canadiens, SMS d'une longueur raisonnable,
 * aucune action en échec, aucune tâche annulée par sa propre condition d'arrêt.
 *
 * ROUGE ATTENDU aujourd'hui (6) :
 *   - invoice_sent_reminder_1d/3d/7d/14d/30d : `[invoice_total]` sort en
 *     « $1626.90 » (actions/index.ts:380) au lieu de « 1 626,90 $ » ;
 *   - lost_lead_reengagement : la tâche est ANNULÉE au dépilage par
 *     checkStopConditions (lead_status = 'lost' ⇒ arrêt), alors que le preset
 *     ne se déclenche QUE sur un lead perdu — il ne peut jamais partir (F25).
 *
 * Fuseau forcé sur America/Toronto et horloge figée : le résultat ne dépend
 * ni de la machine ni du jour (voir T9 pour la dépendance réelle au fuseau).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const courriels: any[] = [];
const sms: any[] = [];
vi.mock('../../../server/lib/mailer', () => ({
  isMailerConfigured: () => true,
  sendEmail: vi.fn(async (p: any) => { courriels.push({ to: p.to, subject: p.subject, html: p.html }); return { sent: true, messageId: 'golden' }; }),
}));
vi.mock('../../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'qa@lume.test' }) }));
vi.mock('../../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));

import { AUTOMATION_PRESETS } from '../../../server/lib/automationPresets.data';
import { jouer, type Sortie } from './golden/_banc-golden';

const DOSSIER = join(__dirname, 'golden');
const MAJ = process.env.GOLDEN_UPDATE || '';
const TZ_ORIGINE = process.env.TZ;
const sorties = new Map<string, Sortie>();

afterEach(() => { vi.useRealTimers(); if (TZ_ORIGINE === undefined) delete process.env.TZ; else process.env.TZ = TZ_ORIGINE; });

describe('T14 — golden set : chaque preset produit exactement ce qui est attendu', () => {
  for (const preset of AUTOMATION_PRESETS) {
    it(`${preset.preset_key} (${preset.trigger_event}, ${preset.delay_seconds} s)`, async () => {
      const sortie = await jouer(preset, { sms, courriels });
      sorties.set(preset.preset_key, sortie);
      const fichier = join(DOSSIER, `${preset.preset_key}.json`);
      if (MAJ === '1' || MAJ === preset.preset_key) {
        mkdirSync(DOSSIER, { recursive: true });
        writeFileSync(fichier, JSON.stringify(sortie, null, 2) + '\n');
      }
      expect(existsSync(fichier), `golden absent : ${fichier} — générer avec GOLDEN_UPDATE=${preset.preset_key}`).toBe(true);
      const attendu = JSON.parse(readFileSync(fichier, 'utf8'));
      expect(sortie).toEqual(attendu);
    });
  }
});

describe('T3.11 — vocabulaire et qualité des messages produits', () => {
  const ORPHELIN = /\[[a-z_]+\]/;
  // Un espace AVANT la virgule = un prénom qui manquait (« Bonjour , ») ; « Merci, » suivi
  // de la signature de l'entreprise est légitime.
  const SALUT_VIDE = /(Bonjour|Merci|Allo|Hi|Hello|Thank you)\s+[,!]/;
  const STATUT_ANGLAIS = /\b(scheduled|completed|in_progress|past_due|overdue|cancelled)\b/;
  const ARGENT_US = /\$\s?\d[\d,]*\.\d{2}/;
  const ARGENT_CA = /\d[\d ]*,\d{2}\s?\$/;

  for (const preset of AUTOMATION_PRESETS) {
    it(`${preset.preset_key} : messages présentables`, () => {
      const s = sorties.get(preset.preset_key);
      expect(s, 'sortie non produite (voir T14)').toBeDefined();
      if (!s) return;
      const fautes: string[] = [];
      if (s.erreurs.length) fautes.push(`actions en échec : ${s.erreurs.join(' | ')}`);
      if (s.annulees.length) fautes.push(`tâche annulée par la condition d'arrêt AVANT toute exécution — ce preset ne peut jamais partir : ${s.annulees.join(', ')}`);
      const envoyes = s.messages.filter((m) => m.canal === 'sms' || m.canal === 'courriel' || m.canal === 'notification' || m.canal === 'tache' || m.canal === 'avis');
      if (envoyes.length === 0) fautes.push('aucun message produit : preset mort ou événement/condition non satisfaits');
      for (const m of envoyes) {
        const texte = `${m.subject ?? ''}\n${m.body}`;
        const ou = `${m.canal}${m.subject ? ` « ${m.subject} »` : ''}`;
        if (/\bundefined\b|\bnull\b/.test(texte)) fautes.push(`${ou} : « undefined »/« null » dans le texte`);
        if (ORPHELIN.test(texte)) fautes.push(`${ou} : variable non résolue ${ORPHELIN.exec(texte)![0]}`);
        if (SALUT_VIDE.test(texte)) fautes.push(`${ou} : salutation sans prénom « ${SALUT_VIDE.exec(texte)![0]} »`);
        if (m.canal === 'sms' || m.canal === 'courriel') {
          if (STATUT_ANGLAIS.test(texte)) fautes.push(`${ou} : statut anglais « ${STATUT_ANGLAIS.exec(texte)![0]} »`);
          if (ARGENT_US.test(texte)) fautes.push(`${ou} : montant au format américain « ${ARGENT_US.exec(texte)![0]} » (attendu « 1 626,90 $ »)`);
          if (/\d/.test(texte) && /(\$|dollars)/.test(texte) && !ARGENT_CA.test(texte) && !ARGENT_US.test(texte)) fautes.push(`${ou} : montant mal formé`);
        }
        if (m.canal === 'sms' && m.body.length > 320) fautes.push(`sms : ${m.body.length} caractères (> 2 segments)`);
        if (m.canal === 'sms' && !m.to) fautes.push('sms sans destinataire');
        if (m.canal === 'courriel' && !m.subject?.trim()) fautes.push('courriel sans objet');
      }
      expect(fautes, fautes.join('\n')).toEqual([]);
    });
  }

  it('chaque SMS et courriel de preset a sa version anglaise (body_en / subject_en)', () => {
    const manquants: string[] = [];
    for (const p of AUTOMATION_PRESETS) {
      for (const a of p.actions) {
        const c = a.config as Record<string, unknown>;
        if ((a.type === 'send_sms' || a.type === 'send_email') && !(typeof c.body_en === 'string' && (c.body_en as string).trim())) manquants.push(`${p.preset_key}/${a.type} body_en`);
        if (a.type === 'send_email' && !(typeof c.subject_en === 'string' && (c.subject_en as string).trim())) manquants.push(`${p.preset_key}/send_email subject_en`);
      }
    }
    expect(manquants, manquants.join(', ')).toEqual([]);
  });
});
