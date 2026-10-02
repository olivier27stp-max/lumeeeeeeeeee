/**
 * Agent E — PREUVES DE CONCEPTION (vertes aujourd'hui).
 *
 * Ces tests n'éprouvent pas le produit : ils éprouvent les deux PROTOTYPES purs écrits
 * pendant l'enquête (scripts/qa/finale/e/prototype-ciblage.ts, prototype-doublons.ts), pour
 * montrer que les règles proposées dans notes/E-conception.md tiennent sur des cas réels —
 * en particulier qu'un anti-doublon « quasi identique » n'avale jamais deux messages
 * réellement différents. Les correctifs pourront reprendre ces fonctions et ces cas.
 */
import { describe, it, expect } from 'vitest';
import { AUTOMATION_PRESETS } from '../../../../server/lib/automationPresets.data';
import { PACK_PARCOURS } from '../../../../server/lib/automationPack.data';
import { resolveTemplate } from '../../../../server/lib/actions/index';
import {
  estDoublon, similarite, normaliserMessage, SEUIL_QUASI_IDENTIQUE, type EnvoiPasse,
} from '../../../../scripts/qa/finale/e/prototype-doublons';
import { evaluerCiblage, ciblagesSeChevauchent, type Ciblage, type FicheClient } from '../../../../scripts/qa/finale/e/prototype-ciblage';

const MAINTENANT = new Date('2026-10-14T15:00:00Z');
const ilYA = (heures: number) => new Date(MAINTENANT.getTime() - heures * 3600_000);
const LIEN_FACTURE = 'https://app.exemple.test/invoice/11111111-1111-4111-8111-111111111111';
const passe = (p: Partial<EnvoiPasse> & { texte: string }): EnvoiPasse => ({ regleId: 'regle-A', declencheur: 'invoice.sent', fiche: 'invoice:1', quand: ilYA(2), ...p });

describe('E — conception « doublons » : ce qui est le même message, et ce qui ne l’est pas', () => {
  it('le même texte, à la casse, aux accents et à la ponctuation près → doublon', () => {
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
    expect(estDoublon({ regleId: 'regle-A', declencheur: 'invoice.overdue', fiche: 'invoice:43', texte: 'Bonjour Marie, la facture F-0043 de 250,00 $ est en retard.' }, [avant], MAINTENANT).doublon).toBe(false);
    expect(estDoublon({ regleId: 'regle-B', declencheur: 'invoice.overdue', fiche: 'invoice:43', texte: 'Bonjour Marie, la facture F-0043 de 250,00 $ est en retard.' }, [avant], MAINTENANT).doublon).toBe(false);
  });

  it('la MÊME automatisation ne se dédoublonne jamais elle-même (veille, puis 2 h avant)', () => {
    const veille = passe({ regleId: 'rdv', fiche: 'schedule_event:7', declencheur: 'appointment.created', texte: 'Rappel : votre rendez-vous est le 14 octobre à 9 h.' });
    expect(estDoublon({ regleId: 'rdv', declencheur: 'appointment.created', fiche: 'schedule_event:7', texte: 'Rappel : votre rendez-vous est le 14 octobre à 9 h.' }, [veille], MAINTENANT).doublon).toBe(false);
  });

  it('hors de la fenêtre de 24 h → ce n’est plus un doublon', () => {
    const hier = passe({ quand: ilYA(25), texte: 'Bonjour Marie, merci de votre confiance.' });
    expect(estDoublon({ regleId: 'regle-B', declencheur: 'invoice.sent', fiche: 'invoice:1', texte: 'Bonjour Marie, merci de votre confiance.' }, [hier], MAINTENANT).doublon).toBe(false);
  });

  it('relance LOURDEMENT reformulée de la même facture, même déclencheur, même lien de paiement → doublon', () => {
    const avant = passe({ texte: `Bonjour Marie, la facture F-0042 est en retard de 3 jours. Payez ici : ${LIEN_FACTURE}` });
    const v = estDoublon({ regleId: 'regle-B', declencheur: 'invoice.sent', fiche: 'invoice:1', texte: `Marie, un mot pour vous dire que votre solde reste impayé. Le règlement se fait en ligne : ${LIEN_FACTURE}` }, [avant], MAINTENANT);
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
});

describe('E — conception « doublons » : le seuil mesuré sur les messages fournis par Lume', () => {
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
      expect(normaliserMessage(x) === normaliserMessage(y) || similarite(x, y) >= SEUIL_QUASI_IDENTIQUE, `${a} ↔ ${b} : ${similarite(x, y).toFixed(2)}`).toBe(true);
    }
  });
});

