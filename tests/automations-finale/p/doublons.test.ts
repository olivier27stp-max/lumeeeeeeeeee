/**
 * Agent P — doublons, la garde d'envoi (server/lib/actions/doublons.ts).
 *
 *   npx vitest run --maxWorkers=2 tests/automations-finale/p/doublons.test.ts
 *
 * Trois blocs :
 *   1. ce qui est « le même message » — les cas de la conception de l'agent E
 *      rejoués sur le VRAI module, et le seuil remesuré sur les messages fournis ;
 *   2. la garde elle-même (lecture des 24 h, réservation, libération), sur une
 *      fausse base qui imite l'index unique de `automation_execution_logs` ;
 *   3. en cas de doute, on envoie — avec une trace.
 * La réservation contre la VRAIE base (deux consommateurs réellement simultanés) :
 * integration/p-doublons.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AUTOMATION_PRESETS } from '../../../server/lib/automationPresets.data';
import { PACK_PARCOURS } from '../../../server/lib/automationPack.data';
import { resolveTemplate } from '../../../server/lib/actions/index';
import {
  estDoublon, envoiPasse, similarite, normaliserMessage, empreinte, empreinteDestinataire, liensPublicsDe, gardeDoublon,
  phraseDoublon, quandLisible, cleReservation, fenetreDoublonHeures,
  SEUIL_QUASI_IDENTIQUE, ACTION_RESERVATION, FENETRE_DOUBLON_HEURES_DEFAUT, type ContexteDoublon, type EnvoiPasse,
} from '../../../server/lib/actions/doublons';
import { logger } from '../../../server/lib/logger';
import { FausseBase, uuid } from './fausse-base';

const MAINTENANT = new Date('2026-10-14T19:00:00Z'); // 15 h à Montréal
const ilYA = (heures: number) => new Date(MAINTENANT.getTime() - heures * 3600_000);
const LIEN_FACTURE = 'https://app.exemple.test/invoice/11111111-1111-4111-8111-111111111111';
const passe = (p: Partial<{ regleId: string; declencheur: string; fiche: string; quand: Date; nomRegle: string }> & { texte: string }): EnvoiPasse =>
  envoiPasse({ regleId: 'regle-A', declencheur: 'invoice.sent', fiche: 'invoice:1', quand: ilYA(2), ...p });

describe('P — doublons : ce qui est le même message, et ce qui ne l’est pas', () => {
  it('le même texte, à la casse, aux accents et à la ponctuation près → doublon, quelle que soit la fiche', () => {
    const v = estDoublon({ regleId: 'regle-B', declencheur: 'note.added', fiche: 'client:9', texte: 'bonjour marie — MERCI de votre confiance !!' },
      [passe({ fiche: 'client:1', declencheur: 'job.completed', texte: 'Bonjour Marie, merci de votre confiance.' })], MAINTENANT);
    expect(v).toMatchObject({ doublon: true, motif: 'identique' });
  });

  it('un message reformulé pour la même fiche → doublon ; le même pour une AUTRE fiche → non', () => {
    const avant = passe({ fiche: 'schedule_event:7', declencheur: 'appointment.created', texte: 'Bonjour Marie, votre rendez-vous est confirmé pour demain 9 h. Merci !' });
    const reformule = 'Bonjour Marie, votre rendez-vous est bien confirmé pour demain à 9 h. Merci.';
    expect(estDoublon({ regleId: 'regle-B', declencheur: 'appointment.created', fiche: 'schedule_event:7', texte: reformule }, [avant], MAINTENANT)).toMatchObject({ doublon: true, motif: 'quasi_identique' });
    expect(estDoublon({ regleId: 'regle-B', declencheur: 'appointment.created', fiche: 'schedule_event:8', texte: reformule }, [avant], MAINTENANT).doublon).toBe(false);
  });

  it('deux factures différentes en retard le même jour, même gabarit → les DEUX partent', () => {
    const avant = passe({ fiche: 'invoice:42', declencheur: 'invoice.overdue', texte: 'Bonjour Marie, la facture F-0042 de 517,39 $ est en retard.' });
    for (const regleId of ['regle-A', 'regle-B']) {
      expect(estDoublon({ regleId, declencheur: 'invoice.overdue', fiche: 'invoice:43', texte: 'Bonjour Marie, la facture F-0043 de 250,00 $ est en retard.' }, [avant], MAINTENANT).doublon).toBe(false);
    }
  });

  it('la MÊME automatisation ne se dédoublonne jamais elle-même (veille, puis 2 h avant)', () => {
    const veille = passe({ regleId: 'rdv', fiche: 'schedule_event:7', declencheur: 'appointment.created', texte: 'Rappel : votre rendez-vous est le 14 octobre à 9 h.' });
    expect(estDoublon({ regleId: 'rdv', declencheur: 'appointment.created', fiche: 'schedule_event:7', texte: 'Rappel : votre rendez-vous est le 14 octobre à 9 h.' }, [veille], MAINTENANT).doublon).toBe(false);
  });

  it('hors de la fenêtre de 24 h → ce n’est plus un doublon ; la fenêtre se règle', () => {
    const hier = passe({ quand: ilYA(25), texte: 'Bonjour Marie, merci de votre confiance.' });
    const nouveau = { regleId: 'regle-B', declencheur: 'invoice.sent', fiche: 'invoice:1', texte: 'Bonjour Marie, merci de votre confiance.' };
    expect(estDoublon(nouveau, [hier], MAINTENANT, 24).doublon).toBe(false);
    expect(estDoublon(nouveau, [hier], MAINTENANT, 48).doublon).toBe(true);
    expect(FENETRE_DOUBLON_HEURES_DEFAUT).toBe(24);
  });

  it('relance LOURDEMENT reformulée de la même facture, même déclencheur, même lien de paiement → doublon', () => {
    const avant = passe({ texte: `Bonjour Marie, la facture F-0042 est en retard de 3 jours. Payez ici : ${LIEN_FACTURE}` });
    const v = estDoublon({ regleId: 'regle-B', declencheur: 'invoice.sent', fiche: 'invoice:1', texte: `Marie, un mot pour vous dire que votre solde reste impayé. Le règlement se fait en ligne : ${LIEN_FACTURE}?utm=relance` }, [avant], MAINTENANT);
    expect(v).toMatchObject({ doublon: true, motif: 'meme_lien' });
  });

  it('relance de facture le matin, REÇU de paiement l’après-midi : même lien, déclencheurs différents → les deux partent', () => {
    const relance = passe({ declencheur: 'invoice.sent', texte: `Bonjour Marie, la facture F-0042 est en retard. Payez ici : ${LIEN_FACTURE}` });
    const v = estDoublon({ regleId: 'regle-B', declencheur: 'invoice.paid', fiche: 'invoice:1', texte: `Merci Marie ! Paiement reçu pour la facture F-0042. Votre reçu : ${LIEN_FACTURE}` }, [relance], MAINTENANT);
    expect(v.doublon).toBe(false);
  });

  it('merci après la job, puis demande d’avis le même jour (même job) → les deux partent', () => {
    const merci = passe({ fiche: 'job:3', declencheur: 'job.completed', texte: 'Bonjour Marie, merci d’avoir choisi Lavage Éclair aujourd’hui.' });
    const v = estDoublon({ regleId: 'regle-B', declencheur: 'job.completed', fiche: 'job:3', texte: 'Bonjour Marie, comment s’est passé votre lavage ? Laissez-nous un avis : https://app.exemple.test/survey/3333' }, [merci], MAINTENANT);
    expect(v.doublon).toBe(false);
  });

  it('un courriel se compare sur son texte LISIBLE : le HTML et les paramètres de suivi d’un lien ne comptent pas', () => {
    const html = '<div style="font-family:sans-serif"><h2>Merci</h2><p>Bonjour Marie,&nbsp;merci de votre confiance.</p><style>p{color:red}</style></div>';
    expect(normaliserMessage(html)).toBe('merci bonjour marie merci de votre confiance');
    expect(empreinte(html)).toBe(empreinte('MERCI\nBonjour Marie, merci de votre confiance !'));
    expect(liensPublicsDe(`<a href="${LIEN_FACTURE}?s=1">Payer</a> https://g.page/r/x/review`)).toEqual([LIEN_FACTURE]);
  });

  it('le destinataire : un même numéro écrit de trois façons a la même empreinte ; texto et courriel sont deux canaux', () => {
    const e = empreinteDestinataire('sms', '+15145550142');
    expect(empreinteDestinataire('sms', '(514) 555-0142')).toBe(e);
    expect(empreinteDestinataire('sms', '1 514 555 0142')).toBe(e);
    expect(empreinteDestinataire('sms', '+15145550143')).not.toBe(e);
    expect(empreinteDestinataire('email', ' Marie@Exemple.CA ')).toBe(empreinteDestinataire('email', 'marie@exemple.ca'));
    expect(e).not.toContain('5550142'); // le journal ne garde pas le numéro
  });
});

describe('P — doublons : le seuil mesuré sur les messages fournis par Lume', () => {
  const VARS: Record<string, string> = {
    client_first_name: 'Marie', client_last_name: 'Tremblay', client_name: 'Marie Tremblay', company_name: 'Lavage Éclair', company_phone: '514 555-0100',
    invoice_number: 'F-0042', invoice_total: '517,39 $', invoice_due_date: '15 octobre 2026', invoice_link: LIEN_FACTURE,
    quote_number: 'D-0218', quote_total: '1 437,19 $', quote_valid_until: '2 novembre 2026', quote_link: 'https://app.exemple.test/quote/2222',
    appointment_date: '14 octobre 2026', appointment_time: '09 h 00', appointment_title: 'Lavage de vitres', appointment_address: '120 rue Principale, Montréal',
    job_name: 'Lavage de vitres', google_review_url: 'https://g.page/r/exemple/review', review_page_url: 'https://app.exemple.test/survey/3333',
    review_link: 'https://app.exemple.test/survey/3333', survey_url: 'https://app.exemple.test/survey/3333', deposit_amount: '150,00 $',
  };
  const famille = (cle: string) => cle.replace(/#.*$/, '')
    .replace(/^pack_relance_facture$/, 'invoice_sent_reminder').replace(/^pack_relance_devis$/, 'quote_followup')
    .replace(/^(pack_rendez_vous|appointment_confirmation|job_reminder.*)$/, 'rendez_vous')
    .replace(/^(pack_suivi_prospect|welcome_new_lead|lead_followup.*)$/, 'prospect')
    .replace(/^(pack_depot|deposit_reminder|deposit_followup.*)$/, 'depot')
    .replace(/_\d+[dhm]$/, '');
  type Action = { type?: string; config?: Record<string, unknown> };
  const corpus: Array<{ source: string; canal: string; texte: string }> = [];
  const ajouter = (source: string, a: Action | undefined) => {
    if (!a?.config || typeof a.config.body !== 'string') return;
    if (a.type === 'send_sms') corpus.push({ source, canal: 'texto', texte: resolveTemplate(a.config.body, VARS) });
    if (a.type === 'send_email') corpus.push({ source, canal: 'courriel', texte: `${resolveTemplate(String(a.config.subject ?? ''), VARS)}\n${resolveTemplate(a.config.body, VARS, { html: true })}` });
  };
  for (const p of AUTOMATION_PRESETS) for (const a of (p.actions ?? []) as Action[]) ajouter(p.preset_key, a);
  for (const p of PACK_PARCOURS) for (const e of ((p as unknown as { steps?: Array<{ id?: string; action?: Action }> }).steps ?? [])) ajouter(`${p.preset_key}#${e.id ?? ''}`, e.action);

  it('le corpus : au moins 80 textos et courriels fournis', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(80);
  });

  it('AUCUNE paire de messages de familles différentes n’atteint le seuil (pas de faux positif) — marge d’au moins 0,15', () => {
    let max = 0; let paire = '';
    for (let i = 0; i < corpus.length; i++) {
      for (let j = i + 1; j < corpus.length; j++) {
        const [x, y] = [corpus[i], corpus[j]];
        if (x.canal !== y.canal || famille(x.source) === famille(y.source)) continue;
        const s = similarite(x.texte, y.texte);
        if (s > max) { max = s; paire = `${x.source} ↔ ${y.source}`; }
      }
    }
    expect(max, paire).toBeLessThanOrEqual(SEUIL_QUASI_IDENTIQUE - 0.15);
  });

  it('un préréglage et sa reprise dans le pack de base (le vrai doublon de prod : les deux publiés) sont reconnus', () => {
    const trouver = (source: string, canal: string) => corpus.find((m) => m.source === source && m.canal === canal)!.texte;
    for (const [a, b] of [['invoice_sent_reminder_7d', 'pack_relance_facture#e6'], ['quote_followup_3d', 'pack_relance_devis#e7'], ['invoice_sent_reminder_14d', 'pack_relance_facture#e10']] as const) {
      const [x, y] = [trouver(a, 'texto'), trouver(b, 'texto')];
      const v = estDoublon({ regleId: 'pack', declencheur: 'd', fiche: 'f:1', texte: y }, [envoiPasse({ regleId: 'prereglage', declencheur: 'd', fiche: 'f:1', texte: x, quand: ilYA(1) })], MAINTENANT);
      expect(v.doublon, `${a} ↔ ${b} : ${similarite(x, y).toFixed(2)}`).toBe(true);
    }
  });
});

describe('P — doublons : la garde d’envoi', () => {
  const ORG = uuid(1, 9);
  const CLIENT = uuid(1);
  let base: FausseBase;
  const ctx = (regle: string, p: Partial<ContexteDoublon> = {}): ContexteDoublon => ({
    supabase: base.client, orgId: ORG, entityType: 'client', entityId: CLIENT, ruleId: regle, declencheur: 'note.added',
    nomRegle: regle === 'A' ? 'Bienvenue A' : `Règle ${regle}`, fuseau: 'America/Toronto', ...p,
  });
  const reservations = () => base.lignes('automation_execution_logs').filter((l) => l.action_type === ACTION_RESERVATION);
  /** La garde, jouée à une heure donnée : la base date la réservation de la même heure. */
  const gardeA = (c: ContexteDoublon, canal: 'sms' | 'email', destinataire: string, texte: string, quand: Date) => {
    base.horloge = () => quand;
    return gardeDoublon(c, canal, destinataire, texte, quand);
  };
  const TEXTE = 'Bonjour Marie, merci de votre confiance. À bientôt !';

  beforeEach(() => { base = new FausseBase({ automation_execution_logs: [] }); delete process.env.AUTOMATION_FENETRE_DOUBLON_HEURES; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.AUTOMATION_FENETRE_DOUBLON_HEURES; });

  it('[mécanisme de E-20] deux automatisations identiques : la première envoie, la seconde est un doublon qui NOMME la première', async () => {
    const un = await gardeA(ctx('A'), 'sms', '+15145550142', TEXTE, ilYA(1));
    expect(un.doublon).toBe(false);
    const deux = await gardeA(ctx('B'), 'sms', '(514) 555-0142', TEXTE.toUpperCase(), MAINTENANT);
    expect(deux).toMatchObject({ doublon: true, motif: 'identique', phrase: 'Ignoré : doublon de « Bienvenue A », envoyé à 14 h 00' });
    expect(reservations()).toHaveLength(1);
  });

  it('[mécanisme de E-21] même chose par courriel (objet + corps) — et un courriel n’empêche pas un texto', async () => {
    const courriel = `Merci\n<p>${TEXTE}</p>`;
    expect((await gardeA(ctx('A'), 'email', 'marie@exemple.test', courriel, MAINTENANT)).doublon).toBe(false);
    expect((await gardeA(ctx('B'), 'email', 'Marie@Exemple.test', courriel, MAINTENANT)).doublon).toBe(true);
    expect((await gardeA(ctx('B'), 'sms', '+15145550142', courriel, MAINTENANT)).doublon).toBe(false);
  });

  it('[mécanisme de E-22] message reformulé, même fiche → doublon ; autre fiche du même client → part', async () => {
    await gardeA(ctx('A'), 'sms', '+15145550142', 'Bonjour Marie, votre rendez-vous est confirmé pour demain 9 h. Merci !', MAINTENANT);
    const reformule = 'Bonjour Marie, votre rendez-vous est bien confirmé pour demain à 9 h. Merci.';
    expect(await gardeA(ctx('B'), 'sms', '+15145550142', reformule, MAINTENANT)).toMatchObject({ doublon: true, motif: 'quasi_identique' });
    expect((await gardeA(ctx('B', { entityType: 'schedule_event', entityId: uuid(8) }), 'sms', '+15145550142', reformule, MAINTENANT)).doublon).toBe(false);
  });

  it('[témoin E-23] deux messages réellement différents le même jour → les deux partent ; le même texte à deux clients → les deux partent', async () => {
    expect((await gardeA(ctx('A'), 'sms', '+15145550142', 'Bonjour Marie, merci d’avoir choisi Lavage Éclair aujourd’hui.', MAINTENANT)).doublon).toBe(false);
    expect((await gardeA(ctx('B'), 'sms', '+15145550142', 'Votre facture est prête : vous pouvez la régler en ligne quand vous voulez.', MAINTENANT)).doublon).toBe(false);
    expect((await gardeA(ctx('C'), 'sms', '+15145550181', TEXTE, MAINTENANT)).doublon).toBe(false);
    expect((await gardeA(ctx('D'), 'sms', '+15145550182', TEXTE, MAINTENANT)).doublon).toBe(false);
    expect(reservations()).toHaveLength(4);
  });

  it('la même automatisation se suit sans se bloquer : même texte, deux fois, même jour', async () => {
    expect((await gardeA(ctx('A'), 'sms', '+15145550142', TEXTE, ilYA(3))).doublon).toBe(false);
    expect((await gardeA(ctx('A'), 'sms', '+15145550142', TEXTE, MAINTENANT)).doublon).toBe(false);
    // …et une AUTRE automatisation reste un doublon de la première.
    expect((await gardeA(ctx('B'), 'sms', '+15145550142', TEXTE, MAINTENANT)).doublon).toBe(true);
  });

  it('[mécanisme de E-27] deux consommateurs EN MÊME TEMPS : un seul envoie (l’index unique tranche)', async () => {
    const [x, y] = await Promise.all([
      gardeA(ctx('A'), 'sms', '+15145550142', TEXTE, MAINTENANT),
      gardeA(ctx('B'), 'sms', '+15145550142', TEXTE, MAINTENANT),
    ]);
    expect([x.doublon, y.doublon].sort()).toEqual([false, true]);
    expect([x, y].find((g) => g.doublon)?.phrase).toMatch(/^Ignoré : doublon de « (Bienvenue A|Règle B) », envoyé à 15 h 00$/);
    expect(reservations()).toHaveLength(1);
    expect(reservations()[0].execution_key).toBe(cleReservation('sms', '+15145550142', TEXTE, MAINTENANT));
  });

  it('reprise après une panne du fournisseur : la place est rendue, la reprise — ou une autre automatisation — envoie', async () => {
    const tentative = await gardeA(ctx('A'), 'sms', '+15145550142', TEXTE, MAINTENANT);
    await tentative.liberer(); // le fournisseur a refusé le message
    expect(reservations()[0]).toMatchObject({ execution_key: null, result_data: { reservation_liberee: true } });
    expect((await gardeA(ctx('B'), 'sms', '+15145550142', TEXTE, MAINTENANT)).doublon).toBe(false);
    // Sans libération (action coupée en plein envoi) : la MÊME règle reprend quand même.
    const coupee = await gardeA(ctx('C'), 'sms', '+15145550199', TEXTE, MAINTENANT);
    expect(coupee.doublon).toBe(false);
    expect((await gardeA(ctx('C'), 'sms', '+15145550199', TEXTE, MAINTENANT)).doublon).toBe(false);
  });

  it('au-delà de 24 h le même texte repart ; un autre bureau n’est jamais regardé', async () => {
    await gardeA(ctx('A'), 'sms', '+15145550142', TEXTE, ilYA(25));
    expect((await gardeA(ctx('B'), 'sms', '+15145550142', TEXTE, MAINTENANT)).doublon).toBe(false);
    expect((await gardeA(ctx('E', { orgId: uuid(2, 9) }), 'sms', '+15145550142', TEXTE, MAINTENANT)).doublon).toBe(false);
  });

  it('ce que la ligne technique garde : ni le numéro, ni le texte tel qu’écrit — et rien qu’un compteur prendrait pour un envoi', async () => {
    await gardeA(ctx('A', { entityType: 'invoice', entityId: uuid(4, 2), declencheur: 'invoice.overdue' }), 'sms', '+15145550142', `Bonjour Marie : ${LIEN_FACTURE}`, MAINTENANT);
    const l = reservations()[0];
    expect(l).toMatchObject({
      org_id: ORG, automation_rule_id: 'A', trigger_event: 'invoice.overdue', entity_type: 'invoice', entity_id: uuid(4, 2),
      action_type: 'reservation', result_success: true, result_error: null,
    });
    expect(l.result_data).toEqual({ envoi: {
      c: 'sms', a: empreinteDestinataire('sms', '+15145550142'), e: empreinte(`Bonjour Marie : ${LIEN_FACTURE}`), t: 'bonjour marie lien',
      l: [LIEN_FACTURE], fiche: `invoice:${uuid(4, 2)}`, declencheur: 'invoice.overdue', regle: 'A', nom: 'Bienvenue A',
    } });
    expect(JSON.stringify(l)).not.toContain('5550142');
    expect(l.action_type).not.toMatch(/^send_/);
  });

  it('hors moteur (aucune règle), texte vide, ou fenêtre réglée à 0 : la garde ne s’applique pas et ne lit rien', async () => {
    expect((await gardeA(ctx('A', { ruleId: undefined }), 'sms', '+15145550142', TEXTE, MAINTENANT)).doublon).toBe(false);
    expect((await gardeA(ctx('A'), 'sms', '+15145550142', '   ', MAINTENANT)).doublon).toBe(false);
    process.env.AUTOMATION_FENETRE_DOUBLON_HEURES = '0';
    expect(fenetreDoublonHeures()).toBe(0);
    expect((await gardeA(ctx('A'), 'sms', '+15145550142', TEXTE, MAINTENANT)).doublon).toBe(false);
    expect(base.totalLectures()).toBe(0);
    expect(reservations()).toHaveLength(0);
    process.env.AUTOMATION_FENETRE_DOUBLON_HEURES = 'beaucoup';
    expect(fenetreDoublonHeures()).toBe(24);
    process.env.AUTOMATION_FENETRE_DOUBLON_HEURES = '9999';
    expect(fenetreDoublonHeures()).toBe(168);
  });
});

