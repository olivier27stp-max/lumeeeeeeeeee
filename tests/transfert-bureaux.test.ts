// Transfert entre bureaux (Q13) : copie dans le bureau cible + original archivé.
// Preuve en conditions réelles : e2e PostgREST staging 23/23.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const sql = lire('supabase/migrations/20260928000000_transfert_entre_bureaux.sql');

describe('transfert entre bureaux', () => {
  it('droits : admin/propriétaire des DEUX bureaux, même entreprise', () => {
    expect(sql).toMatch(/has_org_admin_role\(v_uid, v_src\) and public\.has_org_admin_role\(v_uid, p_org_cible\)/);
    expect(sql).toMatch(/company_group_id from public\.orgs where id = v_src\)\s*is distinct from/);
  });
  it('une facture ne change jamais de bureau ; une soumission acceptée non plus', () => {
    expect(sql).toMatch(/une facture ne change jamais de bureau/);
    expect(sql).toMatch(/q\.status not in \('draft', 'awaiting_response', 'changes_requested'\)/);
  });
  it('copie dans le bureau CIBLE : l’en-tête du bureau est basculé puis restauré', () => {
    expect(sql).toMatch(/jsonb_build_object\('x-lume-org', p_org_cible::text/);
    expect(sql.match(/perform set_config\('request\.headers', coalesce\(v_entete, ''\), true\)/g)?.length).toBe(3);
  });
  it('seul le point d’entrée est exécutable par un utilisateur', () => {
    for (const f of ['_membre_actif_ou_nul', '_taxe_defaut_bureau', '_client_dans_bureau', '_transferer_devis', '_transferer_job']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\.${f}\([^)]*\) from public, anon, authenticated`));
    }
    expect(sql).toMatch(/grant execute on function public\.transferer_vers_bureau\(text, uuid, uuid\) to authenticated/);
  });
  it('les trois fiches offrent l’entrée « Transférer vers un bureau »', () => {
    for (const p of ['src/pages/ClientDetails.tsx', 'src/pages/QuoteDetails.tsx', 'src/pages/JobDetails.tsx']) {
      expect(lire(p)).toMatch(/<TransfertBureauDialog entite="(client|quote|job)"/);
    }
  });
});
