import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Le registre de consentement aux témoins était VIDE — dans les deux
 * environnements, depuis toujours.
 *
 * Trouvé le 2026-09-01 par le robot de recette : au premier chargement, quatre
 * appels à `/api/dsr/consent` repartaient en erreur sans que rien ne s'affiche.
 * L'utilisateur voyait la bannière se fermer et croyait son choix pris en
 * compte.
 *
 * Deux causes empilées, la seconde masquée par la première :
 *   1. le garde Zod refusait `org_id: null`, pourtant légitime (visiteur
 *      anonyme, sans organisation) → 400 ;
 *   2. la colonne `consents.org_id` portait un NOT NULL absent de toute
 *      migration, contraire à la conception d'origine → 500.
 *
 * Ces tests verrouillent les deux.
 */

const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8');

describe('le garde de validation accepte un org_id nul', () => {
  const gardes = lire('server/lib/validation-guards.ts');

  it('org_id, orgId et id sont nullable', () => {
    // Le CLAUDE.md l'impose : « Zod nullable() requis pour les champs pouvant
    // recevoir null des clients ». Sans lui, tout le corps est rejeté en 400.
    for (const champ of ['org_id', 'orgId', 'id']) {
      const ligne = gardes
        .split('\n')
        .find((l) => l.trim().startsWith(`${champ}: z.string().uuid()`));
      expect(ligne, `${champ} introuvable dans commonFieldsSchema`).toBeTruthy();
      expect(ligne, `${champ} doit être .nullable()`).toContain('.nullable()');
    }
  });
});

describe('la migration rétablit un org_id facultatif', () => {
  const migration = 'supabase/migrations/20260901140000_consents_org_id_nullable.sql';

  it('existe et lève bien la contrainte', () => {
    expect(fs.existsSync(path.join(RACINE, migration))).toBe(true);
    const sql = lire(migration);
    expect(sql).toContain('alter column org_id drop not null');
  });

  it('est idempotente', () => {
    const sql = lire(migration);
    // Ré-appliquée, elle ne doit pas échouer : on ne lève la contrainte que
    // si elle est encore là.
    expect(sql).toContain("is_nullable  = 'NO'");
  });

  it('laisse une trace pour qu\'on ne remette pas la contrainte', () => {
    const sql = lire(migration);
    expect(sql).toContain('comment on column public.consents.org_id');
    expect(sql).toMatch(/Ne PAS remettre de\s+.*contrainte NOT NULL/s);
  });
});

describe('le client envoie bien un org_id nul quand il n\'y a pas d\'organisation', () => {
  const api = lire('src/lib/consentApi.ts');

  it('c\'est volontaire et documenté', () => {
    expect(api).toContain('org_id: params.orgId ?? null');
  });

  it('les quatre finalités de témoins sont envoyées', () => {
    for (const p of ['cookies-essential', 'cookies-analytics', 'cookies-marketing', 'cookies-preferences']) {
      expect(api).toContain(p);
    }
  });
});
