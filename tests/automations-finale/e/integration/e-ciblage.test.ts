/**
 * Agent E — point 6 de la mission : CIBLAGE « Qui est touché ».
 *
 * Ce que le moteur de conditions sait dire aujourd'hui, et ce qui lui manque pour
 * porter une section « Qui est ciblé » (étiquettes, type de client, valeur de champ,
 * ET / OU, exclusions prioritaires, évalué au moment de l'exécution).
 *
 * Vrai moteur, pile LOCALE, mon bureau A (suffixe e) en bac à sable.
 *
 *   QA_AUTO_SUFFIXE=e npx vitest run --maxWorkers=2 --config tests/automations-finale/e/vitest.config.ts --project e-integration tests/automations-finale/e/integration/e-ciblage.test.ts
 *
 * « témoin » = vert aujourd'hui. Les autres sont ROUGES aujourd'hui. Les tests qui
 * écrivent `conditions.ciblage` suivent la structure proposée dans
 * notes/E-conception.md (« Conception 1 ») : si une autre structure est retenue,
 * seule la donnée du test change, pas ce qu'il exige.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { demarrerMoteur, marque } from '../../../automations-suite/harnais/moteur';
import { emettreNote, attendreTraitement, pause } from '../../../automations-suite/integration/20-cde-outils';
import {
  PILE_LOCALE, Menage, creerClient, creerRegle, taches, avancer, attendreJournaux, attendre, partis, verdicts, motifs,
  etiqueter, champParCle, ecrireChamp, poserDrapeau, type Bureau,
} from './outils-e';
import { automationRuleCreateSchema } from '../../../../server/lib/validation';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const menage = new Menage();

beforeAll(async () => { if (PILE_LOCALE) b = await demarrerMoteur(); });
afterEach(async () => { await menage.vider(); });
afterAll(async () => { await menage.vider(); });

const texto = (corps: string, type: 'transactionnel' | 'marketing' = 'transactionnel') => ({ type: 'send_sms', config: { body: corps, type_envoi: type } });
const courriel = (objet: string, type: 'transactionnel' | 'marketing' = 'transactionnel') =>
  ({ type: 'send_email', config: { subject: objet, body: '<p>Bonjour [client_first_name]</p>', type_envoi: type } });

/** Émet l'événement sur chaque client, attend la fin du traitement, rend les textes partis par client. */
async function jouer(regle: string, clients: Record<string, string>, m: string, depuis: string): Promise<Record<string, number>> {
  for (const id of Object.values(clients)) await emettreNote(b, id);
  for (const id of Object.values(clients)) await attendreTraitement(b, id, 'note.added', depuis);
  await pause(1200);
  const envois = await partis(b as Bureau, depuis, m);
  const out: Record<string, number> = {};
  for (const [nom, id] of Object.entries(clients)) {
    const { data } = await b.admin.from('clients').select('phone, email').eq('id', id).single();
    out[nom] = envois.filter((e) => e.destinataire === data!.phone || e.destinataire === data!.email).length;
  }
  void regle;
  return out;
}

