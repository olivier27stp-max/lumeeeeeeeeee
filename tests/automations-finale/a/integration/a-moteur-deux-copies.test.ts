/**
 * [A] Les DEUX copies du message d'une automatisation (`steps` et `actions`) — mission, point 1.
 *
 * La même ligne `automation_rules` porte le message deux fois : dans `steps` (le parcours de
 * l'éditeur plein écran) et dans `actions` (l'ancien modèle à plat). L'éditeur n'écrit que
 * `steps` ; `actions` garde le texte provisoire « À compléter » posé à la création.
 *
 *  · [A-02] ce que le MOTEUR exécute quand les deux divergent (fait établi, vert) ;
 *  · [A-02] l'enregistrement de l'éditeur laisse `actions` contredire `steps` (rouge) ;
 *  · [A-11] `ecrituresSensiblesPour` (carte de confirmation de Lumi) ne lit que `actions` :
 *    un parcours qui texte le client à « job terminée » est invisible pour elle (rouge) ;
 *  · [A-06] un texte aux variables inventées, écrit par l'outil de Lumi, part TROUÉ (fait, vert) ;
 *  · [A-21] un courriel réécrit par l'outil de Lumi (texte brut) part sans ses sauts de ligne (rouge).
 *
 * Vrai moteur en processus, bureau de test en bac à sable : on lit `envois_simules`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { marque, attendre, envoisSimules, journalDefinitif, traiterFile } from '../../../automations-suite/harnais/moteur';
import { preparerBureau, apiEnMemoire, creerClient, creerFacture, ok, tachesPlanifiees, type Api, type Bureau } from '../../../automations-suite/integration/10-b-outils';

let b: Bureau & { fuseau: string };
let api: Api;
const regles: string[] = [];
const m = marque('A-COPIES');

beforeAll(async () => {
  b = await preparerBureau();
  const routes = await import('../../../../server/routes/automation-rules');
  api = await apiEnMemoire(b, [{ routeur: routes.default }]);
});
afterAll(async () => {
  if (regles.length) await b.admin.from('automation_rules').delete().in('id', regles);
  await api?.fermer();
});

const sms = (id: string, body: string, suivant: string | null = null) => ({ id, type: 'action', action: { type: 'send_sms', config: { body } }, suivant });

async function regleEnBase(nom: string, ligne: Record<string, unknown>): Promise<string> {
  const r = await ok<{ id: string }>(b.admin.from('automation_rules').insert({
    org_id: b.orgA, name: `${m} ${nom}`, trigger_event: 'invoice.overdue', conditions: {}, delay_seconds: 0,
    is_active: true, is_preset: false, settings: { fenetre: { debut: 0, fin: 24 } }, ...ligne,
  }).select('id').single(), 'règle');
  regles.push(r.id);
  return r.id;
}

/** Une facture envoyée, échue : l'entité d'un événement « Facture en retard ». */
async function factureEnRetard(suffixe: string) {
  const client = await creerClient(b, `${m} ${suffixe}`, { phone: `+15555550${String(160 + Math.floor(Math.random() * 30))}` });
  const f = await creerFacture(b, `${m} ${suffixe}`, client.id, 24_500);
  await ok(b.admin.from('invoices').update({ status: 'sent', issued_at: new Date().toISOString(), sent_at: new Date().toISOString(), due_date: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10) }).eq('id', f.id), 'échéance');
  return { client, facture: f };
}

/** Émet « Facture en retard » et rend les textos simulés de CETTE règle. */
async function declencher(regle: string, factureId: string) {
  const depuis = new Date().toISOString();
  await b.eventBus.emit('invoice.overdue' as never, { orgId: b.orgA, entityType: 'invoice', entityId: factureId, metadata: { days_overdue: 2 } } as never);
  // Un parcours inscrit sa 1re étape dans la file planifiée : on la rend due, puis la file du bureau passe.
  const taches = await attendre(() => tachesPlanifiees(b.admin, regle), (t) => t.length >= 1, 20_000);
  for (const t of taches) await ok(b.admin.from('automation_scheduled_tasks').update({ execute_at: new Date(Date.now() - 1000).toISOString() }).eq('id', (t as { id: string }).id), 'avancer');
  await traiterFile(b.admin, b.orgA);
  const lire = async () => (await b.admin.from('automation_execution_logs').select('action_type, result_success, result_error, result_data').eq('automation_rule_id', regle).eq('entity_id', factureId)).data ?? [];
  const logs = await attendre(lire, (l) => l.length >= 1 && l.every((x) => journalDefinitif(x.result_error)), 30_000);
  const tous = await envoisSimules(b.admin, b.orgA, depuis);
  return { logs, envois: tous.filter((e) => e.canal === 'sms'), courriels: tous.filter((e) => e.canal !== 'sms') };
}

