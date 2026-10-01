/**
 * Agent E — point 7 de la mission : DOUBLONS (décision du propriétaire : avertir + un seul envoi).
 *
 * « Un client ne reçoit jamais deux fois le même message (même canal, contenu
 * identique ou quasi identique) dans une fenêtre courte. Le deuxième envoi est
 * journalisé “ignoré : doublon”. »
 *
 * Les six cas demandés, joués sur le VRAI moteur (pile locale, mon bureau A en bac
 * à sable). Déclencheur : `note.added` sur un client — aucun préréglage ne l'écoute,
 * donc seules MES règles répondent.
 *
 *   QA_AUTO_SUFFIXE=e npx vitest run --maxWorkers=2 --config tests/automations-finale/e/vitest.config.ts --project e-integration tests/automations-finale/e/integration/e-doublons.test.ts
 *
 * « témoin » = vert aujourd'hui (et doit le rester après le correctif : ce sont les
 * garde-fous contre un anti-doublon trop zélé). Les autres sont ROUGES aujourd'hui.
 * Ce que le journal doit dire d'un doublon ignoré (`saute_code: 'doublon'`) suit la
 * proposition de notes/E-conception.md, « Conception 2 ».
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { demarrerMoteur, marque, traiterFile } from '../../../automations-suite/harnais/moteur';
import { emettreNote, attendreTraitement, modeBac, rendreDues, pause } from '../../../automations-suite/integration/20-cde-outils';
import {
  PILE_LOCALE, Menage, creerClient, creerRegle, taches, avancer, attendreJournaux, attendre, partis, verdicts, motifs, type Bureau,
} from './outils-e';
import { COMPTES, sessionDe } from '../../../automations-suite/harnais/bureau-test';
import { changerPublication } from '../../../../server/lib/automations-publication';
import { lireDejaPubliees, noteDejaPubliees } from '../../../../server/lib/lumi/deja-publiees';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const menage = new Menage();

beforeAll(async () => { if (PILE_LOCALE) b = await demarrerMoteur(); });
afterEach(async () => { await menage.vider(); });
afterAll(async () => { if (PILE_LOCALE) { await modeBac(b, 'succes'); await menage.vider(); } });

/** Transactionnel : ni plafond commercial, ni mention STOP ajoutée — on isole le SEUL sujet, le doublon. */
const texto = (corps: string) => ({ type: 'send_sms', config: { body: corps, type_envoi: 'transactionnel' } });
const courriel = (objet: string, corps: string) => ({ type: 'send_email', config: { subject: objet, body: `<p>${corps}</p>`, type_envoi: 'transactionnel' } });