describe.skipIf(!PILE_LOCALE)('E — ciblage : ce que le moteur sait déjà dire (témoins)', () => {
  it('[E-01 témoin] « a l’étiquette VIP ET PAS l’étiquette Ne pas relancer » : seul le client VIP non exclu reçoit ; les autres sont journalisés', async () => {
    const m = marque('E-01');
    const depuis = new Date().toISOString();
    const vip = await creerClient(b, menage, `${m}-vip`, { phone: '+15145550151' });
    const vipExclu = await creerClient(b, menage, `${m}-vipx`, { phone: '+15145550152' });
    const autre = await creerClient(b, menage, `${m}-autre`, { phone: '+15145550153' });
    await etiqueter(b as Bureau, vip, 'VIP');
    await etiqueter(b as Bureau, vipExclu, 'VIP', 'Ne pas relancer');
    const regle = await creerRegle(b, menage, m, {
      conditions: { client_a_etiquette: 'VIP', client_sans_etiquette: 'Ne pas relancer' },
      actions: [texto(`${m} Offre réservée à nos clients VIP.`)],
    });
    const recus = await jouer(regle, { vip, vipExclu, autre }, m, depuis);
    expect(recus).toEqual({ vip: 1, vipExclu: 0, autre: 0 });
    // Les deux écartés ont une ligne de journal lisible (L-004) — jamais un échec.
    await attendreJournaux(b, regle, 3);
    expect((await verdicts(b as Bureau, regle)).sort()).toEqual(['conditions', 'conditions', 'envoye']);
    expect(new Set(await motifs(b as Bureau, regle))).toEqual(new Set(['Conditions non remplies : étiquette du client']));
  });

  it('[E-02 témoin] un champ personnalisé de la FICHE DE L’ÉVÉNEMENT filtre bien (ici : « Référé par » = Facebook, événement sur le client)', async () => {
    const m = marque('E-02');
    const depuis = new Date().toISOString();
    const champ = await champParCle(b as Bureau, 'client', 'refere_par');
    expect(champ, 'champ de base « Référé par » absent du bureau').not.toBeNull();
    const oui = await creerClient(b, menage, `${m}-oui`, { phone: '+15145550154' });
    const non = await creerClient(b, menage, `${m}-non`, { phone: '+15145550155' });
    await ecrireChamp(b as Bureau, 'client', oui, champ!.id, 'Facebook');
    await ecrireChamp(b as Bureau, 'client', non, champ!.id, 'Bouche à oreille');
    const regle = await creerRegle(b, menage, m, {
      conditions: { champs_perso: [{ field_id: champ!.id, op: 'is', value: 'Facebook' }] },
      actions: [texto(`${m} Merci de nous suivre sur Facebook.`)],
    });
    expect(await jouer(regle, { oui, non }, m, depuis)).toEqual({ oui: 1, non: 0 });
  });
});

