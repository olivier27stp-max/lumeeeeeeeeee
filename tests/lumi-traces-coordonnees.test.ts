/**
 * Loi 25 : le journal des tours (lumi_traces) ne garde ni courriel ni téléphone.
 *
 * Tests critiques du 2026-10-01, en prod : « Cherche le client dont le courriel
 * est crit.loi25.…@lume-qa.test » laissait « crit loi25 … lume qa test » dans
 * enonce_normalise, et « 514-555-0113 » y devenait « 514 555 0113 ».
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('../server/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

import { enoncePourTrace, journaliserTrace, masquerCoordonnees, normaliserEnonce } from '../server/lib/lumi/traces';

describe('masquerCoordonnees', () => {
  it('retire un courriel, quelle que soit sa forme', () => {
    for (const c of ['crit.loi25.rsg9g@lume-qa.test', 'Marie-Eve.Tremblay+devis@videotron.qc.ca', 'a@b.co']) {
      const sortie = enoncePourTrace(`Cherche le client dont le courriel est ${c} stp`) ?? '';
      expect(sortie, c).toBe('cherche le client dont le courriel est courriel masque stp');
    }
  });
  it('retire un numéro de téléphone, quelle que soit sa ponctuation', () => {
    for (const n of ['514-555-0113', '(514) 555-0113', '514 555 0113', '5145550113', '+1 514 555 0113', '1-514-555-0113', '514.555.0113']) {
      const sortie = enoncePourTrace(`Appelle le ${n} demain`) ?? '';
      expect(sortie, n).not.toMatch(/\d{3}/);
      expect(sortie, n).toContain('telephone masque');
    }
  });
  it('laisse le reste intact : numéros de pièces, montants, dates', () => {
    for (const q of ['Envoie la facture 1042 à Tremblay', 'Combien j’ai fait en 2026 ?', 'Le devis de 1 250,00 $ du 3 octobre', 'La job 24 est à 14 h 30']) {
      expect(masquerCoordonnees(q), q).toBe(q);
    }
  });
});

describe('journaliserTrace', () => {
  it('écrit l’énoncé masqué, même quand l’appelant passe le texte brut', async () => {
    const lignes: Array<Record<string, unknown>> = [];
    const admin = { from: () => ({ insert: async (l: Record<string, unknown>) => { lignes.push(l); return { error: null }; } }) } as unknown as SupabaseClient;
    await journaliserTrace(admin, { orgId: 'o', userId: 'u', canal: 'lumi', origine: 'texte', resultat: 'ok', enonce: 'Le courriel de Nathalie est nathalie.cote@exemple.ca et son cell 514-555-0113.' });
    const enonce = String(lignes[0].enonce_normalise);
    expect(enonce).not.toMatch(/exemple|555|0113/);
    expect(enonce).toContain('courriel masque');
    expect(enonce).toContain('telephone masque');
  });
  it('les routes passent le texte BRUT au journal (normalisé, un courriel n’a plus son « @ » et ne se masque plus)', () => {
    for (const f of ['server/routes/lumi.ts', 'server/routes/sales-chat.ts', 'server/routes/support.ts', 'server/lib/sms/lumi-sms.ts']) {
      const s = readFileSync(resolve(__dirname, '..', f), 'utf8');
      expect(s, f).not.toMatch(/enonce: normaliserEnonce\(/);
    }
  });
  it('les clés de cache, elles, ne sont PAS masquées : deux adresses différentes restent deux questions', () => {
    expect(normaliserEnonce('le client a@b.co')).not.toBe(normaliserEnonce('le client c@d.co'));
  });
});