describe.skipIf(!PILE_LOCALE)('E — doublons : deux automatisations pour le même client', () => {
  it('[E-20] deux automatisations IDENTIQUES (même déclencheur, même texto) → le client reçoit UN texto, le second est journalisé « ignoré : doublon »', async () => {
    const m = marque('E-20');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const corps = `${m} Bonjour [client_first_name], merci de votre confiance. À bientôt !`;
    const r1 = await creerRegle(b, menage, `${m} un`, { actions: [texto(corps)] });
    const r2 = await creerRegle(b, menage, `${m} deux`, { actions: [texto(corps)] });
    await emettreNote(b, client);
    await attendreJournaux(b, r1, 1);
    await attendreJournaux(b, r2, 1);
    const envois = await partis(b as Bureau, depuis, m);
    const etat = { envois: envois.length, journal: [...await verdicts(b as Bureau, r1), ...await verdicts(b as Bureau, r2)] };
    expect(etat, 'aujourd’hui : 2 textos identiques partent').toEqual({ envois: 1, journal: ['envoye', 'doublon'] });
    expect((await motifs(b as Bureau, r2)).join(' ')).toMatch(/doublon/i);
  });

  it('[E-21] deux automatisations IDENTIQUES par courriel (même objet, même corps) → UN courriel', async () => {
    const m = marque('E-21');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const r1 = await creerRegle(b, menage, `${m} un`, { actions: [courriel(`${m} Merci`, 'Bonjour [client_first_name], merci de votre confiance.')] });
    const r2 = await creerRegle(b, menage, `${m} deux`, { actions: [courriel(`${m} Merci`, 'Bonjour [client_first_name], merci de votre confiance.')] });
    await emettreNote(b, client);
    await attendreJournaux(b, r1, 1);
    await attendreJournaux(b, r2, 1);
    expect((await partis(b as Bureau, depuis, m)).length, 'aujourd’hui : 2 courriels identiques partent').toBe(1);
  });

  it('[E-22] deux automatisations QUASI identiques (message reformulé) → UN texto', async () => {
    const m = marque('E-22');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const r1 = await creerRegle(b, menage, `${m} un`, { actions: [texto(`${m} Bonjour [client_first_name], votre rendez-vous est confirmé pour demain 9 h. Merci !`)] });
    const r2 = await creerRegle(b, menage, `${m} deux`, { actions: [texto(`${m} Bonjour [client_first_name], votre rendez-vous est bien confirmé pour demain à 9 h. Merci.`)] });
    await emettreNote(b, client);
    await attendreJournaux(b, r1, 1);
    await attendreJournaux(b, r2, 1);
    const etat = { envois: (await partis(b as Bureau, depuis, m)).length, second: await verdicts(b as Bureau, r2) };
    expect(etat, 'aujourd’hui : les deux formulations partent').toEqual({ envois: 1, second: ['doublon'] });
  });

  it('[E-23 témoin] deux automatisations RÉELLEMENT différentes pour le même client le même jour → les DEUX partent', async () => {
    const m = marque('E-23');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const r1 = await creerRegle(b, menage, `${m} merci`, { actions: [texto(`${m} Bonjour [client_first_name], merci d’avoir choisi [company_name] aujourd’hui.`)] });
    const r2 = await creerRegle(b, menage, `${m} facture`, { actions: [texto(`${m} Votre facture est prête : vous pouvez la régler en ligne quand vous voulez.`)] });
    await emettreNote(b, client);
    await attendreJournaux(b, r1, 1);
    await attendreJournaux(b, r2, 1);
    expect((await partis(b as Bureau, depuis, m)).length).toBe(2);
    expect([...await verdicts(b as Bureau, r1), ...await verdicts(b as Bureau, r2)]).toEqual(['envoye', 'envoye']);
  });

  it('[E-23 témoin] le MÊME texte à deux clients DIFFÉRENTS → les deux partent (le doublon se juge par destinataire)', async () => {
    const m = marque('E-23b');
    const depuis = new Date().toISOString();
    // Deux numéros distincts de la plage fictive, choisis ici pour ne pas dépendre du hasard.
    const c1 = await creerClient(b, menage, `${m}-1`, { phone: '+15145550181' });
    const c2 = await creerClient(b, menage, `${m}-2`, { phone: '+15145550182' });
    const regle = await creerRegle(b, menage, m, { actions: [texto(`${m} Bonjour, merci de votre confiance.`)] });
    await emettreNote(b, c1);
    await emettreNote(b, c2);
    await attendreJournaux(b, regle, 2);
    expect((await partis(b as Bureau, depuis, m)).length).toBe(2);
  });
});

describe.skipIf(!PILE_LOCALE)('E — doublons : la même automatisation, plusieurs fois (témoins)', () => {
  it('[E-24 témoin] le même événement reçu DEUX fois de suite → un seul texto (fenêtre de 2 min du moteur)', async () => {
    const m = marque('E-24');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [texto(`${m} Bonjour, c’est noté.`)] });
    await emettreNote(b, client);
    await emettreNote(b, client);
    await attendreTraitement(b, client, 'note.added', depuis, 2);
    await attendreJournaux(b, regle, 1);
    await pause(1500);
    expect((await partis(b as Bureau, depuis, m)).length).toBe(1);
  });

  it('[E-25 témoin] reprise d’une tâche après une panne du fournisseur → un seul texto livré, pas de second après la reprise', async () => {
    const m = marque('E-25');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [texto(`${m} Bonjour, petit rappel.`)], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await modeBac(b, 'panne');
    try { await avancer(b, regle); } finally { await modeBac(b, 'succes'); }
    expect((await taches(b, regle))[0]).toMatchObject({ status: 'pending', attempts: 1 });
    expect((await partis(b as Bureau, depuis, m)).length).toBe(0);
    await avancer(b, regle);                      // 1re reprise : part
    await avancer(b, regle);                      // un tick de plus : rien à refaire
    expect((await taches(b, regle))[0].status).toBe('completed');
    expect((await partis(b as Bureau, depuis, m)).length).toBe(1);
  });

  it('[E-26 témoin] deux consommateurs en parallèle sur la même tâche due → un seul texto', async () => {
    const m = marque('E-26');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [texto(`${m} Bonjour, petit rappel.`)], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await rendreDues(b, regle);
    await Promise.all([traiterFile(b.admin, b.orgA), traiterFile(b.admin, b.orgA)]);
    expect((await partis(b as Bureau, depuis, m)).length).toBe(1);
    expect((await taches(b, regle)).map((t) => t.status)).toEqual(['completed']);
  });
});

