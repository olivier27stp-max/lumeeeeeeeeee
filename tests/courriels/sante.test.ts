/**
 * Santé des courriels (2026-09-17) : taux de rebond sur 24 h, seuil, courriel
 * à l'exploitant, destination, heure d'envoi — fonctions pures — et le
 * branchement dans server/index.ts (statique). Aucun envoi.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculerSante, doitAlerter, adressesEnCause, composerAlerte, destinationAlerte, doitEnvoyerMaintenant, formaterTaux,
  ENTITE_ALERTE, SEUIL_TAUX, MINIMUM_ENVOIS, type LigneEnvoi,
} from '../../server/lib/courriels/sante';

const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8');

function lignes(n: { sent?: number; delivered?: number; bounced?: number; complained?: number; alertes?: number }): LigneEnvoi[] {
  const out: LigneEnvoi[] = [];
  let i = 0;
  const pousser = (status: string, count: number, entity_type: string | null = 'invoice') => {
    for (let k = 0; k < count; k++, i++) out.push({ org_id: k % 2 ? 'org-a' : 'org-b', to_email: `p${i}@exemple.test`, status, entity_type, created_at: new Date(Date.UTC(2026, 8, 17, 8, 0, i)).toISOString() });
  };
  pousser('sent', n.sent ?? 0); pousser('delivered', n.delivered ?? 0); pousser('bounced', n.bounced ?? 0); pousser('complained', n.complained ?? 0);
  pousser('sent', n.alertes ?? 0, ENTITE_ALERTE);
  return out;
}

describe('calculerSante', () => {
  it('compte envoyés, non livrés, plaintes et le taux', () => {
    const s = calculerSante(lignes({ delivered: 90, bounced: 6, complained: 4 }));
    expect(s).toEqual({ total: 100, nonLivres: 6, plaintes: 4, taux: 0.1 });
  });
  it('sans envoi, taux 0 (pas de division par zéro)', () => {
    expect(calculerSante([])).toEqual({ total: 0, nonLivres: 0, plaintes: 0, taux: 0 });
  });
  it('les alertes elles-mêmes ne comptent pas dans le total', () => {
    expect(calculerSante(lignes({ delivered: 10, alertes: 5 })).total).toBe(10);
  });
});

describe('doitAlerter — > 2 % et au moins 20 envois', () => {
  it('alerte à 3 rebonds sur 100', () => {
    expect(doitAlerter(calculerSante(lignes({ delivered: 97, bounced: 3 })))).toBe(true);
  });
  it('exactement 2 % ne déclenche pas (strictement au-dessus)', () => {
    expect(SEUIL_TAUX).toBe(0.02);
    expect(doitAlerter(calculerSante(lignes({ delivered: 98, bounced: 2 })))).toBe(false);
  });
  it('sous 20 envois, un rebond isolé ne déclenche pas (5 % sur 19, c’est du bruit)', () => {
    expect(MINIMUM_ENVOIS).toBe(20);
    expect(doitAlerter(calculerSante(lignes({ delivered: 18, bounced: 1 })))).toBe(false);
    expect(doitAlerter(calculerSante(lignes({ delivered: 19, bounced: 1 })))).toBe(true);
  });
  it('les plaintes comptent comme les rebonds', () => {
    expect(doitAlerter(calculerSante(lignes({ delivered: 30, complained: 1 })))).toBe(true);
  });
});

describe('adressesEnCause', () => {
  it('garde les rebonds et plaintes, les plus récents d’abord, 10 au plus, avec l’entreprise', () => {
    const noms = new Map([['org-a', 'Vision Lavage'], ['org-b', 'Coquin lavage']]);
    const causes = adressesEnCause(lignes({ delivered: 5, bounced: 8, complained: 4 }), noms);
    expect(causes).toHaveLength(10);
    expect(causes[0].statut).toBe('complained');
    expect(causes[0].quand > causes[9].quand).toBe(true);
    expect(causes.every((c) => c.entreprise === 'Vision Lavage' || c.entreprise === 'Coquin lavage')).toBe(true);
  });
  it('une ligne sans org est attribuée à Lume', () => {
    expect(adressesEnCause([{ org_id: null, to_email: 'x@y.z', status: 'bounced', entity_type: 'invoice', created_at: '2026-09-17T08:00:00.000Z' }], new Map())[0].entreprise).toBe('Lume');
  });
});

describe('composerAlerte', () => {
  const s = calculerSante(lignes({ delivered: 93, bounced: 5, complained: 2 }));
  const causes = adressesEnCause(lignes({ bounced: 2 }), new Map([['org-a', 'Vision Lavage']]));
  const { sujet, html } = composerAlerte(s, causes);
  it('sujet « [Lume] Taux de rebond x % sur 24 h »', () => {
    expect(formaterTaux(0.07)).toBe('7,0 %');
    expect(sujet).toBe('[Lume] Taux de rebond 7,0 % sur 24 h');
  });
  it('le corps porte les totaux, le taux, les adresses avec l’entreprise, sans signature d’équipe', () => {
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('Envoyés (24 h)');
    expect(html).toContain('>100<');
    expect(html).toContain('Non livrés');
    expect(html).toContain('>5<');
    expect(html).toContain('Plaintes');
    expect(html).toContain('>2<');
    expect(html).toContain('7,0 %');
    expect(html).toContain('p0@exemple.test');
    expect(html).toContain('Vision Lavage');
    expect(html).not.toContain('L’équipe Lume');
  });
  it('échappe les données (adresse ou nom d’entreprise piégés)', () => {
    const h = composerAlerte(s, [{ email: '<script>x</script>', entreprise: 'A & B', statut: 'bounced', quand: '2026-09-17T08:00:00.000Z' }]).html;
    expect(h).not.toContain('<script>');
    expect(h).toContain('A &amp; B');
  });
});

describe('destinationAlerte', () => {
  it('ALERT_EMAIL, sinon SECURITY_ALERT_EMAIL, sinon le support', () => {
    expect(destinationAlerte({ ALERT_EMAIL: 'ops@lume.test', SECURITY_ALERT_EMAIL: 'sec@lume.test' } as NodeJS.ProcessEnv)).toBe('ops@lume.test');
    expect(destinationAlerte({ SECURITY_ALERT_EMAIL: 'sec@lume.test' } as NodeJS.ProcessEnv)).toBe('sec@lume.test');
    expect(destinationAlerte({} as NodeJS.ProcessEnv)).toMatch(/@/);
  });
});

describe('doitEnvoyerMaintenant — 8 h Montréal, première tranche de dix minutes', () => {
  // 17 septembre 2026 : Montréal = UTC-4.
  it('8 h 03 → oui ; 8 h 10 → non ; 7 h 59 → non ; 8 h 03 UTC (4 h locales) → non', () => {
    expect(doitEnvoyerMaintenant(new Date('2026-09-17T12:03:00Z'))).toBe(true);
    expect(doitEnvoyerMaintenant(new Date('2026-09-17T12:10:00Z'))).toBe(false);
    expect(doitEnvoyerMaintenant(new Date('2026-09-17T11:59:00Z'))).toBe(false);
    expect(doitEnvoyerMaintenant(new Date('2026-09-17T08:03:00Z'))).toBe(false);
  });
});

describe('branchement (statique)', () => {
  it('server/index.ts démarre demarrerSanteCourriels avec le client service', () => {
    const src = lire('server/index.ts');
    expect(src).toContain("import('./lib/courriels/sante')");
    expect(src).toContain('demarrerSanteCourriels(serviceClient)');
  });
  it('l’alerte est journalisée sous alerte_rebonds, et le webhook ne la suit jamais (Loi 25)', () => {
    const sante = lire('server/lib/courriels/sante.ts');
    expect(sante).toContain("entityType: ENTITE_ALERTE");
    expect(ENTITE_ALERTE).toBe('alerte_rebonds');
    expect(lire('server/routes/webhooks-email.ts')).toContain("'alerte_rebonds'");
  });
  it('pas de console.log côté serveur', () => {
    expect(lire('server/lib/courriels/sante.ts')).not.toMatch(/console\.log/);
    expect(lire('server/routes/email-deliveries.ts')).not.toMatch(/console\.log/);
  });
});
