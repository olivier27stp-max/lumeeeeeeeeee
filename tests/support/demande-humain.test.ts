/**
 * Une demande d'humain écrite au clavier vaut le bouton.
 *
 * Avant : « je veux parler à une vraie personne » recevait l'article de la FAQ
 * (« Dites-le simplement ici : "je veux parler à quelqu'un" ») — le client
 * venait de le dire. Trouvé en préparant la batterie du support (2026-10-01).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { demandeUnHumain } from '../../server/lib/support/demande-humain';
import { sansBureauxDeTest } from '../../server/lib/support/resume-quotidien';

describe('demandeUnHumain', () => {
  it('une demande explicite, en français ou en anglais, est reconnue', () => {
    for (const q of [
      'Je veux parler à une vraie personne',
      'je veux parler a quelqu’un svp',
      'Passe-moi un humain',
      'Pouvez-vous me transférer à un agent ?',
      'j’ai besoin de parler avec un conseiller',
      'Un humain svp',
      'humain',
      'I want to talk to a human',
      'Can I speak to someone on the support team?',
      'Get me a real person please',
      'agent',
    ]) expect(demandeUnHumain(q), q).toBe(true);
  });

  it('une question sur la marche à suivre garde son article ; le reste va à l’assistant', () => {
    for (const q of [
      'Comment parler à un humain de l’équipe ?',
      'How do I talk to a human on the team?',
      'Comment ajouter un employé à mon équipe ?',
      'Mon agent d’assurance veut une copie de la facture',
      'Je veux contacter mon client par texto',
      'Comment envoyer des SMS à mes clients ?',
      'La personne qui a signé le contrat a changé',
      'Combien coûte le forfait Scale ?',
      '',
    ]) expect(demandeUnHumain(q), q).toBe(false);
  });

  it('la route transmet sans passer par la FAQ ni par le modèle', () => {
    const r = readFileSync(resolve(__dirname, '..', '..', 'server', 'routes', 'support.ts'), 'utf8');
    expect(r).toContain('const veutHumain = !!humain || demandeUnHumain(message);');
    expect(r).toContain('let transferer = veutHumain;');
    expect(r).toMatch(/const fixe = veutHumain\s*\? null/);
    expect(r).toContain('} else if (!veutHumain) {');
  });

  it('la route répond dans la langue du message (FAQ, centre d’aide, cache commun et modèle)', () => {
    const r = readFileSync(resolve(__dirname, '..', '..', 'server', 'routes', 'support.ts'), 'utf8');
    expect(r).toContain('const langue = langueDuMessage(message, ctx.langue);');
    expect(r).toContain('reponseFaqPour(message, langue)');
    expect(r).toContain('reponseAideDirecte(message, langue, { premierMessage })');
    expect(r).toContain("{ langue, companyName: ctx.companyName");
    // Lecture et écriture du cache commun dans la langue du message ; l'oubli (👎) dans celle de la question oubliée.
    expect(r.match(/PORTEE_CACHE_SUPPORT_GLOBALE\(langue\)/g)).toHaveLength(2);
    expect(r).toContain('PORTEE_CACHE_SUPPORT_GLOBALE(langueDuMessage(q.body, ctx.langue))');
    expect(r).not.toContain('PORTEE_CACHE_SUPPORT_GLOBALE(ctx.langue)');
  });
});

describe('résumé quotidien de l’équipe', () => {
  it('les conversations des bureaux de test n’y figurent pas', () => {
    const tickets = [{ id: 'a', org_id: 'vrai-client' }, { id: 'b', org_id: 'bureau-de-test' }, { id: 'c', org_id: null }];
    expect(sansBureauxDeTest(tickets, new Set(['bureau-de-test'])).map((t) => t.id)).toEqual(['a', 'c']);
    expect(sansBureauxDeTest(tickets, new Set())).toHaveLength(3);
  });
  it('l’envoi lit la liste du bac à sable et filtre avant de composer', () => {
    const s = readFileSync(resolve(__dirname, '..', '..', 'server', 'lib', 'support', 'resume-quotidien.ts'), 'utf8');
    expect(s).toContain("admin.from('orgs_envois_simules').select('org_id')");
    expect(s.indexOf('sansBureauxDeTest(tousLesTickets')).toBeGreaterThan(0);
    expect(s.indexOf('sansBureauxDeTest(tousLesTickets')).toBeLessThan(s.indexOf('composerResume(jour, fin, tickets'));
  });
});

describe('prix des forfaits : un article, les montants de la page Tarifs', () => {
  it('« c’est combien, Autopilot ? » reçoit les prix, plus l’article « changer de forfait »', async () => {
    const { reponseFaqPour } = await import('../../server/lib/support/faq');
    for (const q of ['C’est combien le forfait Autopilot ?', 'Combien coûte Lume ?', 'prix du forfait Autopilot', 'How much is the Scale plan?', 'How much is Autopilot per month?']) {
      const r = reponseFaqPour(q, /^how/i.test(q) ? 'en' : 'fr');
      expect(r?.id, q).toBe('pricing');
      for (const prix of ['150', '347', '495']) expect(r?.reponse, q).toContain(prix);
    }
    // Changer de forfait garde son article ; une question sur SES chiffres ne reçoit pas la grille.
    expect(reponseFaqPour('Comment changer ou annuler mon forfait ?', 'fr')?.id).toBe('change-plan');
    expect(reponseFaqPour('How much did I make this month?', 'en')).toBeNull();
    expect(reponseFaqPour('combien j’ai de factures impayées', 'fr')).toBeNull();
  });
  it('Lumi le dit au « tu », le support au « vous »', async () => {
    const { reponseFaqPour } = await import('../../server/lib/support/faq');
    expect(reponseFaqPour('Combien coûte Lume ?', 'fr', 'tu')?.reponse).toContain('Ton forfait actuel');
    expect(reponseFaqPour('Combien coûte Lume ?', 'fr')?.reponse).toContain('Votre forfait actuel');
  });
});

/** Les cellules [Minimum, Scale, Autopilot] d'une ligne du tableau comparatif de la page Tarifs, par le début de son libellé anglais. */
function cellulesDe(page: string, debut: string): string {
  const depart = page.indexOf(`{ label: { en: '${debut}`);
  if (depart < 0) throw new Error(`ligne « ${debut} » introuvable dans Pricing.tsx`);
  const d = page.indexOf('cells: [', depart) + 'cells: ['.length;
  return page.slice(d, page.indexOf('] }', d));
}

