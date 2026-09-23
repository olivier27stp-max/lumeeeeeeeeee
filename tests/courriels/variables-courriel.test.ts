/**
 * Les variables offertes à l'entreprise existent-elles vraiment ? (2026-09-22)
 *
 * Le défaut d'origine : l'éditeur proposait `{invoice_total}`, que le serveur
 * ne remplit nulle part. Une entreprise qui l'insérait voyait un TROU dans le
 * courriel reçu par son client — sans erreur, sans avertissement, sans moyen
 * de s'en apercevoir avant qu'un client le signale.
 *
 * Ces tests croisent la liste montrée dans l'app avec les variables réellement
 * passées à `texteDuCourriel` par chaque route.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  VARIABLES_PAR_TYPE,
  variablesPour,
  remplacerParExemples,
} from '../../src/lib/variablesCourriel';

const lire = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
/* Toutes les routes qui appellent `texteDuCourriel`, pas seulement deux.

   La liste s'arrêtait à emails.ts et reminders-cron.ts. Le contrat et la
   demande de dépôt partent d'ailleurs (agreements.ts, payment-requests.ts) :
   leurs variables passaient donc pour « jamais remplies » alors que le
   serveur les fournit. Le test avait raison de crier, mais sur les mauvais
   coupables — et c'est ce qui avait tenu ces deux postes hors de la table. */
const source = [
  'server/routes/emails.ts',
  'server/routes/reminders-cron.ts',
  'server/routes/agreements.ts',
  'server/routes/payment-requests.ts',
].map(lire).join('\n');

describe('variables de courriel', () => {
  it('chaque variable offerte est remplie par le serveur', () => {
    // Le test qui compte : une variable proposée mais jamais fournie produit
    // un trou silencieux chez le client final.
    for (const [type, variables] of Object.entries(VARIABLES_PAR_TYPE)) {
      for (const v of variables) {
        expect(
          source,
          `« ${v.cle} » est offerte pour ${type} mais aucune route ne la passe à texteDuCourriel`,
        ).toContain(`${v.cle}:`);
      }
    }
  });

  it('les trois types branchés côté serveur sont couverts', () => {
    // Un type résolu par le serveur mais absent d'ici priverait l'entreprise
    // de ses variables sur ce courriel-là.
    const branches = [...source.matchAll(/texteDuCourriel\(\s*orgId,\s*'(\w+)'/g)].map((m) => m[1]);
    expect(branches.length).toBeGreaterThan(0);
    for (const type of new Set(branches)) {
      expect(
        Object.keys(VARIABLES_PAR_TYPE),
        `le serveur résout « ${type} » mais aucune variable n'est offerte pour ce type`,
      ).toContain(type);
    }
  });

  it('chaque variable porte un exemple dans les deux langues', () => {
    for (const [type, variables] of Object.entries(VARIABLES_PAR_TYPE)) {
      for (const v of variables) {
        expect(v.exemple.fr, `${type}/${v.cle}`).toBeTruthy();
        expect(v.exemple.en, `${type}/${v.cle}`).toBeTruthy();
        expect(v.fr).toBeTruthy();
        expect(v.en).toBeTruthy();
      }
    }
  });

  it('aucune clé en double dans un même type', () => {
    for (const [type, variables] of Object.entries(VARIABLES_PAR_TYPE)) {
      const cles = variables.map((v) => v.cle);
      expect(new Set(cles).size, `doublon dans ${type}`).toBe(cles.length);
    }
  });

  it('un type inconnu ne propose que ce qui marche partout', () => {
    // Mieux vaut offrir deux variables sûres que six dont quatre feront un trou.
    const communes = variablesPour('type_qui_nexiste_pas');
    expect(communes.map((v) => v.cle)).toEqual(['client_name', 'company_name']);
  });

  it('l’aperçu remplace les variables connues et laisse voir les autres', () => {
    const t = remplacerParExemples(
      'Facture {invoice_number} — {invoice_amount} — {variable_inventee}',
      'invoice_sent',
      true,
    );
    expect(t).toContain('48');
    expect(t).toContain('1 220,17 $');
    // Une variable inconnue reste visible : l'effacer la ferait passer pour bonne.
    expect(t).toContain('{variable_inventee}');
  });
});
