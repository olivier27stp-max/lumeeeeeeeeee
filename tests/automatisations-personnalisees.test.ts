/**
 * LES AUTOMATISATIONS QUE L'UTILISATEUR CONSTRUIT LUI-MÊME.
 *
 * Jusqu'ici `automation_rules` n'était remplie que par le seeder : aucune
 * entrée humaine n'y arrivait, donc aucune validation. Maintenant que
 * l'interface permet d'en créer, tout ce qui vient du navigateur doit être
 * refusé ou accepté selon des règles précises — et c'est ce que ce fichier
 * fige.
 *
 * Ce qui est vérifié ici tient en une phrase : on ne doit pas pouvoir
 * enregistrer une automatisation que le moteur ne saurait pas exécuter, ou
 * qu'il exécuterait autrement que ce que l'utilisateur a demandé.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  automationRuleCreateSchema,
  automationRuleUpdateSchema,
} from '../server/lib/validation';
import {
  DECLENCHEURS,
  ACTIONS,
  CLES_DECLENCHEURS,
  CLES_ACTIONS,
  trouverDeclencheur,
  trouverAction,
  DELAI_MAX_SECONDES,
  ACTIONS_MAX,
} from '../src/lib/automationCatalogue';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

/** Une automatisation valide, dont chaque test dérive sa variante. */
const valide = () => ({
  name: 'Relance des soumissions',
  trigger_event: 'quote.sent',
  delay_seconds: 259200,
  actions: [{ type: 'send_sms', config: { body: 'Bonjour [client_first_name], une question sur la soumission ?' } }],
});