describe.skipIf(!PILE_LOCALE)('E — ciblage : ce qui manque (ROUGE aujourd’hui)', () => {
  it('[E-03] un OU : « étiquette VIP OU étiquette Commercial » — aujourd’hui une règle ne porte qu’UNE étiquette, et un ciblage est refusé à l’enregistrement', async () => {
    const m = marque('E-03');
    const depuis = new Date().toISOString();
    const ciblage = { inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }, { type: 'etiquette', valeur: 'Commercial' }] }, exclure: [] };
    // 1) À l'enregistrement : le serveur accepte la structure.
    const zod = automationRuleCreateSchema.safeParse({
      name: 'E-03', trigger_event: 'note.added', conditions: { ciblage }, delay_seconds: 0, actions: [texto('x')],
    });
    // 2) À l'exécution : VIP ou Commercial reçoit, les autres non.
    const vip = await creerClient(b, menage, `${m}-vip`, { phone: '+15145550156' });
    const commercial = await creerClient(b, menage, `${m}-com`, { phone: '+15145550157' });
    const autre = await creerClient(b, menage, `${m}-autre`, { phone: '+15145550158' });
    await etiqueter(b as Bureau, vip, 'VIP');
    await etiqueter(b as Bureau, commercial, 'Commercial');
    const regle = await creerRegle(b, menage, m, { conditions: { ciblage }, actions: [texto(`${m} Bonjour.`)] });
    const recus = await jouer(regle, { vip, commercial, autre }, m, depuis);
    expect({ enregistrable: zod.success, recus }).toEqual({ enregistrable: true, recus: { vip: 1, commercial: 1, autre: 0 } });
  });

  it('[E-04] « type de client » : filtrer une automatisation de FACTURE sur un champ de la fiche CLIENT — aujourd’hui la règle ne part pour personne', async () => {
    const m = marque('E-04');
    const depuis = new Date().toISOString();
    const champ = await champParCle(b as Bureau, 'client', 'refere_par');
    const client = await creerClient(b, menage, m, { phone: '+15145550159' });
    await ecrireChamp(b as Bureau, 'client', client, champ!.id, 'Commercial');
    const { data: facture, error } = await b.admin.from('invoices').insert({
      org_id: b.orgA, created_by: b.users.proprioA, invoice_number: `E04-${Date.now().toString(36)}`, client_id: client,
      status: 'sent', subtotal_cents: 10000, total_cents: 11498, due_date: new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10),
    }).select('id').single();
    if (error) throw new Error(error.message);
    menage.ajouter(() => b.admin.from('invoices').delete().eq('id', facture!.id));
    const regle = await creerRegle(b, menage, m, {
      trigger_event: 'invoice.overdue',
      // La structure proposée : une règle de CIBLAGE lit toujours la fiche du CLIENT de l'entité.
      conditions: { days_overdue: 3, ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'champ', field_id: champ!.id, op: 'is', value: 'Commercial' }] }, exclure: [] } },
      actions: [texto(`${m} Votre facture [invoice_number] est en retard.`)],
    });
    await b.eventBus.emit('invoice.overdue', { orgId: b.orgA, entityType: 'invoice', entityId: facture!.id, metadata: { days_overdue: 3, invoice_number: 'E04' } });
    await attendreJournaux(b, regle, 1);
    expect({ envois: (await partis(b as Bureau, depuis, m)).length, journal: await verdicts(b as Bureau, regle) })
      .toEqual({ envois: 1, journal: ['envoye'] });
  });

  it('[E-04] la même chose avec les SEULS outils d’aujourd’hui (`champs_perso` sur un champ du client, événement de facture) : la règle est muette', async () => {
    const m = marque('E-04b');
    const depuis = new Date().toISOString();
    const champ = await champParCle(b as Bureau, 'client', 'refere_par');
    const client = await creerClient(b, menage, m, { phone: '+15145550160' });
    await ecrireChamp(b as Bureau, 'client', client, champ!.id, 'Commercial');
    const { data: facture, error } = await b.admin.from('invoices').insert({
      org_id: b.orgA, created_by: b.users.proprioA, invoice_number: `E04b-${Date.now().toString(36)}`, client_id: client,
      status: 'sent', subtotal_cents: 10000, total_cents: 11498, due_date: new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10),
    }).select('id').single();
    if (error) throw new Error(error.message);
    menage.ajouter(() => b.admin.from('invoices').delete().eq('id', facture!.id));
    const regle = await creerRegle(b, menage, m, {
      trigger_event: 'invoice.overdue',
      conditions: { days_overdue: 3, champs_perso: [{ field_id: champ!.id, op: 'is', value: 'Commercial' }] },
      actions: [texto(`${m} Votre facture est en retard.`)],
    });
    await b.eventBus.emit('invoice.overdue', { orgId: b.orgA, entityType: 'invoice', entityId: facture!.id, metadata: { days_overdue: 3, invoice_number: 'E04b' } });
    await attendreJournaux(b, regle, 1);
    expect({ envois: (await partis(b as Bureau, depuis, m)).length, journal: await verdicts(b as Bureau, regle) })
      .toEqual({ envois: 1, journal: ['envoye'] });
  });

  it('[E-05] évalué AU MOMENT DE L’EXÉCUTION : le client reçoit l’étiquette d’exclusion pendant l’attente → le texto différé ne part pas', async () => {
    const m = marque('E-05');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m, { phone: '+15145550161' });
    const regle = await creerRegle(b, menage, m, {
      conditions: { client_sans_etiquette: 'Ne pas relancer' }, delay_seconds: 3600,
      actions: [texto(`${m} Petit rappel de notre part.`)],
    });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await etiqueter(b as Bureau, client, 'Ne pas relancer'); // pendant le délai
    await avancer(b, regle);
    const etat = { envois: (await partis(b as Bureau, depuis, m)).length, journal: await verdicts(b as Bureau, regle) };
    expect(etat.envois, `aujourd’hui : le ciblage n’est jugé qu’au déclenchement — journal ${JSON.stringify(etat.journal)}`).toBe(0);
    expect((await motifs(b as Bureau, regle)).join(' ')).toMatch(/hors ciblage/i);
  });

  it('[E-06] « Démarrer une automatisation » respecte le ciblage de l’automatisation démarrée', async () => {
    const m = marque('E-06');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m, { phone: '+15145550162' });
    await etiqueter(b as Bureau, client, 'Ne pas relancer');
    const cible = await creerRegle(b, menage, `${m} cible`, {
      trigger_event: 'task.completed', conditions: { client_sans_etiquette: 'Ne pas relancer' },
      actions: [texto(`${m} Relance.`)],
    });
    const lanceur = await creerRegle(b, menage, `${m} lanceur`, { actions: [{ type: 'demarrer_automatisation', config: { rule_id: cible } }] });
    await emettreNote(b, client);
    await attendreJournaux(b, lanceur, 1);
    await pause(1500);
    expect((await partis(b as Bureau, depuis, m)).length, 'aujourd’hui : le client exclu reçoit quand même le texto').toBe(0);
  });

  it('[E-07] une exclusion est journalisée « ignoré : hors ciblage » (aujourd’hui : « Conditions non remplies : étiquette du client »)', async () => {
    const m = marque('E-07');
    const client = await creerClient(b, menage, m, { phone: '+15145550163' });
    await etiqueter(b as Bureau, client, 'Ne pas relancer');
    const regle = await creerRegle(b, menage, m, { conditions: { client_sans_etiquette: 'Ne pas relancer' }, actions: [texto(`${m} x`)] });
    await emettreNote(b, client);
    await attendreJournaux(b, regle, 1);
    expect((await motifs(b as Bureau, regle))[0]).toMatch(/hors ciblage/i);
  });
});

