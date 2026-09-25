// Page d'aide « Exporter depuis Jobber » et périmètre honnête du lancement.
import { describe, it, expect } from 'vitest';
import { CRM_EXPORT_CONFIGS, LIMITES_LANCEMENT, getCrmConfig } from '../../server/lib/migration/instructions';
import { detailIntrouvable } from '../../server/lib/migration/importer';

describe('Exporter depuis Jobber', () => {
  const j = CRM_EXPORT_CONFIGS.jobber;
  it('nomme les cinq rapports, numérotés, dans l\'ordre client → soumissions → jobs → visites → factures', () => {
    const fr = j.reports.map((r) => r.fr);
    expect(fr[0]).toMatch(/^1\. « Client Contact Info »/);
    expect(fr[1]).toMatch(/^2\. « Quotes »/);
    expect(fr[2]).toMatch(/^3\. « One-Off Jobs »/);
    expect(fr[3]).toMatch(/^4\. « Visits »/);
    expect(fr[4]).toMatch(/^5\. « Invoices »/);
    expect(fr[5]).toMatch(/^Facultatif/);
  });
  it('exige la période « All time » et le statut « All », et nomme le piège des 30 jours', () => {
    const etapes = j.steps.map((s) => s.fr).join('\n');
    expect(etapes).toContain('« All time »');
    expect(etapes).toContain('« All »');
    expect(etapes).toMatch(/30 derniers jours/);
    expect(etapes).toMatch(/29 lignes/);
    const en = j.steps.map((s) => s.en).join('\n');
    expect(en).toContain('"All time"');
  });
  it('accepte CSV et Excel et prévient que les visites dépendent du fichier Jobs', () => {
    expect(j.formats).toEqual(['csv', 'xlsx']);
    expect(j.knownLimitations.map((l) => l.fr).join(' ')).toMatch(/Job #/);
  });
});

describe('périmètre du lancement', () => {
  it('les quatre limites sont dites et répétées pour chaque CRM source', () => {
    const fr = LIMITES_LANCEMENT.map((l) => l.fr).join('\n');
    for (const mot of ['notes', 'pièces jointes', 'étiquettes', 'champs personnalisés', 'demandes de service', 'jobs récurrents', 'sans contrat de service', 'première feuille', '20 000', '50 000']) {
      expect(fr, mot).toContain(mot);
    }
    for (const cfg of Object.values(CRM_EXPORT_CONFIGS)) {
      expect(cfg.notImported, cfg.key).toBe(LIMITES_LANCEMENT);
    }
    expect(getCrmConfig('jobber').notImported).toHaveLength(4);
  });
});

describe('motifs de rejet avec la référence manquante', () => {
  it('« job introuvable » porte le numéro cherché — relevable directement dans rejects.csv', () => {
    expect(detailIntrouvable('job', '#4512', 'numéro absent du fichier Jobs ou ambigu')).toBe('job introuvable : « #4512 » (numéro absent du fichier Jobs ou ambigu)');
  });
  it('référence vide → « référence absente » ; référence longue → tronquée à 60', () => {
    expect(detailIntrouvable('client', '   ', 'x')).toBe('client introuvable : référence absente (x)');
    const long = 'a'.repeat(80);
    const d = detailIntrouvable('client', long, 'x');
    expect(d).toContain(`« ${'a'.repeat(57)}… »`);
  });
});