describe('catalogue — il ne peut pas dériver du moteur', () => {
  it('chaque déclencheur offert existe dans CRMEventType', () => {
    const busSource = lire('server/lib/eventBus.ts');
    // On lit le type source plutôt que d'importer : le bus tire Supabase avec
    // lui, et ce test doit rester un test de cohérence, pas d'intégration.
    const declaresDansLeBus = [...busSource.matchAll(/\|\s*'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]);
    expect(declaresDansLeBus.length).toBeGreaterThan(20);
    for (const d of DECLENCHEURS) {
      expect(declaresDansLeBus, `« ${d.fr} » (${d.cle}) n'est pas un événement du bus`).toContain(d.cle);
    }
  });

  it('chaque action offerte est exécutable par le moteur', () => {
    const dispatch = lire('server/lib/actions/index.ts');
    for (const a of ACTIONS) {
      expect(dispatch, `« ${a.fr} » (${a.cle}) n'est pas dans le dispatch d'executeAction`)
        .toMatch(new RegExp(`case\\s+'${a.cle}'`));
    }
  });

  it('aucune action offerte ne laisse choisir le destinataire', () => {
    // DESTINATAIRE_IMPOSE : `config.to` a été retiré du moteur parce qu'il
    // permettait d'envoyer les données d'un client à une adresse arbitraire.
    // Le catalogue ne doit jamais le réintroduire par un champ.
    for (const a of ACTIONS) {
      for (const champ of a.champs) {
        // Un message vers le client : texte seulement. Une action interne
        // (mettre à jour un champ personnalisé) choisit un CHAMP de la fiche
        // concernée, jamais une personne ni une adresse.
        const permis = a.vers_client ? ['body', 'subject', 'title'] : ['body', 'subject', 'title', 'field_id', 'value'];
        expect(permis).toContain(champ.cle);
        expect(champ.cle).not.toBe('to');
      }
    }
  });

  it('un déclencheur qui accepte « avant » porte bien une date future', () => {
    // Le moteur ne sait calculer un délai négatif que pour les rendez-vous
    // (`resolveExecuteAt`). Ailleurs, la tâche partirait tout de suite.
    for (const d of DECLENCHEURS.filter((x) => x.accepte_delai_negatif)) {
      expect(d.entite, `« ${d.fr} » accepte « avant » sans porter de rendez-vous`).toBe('appointment');
    }
  });

  it('les libellés existent dans les deux langues', () => {
    for (const d of DECLENCHEURS) {
      expect(d.fr.length, `${d.cle} sans libellé français`).toBeGreaterThan(0);
      expect(d.en.length, `${d.cle} sans libellé anglais`).toBeGreaterThan(0);
      expect(d.aide_fr.length).toBeGreaterThan(0);
    }
    for (const a of ACTIONS) {
      expect(a.fr.length).toBeGreaterThan(0);
      expect(a.en.length).toBeGreaterThan(0);
    }
  });

  it('pas de doublon de clé', () => {
    expect(new Set(CLES_DECLENCHEURS).size).toBe(CLES_DECLENCHEURS.length);
    expect(new Set(CLES_ACTIONS).size).toBe(CLES_ACTIONS.length);
  });
});

describe('validation — ce qui entre en base', () => {
  it('accepte une automatisation bien formée', () => {
    const r = automationRuleCreateSchema.safeParse(valide());
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });

  it('refuse un déclencheur que le serveur n\'émet jamais', () => {
    // `lead.updated` est DÉCLARÉ dans le bus mais aucun code ne l'émet :
    // l'accepter donnerait une automatisation qui ne part jamais, sans que
    // personne puisse comprendre pourquoi.
    const r = automationRuleCreateSchema.safeParse({ ...valide(), trigger_event: 'lead.updated' });
    expect(r.success).toBe(false);
  });

  it('refuse un déclencheur inventé', () => {
    const r = automationRuleCreateSchema.safeParse({ ...valide(), trigger_event: 'client.a_soif' });
    expect(r.success).toBe(false);
  });

  it('refuse une action que le moteur ne sait pas exécuter', () => {
    const r = automationRuleCreateSchema.safeParse({
      ...valide(),
      actions: [{ type: 'lancer_les_feux_artifice', config: { body: 'boum' } }],
    });
    expect(r.success).toBe(false);
  });

  it('refuse log_activity, qui est une écriture interne du moteur', () => {
    const r = automationRuleCreateSchema.safeParse({
      ...valide(),
      actions: [{ type: 'log_activity', config: { body: 'x' } }],
    });
    expect(r.success).toBe(false);
  });

  it('refuse un destinataire glissé dans la config', () => {
    // La garde qui compte le plus : `to` rouvrirait le chemin d'exfiltration
    // que DESTINATAIRE_IMPOSE a fermé.
    const r = automationRuleCreateSchema.safeParse({
      ...valide(),
      actions: [{ type: 'send_email', config: { subject: 'Coucou', body: 'Salut', to: 'ailleurs@example.com' } }],
    });
    expect(r.success).toBe(false);
  });

  it('refuse un courriel sans objet', () => {
    const r = automationRuleCreateSchema.safeParse({
      ...valide(),
      actions: [{ type: 'send_email', config: { body: 'Sans objet' } }],
    });
    expect(r.success).toBe(false);
  });

  it('refuse un texto vide', () => {
    const r = automationRuleCreateSchema.safeParse({
      ...valide(),
      actions: [{ type: 'send_sms', config: { body: '   ' } }],
    });
    expect(r.success).toBe(false);
  });

  it('refuse un objet de courriel posé sur un texto', () => {
    const r = automationRuleCreateSchema.safeParse({
      ...valide(),
      actions: [{ type: 'send_sms', config: { body: 'Allo', subject: 'Un objet' } }],
    });
    expect(r.success).toBe(false);
  });

  it('refuse une automatisation sans action', () => {
    const r = automationRuleCreateSchema.safeParse({ ...valide(), actions: [] });
    expect(r.success).toBe(false);
  });

  it(`refuse plus de ${ACTIONS_MAX} actions`, () => {
    const trop = Array.from({ length: ACTIONS_MAX + 1 }, (_, i) => ({
      type: 'send_sms', config: { body: `message ${i}` },
    }));
    const r = automationRuleCreateSchema.safeParse({ ...valide(), actions: trop });
    expect(r.success).toBe(false);
  });

  it('refuse un nom vide', () => {
    const r = automationRuleCreateSchema.safeParse({ ...valide(), name: '  ' });
    expect(r.success).toBe(false);
  });

  it('refuse un délai au-delà d\'un an', () => {
    const r = automationRuleCreateSchema.safeParse({ ...valide(), delay_seconds: DELAI_MAX_SECONDES + 1 });
    expect(r.success).toBe(false);
  });

  it('refuse un délai qui n\'est pas un entier', () => {
    const r = automationRuleCreateSchema.safeParse({ ...valide(), delay_seconds: 1.5 });
    expect(r.success).toBe(false);
  });

  it('naît en pause quand rien n\'est précisé', () => {
    // Une automatisation écrit à de vrais clients : personne ne doit en
    // démarrer une par accident en fermant le formulaire.
    const r = automationRuleCreateSchema.safeParse(valide());
    expect(r.success && r.data.is_active).toBe(false);
  });

  it('refuse un opérateur de condition que le moteur ignore', () => {
    // `gt` n'est pas dans OPERATEURS_CONNUS : côté moteur il ferait échouer la
    // règle ENTIÈRE, en silence. Mieux vaut le refuser à l'enregistrement.
    const r = automationRuleCreateSchema.safeParse({
      ...valide(),
      conditions: { amount_cents: { gt: 50000 } },
    });
    expect(r.success).toBe(false);
  });

  it('accepte les 4 opérateurs que le moteur connaît', () => {
    for (const conditions of [
      { status: { eq: 'sent' } },
      { status: { neq: 'draft' } },
      { status: { in: ['sent', 'viewed'] } },
      { status: { not_in: ['draft'] } },
      { status: 'sent' },
    ]) {
      const r = automationRuleCreateSchema.safeParse({ ...valide(), conditions });
      expect(r.success, JSON.stringify(conditions)).toBe(true);
    }
  });

  it('la modification refuse un corps vide', () => {
    expect(automationRuleUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('la modification accepte un seul champ', () => {
    expect(automationRuleUpdateSchema.safeParse({ name: 'Nouveau nom' }).success).toBe(true);
  });
});

describe('route — les gardes qui demandent de lire le catalogue', () => {
  const source = lire('server/routes/automation-rules.ts');

  it('les donnees metier passent par le client de l utilisateur', () => {
    // `getServiceClient()` contourne la RLS : une faille dans ces routes
    // franchirait alors la frontiere entre entreprises. Toute lecture ou
    // ecriture d'automatisation doit donc passer par `auth.client`.
    // On découpe sur chaque `.from('automation_…')` et on regarde le client
    // qui le précède : plus lisible et plus sûr qu'une regex multiligne.
    const morceaux = source.split(/\.from\('automation_/).slice(0, -1);
    const acces = morceaux.map((m) => (/getServiceClient\(\)\s*$/.test(m.trimEnd()) ? 'service' : 'auth'));
    expect(acces.length).toBeGreaterThan(3);
    for (const client of acces) {
      expect(client, 'une table automation_* lue avec le service_role').toBe('auth');
    }
  });

  it('le service_role ne sert QUE au journal des couts de Lumi', () => {
    // Une seule exception, et elle est obligatoire : `ai_usage` n'accepte
    // d'ecriture que du `service_role` (policy `ai_usage_service`, verifiee
    // en base le 2026-09-24). Sans elle, une generation ne serait jamais
    // facturee au budget, et le plafond mensuel ne voudrait plus rien dire.
    const appels = source.match(/getServiceClient\(\)/g) ?? [];
    expect(appels.length, 'le service_role a un nouvel usage : le justifier ici').toBe(1);
    const bloc = source.slice(source.indexOf('rules/generer'));
    expect(bloc.slice(0, 2000)).toContain('getServiceClient()');
  });

  it('filtre chaque requête sur l\'org de la session', () => {
    // Sans `.eq('org_id', …)`, un identifiant deviné donnerait accès à
    // l'automatisation d'une autre entreprise.
    const acces = [...source.matchAll(/\.from\('automation_[a-z_]+'\)/g)];
    expect(acces.length).toBeGreaterThan(3);
    expect(source.match(/auth\.orgId/g)?.length ?? 0).toBeGreaterThanOrEqual(acces.length);
  });

  it('refuse de changer le déclencheur d\'un préréglage', () => {
    expect(source).toMatch(/is_preset\s*&&\s*'trigger_event' in patch/);
  });

  it('refuse de supprimer un préréglage', () => {
    expect(source).toMatch(/existante\.is_preset/);
  });

  it('annule les envois déjà prévus avant de supprimer', () => {
    // Sans ça, les tâches survivraient à la règle : elles partiraient sans
    // rien pour les expliquer, ou échoueraient sans règle à pointer.
    const iAnnulation = source.indexOf("status: 'cancelled'");
    const iSuppression = source.indexOf('.delete()');
    expect(iAnnulation).toBeGreaterThan(-1);
    expect(iAnnulation).toBeLessThan(iSuppression);
  });

  it('traduit un refus de la RLS en message clair, pas en 500', () => {
    expect(source).toMatch(/42501/);
  });

  it('la copie d\'un préréglage devient une automatisation à soi', () => {
    // Sans `preset_key: null`, le seeder réécrirait la copie au prochain
    // démarrage et effacerait les changements de l'utilisateur.
    const bloc = source.slice(source.indexOf('duplicate'));
    expect(bloc).toMatch(/preset_key:\s*null/);
    expect(bloc).toMatch(/is_preset:\s*false/);
  });
});

describe('permissions et RLS', () => {
  it('chaque route déclare sa permission', () => {
    const perms = lire('server/lib/route-permissions.ts');
    for (const ligne of [
      "'GET /api/automations/rules': 'automations.read'",
      "'POST /api/automations/rules': 'automations.update'",
      "'PATCH /api/automations/rules/:id': 'automations.update'",
      "'DELETE /api/automations/rules/:id': 'automations.update'",
      "'POST /api/automations/rules/:id/duplicate': 'automations.update'",
    ]) {
      expect(perms, `route non déclarée : ${ligne}`).toContain(ligne);
    }
  });

  it('la RLS porte la permission de la page Rôles', () => {
    // Avant, les policies ne vérifiaient que l'appartenance à l'org : un
    // technicien aurait pu écrire une règle qui envoie des SMS aux clients.
    const sql = lire('supabase/migrations/20260924090000_automation_rules_permission_rls.sql');
    expect(sql).toMatch(/member_has_permission\(\(select auth\.uid\(\)\), org_id, 'automations\.read'\)/);
    const ecritures = sql.match(/member_has_permission\(\(select auth\.uid\(\)\), org_id, 'automations\.update'\)/g);
    // insert (1) + update USING + update WITH CHECK (2) + delete (1)
    expect(ecritures?.length).toBe(4);
  });

  it('la route est montée et limitée en débit', () => {
    const index = lire('server/index.ts');
    expect(index).toMatch(/automationRulesRouter/);
    expect(index).toMatch(/app\.use\('\/api\/automations\/rules', automationLimiter\)/);
  });
});

describe('délais — ce que l\'utilisateur saisit vs ce que la base stocke', () => {
  // Import tardif : ce module touche `supabase` à l'import, inutile ailleurs.
  it('convertit dans les deux sens sans perte', async () => {
    const { enSecondes, depuisSecondes } = await import('../src/lib/automationBuilderApi');
    const cas: Array<[number, 'minutes' | 'heures' | 'jours']> = [
      [30, 'minutes'], [2, 'heures'], [3, 'jours'], [1, 'jours'],
    ];
    for (const [valeur, unite] of cas) {
      const s = enSecondes(valeur, unite, false);
      const retour = depuisSecondes(s);
      expect(retour.valeur, `${valeur} ${unite}`).toBe(valeur);
      expect(retour.unite).toBe(unite);
      expect(retour.avant).toBe(false);
    }
  });

  it('garde le sens « avant » à l\'aller comme au retour', async () => {
    const { enSecondes, depuisSecondes } = await import('../src/lib/automationBuilderApi');
    const s = enSecondes(1, 'jours', true);
    expect(s).toBe(-86400);
    expect(depuisSecondes(s)).toEqual({ valeur: 1, unite: 'jours', avant: true });
  });

  it('choisit la plus grande unité qui tombe juste', async () => {
    const { depuisSecondes } = await import('../src/lib/automationBuilderApi');
    expect(depuisSecondes(7200)).toEqual({ valeur: 2, unite: 'heures', avant: false });
    expect(depuisSecondes(172800)).toEqual({ valeur: 2, unite: 'jours', avant: false });
    expect(depuisSecondes(0)).toEqual({ valeur: 0, unite: 'minutes', avant: false });
  });
});

describe('recherche dans le catalogue', () => {
  it('trouve par clé, et rien d\'autre', () => {
    expect(trouverDeclencheur('quote.sent')?.fr).toBe('Soumission envoyée');
    expect(trouverDeclencheur('inexistant')).toBeUndefined();
    expect(trouverAction('send_sms')?.fr).toBe('Envoyer un texto');
    expect(trouverAction('inexistant')).toBeUndefined();
  });
});