describe.skipIf(!PILE_LOCALE)('E — désabonnés / STOP : toujours exclus, quoi que dise le ciblage', () => {
  async function clientRetire(m: string, phone: string) {
    const id = await creerClient(b, menage, m, { phone });
    const { data: c } = await b.admin.from('clients').select('email, phone').eq('id', id).single();
    const { error: e1 } = await b.admin.from('sms_opt_outs').upsert({ org_id: b.orgA, phone, reason: 'STOP (test E)' }, { onConflict: 'org_id,phone' });
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await b.admin.from('email_unsubscribes').insert({ org_id: b.orgA, email: String(c!.email).toLowerCase(), category: 'all', reason: 'test E' });
    if (e2) throw new Error(e2.message);
    menage.ajouter(() => b.admin.from('sms_opt_outs').delete().eq('org_id', b.orgA).eq('phone', phone));
    menage.ajouter(() => b.admin.from('email_unsubscribes').delete().eq('org_id', b.orgA).eq('email', String(c!.email).toLowerCase()));
    return id;
  }

  it('[E-10 témoin] réglage par défaut : STOP + désabonné → AUCUN texto ni courriel, commercial ou transactionnel, immédiat ou différé, même ciblé par étiquette', async () => {
    const m = marque('E-10');
    const depuis = new Date().toISOString();
    const restaurer = await poserDrapeau(b as Bureau, 'auto_desabonnement_canal', false);
    menage.ajouter(restaurer);
    const client = await clientRetire(m, '+15145550164');
    await etiqueter(b as Bureau, client, 'VIP');
    const regles = [
      await creerRegle(b, menage, `${m} texto commercial`, { conditions: { client_a_etiquette: 'VIP' }, actions: [texto(`${m} promo`, 'marketing')] }),
      await creerRegle(b, menage, `${m} texto transactionnel`, { actions: [texto(`${m} confirmation`)] }),
      await creerRegle(b, menage, `${m} courriel commercial`, { actions: [courriel(`${m} promo`, 'marketing')] }),
      await creerRegle(b, menage, `${m} courriel transactionnel`, { actions: [courriel(`${m} confirmation`)] }),
      await creerRegle(b, menage, `${m} texto différé`, { delay_seconds: 3600, actions: [texto(`${m} rappel`, 'marketing')] }),
    ];
    await emettreNote(b, client);
    for (const r of regles.slice(0, 4)) await attendreJournaux(b, r, 1);
    await attendre(() => taches(b, regles[4]), (x) => x.length === 1);
    await avancer(b, regles[4]);
    expect((await partis(b as Bureau, depuis, m)).length).toBe(0);
    const tous = (await Promise.all(regles.map((r) => verdicts(b as Bureau, r)))).flat();
    expect(tous).toEqual(['desabonne', 'desabonne', 'desabonne', 'desabonne', 'desabonne']);
  });

  it('[E-11] « désabonnement par canal » allumé : un client qui a répondu STOP ne reçoit PLUS AUCUN texto, même transactionnel (décision à prendre : aujourd’hui le transactionnel est tenté)', async () => {
    const m = marque('E-11');
    const depuis = new Date().toISOString();
    const restaurer = await poserDrapeau(b as Bureau, 'auto_desabonnement_canal', true);
    menage.ajouter(restaurer);
    const client = await clientRetire(m, '+15145550165');
    const sms = await creerRegle(b, menage, `${m} texto transactionnel`, { actions: [texto(`${m} confirmation`)] });
    const mail = await creerRegle(b, menage, `${m} courriel transactionnel`, { actions: [courriel(`${m} confirmation`)] });
    await emettreNote(b, client);
    await attendreJournaux(b, sms, 1);
    await attendreJournaux(b, mail, 1);
    const envois = await partis(b as Bureau, depuis, m);
    expect(envois.map((e) => e.canal), 'le propriétaire demande : STOP / désabonné toujours exclus').toEqual([]);
  });
});