describe('contenu des forfaits : un article, les faits de la page Tarifs', () => {
  const page = readFileSync(resolve(__dirname, '..', '..', 'src', 'pages', 'marketing', 'Pricing.tsx'), 'utf8');

  it('« combien de bureaux inclus dans Autopilot ? » ne reçoit plus la grille des prix', async () => {
    // Batterie du support, prod, 2026-10-01 : l'article de prix répondait, sans le nombre de bureaux.
    const { reponseFaqPour } = await import('../../server/lib/support/faq');
    const r = reponseFaqPour('Combien de bureaux sont inclus dans le forfait Autopilot ?', 'fr');
    expect(r?.id).toBe('plan-includes');
    expect(r?.reponse).toContain('2 bureaux');
  });

  it('« inclus dans quel forfait ? » reçoit le contenu des forfaits, en français et en anglais', async () => {
    const { reponseFaqPour } = await import('../../server/lib/support/faq');
    const fr = reponseFaqPour('Le module de porte-à-porte est inclus dans quel forfait ?', 'fr');
    expect(fr?.id).toBe('plan-includes');
    expect(fr?.reponse).toMatch(/Autopilot ajoute[^.]*porte-à-porte/);
    expect(reponseFaqPour('Which plan includes texting?', 'en')?.id).toBe('plan-includes');
    expect(reponseFaqPour('Quel rabais avec le forfait Autopilot payé à l’année ?', 'fr')?.reponse).toContain('30 %');
  });

  it('une question de prix garde l’article de prix', async () => {
    const { reponseFaqPour } = await import('../../server/lib/support/faq');
    for (const q of ["C'est combien par mois, le forfait Minimum ?", 'Le forfait Scale, ça coûte combien par mois ?', 'Quel est le prix mensuel du forfait Autopilot ?']) {
      expect(reponseFaqPour(q, 'fr')?.id, q).toBe('pricing');
    }
  });

  it('chaque fait de l’article est celui de la page Tarifs', async () => {
    const { ARTICLES } = await import('../../src/components/supportArticles');
    const a = ARTICLES.find((x) => x.id === 'plan-includes')!;
    const ligne = (debut: string) => cellulesDe(page, debut);
    // Bureaux inclus : 1 / 1 / 2.
    expect([...ligne('Offices included').matchAll(/en: '(\d+)'/g)].map((m) => Number(m[1]))).toEqual([1, 1, 2]);
    expect(a.a_fr).toMatch(/Minimum :[^.]*avec 1 bureau\./);
    expect(a.a_fr).toMatch(/Scale ajoute[^.]*et 1 bureau\./);
    expect(a.a_fr).toMatch(/Autopilot ajoute[^.]*et 2 bureaux\./);
    // Utilisateurs inclus : Scale et Autopilot (Minimum : écart page / base, pas écrit).
    const sieges = [...page.matchAll(/seats: \{ users: (\d+) \}/g)].map((m) => Number(m[1]));
    expect(a.a_fr).toContain(`avec ${sieges[1]} utilisateurs inclus et 1 bureau`);
    expect(a.a_fr).toContain(`avec ${sieges[2]} utilisateurs inclus et 2 bureaux`);
    expect(a.a_fr).not.toMatch(/Minimum :[^.]*utilisateurs/);
    // Rabais annuel : celui des données de la page.
    const rabais = [...page.matchAll(/annualDiscount: ([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 100));
    expect(a.a_fr).toContain(`${rabais[0]} % avec Minimum, ${rabais[1]} % avec Scale et ${rabais[2]} % avec Autopilot`);
    expect(a.a_en).toContain(`${rabais[0]}% on Minimum, ${rabais[1]}% on Scale and ${rabais[2]}% on Autopilot`);
    // Premier forfait de chaque fonction : [Minimum, Scale, Autopilot].
    const premier = (debut: string) => ligne(debut).split(',').map((c) => c.trim()).findIndex((c) => c !== 'false');
    const phrase = (forfait: string) => { const d = a.a_fr.indexOf(`${forfait} ajoute`); return a.a_fr.slice(d, a.a_fr.indexOf('.', d)); };
    for (const [debut, mot] of [['Two-way SMS with a dedicated number', 'textos'], ['Automations & quote/invoice follow-ups', 'automatisations'], ['QuickBooks export', 'QuickBooks']] as const) {
      expect(premier(debut), debut).toBe(1);
      expect(phrase('Scale'), mot).toContain(mot);
    }
    for (const [debut, mot] of [['Lumi, the AI assistant', 'Lumi'], ['Door-to-door:', 'porte-à-porte'], ['Full API access', 'API']] as const) {
      expect(premier(debut), debut).toBe(2);
      expect(phrase('Autopilot'), mot).toContain(mot);
      expect(phrase('Scale'), mot).not.toContain(mot);
    }
  });

  it('Lumi le dit au « tu »', async () => {
    const { reponseFaqPour } = await import('../../server/lib/support/faq');
    expect(reponseFaqPour('Combien de bureaux sont inclus dans le forfait Autopilot ?', 'fr', 'tu')?.reponse).toContain('Ton forfait actuel');
  });
});
