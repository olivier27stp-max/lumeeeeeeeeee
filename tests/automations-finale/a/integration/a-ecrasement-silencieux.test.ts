/**
 * [A-09] Deux mains sur la même automatisation : l'éditeur ouvert et Lumi — mission, point 3 :
 * « ses modifs apparaissent dans l'éditeur ouvert sans écraser en silence les modifs locales
 * (comportement défini et testé) ».
 *
 * Aujourd'hui rien ne relie les deux : la route de modification n'a aucune garde de version
 * (`PATCH /api/automations/rules/:id` écrit ce qu'elle reçoit) et l'éditeur n'est prévenu de rien.
 * Séquence éprouvée, par les vraies pièces (route réelle, handler réel de l'outil de Lumi) :
 *
 *   1. l'éditeur charge l'automatisation (il garde le parcours en mémoire) ;
 *   2. Lumi (clavardage général, autre onglet ou téléphone) réécrit le texto ;
 *   3. l'éditeur, qui n'en sait rien, enregistre une autre modification (un délai ajouté) :
 *      son `steps` en mémoire repart en entier, avec l'ANCIEN texto.
 *
 * Attendu : la 3e écriture est refusée (409 « modifiée ailleurs ») ou fusionnée — le texto de Lumi
 * survit. Le correctif posera une garde (par exemple `updated_at` attendu, envoyé par l'éditeur) :
 * ce test l'enverra alors ; l'important est qu'une écriture PÉRIMÉE n'efface plus rien sans le dire.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { marque } from '../../../automations-suite/harnais/moteur';
import { COMPTES, sessionDe } from '../../../automations-suite/harnais/bureau-test';
import { preparerBureau, apiEnMemoire, ok, type Api, type Bureau } from '../../../automations-suite/integration/10-b-outils';

let b: Bureau & { fuseau: string };
let api: Api;
const regles: string[] = [];
const m = marque('A-ECRASE');

beforeAll(async () => {
  b = await preparerBureau();
  const routes = await import('../../../../server/routes/automation-rules');
  api = await apiEnMemoire(b, [{ routeur: routes.default }]);
});
afterAll(async () => {
  if (regles.length) await b.admin.from('automation_rules').delete().in('id', regles);
  await api?.fermer();
});

describe('[A-09] l’éditeur ouvert n’écrase pas en silence ce que Lumi vient d’écrire', () => {
  it('une écriture périmée de l’éditeur est refusée ou fusionnée : le texto de Lumi survit', async () => {
    const r = await ok<{ id: string }>(b.admin.from('automation_rules').insert({
      org_id: b.orgA, name: `${m} relance`, trigger_event: 'invoice.overdue', conditions: {}, delay_seconds: 0, is_active: false, is_preset: false,
      actions: [{ type: 'send_sms', config: { body: 'À compléter' } }],
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Texte d’origine' } }, suivant: null }],
    }).select('id').single(), 'règle');
    regles.push(r.id);

    // 1. L'éditeur charge la règle.
    const charge = await api.appeler('GET', `/api/automations/editeur?rule_id=${r.id}`);
    expect(charge.status, JSON.stringify(charge.json).slice(0, 200)).toBe(200);
    const enMemoire = charge.json.rule as { name: string; steps: Array<Record<string, unknown>>; updated_at: string };

    // 2. Lumi réécrit le texto (handler réel, jeton du propriétaire).
    const s = await sessionDe(b.admin, COMPTES.proprioA.email);
    const outils = (await import('../../../../server/lib/agent/tools')).AGENT_TOOLS as unknown as Array<{ declaration: { name: string }; handler?: (a: Record<string, unknown>, c: unknown) => Promise<any> }>;
    const deLumi = `Bonjour [client_first_name], votre facture [invoice_number] est en retard : [invoice_link] ${m}`;
    const rep = await outils.find((o) => o.declaration.name === 'update_automation_sms_body')!.handler!(
      { rule_id: r.id, body: deLumi }, { client: s.client, orgId: b.orgA, userId: b.users.proprioA, accessToken: s.jeton });
    expect(rep?.updated, JSON.stringify(rep)).toBe(true);

    // 3. L'éditeur enregistre SA modification (une attente ajoutée devant), avec son parcours en mémoire.
    const perime = [{ id: 'e0', type: 'attendre', delai_secondes: 86400, suivant: 'e1' }, ...enMemoire.steps];
    // L'éditeur envoie la version qu'il a LUE (`version_lue`, garde A-09) : c'est elle que la route compare.
    const ecrit = await api.appeler('PATCH', `/api/automations/rules/${r.id}`, { name: enMemoire.name, steps: perime, version_lue: enMemoire.updated_at });
    expect(ecrit.status, JSON.stringify(ecrit.json).slice(0, 200)).toBe(409);
    expect(ecrit.json.code).toBe('modifiee_ailleurs');

    const relu = await ok<{ steps: Array<{ type: string; action?: { config?: { body?: string } } }> }>(
      b.admin.from('automation_rules').select('steps').eq('id', r.id).single(), 'relecture');
    const texto = relu.steps.find((e) => e.type === 'action')?.action?.config?.body;
    // ROUGE aujourd'hui : 200, et le texto redevient « Texte d’origine » — la modification de Lumi a disparu sans un mot.
    expect({ statut: ecrit.status === 409 ? 'refusée' : 'acceptée', texto }, 'écriture périmée')
      .toSatisfy((v: { statut: string; texto?: string }) => v.statut === 'refusée' || v.texto === deLumi);
  });
});