describe.skipIf(!PILE_LOCALE)('E — « Aucune demande d’avis (noreview) »', () => {
  async function clientSansAvis(m: string, phone: string) {
    const champ = await champParCle(b as Bureau, 'client', 'noreview');
    expect(champ?.field_type, 'le champ de base « noreview » (case à cocher) doit exister dans le bureau').toBe('checkbox');
    const id = await creerClient(b, menage, m, { phone });
    await ecrireChamp(b as Bureau, 'client', id, champ!.id, true);
    return id;
  }
  beforeAll(async () => {
    if (!PILE_LOCALE) return;
    await b.admin.from('company_settings').update({ review_enabled: true, google_review_url: 'https://g.page/r/exemple-lume-qa/review' }).eq('org_id', b.orgA);
  });

  it('[E-15 témoin] l’action « Demander un avis » saute un client « noreview » (motif lisible, pas un échec) ; son voisin la reçoit', async () => {
    const m = marque('E-15');
    const depuis = new Date().toISOString();
    const exclu = await clientSansAvis(`${m}-exclu`, '+15145550166');
    const voisin = await creerClient(b, menage, `${m}-voisin`, { phone: '+15145550167' });
    const regle = await creerRegle(b, menage, m, { actions: [{ type: 'request_review', config: {} }] });
    await emettreNote(b, exclu);
    await attendreJournaux(b, regle, 1);
    expect(await verdicts(b as Bureau, regle)).toEqual(['client_sans_avis']);
    expect((await motifs(b as Bureau, regle))[0]).toBe('Client marqué « noreview » : aucune demande d’avis');
    await emettreNote(b, voisin);
    await attendreJournaux(b, regle, 2);
    const { data: v } = await b.admin.from('clients').select('phone, email').eq('id', voisin).single();
    const { data: recus } = await b.admin.from('envois_simules').select('canal, destinataire').eq('org_id', b.orgA)
      .gte('created_at', new Date(Date.parse(depuis) - 60_000).toISOString()).in('destinataire', [v!.phone, v!.email]);
    expect((recus ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('[E-17] une automatisation de demande d’avis ÉCRITE À LA MAIN (texto avec le lien d’avis) saute aussi un client « noreview » — aujourd’hui seuls les deux préréglages d’avis le font', async () => {
    const m = marque('E-17');
    const depuis = new Date().toISOString();
    const exclu = await clientSansAvis(m, '+15145550168');
    const regle = await creerRegle(b, menage, m, {
      actions: [texto(`${m} Bonjour [client_first_name], laissez-nous un avis, ça nous aide beaucoup : [google_review_url]`)],
    });
    await emettreNote(b, exclu);
    await attendreJournaux(b, regle, 1);
    const etat = { envois: (await partis(b as Bureau, depuis, m)).length, journal: await verdicts(b as Bureau, regle) };
    expect(etat, 'aujourd’hui : le client « noreview » reçoit la demande d’avis').toEqual({ envois: 0, journal: ['client_sans_avis'] });
  });
});
