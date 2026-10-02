/**
 * Agent E — point 16 de la mission : LANGUE, CONTENU ET EXPÉDITEUR.
 *
 * Déjà établi par la suite existante (cité, pas refait) :
 *   · langue de l'ENTREPRISE pour chaque message — tests/automations-suite/integration/30-fgh-langue.test.ts [H-001] à [H-006] ;
 *   · logo, couleur, nom de l'entreprise, aucune autre trace de Lume — 30-fgh-conformite.test.ts [G-020], [G-021] ;
 *   · « ROUGE ATTENDU — décision requise » : le petit mascot Lume en bas du courriel [G-022] (retiré le 2026-09-29),
 *     l'adresse d'expédition sur le domaine de Lume tant que l'entreprise n'a pas vérifié le sien [G-023] ;
 *   · lien de désabonnement et List-Unsubscribe [G-001] à [G-004] ; STOP et mention « Répondez STOP » [G-010] à [G-013].
 *
 * Ce fichier ajoute : qui est l'expéditeur réel (numéro, nom, adresse de réponse), ce qui se
 * passe quand l'entreprise n'a pas rempli son nom ou son courriel, et l'absence de langue par client.
 *
 *   QA_AUTO_SUFFIXE=e npx vitest run --maxWorkers=2 --config tests/automations-finale/e/vitest.config.ts --project e-integration tests/automations-finale/e/integration/e-langue-expediteur.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { demarrerMoteur, marque } from '../../../automations-suite/harnais/moteur';
import { NUMERO_A } from '../../../automations-suite/harnais/bureau-test';
import { emettreNote } from '../../../automations-suite/integration/20-cde-outils';
import { PILE_LOCALE, Menage, creerClient, creerRegle, attendreJournaux, partis, type Bureau } from './outils-e';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const menage = new Menage();
beforeAll(async () => { if (PILE_LOCALE) b = await demarrerMoteur(); });
afterEach(async () => { await menage.vider(); });
afterAll(async () => { await menage.vider(); });

const texto = (corps: string) => ({ type: 'send_sms', config: { body: corps, type_envoi: 'transactionnel' } });
const courriel = (objet: string) => ({ type: 'send_email', config: { subject: objet, body: '<p>Bonjour [client_first_name], merci.</p>', type_envoi: 'transactionnel' } });

async function reglagesTemporaires(valeurs: Record<string, unknown>): Promise<void> {
  const { data: avant, error } = await b.admin.from('company_settings').select(Object.keys(valeurs).join(', ')).eq('org_id', b.orgA).single();
  if (error) throw new Error(error.message);
  const { error: e2 } = await b.admin.from('company_settings').update(valeurs).eq('org_id', b.orgA);
  if (e2) throw new Error(e2.message);
  menage.ajouter(() => b.admin.from('company_settings').update(avant as unknown as Record<string, unknown>).eq('org_id', b.orgA));
}

async function envoyer(m: string) {
  const depuis = new Date().toISOString();
  const client = await creerClient(b, menage, m);
  const rs = await creerRegle(b, menage, `${m} texto`, { actions: [texto(`${m} Bonjour, à demain.`)] });
  const rc = await creerRegle(b, menage, `${m} courriel`, { actions: [courriel(`${m} Merci`)] });
  await emettreNote(b, client);
  await attendreJournaux(b, rs, 1);
  await attendreJournaux(b, rc, 1);
  const envois = await partis(b as Bureau, depuis, m);
  return {
    sms: envois.find((e) => e.canal === 'sms'),
    mail: envois.find((e) => e.canal === 'courriel'),
  };
}

describe.skipIf(!PILE_LOCALE)('E — expéditeur d’un message automatisé', () => {
  it('[E-50 témoin] texto : part du numéro DE L’ENTREPRISE ; courriel : nom de l’entreprise, réponse à l’adresse de l’entreprise', async () => {
    const { sms, mail } = await envoyer(marque('E-50'));
    expect((sms!.meta as { from?: string }).from).toBe(NUMERO_A);
    const meta = mail!.meta as { from?: string; replyTo?: string };
    expect(meta.from).toMatch(/^Nettoyage Test A </);
    expect(meta.replyTo).toBe('bureau-a@lume-qa.test');
    expect(String(mail!.corps)).toContain('<html lang="fr">');
  });

  it('[E-51 témoin] entreprise SANS nom dans ses réglages : le courriel ne part ni au nom de « Lume CRM », ni avec une réponse vers le soutien de Lume', async () => {
    await reglagesTemporaires({ company_name: '', email: '' });
    const { mail } = await envoyer(marque('E-51'));
    const meta = (mail?.meta ?? {}) as { from?: string; replyTo?: string };
    expect({ from: meta.from, replyTo: meta.replyTo }).not.toMatchObject({ from: expect.stringMatching(/^Lume/i) });
    expect(String(meta.replyTo ?? '')).not.toMatch(/lumecrm\.net|support@/i);
  });
});

describe.skipIf(!PILE_LOCALE)('E — langue du client', () => {
  it('[E-52 témoin] aucune préférence de langue n’existe par client : ni colonne sur la fiche, ni champ posé d’office', async () => {
    const m = marque('E-52');
    const client = await creerClient(b, menage, m);
    const { data: fiche } = await b.admin.from('clients').select('*').eq('id', client).single();
    expect(Object.keys(fiche as Record<string, unknown>).filter((k) => /lang/i.test(k))).toEqual([]);
    const { data: champs } = await b.admin.from('custom_fields').select('key, label').eq('org_id', b.orgA).eq('object_type', 'client').is('archived_at', null);
    expect((champs ?? []).filter((c) => /lang/i.test(`${c.key} ${c.label}`))).toEqual([]);
  });
});
