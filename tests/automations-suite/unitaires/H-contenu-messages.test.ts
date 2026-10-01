/**
 * H / A — Contenu des messages : fonctions pures.
 *
 *  · [H-020] `variablesPourMachine` : le webhook garde ses dates en AAAA-MM-JJ ;
 *  · [A-247] `resolveReviewTemplate` : UNE passe (une valeur insérée n'est
 *    jamais relue), `{survey_url}` ne casse plus le bouton du courriel ;
 *  · [H-022] `sansPrenomVide` : la salutation sans prénom, FR et EN.
 *
 * Aucune base, aucun réseau.
 */
import { describe, it, expect } from 'vitest';
import { sansPrenomVide, variablesPourMachine, DATES_TECHNIQUES } from '../../../server/lib/actions/index';
import { resolveReviewTemplate, reviewEmail, reviewSmsBody } from '../../../server/lib/reviews';

describe('H-020 — dates : lisibles pour le client, techniques pour une machine', () => {
  it('[H-020] variablesPourMachine remet AAAA-MM-JJ sous le nom d’origine et retire les clés `_iso`', () => {
    const vars = {
      client_name: 'Marie Tremblay',
      invoice_due_date: '15 octobre 2026', invoice_due_date_iso: '2026-10-15',
      quote_valid_until: '1 novembre 2026', quote_valid_until_iso: '2026-11-01',
      appointment_date: 'October 15, 2026', appointment_date_iso: '2026-10-15',
    };
    expect(variablesPourMachine(vars)).toEqual({
      client_name: 'Marie Tremblay', invoice_due_date: '2026-10-15', quote_valid_until: '2026-11-01', appointment_date: '2026-10-15',
    });
    // L'objet d'origine n'est pas modifié : les messages suivants gardent la date lisible.
    expect(vars.invoice_due_date).toBe('15 octobre 2026');
  });

  it('[H-020] sans forme technique (autre entité), les variables passent telles quelles', () => {
    expect(variablesPourMachine({ client_name: 'Marie', job_name: 'Vitres' })).toEqual({ client_name: 'Marie', job_name: 'Vitres' });
    expect([...DATES_TECHNIQUES]).toEqual(['invoice_due_date', 'quote_valid_until', 'appointment_date']);
  });
});

describe('A-247 — le gabarit de la demande d’avis est résolu en UNE passe', () => {
  it('[A-247] une valeur entre crochets insérée par {var} n’est pas reprise pour une variable', () => {
    expect(resolveReviewTemplate('Terminé : {job_name}.', { job_name: 'Lavage [vitres]' })).toBe('Terminé : Lavage [vitres].');
    expect(resolveReviewTemplate('{client_first_name} — [job_name]', { client_first_name: '[job_name]', job_name: 'Vitres' })).toBe('[job_name] — Vitres');
  });

  it('[A-247] une variable inconnue devient vide ; `[constructor]` ne remonte pas à Object.prototype', () => {
    expect(resolveReviewTemplate('a[inconnue]b{autre}c', {})).toBe('abc');
    expect(resolveReviewTemplate('x[constructor]y{toString}z', {})).toBe('xyz');
  });

  it('[A-247] `{survey_url}` (accolades) dans un corps personnalisé garde le bouton du courriel', () => {
    const vars = { client_first_name: 'Marie', client_name: 'Marie T', company_name: 'Vision', job_name: 'Vitres', survey_url: 'https://lume.test/survey/abc' };
    const mail = reviewEmail({ review_email_body: 'Bonjour {client_first_name},\n\n{survey_url}\n\nMerci !' }, vars);
    expect(mail.html).toContain('href="https://lume.test/survey/abc"');
    expect(mail.html).toContain('Laisser un avis');
    expect(mail.html).not.toContain('[]');
    expect(mail.text).toBe('Bonjour Marie,\n\nhttps://lume.test/survey/abc\n\nMerci !');
  });
});

describe('H-022 — salutation sans prénom', () => {
  it.each([
    ['Bonjour , merci d’avoir choisi X !', 'Bonjour, merci d’avoir choisi X !'],
    ['<p>Bonjour ,</p>', '<p>Bonjour,</p>'],
    ['Hi , thanks for choosing X!', 'Hi, thanks for choosing X!'],
    ['Hello ,', 'Hello,'],
    ['Bonjour Marie, merci', 'Bonjour Marie, merci'],
  ])('[H-022] « %s » → « %s »', (avant, apres) => {
    expect(sansPrenomVide(avant)).toBe(apres);
  });

  it.each([
    ['Bonjour , votre rendez-vous est demain.', 'Bonjour, votre rendez-vous est demain.'],
    // L'espace avant « ! » est celle que l'entrepreneur a tapée : intacte.
    ['Bonjour Marie, c’est noté. Merci !', 'Bonjour Marie, c’est noté. Merci !'],
    // Deux espaces = une variable vide entre les deux : on n'en garde qu'une.
    ['Merci  !', 'Merci !'],
    ['Ici Plomberie Tremblay inc.. Merci !', 'Ici Plomberie Tremblay inc. Merci !'],
    ['Hi , see you soon...', 'Hi, see you soon...'],
  ])('[H-022] texto : « %s » → « %s »', (avant, apres) => {
    expect(sansPrenomVide(avant, { texto: true })).toBe(apres);
  });

  it('[H-022] texto d’avis par défaut sans prénom : « Bonjour, merci… », jamais « Bonjour Bonjour, »', () => {
    const vars = { client_first_name: '', client_name: '', company_name: 'Vision Lavage', job_name: 'Vitres', survey_url: 'https://lume.test/survey/abc' };
    const texto = sansPrenomVide(reviewSmsBody({}, vars, 'fr'));
    expect(texto).toBe("Bonjour, merci d'avoir choisi Vision Lavage ! Un avis Google ou Facebook nous aiderait énormément : https://lume.test/survey/abc");
    const courriel = sansPrenomVide(reviewEmail({}, vars).html);
    expect(courriel).toContain('<p style="margin:0 0 16px;">Bonjour,</p>');
    expect(courriel).not.toMatch(/Bonjour\s+Bonjour/);
  });
});
