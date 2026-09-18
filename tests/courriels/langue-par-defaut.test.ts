/**
 * Un courriel automatique parle la langue de l'ENTREPRISE (2026-09-17).
 *
 * Le rappel de paiement du cron avait ses textes par défaut en anglais, en dur :
 * une entreprise québécoise qui n'avait pas écrit les siens relançait ses
 * clients en anglais. Le reste du courriel (titre, bouton, montant) suivait
 * pourtant déjà `company_settings.default_language`.
 *
 * Garde statique plutôt qu'un test d'intégration : la faute est un littéral
 * dans le fichier, pas un comportement qui demande une base de données.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'server', 'routes', 'reminders-cron.ts');
const source = fs.readFileSync(SRC, 'utf8');

describe('rappels de paiement — langue', () => {
  it('les textes par défaut existent dans les deux langues', () => {
    expect(source).toMatch(/DEFAUTS\s*=\s*\{/);
    expect(source).toMatch(/\bfr:\s*\{/);
    expect(source).toMatch(/\ben:\s*\{/);
  });

  it('le défaut est choisi par la langue de l’entreprise, pas figé', () => {
    expect(source).toContain('DEFAUTS[langueRappel]');
    expect(source).toContain('langueEntreprise(societe)');
  });

  it('plus aucun texte anglais en dur comme valeur par défaut', () => {
    expect(source).not.toContain('Payment reminder — invoice {invoice_number}');
    expect(source).not.toMatch(/const DEFAULT_EMAIL_SUBJECT\s*=/);
    expect(source).not.toMatch(/const DEFAULT_EMAIL_BODY\s*=/);
    expect(source).not.toMatch(/const DEFAULT_SMS_BODY\s*=/);
  });

  it('le rappel français ne culpabilise pas et ouvre une porte', () => {
    // Décision prise sur les maquettes : un client en retard est presque
    // toujours distrait. On récupère plus d'argent en proposant d'étaler
    // qu'en menaçant.
    expect(source).toContain('ce message se croise avec');
    expect(source).toContain('on peut étaler le paiement');
  });

  it('l’objet ne répète pas le nom de l’entreprise (l’expéditeur l’affiche déjà)', () => {
    const sujets = [...source.matchAll(/sujet:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(sujets.length).toBeGreaterThanOrEqual(2);
    for (const s of sujets) expect(s).not.toContain('{company_name}');
  });

  it('les réglages de l’entreprise ne sont lus qu’une fois par facture', () => {
    // Deux appels dans la même boucle = une requête de plus par rappel envoyé.
    expect((source.match(/await getCompanySettings\(orgId\)/g) || []).length).toBe(1);
  });
});