describe('[A-02] `steps` et `actions` divergent dans la même règle', () => {
  it('le moteur exécute `steps` : le client reçoit le texte du parcours, jamais « À compléter »', async () => {
    const id = await regleEnBase('divergente', {
      actions: [{ type: 'send_sms', config: { body: 'À compléter' } }],
      steps: [sms('e1', `Bonjour [client_first_name], votre facture est en retard. TEXTE-DU-PARCOURS ${m}`)],
    });
    const { facture } = await factureEnRetard('divergente');
    const { logs, envois } = await declencher(id, facture.id);
    const miens = envois.filter((e) => String(e.corps).includes(m) || String(e.corps).includes('À compléter'));
    expect(miens.map((e) => e.corps), `journal : ${JSON.stringify(logs)}`).toHaveLength(1);
    expect(String(miens[0].corps)).toContain('TEXTE-DU-PARCOURS');
    expect(String(miens[0].corps)).not.toContain('À compléter');
  });

  it('l’éditeur enregistre le parcours : `actions` ne garde pas un texte que `steps` n’a plus', async () => {
    // Les deux appels de l'éditeur plein écran : création (action provisoire), puis enregistrement automatique.
    const cree = await api.appeler('POST', '/api/automations/rules', {
      name: `${m} éditeur`, trigger_event: 'invoice.overdue', conditions: {}, delay_seconds: 0,
      actions: [{ type: 'send_sms', config: { body: 'À compléter' } }], steps: [], is_active: false,
    });
    expect(cree.status, JSON.stringify(cree.json)).toBe(201);
    regles.push(cree.json.id);
    const texte = 'Bonjour [client_first_name], votre facture [invoice_number] est en retard : [invoice_link]';
    const maj = await api.appeler('PATCH', `/api/automations/rules/${cree.json.id}`, { name: `${m} éditeur`, steps: [sms('e1', texte)] });
    expect(maj.status, JSON.stringify(maj.json)).toBe(200);

    const ligne = await ok<{ steps: Array<{ action: { config: { body: string } } }>; actions: Array<{ type: string; config: { body?: string } }> }>(
      b.admin.from('automation_rules').select('steps, actions').eq('id', cree.json.id).single(), 'relecture');
    expect(ligne.steps[0].action.config.body).toBe(texte);
    const textesDuParcours = ligne.steps.map((e) => e.action.config.body);
    const orphelins = ligne.actions.filter((a) => a.type === 'send_sms' && !textesDuParcours.includes(String(a.config.body)));
    // ROUGE aujourd'hui : `actions` = [« À compléter »] — une 2e copie du message, fausse, dans la même ligne.
    expect(orphelins.map((a) => a.config.body), 'une seule source de vérité : `actions` dérivé de `steps`, ou vide').toEqual([]);
  });
});

describe('[A-11] la carte de confirmation de Lumi ne voit pas les parcours', () => {
  it('un parcours ACTIF qui texte le client à « job terminée » rend `update_job_status` sensible, même si `actions` est vide', async () => {
    // Ce qu'écrit create_automation_from_text (outil de Lumi) : `actions: []`, tout est dans `steps`.
    const id = await regleEnBase('job terminée', {
      trigger_event: 'job.completed', actions: [],
      steps: [sms('e1', 'Bonjour [client_first_name], merci pour votre confiance !')],
    });
    const { ecrituresSensiblesPour } = await import('../../../../server/lib/lumi/execution');
    const sensibles = await ecrituresSensiblesPour(b.admin, b.orgA);
    await b.admin.from('automation_rules').update({ is_active: false }).eq('id', id);
    // ROUGE aujourd'hui : seule `actions` est lue (server/lib/lumi/execution.ts) — Lumi termine la job
    // sans carte, et le client reçoit un texto que personne n'a vu venir.
    expect(sensibles.has('update_job_status'), 'terminer une job déclenche un texto au client : la carte doit s’afficher').toBe(true);
  });
});

describe('[A-06] un texte aux variables inventées part troué', () => {
  it('ce que le client reçoit quand Lumi écrit {{client_prenom}} et {{lien_paiement}} (le texte vu en conversation réelle)', async () => {
    const id = await regleEnBase('trouée', {
      actions: [],
      steps: [sms('e1', `Bonjour {{client_prenom}}, votre facture {{facture_numero}} d'un montant de {{solde_du}} est en retard. Réglez ici : {{lien_paiement}}. ${m}`)],
    });
    const { facture } = await factureEnRetard('trouée');
    const { envois } = await declencher(id, facture.id);
    const mien = envois.find((e) => String(e.corps).includes(m));
    expect(mien, 'le texto est parti (bac à sable)').toBeTruthy();
    // Fait établi : aucune des quatre variables n'existe, le moteur les remplace par du vide.
    expect(String(mien!.corps)).not.toMatch(/\{\{|\}\}/);
    expect(String(mien!.corps)).toMatch(/Bonjour\s*,/);
    expect(String(mien!.corps)).toMatch(/Réglez ici : \./);
  });
});

describe('[A-21] un courriel réécrit par Lumi garde ses paragraphes', () => {
  it('le corps écrit par update_automation_message (texte brut, sauts de ligne) part avec ses sauts de ligne', async () => {
    // Ce que l'outil enregistre : le texte tel que le modèle le donne, sans HTML (relevé : relire-apres-ecriture, cas 1.7).
    const corps = `Bonjour [client_first_name],

Votre facture [invoice_number] est en retard. ${m}

Merci,
L’équipe`;
    const id = await regleEnBase('courriel', {
      actions: [],
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_email', config: { subject: `Rappel ${m}`, body: corps } }, suivant: null }],
    });
    const { facture } = await factureEnRetard('courriel');
    const { logs, courriels } = await declencher(id, facture.id);
    const mien = courriels.find((e) => String(e.sujet).includes(m) || String(e.corps).includes(m));
    expect(mien, `le courriel est parti (bac à sable) — journal : ${JSON.stringify(logs)}`).toBeTruthy();
    const html = String(mien!.corps);
    // La DERNIÈRE occurrence : la première est le texte d'aperçu caché en tête du courriel.
    const ou = html.lastIndexOf('Votre facture');
    const autour = html.slice(Math.max(0, ou - 260), ou + 20);
    // ROUGE aujourd'hui si le corps est collé tel quel dans le HTML : « Bonjour Cliente, Votre facture… Merci, L’équipe » sur une ligne.
    expect(autour, 'un saut de ligne (<br>, <p>) sépare la salutation du premier paragraphe').toMatch(/<br|<\/p>|<p[ >]/i);
  });
});
