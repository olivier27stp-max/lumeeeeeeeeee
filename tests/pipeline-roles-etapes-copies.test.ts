/**
 * Les étapes « Soumission envoyée » / « Soumission ouverte » gardent leur rôle
 * (2026-09-30). Les déplacements automatiques visent l'étape par son rôle :
 * une copie de pipeline qui le perdait ne bougeait plus jamais au devis
 * envoyé. Le comportement est prouvé contre staging (copie → rôles gardés) ;
 * ce test fige les trois endroits qui doivent le porter.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261003510000_pipeline_roles_etapes_copies.sql', 'utf8');
const fonction = (nom: string) => {
  const i = sql.indexOf(`FUNCTION public.${nom}(`);
  return sql.slice(i, sql.indexOf('$function$;', i));
};

describe('rôles des étapes de pipeline', () => {
  it('une copie de pipeline recopie le rôle de chaque étape', () => {
    expect(fonction('_pipeline_copier')).toMatch(/show_in_pie, role_systeme\s*\)/);
    expect(fonction('_pipeline_copier')).toMatch(/e\.role_systeme\s*\n\s*from/);
  });

  it('un pipeline sur mesure reçoit le rôle d’après le nom de l’étape', () => {
    expect(fonction('creer_pipeline_sur_mesure')).toMatch(/pipeline_role_d_apres_nom\(v_etape ->> 'nom_fr'\)/);
  });

  it('le nom reconnu : accents, casse et espaces sans importance', () => {
    expect(sql).toMatch(/'soumission envoyee'/);
    expect(sql).toMatch(/'soumission ouverte'/);
    expect(sql).toMatch(/translate\(/);
    expect(sql).toMatch(/regexp_replace\(lower\(/);
  });
});
