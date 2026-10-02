/**
 * [A] Les outils d'écriture de Lumi sur les automatisations, RELUS en base — mission, point 1 :
 * « chaque outil d'écriture relit l'état réel en base et le retourne ; jamais “c'est fait” sans
 * un résultat d'outil qui le confirme ».
 *
 * Les handlers tournent dans le processus, avec le VRAI jeton du compte de test (RLS appliquée).
 * Après chaque appel, on relit `automation_rules` en service_role et on compare à la réponse.
 *
 *  · [A-03] « déjà fait » (anti double-clic de 10 minutes) répond un succès sans relire l'état :
 *    si l'écran a changé la règle entre-temps, Lumi annonce un état que la base n'a pas ;
 *  · [A-05] la réponse ne porte pas le texte enregistré ;
 *  · [A-06] un texte aux variables inventées est accepté ;
 *  · [A-07] `actions` (2e copie) n'est pas tenu à jour quand le parcours a plusieurs messages ;
 *  · [A-08] une automatisation à la corbeille est réécrite ;
 *  · [A-10] aucun outil de lecture ne rend le CONTENU d'une automatisation.
 *
 * Constats complets et balayage des 198 outils d'écriture : notes/A-constats.md,
 * scripts/qa/finale/a/relire-apres-ecriture.mts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { marque } from '../../../automations-suite/harnais/moteur';
import { COMPTES, sessionDe } from '../../../automations-suite/harnais/bureau-test';
import { preparerBureau, ok, type Bureau } from '../../../automations-suite/integration/10-b-outils';

let b: Bureau & { fuseau: string };
let ctx: { client: unknown; orgId: string; userId: string; accessToken: string };
type Outil = { declaration: { name: string }; kind: string; handler?: (a: Record<string, unknown>, c: unknown) => Promise<any> };
let OUTILS: Outil[] = [];
const regles: string[] = [];
const m = marque('A-RELIRE');
let langueAvant = 'fr';

beforeAll(async () => {
  b = await preparerBureau();
  const s = await sessionDe(b.admin, COMPTES.proprioA.email);
  ctx = { client: s.client, orgId: b.orgA, userId: b.users.proprioA, accessToken: s.jeton };
  OUTILS = (await import('../../../../server/lib/agent/tools')).AGENT_TOOLS as unknown as Outil[];
  langueAvant = (await ok<{ default_language: string }>(b.admin.from('company_settings').select('default_language').eq('org_id', b.orgA).single(), 'langue')).default_language;
});
afterAll(async () => {
  if (regles.length) await b.admin.from('automation_rules').delete().in('id', regles);
  await b.admin.from('company_settings').update({ default_language: langueAvant }).eq('org_id', b.orgA);
});

const appeler = async (nom: string, args: Record<string, unknown>) => {
  const o = OUTILS.find((x) => x.declaration.name === nom);
  if (!o?.handler) throw new Error(`outil absent : ${nom}`);
  try { return await o.handler(args, ctx); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
};
const sms = (id: string, body: string, suivant: string | null = null) => ({ id, type: 'action', action: { type: 'send_sms', config: { body } }, suivant });

async function regle(nom: string, ligne: Record<string, unknown>): Promise<string> {
  const r = await ok<{ id: string }>(b.admin.from('automation_rules').insert({
    org_id: b.orgA, name: `${m} ${nom}`, trigger_event: 'invoice.overdue', conditions: {}, delay_seconds: 0, is_active: false, is_preset: false,
    actions: [{ type: 'send_sms', config: { body: 'À compléter' } }], ...ligne,
  }).select('id').single(), 'règle');
  regles.push(r.id);
  return r.id;
}
async function relire(id: string) {
  const r = await ok<{ steps: Array<{ type: string; action?: { config?: { body?: string } } }> | null; actions: Array<{ config?: { body?: string } }>; is_active: boolean }>(
    b.admin.from('automation_rules').select('steps, actions, is_active').eq('id', id).single(), 'relecture');
  return {
    steps: (r.steps ?? []).filter((e) => e.type === 'action').map((e) => String(e.action?.config?.body ?? '')),
    actions: (r.actions ?? []).map((a) => String(a.config?.body ?? '')),
    is_active: r.is_active,
  };
}

describe('[A-05] la réponse de l’outil porte l’état RELU', () => {
  it('update_automation_message rend le texte enregistré (relu en base), pas seulement « updated: true » et l’ancien texte', async () => {
    const id = await regle('relu', { steps: [sms('e1', 'Bonjour [client_name], c’est [company_name]. Merci !')] });
    const nouveau = `Bonjour [client_first_name], votre facture [invoice_number] est en retard : [invoice_link] ${m}`;
    const rep = await appeler('update_automation_message', { rule_id: id, action_type: 'send_sms', body: nouveau });
    expect((await relire(id)).steps[0]).toBe(nouveau);
    // ROUGE aujourd'hui : { updated, rule_id, name, action_type, ancien_texte, note } — rien de relu.
    expect(JSON.stringify(rep), 'la réponse doit contenir le texte tel qu’enregistré, pour que Lumi le CITE au lieu de le réinventer').toContain(nouveau);
  });
});

describe('[A-03] « déjà fait » ne vaut que si l’état en base est toujours celui annoncé', () => {
  it('update_automation_message : redemandé après une modification à l’écran, il réécrit (ou dit que ce n’est plus le cas)', async () => {
    const id = await regle('déjà fait message', { steps: [sms('e1', 'Avant')] });
    const voulu = `Texte voulu par Lumi ${m}`;
    const args = { rule_id: id, action_type: 'send_sms', body: voulu };
    await appeler('update_automation_message', args);
    expect((await relire(id)).steps[0]).toBe(voulu);
    // Le propriétaire change le texte dans l'éditeur…
    await ok(b.admin.from('automation_rules').update({ steps: [sms('e1', 'Texte remis à l’écran')] }).eq('id', id), 'écran');
    // … puis redemande le même texte à Lumi, dans les 10 minutes.
    const rep = await appeler('update_automation_message', args);
    const relu = await relire(id);
    const annonceUnSucces = rep?.updated === true && !rep?.error;
    // ROUGE aujourd'hui : rep = { updated: true, deja_fait: true }, base = « Texte remis à l’écran ».
    expect(annonceUnSucces ? relu.steps[0] : voulu, `réponse : ${JSON.stringify(rep).slice(0, 200)}`).toBe(voulu);
  });

  it('toggle_automation_rule : réactivée par Lumi après un retour en brouillon à l’écran, elle EST active (ou Lumi dit qu’elle ne l’est pas)', async () => {
    const id = await regle('déjà fait bascule', { actions: [], steps: [sms('e1', 'Bonjour [client_first_name], votre facture [invoice_number] est en retard : [invoice_link]')] });
    const rep1 = await appeler('toggle_automation_rule', { rule_id: id, is_active: true });
    expect((await relire(id)).is_active, JSON.stringify(rep1)).toBe(true);
    await ok(b.admin.from('automation_rules').update({ is_active: false }).eq('id', id), 'retour en brouillon');
    const rep2 = await appeler('toggle_automation_rule', { rule_id: id, is_active: true });
    const relu = await relire(id);
    await b.admin.from('automation_rules').update({ is_active: false }).eq('id', id);
    // ROUGE aujourd'hui : rep2 = { updated: true, is_active: true, deja_fait: true }, base : is_active = false.
    expect({ annonce: rep2?.is_active === true && !rep2?.error, base: relu.is_active }, `réponse : ${JSON.stringify(rep2).slice(0, 200)}`)
      .toEqual({ annonce: true, base: true });
  });

  it('set_automation_language : « en » → « fr » (à l’écran) → « en » dans les 10 minutes écrit bien « en »', async () => {
    const lire = async () => (await ok<{ default_language: string }>(b.admin.from('company_settings').select('default_language').eq('org_id', b.orgA).single(), 'langue')).default_language;
    // Passe précédente dans la fenêtre : on part d'une empreinte propre pour CE test.
    await b.admin.from('agent_actions').delete().eq('org_id', b.orgA).eq('outil', 'set_automation_language');
    await appeler('set_automation_language', { language: 'en' });
    expect(await lire()).toBe('en');
    await ok(b.admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', b.orgA), 'retour au français');
    const rep = await appeler('set_automation_language', { language: 'en' });
    // ROUGE aujourd'hui : « Cette action identique vient d'être exécutée » — la base reste « fr ».
    expect(await lire(), `réponse : ${JSON.stringify(rep).slice(0, 200)}`).toBe('en');
  });

  it('hors automatisations aussi (le mécanisme est commun à 194 des 199 écritures) : update_task_status « faite » → rouverte à l’écran → « faite »', async () => {
    const titre = `${m} tâche`;
    const cree = await appeler('create_task', { title: titre });
    const { data: tache } = await b.admin.from('tasks').select('id, status').eq('org_id', b.orgA).eq('title', titre).maybeSingle();
    expect(tache, `création : ${JSON.stringify(cree).slice(0, 200)}`).toBeTruthy();
    const statut = async () => (await ok<{ status: string }>(b.admin.from('tasks').select('status').eq('id', tache!.id).single(), 'tâche')).status;
    await appeler('update_task_status', { task_id: tache!.id, status: 'done' });
    const fait = await statut();
    expect(fait).not.toBe('open');
    await ok(b.admin.from('tasks').update({ status: 'open', completed_at: null }).eq('id', tache!.id), 'rouverte à l’écran');
    const rep = await appeler('update_task_status', { task_id: tache!.id, status: 'done' });
    const relu = await statut();
    await b.admin.from('tasks').delete().eq('id', tache!.id);
    // ROUGE aujourd'hui : « Cette action identique vient d'être exécutée » — la tâche reste ouverte.
    expect(relu, `réponse : ${JSON.stringify(rep).slice(0, 200)}`).toBe(fait);
  });
});

describe('[A-06] un texte aux variables inventées est refusé à l’écriture', () => {
  it('update_automation_sms_body refuse {{client_prenom}} / {{lien_paiement}} et nomme les variables fautives', async () => {
    const id = await regle('variables', { steps: [sms('e1', 'Bonjour [client_first_name].')] });
    const troue = 'Bonjour {{client_prenom}}, votre facture {{facture_numero}} est en retard : {{lien_paiement}}';
    const rep = await appeler('update_automation_sms_body', { rule_id: id, body: troue });
    const relu = await relire(id);
    // ROUGE aujourd'hui : accepté, enregistré ; le client recevrait « Bonjour , votre facture  est en retard :  ».
    expect(relu.steps[0], 'le texte troué ne doit pas être enregistré').toBe('Bonjour [client_first_name].');
    expect(String(rep?.error ?? ''), 'le refus nomme la variable').toMatch(/client_prenom|lien_paiement/);
  });
});

describe('[A-07] une seule source de vérité pour le message', () => {
  it('parcours à deux textos : après la réécriture du 2e, `actions` ne garde pas l’ancien texte', async () => {
    const id = await regle('deux textos', {
      actions: [{ type: 'send_sms', config: { body: 'Premier' } }, { type: 'send_sms', config: { body: 'Deuxième' } }],
      steps: [sms('e1', 'Premier', 'e2'), { id: 'e2', type: 'attendre', delai_secondes: 86400, suivant: 'e3' }, sms('e3', 'Deuxième')],
    });
    const rep = await appeler('update_automation_message', { rule_id: id, action_type: 'send_sms', body: 'Nouveau deuxième', message_number: 2 });
    const relu = await relire(id);
    expect(relu.steps, JSON.stringify(rep)).toEqual(['Premier', 'Nouveau deuxième']);
    // ROUGE aujourd'hui : actions = ['Premier', 'Deuxième'].
    expect(relu.actions.filter((t) => !relu.steps.includes(t)), '`actions` porte un texte que le parcours n’envoie plus').toEqual([]);
  });
});

describe('[A-08] une automatisation à la corbeille ne se réécrit pas', () => {
  it('update_automation_message refuse une règle supprimée, comme la route de l’éditeur (409)', async () => {
    const id = await regle('corbeille', { steps: [sms('e1', 'Avant')], deleted_at: new Date().toISOString() });
    const rep = await appeler('update_automation_message', { rule_id: id, action_type: 'send_sms', body: `Écrit dans la corbeille ${m}` });
    // ROUGE aujourd'hui : { updated: true }.
    expect((await relire(id)).steps[0]).toBe('Avant');
    expect(rep?.error, 'le refus dit que l’automatisation est à la corbeille').toBeTruthy();
  });
});

describe('[A-10] Lumi peut LIRE le contenu d’une automatisation', () => {
  it('un outil de lecture rend le déclencheur, les étapes et le TEXTE exact des messages d’une règle', async () => {
    const texte = `Bonjour [client_first_name], rappel pour votre facture [invoice_number]. ${m}`;
    const id = await regle('à lire', { steps: [{ id: 'e1', type: 'attendre', delai_secondes: 259200, suivant: 'e2' }, sms('e2', texte)] });
    const lectures = OUTILS.filter((o) => o.kind === 'read' && /automation/.test(o.declaration.name) && o.handler);
    const rendus: Record<string, string> = {};
    for (const o of lectures) {
      const r = await o.handler!({ rule_id: id, id, language: 'fr' }, ctx).catch((e: unknown) => ({ error: String(e) }));
      rendus[o.declaration.name] = JSON.stringify(r);
    }
    const quiRendLeTexte = Object.entries(rendus).filter(([, json]) => json.includes(texte)).map(([nom]) => nom);
    // ROUGE aujourd'hui : list_automations rend id, nom, déclencheur, actif — jamais les étapes ni les textes.
    // Sans cela, « explique-moi ce qu'elle fait », « plus court », « change seulement l'objet » sont impossibles.
    expect(quiRendLeTexte, `outils de lecture essayés : ${lectures.map((o) => o.declaration.name).join(', ')}`).not.toEqual([]);
  });
});
