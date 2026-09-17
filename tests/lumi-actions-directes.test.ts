/**
 * Actions directes (étage 2 bis) : ce que le code prend à 0 ¢ et, surtout,
 * ce qu'il LAISSE au modèle. Détection et rendu purs, sans base.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detecterActionDirecte, rendreActionDirecte } from '../server/lib/lumi/actions-directes';
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';

const d = (m: string) => detecterActionDirecte(m);

describe('détection', () => {
  it('écritures directes : pointage, pause, mémoire, notifications', () => {
    expect(d('Pointe-moi')).toMatchObject({ genre: 'directe', tool: 'punch_in' });
    expect(d('je commence ma journée')).toMatchObject({ tool: 'punch_in' });
    expect(d('Dépointe-moi')).toMatchObject({ tool: 'punch_out' });
    expect(d("j'ai fini ma journée")).toMatchObject({ tool: 'punch_out' });
    expect(d('Je pars en pause')).toMatchObject({ tool: 'start_break' });
    expect(d('je reviens de pause')).toMatchObject({ tool: 'end_break' });
    expect(d('Marque mes notifications comme lues')).toMatchObject({ tool: 'mark_notifications_read' });
    const r = d('Retiens que je ne travaille jamais le dimanche.');
    expect(r).toMatchObject({ genre: 'directe', tool: 'remember_this' });
    expect(r?.args.note).toBe('je ne travaille jamais le dimanche.');
    expect(r?.args.key).toMatch(/^je-ne-travaille-jamais-le/);
  });
  it('fiches par numéro ou nom, listes de réglages', () => {
    expect(d('Montre-moi la facture INV-000004')).toMatchObject({ genre: 'lecture', tool: 'list_invoices', cible: { numero: '4' } });
    expect(d('facture 19')).toMatchObject({ id: 'facture-numero', cible: { numero: '19' } });
    expect(d('le devis 8')).toMatchObject({ id: 'devis-numero', tool: 'list_quotes' });
    expect(d('la fiche de Gagnon')).toMatchObject({ id: 'client-nom', cible: { nom: 'gagnon' } });
    expect(d('C’est quoi mes taxes ?')).toMatchObject({ id: 'taxes', tool: 'get_tax_config' });
    expect(d('mes modèles de soumission')).toMatchObject({ id: 'modeles-devis' });
    expect(d('Montre-moi mes modèles de facture.')).toMatchObject({ id: 'modeles-facture' });
    expect(d('mes préréglages de devis')).toMatchObject({ id: 'prereglages' });
    expect(d('Quelles équipes (crews) j’ai ?')).toMatchObject({ id: 'equipes', tool: 'list_teams' });
    expect(d('quelles invitations sont encore en attente')).toMatchObject({ id: 'invitations' });
    expect(d('mes factures récurrentes')).toMatchObject({ id: 'recurrentes' });
    expect(d('mes automatisations')).toMatchObject({ id: 'automatisations' });
    expect(d('mes rapports automatiques')).toMatchObject({ id: 'rapports-auto' });
    expect(d('c’est quoi mes relances automatiques')).toMatchObject({ id: 'relances-auto', tool: 'get_reminder_settings' });
    expect(d('mes heures cette semaine')).toMatchObject({ id: 'heures', tool: 'get_timesheets' });
  });
  it('cartes : job numéroté, facture, devis, invitation, tâche, automatisation', () => {
    expect(d('Marque le job 33 terminé')).toMatchObject({ genre: 'carte', tool: 'update_job_status', args: { status: 'completed' }, cible: { numero: '33' } });
    expect(d('mets la job 12 en cours')).toMatchObject({ tool: 'update_job_status', args: { status: 'in_progress' } });
    expect(d('Archive le job 34')).toMatchObject({ tool: 'archive_job' });
    expect(d('Supprime le job 34')).toMatchObject({ tool: 'delete_job' });
    expect(d('Assigne le job 33 à Antoine')).toMatchObject({ tool: 'assign_job', cible: { numero: '33', nom: 'antoine' } });
    expect(d('Ajoute une note sur le job 33 : code de porte 1234')).toMatchObject({ tool: 'add_note', args: { entity_type: 'job', note: 'code de porte 1234' } });
    expect(d('Envoie la facture INV-000004')).toMatchObject({ tool: 'send_invoice', cible: { numero: '4' } });
    expect(d('marque la facture 4 payée')).toMatchObject({ tool: 'mark_invoice_paid' });
    expect(d('Annule la facture 15')).toMatchObject({ tool: 'void_invoice' });
    expect(d('Envoie le devis 8 au client')).toMatchObject({ tool: 'send_quote' });
    expect(d('annule la soumission 8')).toMatchObject({ tool: 'cancel_quote' });
    expect(d('Invite marc.tremblay@example.com comme technicien')).toMatchObject({ tool: 'invite_member', args: { email: 'marc.tremblay@example.com', role: 'technician' } });
    expect(d('Renvoie l’invitation à marc@example.com')).toMatchObject({ tool: 'resend_invitation', cible: { courriel: 'marc@example.com' } });
    expect(d('Révoque l’invitation de marc@example.com')).toMatchObject({ tool: 'revoke_invitation' });
    expect(d('Crée une tâche : rappeler le fournisseur demain')).toMatchObject({ tool: 'create_task', args: { title: 'Rappeler le fournisseur' }, cible: { texte: 'demain' } });
    expect(d('Désactive l’automatisation Rappel de rendez-vous')).toMatchObject({ tool: 'toggle_automation_rule', args: { is_active: false }, cible: { nom: 'Rappel de rendez-vous' } });
    expect(d('active l’automatisation Avis Google')).toMatchObject({ args: { is_active: true } });
  });
  it('laisse au modèle tout ce qui compose, arbitre ou mélange', () => {
    for (const m of [
      'Texte à Tremblay qu’on arrive dans 10 minutes',
      'Fais-moi une soumission pour un lavage de vitres à 150 $',
      'Déplace le job 33 au 12 octobre 9 h',      // date non simple → modèle
      'Envoie la facture de Gagnon',            // pas de numéro : deux Gagnon possibles
      'Marque le job terminé',                   // pas de numéro
      'Pourquoi mon mois est plus bas que juillet ?',
      'Crée un job chez Gagnon et texte-lui',
      'Retiens que le job 33 est urgent',       // mémoire sur une entité → modèle
      'Combien de clients j’ai ?',               // raccourci existant, pas ici
      'mes taxes et mes services',               // deux listes
      'Supprime toutes mes tâches',
    ]) expect(d(m), m).toBeNull();
  });
  it('tous les outils cités existent et le genre respecte leur nature', () => {
    const phrases = ['Pointe-moi', 'mes taxes', 'Marque le job 33 terminé', 'Envoie la facture 4', 'Invite a@b.co comme admin', 'Crée une tâche : x', 'mes équipes', 'le devis 8'];
    for (const p of phrases) {
      const a = d(p)!;
      expect(TOOLS_BY_NAME[a.tool], a.tool).toBeDefined();
      if (a.genre === 'lecture') expect(TOOLS_BY_NAME[a.tool].kind).toBe('read');
      else expect(TOOLS_BY_NAME[a.tool].kind).toBe('write');
    }
  });
});

describe('rendu', () => {
  const o = { fr: true, fuseau: 'America/Montreal' };
  it('facture par numéro : une seule correspondance, sinon le modèle', () => {
    const a = d('facture 4')!;
    const res = { invoices: [{ id: 'x', invoice_number: 'INV-000004', client_name: 'Gagnon', statut: 'envoyée', total_cents: 12500, balance_cents: 12500 }, { id: 'y', invoice_number: 'INV-000014', client_name: 'B', statut: 'payée', total_cents: 100 }] };
    expect(rendreActionDirecte(a, res, o)).toContain('Facture INV-000004');
    expect(rendreActionDirecte(a, res, o)).toContain('125,00 $');
    expect(rendreActionDirecte(a, { invoices: [] }, o)).toBeNull();
  });
  it('client par nom : une fiche exactement', () => {
    const a = d('le client Gagnon')!;
    expect(rendreActionDirecte(a, { clients: [{ id: '1', name: 'Jean-Pierre Gagnon', phone: '438-555-0102' }] }, o)).toContain('438-555-0102');
    expect(rendreActionDirecte(a, { clients: [{ id: '1', name: 'A Gagnon' }, { id: '2', name: 'B Gagnon' }] }, o)).toBeNull();
  });
  it('listes : gabarit court, vide lisible, reste compté', () => {
    const a = d('mes équipes')!;
    expect(rendreActionDirecte(a, { teams: [] }, o)).toBe('Aucune équipe pour l’instant.');
    const t = rendreActionDirecte(a, { count: 2, teams: [{ id: '1', name: 'Équipe Nord', is_active: true }, { id: '2', name: 'Exec' }] }, o)!;
    expect(t.startsWith('2 équipes :')).toBe(true);
    expect(t).toContain('• Équipe Nord · active');
    const taxes = rendreActionDirecte(d('mes taxes')!, { taxes: [{ name: 'TPS', rate: 5 }, { name: 'TVQ', rate: 9.975, is_default: true }] }, o)!;
    expect(taxes).toContain('• TVQ · 9.975 % · par défaut');
    const rel = rendreActionDirecte(d('mes relances automatiques')!, { enabled: true, schedule: [{ jours_apres_echeance: 7, canal: 'email' }] }, o)!;
    expect(rel).toContain('7 jour(s) après l’échéance · email');
  });
});

describe('branchement', () => {
  it('la route sert l étage 2 bis avant les caches et le routeur, jamais avec une proposition en attente ni après un repli', () => {
    const r = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8');
    expect(r).toContain("const directe = enAttente.length || repli ? null : detecterActionDirecte(message);");
    expect(r.indexOf('detecterActionDirecte(message)')).toBeLessThan(r.indexOf('const premierMessage = historique.length === 0'));
    expect(r).toContain("emettreSse('proposal', { type: 'proposal', tool_use_id: rep.tool_use_id");
  });
});
