/**
 * B-20 — l'ANCIEN système d'automatisations tournait encore à chaque tick,
 * pour rien : le planificateur lisait la table `automations` (vide en prod,
 * aucun écran n'y écrit) et, s'il y avait trouvé une ligne, aurait envoyé
 * ses textos par un chemin à lui — hors pause d'entreprise, hors arrêt
 * global, sans fenêtre d'envoi, sans consentement ni plafond.
 *
 * Retiré : la lecture, ses cinq traitements, leur envoi et leur garde. Et
 * deux fonctions jamais appelées (`delayToSeconds`, `annulerSequence`).
 *
 * NON retiré, contrairement à la liste de l'enquête : le clonage des
 * factures récurrentes (`invoices.is_recurring`). L'interrupteur « Facture
 * récurrente » de la fiche d'une facture l'écrit toujours ; le planificateur
 * est son seul lecteur. Le retirer aurait éteint une fonction offerte à
 * l'écran. Ce test garde les deux ensemble.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (chemin: string) => readFileSync(resolve(__dirname, '../../..', chemin), 'utf8');
const scheduler = lire('server/lib/scheduler.ts');

describe('[B-20] l’ancien système d’automatisations ne tourne plus', () => {
  it('le planificateur ne lit plus la table `automations`', () => {
    expect(scheduler).not.toContain("from('automations')");
  });

  it('ses cinq traitements, leur envoi de texto et leur garde sont retirés', () => {
    expect(scheduler).not.toMatch(/handleDaysAfterQuoteSent|handleDaysBeforeAppointment|handleOnInvoiceDueDate|handleDaysAfterInvoiceDue|handleDaysAfterJobCompleted/);
    expect(scheduler).not.toMatch(/sendOrgSms|runAutomationOnce|notifyAutomationResult|sendSmsIfConfigured/);
    expect(scheduler).not.toContain('async function hasFired(');
  });

  it('aucun autre fichier du serveur ou de l’app ne lit cette table : rien ne dépendait de ce code', () => {
    for (const fichier of ['server/index.ts', 'server/routes/automation-rules.ts', 'server/lib/automationEngine.ts', 'src/lib/automationsApi.ts']) {
      let source = '';
      try { source = lire(fichier); } catch { continue; }
      expect(source, fichier).not.toContain("from('automations')");
    }
  });

  it('les fonctions jamais appelées sont parties : `delayToSeconds` (moteur), `annulerSequence` (parcours)', () => {
    expect(lire('server/lib/automationEngine.ts')).not.toContain('function delayToSeconds');
    expect(lire('server/lib/automationSequences.ts')).not.toContain('annulerSequence');
  });
});

describe('[B-20] ce qui reste, parce que ça sert', () => {
  it('le tick garde la file du moteur, les factures en retard et les devis expirés', () => {
    expect(scheduler).toContain('await viderFile(supabase);');
    expect(scheduler).toContain('await detectOverdueInvoices(supabase);');
    expect(scheduler).toContain('await expireOverdueQuotes(supabase);');
    expect(scheduler).toContain("hasFiredLocal('overdue-detection'");
    expect(scheduler).toContain("hasFiredLocal('quote-expiry'");
  });

  it('le clonage des factures récurrentes reste : l’interrupteur de la fiche d’une facture l’écrit encore', () => {
    const fiche = lire('src/pages/InvoiceDetails.tsx');
    expect(fiche).toContain('is_recurring: checked');
    expect(scheduler).toContain('await handleRecurringInvoices(supabase);');
    expect(scheduler).toContain(".eq('is_recurring', true)");
  });
});