describe('E — conception « ciblage » : ET / OU, exclusions prioritaires, raison lisible', () => {
  const fiche = (p: Partial<FicheClient> = {}): FicheClient => ({ id: 'c1', status: 'active', company: null, city: 'Montréal', lead_source: null, source: null, etiquettes: [], champs: {}, ...p });
  const ctx = { fuseau: 'America/Toronto' };
  const vipOuCommercial: Ciblage = { inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }, { type: 'etiquette', valeur: 'Commercial' }] }, exclure: [{ type: 'etiquette', valeur: 'Ne pas relancer' }] };

  it('sans ciblage : tous les clients', () => {
    expect(evaluerCiblage(null, fiche(), ctx)).toEqual({ cible: true, raison: null });
    expect(evaluerCiblage({}, fiche(), ctx).cible).toBe(true);
  });

  it('OU : une seule des étiquettes suffit ; la casse ne compte pas', () => {
    expect(evaluerCiblage(vipOuCommercial, fiche({ etiquettes: ['commercial'] }), ctx).cible).toBe(true);
    expect(evaluerCiblage(vipOuCommercial, fiche({ etiquettes: ['Autre'] }), ctx)).toEqual({ cible: false, raison: 'ne remplit aucune des conditions' });
  });

  it('l’exclusion est PRIORITAIRE et la raison nomme ce qui exclut', () => {
    expect(evaluerCiblage(vipOuCommercial, fiche({ etiquettes: ['VIP', 'Ne pas relancer'] }), ctx))
      .toEqual({ cible: false, raison: 'exclu par étiquette « Ne pas relancer »' });
  });

  it('ET sur un champ personnalisé du CLIENT et sur le « type de client » (entreprise / particulier)', () => {
    const c: Ciblage = { inclure: { mode: 'toutes', regles: [{ type: 'fiche', cle: 'genre', op: 'is', value: 'entreprise' }, { type: 'champ', field_id: 'f-ref', op: 'is', value: 'Facebook' }] } };
    const champs = { 'f-ref': { type: 'single_line' as const, valeur: 'facebook ' } };
    expect(evaluerCiblage(c, fiche({ company: 'Tremblay inc.', champs }), ctx).cible).toBe(true);
    expect(evaluerCiblage(c, fiche({ company: null, champs }), ctx).cible).toBe(false);
    expect(evaluerCiblage(c, fiche({ company: 'Tremblay inc.' }), ctx, { 'f-ref': 'Référé par' }))
      .toEqual({ cible: false, raison: 'ne remplit pas : champ « Référé par »' });
  });

  it('case à cocher : « noreview » coché exclut ; jamais rempli = pas coché', () => {
    const c: Ciblage = { exclure: [{ type: 'champ', field_id: 'f-nr', op: 'is', value: true }] };
    expect(evaluerCiblage(c, fiche({ champs: { 'f-nr': { type: 'checkbox', valeur: true } } }), ctx).cible).toBe(false);
    expect(evaluerCiblage(c, fiche({ typesChamps: { 'f-nr': 'checkbox' } }), ctx).cible).toBe(true);
  });

  it('chevauchement de deux ciblages (avertissement de doublon) : disjoints seulement si l’un exige ce que l’autre exclut', () => {
    const vip: Ciblage = { inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: 'VIP' }] } };
    const sansVip: Ciblage = { exclure: [{ type: 'etiquette', valeur: 'vip' }] };
    expect(ciblagesSeChevauchent(vip, sansVip)).toBe(false);
    expect(ciblagesSeChevauchent(vip, null)).toBe(true);
    expect(ciblagesSeChevauchent(vip, vipOuCommercial)).toBe(true);
  });
});
