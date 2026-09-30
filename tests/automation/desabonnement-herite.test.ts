/**
 * Vague 3 (audit V2, L2 et L3) — STOP / START du traitement d'origine, celui
 * qui s'applique tant que le drapeau `auto_desabonnement_canal` est OFF
 * (c'est-à-dire partout aujourd'hui).
 *
 *  L3 : un texto « Oui » / « yes » ne lève JAMAIS un désabonnement ; seul
 *       START réabonne, et seulement l'entreprise du numéro qui l'a reçu.
 *  L2 : un STOP ne coupe que l'entreprise du numéro qui l'a reçu quand on la
 *       connaît ; sinon, toutes celles qui ont une conversation (prudence).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appliquerMotCleHerite, motCleHerite } from '../../server/lib/desabonnement/sms';
import { clientEnregistreur, requetes } from './filet-regression/_enregistreur';

const TEL = '+15145550101';
const NUMERO_A = '+14385550000';
const ORG_A = 'org-a';
const ORG_B = 'org-b';

/** Le numéro NUMERO_A appartient à A ; le client a une conversation avec A et B. */
const monde = (proprietaire: string | null = ORG_A) => clientEnregistreur({
  communication_channels: (req) => {
    const numero = req.filtres.find(([m, c]) => m === 'eq' && c === 'phone_number')?.[2];
    return { data: numero === NUMERO_A && proprietaire ? [{ org_id: proprietaire }] : [] };
  },
  conversations: { data: [{ org_id: ORG_A }, { org_id: ORG_B }, { org_id: ORG_A }] },
  sms_opt_outs: { data: null },
});

const orgsTouchees = (journal: ReturnType<typeof monde>['journal'], op: 'insert' | 'delete') =>
  requetes(journal, 'sms_opt_outs', op).map((r) =>
    op === 'insert'
      ? (r.valeur as { org_id: string }).org_id
      : r.filtres.find(([m, c]) => m === 'eq' && c === 'org_id')?.[2],
  );

describe('L3 — « oui » n\'est pas un réabonnement', () => {
  it.each(['oui', 'Oui', 'OUI', 'yes', 'Yes', ' oui '])('« %s » n\'est pas un mot-clé', (m) => {
    expect(motCleHerite(m)).toBeNull();
  });
  it.each(['START', 'start', 'unstop', 'Reprendre', 'resume'])('« %s » réabonne', (m) => {
    expect(motCleHerite(m)).toBe('start');
  });
  it.each(['STOP', 'arrêt', 'Arret', 'unsubscribe', 'désabonner', 'cancel', 'end', 'quit'])('« %s » désabonne', (m) => {
    expect(motCleHerite(m)).toBe('stop');
  });

  it('START ne réabonne QUE l\'entreprise du numéro qui l\'a reçu', async () => {
    const { client, journal } = monde();
    const r = await appliquerMotCleHerite(client, { telephone: TEL, to: NUMERO_A, genre: 'start' });
    expect(r.orgIds).toEqual([ORG_A]);
    expect(orgsTouchees(journal, 'delete')).toEqual([ORG_A]);
  });

  it('START vers un numéro qu\'aucune entreprise ne possède : rien n\'est levé', async () => {
    const { client, journal } = monde(null);
    const r = await appliquerMotCleHerite(client, { telephone: TEL, to: '+19995550000', genre: 'start' });
    expect(r.orgIds).toEqual([]);
    expect(requetes(journal, 'sms_opt_outs', 'delete')).toHaveLength(0);
  });

  it('START sans numéro destinataire : rien n\'est levé', async () => {
    const { client, journal } = monde();
    await appliquerMotCleHerite(client, { telephone: TEL, to: null, genre: 'start' });
    expect(requetes(journal, 'sms_opt_outs', 'delete')).toHaveLength(0);
  });

  it('la route ne traite plus « oui » / « yes » comme un consentement', () => {
    const route = readFileSync(resolve(__dirname, '../../server/routes/messages.ts'), 'utf8');
    expect(route).not.toMatch(/\(yes\|oui\)/);
    expect(route).toContain('motCleHerite(bodyTrim)');
  });
});

describe('L2 — un STOP ne coupe que l\'entreprise du numéro qui l\'a reçu', () => {
  it('numéro connu : seule son entreprise est désabonnée', async () => {
    const { client, journal } = monde();
    const r = await appliquerMotCleHerite(client, { telephone: TEL, to: NUMERO_A, genre: 'stop' });
    expect(r.orgIds).toEqual([ORG_A]);
    expect(orgsTouchees(journal, 'insert')).toEqual([ORG_A]);
    // Et les conversations ne sont même pas consultées.
    expect(requetes(journal, 'conversations')).toHaveLength(0);
  });

  it('numéro inconnu : prudence, toutes les entreprises en conversation', async () => {
    const { client, journal } = monde(null);
    const r = await appliquerMotCleHerite(client, { telephone: TEL, to: '+19995550000', genre: 'stop' });
    expect(r.orgIds.sort()).toEqual([ORG_A, ORG_B]);
    expect(orgsTouchees(journal, 'insert').sort()).toEqual([ORG_A, ORG_B]);
  });

  it('sans numéro destinataire : prudence aussi', async () => {
    const { client } = monde();
    const r = await appliquerMotCleHerite(client, { telephone: TEL, to: null, genre: 'stop' });
    expect(r.orgIds.sort()).toEqual([ORG_A, ORG_B]);
  });

  it('le STOP est enregistré avec le motif client_stop', async () => {
    const { client, journal } = monde();
    await appliquerMotCleHerite(client, { telephone: TEL, to: NUMERO_A, genre: 'stop' });
    expect(requetes(journal, 'sms_opt_outs', 'insert')[0].valeur).toEqual({ org_id: ORG_A, phone: TEL, reason: 'client_stop' });
  });
});
