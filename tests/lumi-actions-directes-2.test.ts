/**
 * Actions directes, deuxième vague : réponses fixes, créations avec champs,
 * messages dictés, listes par client, report par numéro, relances, revenus.
 * Et surtout : ce qui reste au modèle.
 */
import { describe, it, expect } from 'vitest';
import { detecterActionDirecte, dateSimple, rendreActionDirecte } from '../server/lib/lumi/actions-directes';

const d = (m: string) => detecterActionDirecte(m);
const FUSEAU = 'America/Montreal';
const T = new Date('2026-09-17T15:00:00Z'); // jeudi 11 h à Montréal

describe('réponses fixes', () => {
  it('merci, ok, salut, es-tu là → texte fixe, aucun outil', () => {
    for (const m of ['Merci !', 'merci beaucoup', 'ok', 'Parfait', 'C’est bon', 'Salut', 'Allo Lumi', 'es-tu là ?']) expect(d(m), m).toMatchObject({ genre: 'fixe', tool: '' });
    expect(d('merci de m’envoyer le rapport')).toBeNull();
    expect(d('ok envoie-la')).toBeNull();
  });
});

describe('créations avec champs', () => {
  it('client et prospect : prénom + nom, puis téléphone, courriel, adresse, ville après les virgules', () => {
    const c = d('Ajoute un client Linda Tremblay, 514-555-0199, linda@example.com, 12 rue Principale, Laval');
    expect(c).toMatchObject({ genre: 'carte', tool: 'create_client', args: { first_name: 'Linda', last_name: 'Tremblay', phone: '514-555-0199', email: 'linda@example.com', address: '12 rue Principale', city: 'Laval' } });
    expect(d('Nouveau prospect : Julie Fortin, 514-555-0199')).toMatchObject({ tool: 'create_lead', args: { first_name: 'Julie', last_name: 'Fortin', phone: '514-555-0199' } });
    expect(d('Ajoute un client Linda')).toBeNull();                       // pas de nom de famille
    expect(d('Ajoute un client Linda Tremblay, la madame du Tim')).toBeNull(); // un morceau qu’on ne sait pas ranger
  });
  it('job chez un client, date simple, titre optionnel', () => {
    expect(d('Crée une job chez Linda Tremblay demain 9 h')).toMatchObject({ tool: 'create_job', args: { title: 'Job' }, cible: { nom: 'linda tremblay', quand: 'demain', heure: '9' } });
    expect(d('Crée-moi une job pour Linda Tremblay jeudi 13h30 : lavage de vitres')).toMatchObject({ tool: 'create_job', args: { title: 'lavage de vitres' }, cible: { quand: 'jeudi', heure: '13:30' } });
    expect(d('Fais une job chez Gagnon')).toMatchObject({ tool: 'create_job', cible: { nom: 'gagnon', quand: undefined } });
    expect(d('Crée une job chez Linda Tremblay le 12 octobre')).toBeNull(); // date non simple → modèle
  });
  it('note sur un client par nom', () => {
    expect(d('Ajoute une note sur Linda Tremblay : préfère le matin')).toMatchObject({ tool: 'add_note', args: { entity_type: 'client', note: 'préfère le matin' }, cible: { nom: 'Linda Tremblay' } });
    expect(d('Ajoute une note sur le job 33 : code 1234')).toMatchObject({ args: { entity_type: 'job' } });
  });
});

describe('messages dictés', () => {
  it('texto et courriel : le texte après les deux points part tel quel', () => {
    expect(d('Texte à Linda Tremblay : on arrive dans 10 minutes')).toMatchObject({ tool: 'send_sms', args: { message_text: 'on arrive dans 10 minutes' }, cible: { nom: 'Linda Tremblay' } });
    expect(d('Courriel à Gagnon : Rappel de visite | On passe demain à 9 h.')).toMatchObject({ tool: 'send_email', args: { subject: 'Rappel de visite', message: 'On passe demain à 9 h.' } });
    expect(d('Texte à Linda qu’on arrive')).toBeNull(); // à composer → modèle
  });
});

describe('listes par client, report, relances, revenus', () => {
  it('détection', () => {
    expect(d('les factures de Linda Tremblay')).toMatchObject({ id: 'client-factures', tool: 'get_client_profile' });
    expect(d('le solde de Gagnon')).toMatchObject({ id: 'client-solde' });
    expect(d('les jobs de Gagnon')).toMatchObject({ id: 'client-jobs', tool: 'list_jobs', args: { query: 'gagnon' } });
    expect(d('les devis de Gagnon')).toMatchObject({ id: 'client-devis' });
    expect(d('Reporte le job 34 à demain 9 h')).toMatchObject({ tool: 'reschedule_job', cible: { numero: '34', quand: 'demain', heure: '9' } });
    expect(d('planifie le job 34 lundi prochain 13 h')).toMatchObject({ tool: 'reschedule_job', cible: { quand: 'lundi' } });
    expect(d('Relance mes retards')).toMatchObject({ id: 'relance-retards', tool: 'send_payment_reminders' });
    expect(d('relance-les')).toMatchObject({ id: 'relance-retards' });
    expect(d('combien j’ai encaissé cette année')).toMatchObject({ id: 'revenu-annee', args: { period: 'this_year' } });
    expect(d('mes revenus des 30 derniers jours')).toMatchObject({ id: 'revenu-30-jours' });
    expect(d('les factures en retard')).toBeNull(); // raccourci existant, pas une liste par client
  });
  it('dates simples dans le fuseau de l org', () => {
    expect(dateSimple('demain', '9', FUSEAU, T)).toBe('2026-09-18T13:00:00.000Z');       // 9 h Montréal = 13 h UTC
    expect(dateSimple('jeudi', '13:30', FUSEAU, T)).toBe('2026-09-24T17:30:00.000Z');    // un jeudi → jeudi prochain
    expect(dateSimple('lundi prochain', undefined, FUSEAU, T)).toBe('2026-09-21T13:00:00.000Z');
    expect(dateSimple('demain', 'midi', FUSEAU, T)).toBe('2026-09-18T16:00:00.000Z');
    expect(dateSimple('la semaine prochaine', undefined, FUSEAU, T)).toBeNull();
  });
  it('rendu des listes par client', () => {
    const o = { fr: true, fuseau: FUSEAU };
    const profil = { client: { name: 'Jean-Pierre Gagnon' }, billing: { invoices_total: 3, unpaid_count: 2, unpaid_cents: 197182, overdue_cents: 197182 }, quotes: { total: 1, recent: [{ title: 'Vitres', statut: 'envoyé', total_cents: 15000 }] } };
    expect(rendreActionDirecte(d('le solde de Gagnon')!, profil, o)).toContain('1 971,82 $');
    expect(rendreActionDirecte(d('les devis de Gagnon')!, profil, o)).toContain('• Vitres · envoyé · 150,00 $');
    expect(rendreActionDirecte(d('les jobs de Gagnon')!, { total_matching: 1, jobs: [{ job_number: 33, title: 'Lavage', client: 'Jean-Pierre Gagnon', display_status: 'à venir', total_cents: 49439 }] }, o)).toContain('#33 · Lavage');
  });
});