describe.skipIf(!PILE_LOCALE)('E — doublons : deux automatisations identiques, deux consommateurs en parallèle', () => {
  it('[E-27] deux automatisations identiques DIFFÉRÉES, traitées par deux consommateurs en même temps → UN texto', async () => {
    const m = marque('E-27');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const corps = `${m} Bonjour [client_first_name], petit rappel pour votre rendez-vous de demain.`;
    const r1 = await creerRegle(b, menage, `${m} un`, { actions: [texto(corps)], delay_seconds: 3600 });
    const r2 = await creerRegle(b, menage, `${m} deux`, { actions: [texto(corps)], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, r1), (x) => x.length === 1);
    await attendre(() => taches(b, r2), (x) => x.length === 1);
    await rendreDues(b, r1);
    await rendreDues(b, r2);
    await Promise.all([traiterFile(b.admin, b.orgA), traiterFile(b.admin, b.orgA)]);
    await attendre(async () => [...await taches(b, r1), ...await taches(b, r2)], (t) => t.every((x) => x.status === 'completed'));
    expect((await partis(b as Bureau, depuis, m)).length, 'aujourd’hui : chaque automatisation envoie le sien').toBe(1);
  });
});

describe.skipIf(!PILE_LOCALE)('E — doublons : l’avertissement à la publication', () => {
  const corps = 'Bonjour [client_first_name], merci de votre demande. On vous rappelle très vite.';

  it('[E-28] publier une automatisation identique à une autre déjà publiée (même déclencheur, même canal, mêmes clients) → la réponse AVERTIT et NOMME l’autre', async () => {
    const m = marque('E-28');
    const a = await creerRegle(b, menage, `${m} Bienvenue A`, { actions: [texto(corps)], is_active: true });
    const copie = await creerRegle(b, menage, `${m} Bienvenue B`, { actions: [texto(corps)], is_active: false });
    const { client } = await sessionDe(b.admin, COMPTES.proprioA.email);
    const r = await changerPublication(client, b.orgA, copie, true) as unknown as { ok: boolean; avertissements?: Array<{ regle_id?: string; nom?: string }> };
    expect(r.ok).toBe(true); // la publication n'est pas bloquée : on avertit
    expect(r.avertissements ?? [], 'aujourd’hui : aucune mention de l’automatisation en conflit').not.toEqual([]);
    expect(JSON.stringify(r.avertissements)).toContain(`${m} Bienvenue A`);
    void a;
  });

  it('[E-29 témoin] « Construire avec Lumi » signale déjà une automatisation publiée sur le même déclencheur qui fait la même chose', async () => {
    const m = marque('E-29');
    await creerRegle(b, menage, `${m} Bienvenue A`, { actions: [texto(corps)], is_active: true });
    const { client } = await sessionDe(b.admin, COMPTES.proprioA.email);
    const deja = (await lireDejaPubliees(client, b.orgA, 'note.added', null, 'fr')).filter((r) => r.nom.includes(m));
    expect(deja).toEqual([{ nom: `${m} Bienvenue A`, actions: ['send_sms'] }]);
    expect(noteDejaPubliees(deja, 'note.added', 'fr', ['send_sms'])).toContain(`« ${m} Bienvenue A »`);
    expect(noteDejaPubliees(deja, 'note.added', 'fr', ['create_task'])).toBe(''); // pas le même canal : rien
  });

  it('[E-29] l’avertissement de Lumi tient compte du CIBLAGE : deux automatisations qui ne peuvent pas toucher le même client ne sont pas signalées', async () => {
    const m = marque('E-29b');
    // A ne vise que les clients VIP ; la nouvelle exclut les VIP : aucun client commun.
    await creerRegle(b, menage, `${m} Offre VIP`, { conditions: { client_a_etiquette: 'VIP' }, actions: [texto(corps)], is_active: true });
    const { client } = await sessionDe(b.admin, COMPTES.proprioA.email);
    const lire = lireDejaPubliees as unknown as (...args: unknown[]) => Promise<Array<{ nom: string }>>;
    const deja = (await lire(client, b.orgA, 'note.added', null, 'fr', { conditions: { client_sans_etiquette: 'VIP' } })).filter((r) => r.nom.includes(m));
    expect(deja, 'aujourd’hui : signalée quand même (le ciblage n’est pas lu)').toEqual([]);
  });
});
