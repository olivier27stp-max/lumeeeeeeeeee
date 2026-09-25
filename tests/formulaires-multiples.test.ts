// Plusieurs formulaires de demande, chacun vers son pipeline.
//
// CE QUE CES TESTS PROTÈGENT. La route de sauvegarde ÉCRASAIT « le »
// formulaire de l'organisation : avec plusieurs formulaires, « Nouveau »
// aurait réécrit l'ancien en silence — ses questions et son lien public
// perdus, sans le moindre avertissement. Et les lectures par `org_id`
// utilisaient `maybeSingle()`, qui LÈVE dès qu'il y a deux lignes : le jour
// du second formulaire, l'écran de réglages aurait cessé de charger.
//
// La production a 1 formulaire et 20 soumissions reçues : le comportement
// actuel doit rester identique au bit près tant qu'un second n'est pas créé.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const serveur = () => fs.readFileSync('server/routes/request-forms.ts', 'utf8');
const validation = () => fs.readFileSync('server/lib/validation.ts', 'utf8');

describe('lecture — plus aucun maybeSingle() par organisation', () => {
  it('lister les formulaires rend une LISTE, pas une ligne', () => {
    const s = serveur();
    // La route GET /request-forms : `.order(...)` et non `.maybeSingle()`.
    // On retire les commentaires avant de chercher : le mot `maybeSingle`
    // apparaît dans l'explication juste au-dessus du code, et le test se
    // serait accroché à sa propre documentation.
    const bloc = s
      .slice(s.indexOf("router.get('/request-forms'"), s.indexOf("router.post('/request-forms',"))
      .replace(/^\s*\/\/.*$/gm, '');
    expect(bloc).toContain("order('created_at'");
    expect(bloc).not.toContain('maybeSingle');
  });

  it('elle renvoie `forms` ET garde `form` pour l écran actuel', () => {
    // Livrer le serveur avant l'écran n'est sûr que si l'ancien champ
    // survit : sans `form`, l'écran d'aujourd'hui afficherait du vide.
    const s = serveur();
    expect(s).toContain('forms[0] ?? null');
    expect(s).toContain('forms });');
  });
});

describe('écriture — « Nouveau » ne doit jamais écraser', () => {
  it('la cible est désignée par `id`', () => {
    expect(serveur()).toContain('const cibleId =');
  });

  it("l'id est vérifié contre l'organisation de l'appelant", () => {
    // Un id venu du client ne prouve rien : sans ce filtre, on pourrait
    // modifier le formulaire d'une AUTRE entreprise en devinant son id.
    const s = serveur();
    const bloc = s.slice(s.indexOf('const cibleId ='), s.indexOf('const save ='));
    expect(bloc).toContain("eq('id', cibleId)");
    expect(bloc).toContain("eq('org_id', auth.orgId)");
  });

  it('`creer: true` force une création', () => {
    expect(serveur()).toContain("req.body?.creer !== true");
  });

  it('sans id ni `creer`, on vise le plus ancien — comme avant', () => {
    const s = serveur();
    const bloc = s.slice(s.indexOf('const cibleId ='), s.indexOf('const save ='));
    expect(bloc).toContain("order('created_at', { ascending: true })");
  });
});

describe('régénérer une clé — ne pas casser le lien d un autre', () => {
  it('refuse de deviner quand il y a plusieurs formulaires', () => {
    // Régénérer invalide le lien public : se tromper de cible casserait des
    // liens déjà partagés. On exige un id plutôt que de choisir au hasard.
    const s = serveur();
    const bloc = s.slice(s.indexOf("router.post('/request-forms/regenerate-key'"));
    expect(bloc).toContain('liste.length > 1');
    expect(bloc).toContain('précisez lequel');
  });
});

describe('le pipeline du formulaire', () => {
  it('la soumission publique lit `pipeline_id`', () => {
    expect(serveur()).toMatch(/notify_in_app, pipeline_id'/);
  });

  it('et le transmet à ingest_lead', () => {
    expect(serveur()).toContain('p_pipeline_id:');
  });

  it("n'est écrit que s'il est FOURNI", () => {
    // Sans cette garde, chaque sauvegarde de l'écran actuel — qui n'envoie
    // pas le champ — remettrait le formulaire sur le pipeline par défaut.
    expect(serveur()).toContain('req.body.pipeline_id !== undefined');
  });

  it('le schéma accepte id, creer et pipeline_id', () => {
    const v = validation();
    const bloc = v.slice(v.indexOf('upsertRequestFormSchema'), v.indexOf('updateFormSubmissionSchema'));
    expect(bloc).toContain('id: z.string().uuid().optional()');
    expect(bloc).toContain('creer: z.boolean().optional()');
    expect(bloc).toContain('pipeline_id: z.string().uuid().nullable().optional()');
  });
});

describe('la migration', () => {
  const sql = () => fs.readFileSync(
    'supabase/migrations/20260925190000_plusieurs_formulaires_par_pipeline.sql', 'utf8');

  it("lève l'index unique qui interdisait un second formulaire", () => {
    const s = sql();
    expect(s).toContain('drop index if exists public.idx_request_forms_org');
    // Recréé NON unique : il servait aussi à la recherche.
    expect(s).toMatch(/create index idx_request_forms_org/);
  });

  it('supprime l ancienne signature avant de recréer ingest_lead', () => {
    // Ajouter un paramètre crée une SURCHARGE : les deux versions
    // coexisteraient et tout appel deviendrait ambigu (42725, « function is
    // not unique »). Le formulaire public cesserait de fonctionner.
    expect(sql()).toContain('drop function if exists public.ingest_lead(');
  });

  it('révoque EXECUTE à public, anon ET authenticated', () => {
    // `create or replace` RÉINITIALISE l'ACL : les defaults Supabase
    // rouvrent alors la fonction à anon — donc à internet. Constaté sur
    // staging avant correction.
    const s = sql();
    for (const role of ['from public;', 'from anon;', 'from authenticated;']) {
      expect(s).toContain(role);
    }
    expect(s).toContain('to service_role;');
  });

  it('le pipeline du formulaire ne bloque jamais un lead', () => {
    // Pipeline supprimé ou sans étape ouverte : on retombe sur le défaut.
    // Perdre la demande d'un client pour un réglage périmé serait pire que
    // de la classer au mauvais endroit.
    const s = sql();
    expect(s).toContain('on delete set null');
    expect(s).toMatch(/v_etape is null and p_pipeline_id is not null/);
  });
});
