/**
 * Les normes des courriels (audit du 2026-09-29), vérifiées sur TOUS les
 * courriels rendus par les vraies fonctions d'envoi — ceux des exemples de
 * scripts/qa/courriels-exemples, qui servent aussi à l'aperçu et aux envois de
 * test. Un nouveau courriel s'ajoute à ces exemples, et il hérite du contrôle.
 *
 *  - objet ≤ 60 caractères, sans emoji en tête ni référence interne ;
 *  - un texte d'aperçu (préheader) ;
 *  - jamais « vue(s) » : les pluriels sont accordés ;
 *  - aucun lien vers localhost ou une adresse privée ;
 *  - le titre (H1) ne répète pas l'objet ;
 *  - voix Lume : on tutoie ; voix de l'entreprise : aucune trace de Lume.
 */
import { describe, it, expect, beforeAll } from 'vitest';

process.env.VITE_SUPABASE_URL ||= 'https://exemple.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY ||= 'cle-exemple';
process.env.FRONTEND_URL = 'https://lumecrm.net';

type Exemple = { nom: string; sujet: string; html: string; de?: string; famille: string };
const exemples: Exemple[] = [];
let ecartsObjet: (o: string) => string[];
let liensNonPublics: (...c: string[]) => string[];

beforeAll(async () => {
  ({ ecartsObjet, liensNonPublics } = await import('../../server/lib/courriels/garde-envoi'));
  for (const famille of ['clients', 'abonnement', 'compte', 'support-et-interne']) {
    const mod = await import(`../../scripts/qa/courriels-exemples/${famille}.mts`) as { EXEMPLES: Omit<Exemple, 'famille'>[] };
    for (const e of mod.EXEMPLES) exemples.push({ ...e, famille });
  }
}, 60_000);

/** Le texte que le lecteur voit : sans styles, sans l'aperçu caché, sans balises. */
const visible = (html: string) => html
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<div style="display:none[\s\S]*?<\/div>/, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z#0-9]+;/g, ' ')
  .replace(/\s+/g, ' ');

describe('normes des courriels — sur chaque courriel rendu', () => {
  it('les exemples couvrent les quatre familles', () => {
    expect(new Set(exemples.map((e) => e.famille)).size).toBe(4);
    expect(exemples.length).toBeGreaterThan(30);
  });

  it('objet : ≤ 60 caractères, sans emoji en tête ni référence interne', () => {
    const fautifs = exemples.map((e) => [e.nom, e.sujet, ecartsObjet(e.sujet)] as const).filter(([, , x]) => x.length);
    expect(fautifs).toEqual([]);
  });

  it('un texte d’aperçu sur chaque courriel', () => {
    expect(exemples.filter((e) => !/display:none/.test(e.html)).map((e) => e.nom)).toEqual([]);
  });

  it('pluriels accordés : jamais « mot(s) »', () => {
    expect(exemples.filter((e) => /\p{L}\(s\)/u.test(visible(e.html))).map((e) => e.nom)).toEqual([]);
  });

  it('aucun lien vers localhost ou une adresse privée', () => {
    expect(exemples.filter((e) => liensNonPublics(e.html).length).map((e) => e.nom)).toEqual([]);
  });

  it('le titre ne répète pas l’objet mot pour mot', () => {
    const h1 = (html: string) => (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]?.replace(/<[^>]+>/g, '').trim();
    expect(exemples.filter((e) => h1(e.html) === e.sujet.trim()).map((e) => e.nom)).toEqual([]);
  });

  it('voix Lume : on tutoie le propriétaire', () => {
    // Le support cite le message envoyé au CLIENT de l'entreprise (vouvoyé) : hors règle.
    const voixLume = exemples.filter((e) => (e.famille === 'compte' || e.famille === 'abonnement' || e.de === 'Lume') && !e.nom.startsWith('support-'));
    expect(voixLume.filter((e) => /\b(vous|votre|vos)\b/i.test(visible(e.html))).map((e) => e.nom)).toEqual([]);
  });

  it('voix de l’entreprise : marque blanche, aucune trace de Lume', () => {
    const client = exemples.filter((e) => e.famille === 'clients' && e.nom !== 'paiement-recu-entreprise');
    expect(client.length).toBeGreaterThan(5);
    expect(client.filter((e) => /\bLume\b/.test(visible(e.html))).map((e) => e.nom)).toEqual([]);
  });
});

describe('objets calculés : les noms longs ne font jamais déborder', () => {
  const long = 'Entretien Paysager et Déneigement de la Rive-Sud de Montréal inc.';
  it('invitation et son rappel', async () => {
    const { renderInvitationEmail } = await import('../../server/lib/email-templates/invitation');
    for (const rappel of [false, true]) {
      const { subject } = renderInvitationEmail({ orgName: long, role: 'technician', inviteLink: 'https://lumecrm.net/invite/x', inviterName: 'Marie-Christine Tremblay-Gagnon', rappel });
      expect(ecartsObjet(subject)).toEqual([]);
      if (rappel) expect(subject.startsWith('Rappel : ')).toBe(true);
    }
  });
  it('nouveau lead de démo', async () => {
    const { courrielNouveauLead } = await import('../../server/routes/marketing');
    const { sujet } = courrielNouveauLead({ reference: 'LUM-M2K9F3', full_name: 'X', company_name: long, email: 'x@y.ca', phone: '514', industry: 'window_cleaning', employee_count: null, source: null, availability: null, message: null, referral_code: null } as never, { recuLe: '', ip: null, ua: '' });
    expect(ecartsObjet(sujet)).toEqual([]);
    expect(sujet).not.toContain('LUM-M2K9F3');
  });
});

describe('gabarits Supabase Auth : mêmes normes, variables Supabase intactes', () => {
  it('chaque gabarit : objet conforme, aperçu, tutoiement, titre ≠ objet, variable de lien ou de code présente', async () => {
    const { GABARITS_AUTH } = await import('../../server/lib/courriels/gabarits-auth');
    expect(Object.keys(GABARITS_AUTH).sort()).toEqual(['confirmation', 'email_change', 'invite', 'magic_link', 'reauthentication', 'recovery']);
    for (const [cle, g] of Object.entries(GABARITS_AUTH)) {
      expect(ecartsObjet(g.sujet), cle).toEqual([]);
      expect(g.html, cle).toMatch(/display:none/);
      expect(visible(g.html), cle).not.toMatch(/\b(vous|votre|vos)\b/i);
      expect((g.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]?.trim(), cle).not.toBe(g.sujet);
      expect(g.html, cle).toMatch(cle === 'reauthentication' ? /\{\{ \.Token \}\}/ : /href="\{\{ \.ConfirmationURL \}\}"/);
    }
  });
});