describe('P — doublons : en cas de doute, on envoie — avec une trace', () => {
  const ORG = uuid(1, 9);
  let base: FausseBase;
  const ctx = (regle: string): ContexteDoublon => ({ supabase: base.client, orgId: ORG, entityType: 'client', entityId: uuid(1), ruleId: regle, declencheur: 'note.added', nomRegle: regle });
  beforeEach(() => { base = new FausseBase({ automation_execution_logs: [] }); base.horloge = () => MAINTENANT; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('lecture ratée : le message part, la trace dit pourquoi', async () => {
    const trace = vi.spyOn(logger, 'error').mockImplementation(() => {});
    await gardeDoublon(ctx('A'), 'sms', '+15145550142', 'Bonjour', MAINTENANT);
    base.pannes.automation_execution_logs = { message: 'connexion coupée' };
    const g = await gardeDoublon(ctx('B'), 'sms', '+15145550142', 'Bonjour !', MAINTENANT);
    // Ni les envois récents ni la réservation existante ne se lisent : dans le doute, le message part.
    expect(g.doublon).toBe(false);
    expect(trace.mock.calls.map((c) => String(c[0])).join(' | ')).toContain('envois récents illisibles');
  });

  it('écriture ratée (autre chose qu’un doublon) : le message part, la trace le dit', async () => {
    const trace = vi.spyOn(logger, 'error').mockImplementation(() => {});
    base.pannesEcriture.automation_execution_logs = { message: 'base en lecture seule', code: '25006' };
    const g = await gardeDoublon(ctx('A'), 'sms', '+15145550142', 'Bonjour', MAINTENANT);
    expect(g.doublon).toBe(false);
    await g.liberer(); // sans effet, sans erreur
    expect(String(trace.mock.calls[0][0])).toContain('réservation impossible');
  });

  it('un client Supabase qui LÈVE (réseau) ne fait jamais échouer l’envoi', async () => {
    const trace = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const casse = { from: () => { throw new Error('fetch failed'); } } as unknown as ContexteDoublon['supabase'];
    const g = await gardeDoublon({ ...ctx('A'), supabase: casse }, 'sms', '+15145550142', 'Bonjour', MAINTENANT);
    expect(g.doublon).toBe(false);
    expect(String(trace.mock.calls[0][0])).toContain('garde en erreur');
  });

  it('la phrase du journal dit l’heure dans le fuseau de l’entreprise', () => {
    const quand = new Date('2026-10-14T18:02:00Z');
    expect(quandLisible(quand, MAINTENANT, 'America/Toronto')).toBe('à 14 h 02');
    expect(quandLisible(quand, MAINTENANT, 'America/Vancouver')).toBe('à 11 h 02');
    expect(quandLisible(new Date('2026-10-13T22:30:00Z'), MAINTENANT)).toBe('hier à 18 h 30');
    expect(quandLisible(new Date('2026-10-11T13:05:00Z'), MAINTENANT)).toBe('le 11 octobre à 9 h 05');
    expect(phraseDoublon({ nomRegle: 'Relance de facture — 3, 7, 14 et 30 jours', quand }, MAINTENANT)).toBe('Ignoré : doublon de « Relance de facture — 3, 7, 14 et 30 jours », envoyé à 14 h 02');
    expect(phraseDoublon({ nomRegle: null, quand }, MAINTENANT)).toBe('Ignoré : doublon d’un message envoyé à 14 h 02 par une autre automatisation');
    expect(phraseDoublon(undefined)).toMatch(/^Ignoré : doublon/);
  });
});
