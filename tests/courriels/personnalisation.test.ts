/**
 * La personnalisation de bout en bout (2026-09-22).
 *
 * Ce que ces tests protègent : une entreprise écrit un texte dans Réglages →
 * Modèles de courriel, et son client le reçoit. Chaque maillon manquant fait
 * échouer la chaîne EN SILENCE — la page enregistre, et le serveur n'en tient
 * pas compte. C'est pire qu'un champ absent : l'entreprise croit avoir agi.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CATALOGUE_COURRIELS } from '../../src/lib/catalogueCourriels';
import { nettoyerPourApercu, elementsRetires } from '../../src/components/settings/ImportHtmlCourriel';

const lire = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const ROUTES = ['emails.ts', 'agreements.ts', 'payment-requests.ts', 'reminders-cron.ts']
  .map((f) => lire(path.join('server', 'routes', f)))
  .join('\n');

const postesParcours = CATALOGUE_COURRIELS
  .flatMap((g) => g.entrees)
  .filter((e) => e.origine === 'parcours');

describe('chaîne de personnalisation', () => {
  it('chaque poste offert est RÉSOLU par une route : sinon l’entreprise écrit dans le vide', () => {
    // Le défaut trouvé le 2026-09-22 : la page offrait dix postes, le serveur
    // n'en lisait que trois. Sept entreprises sur dix auraient écrit un texte
    // que rien n'aurait jamais lu.
    expect(postesParcours.length).toBeGreaterThan(0);
    for (const e of postesParcours) {
      expect(
        ROUTES,
        `« ${e.titre.fr} » (${e.type}) est modifiable dans la page mais aucune route ne le résout`,
      ).toContain(`'${e.type}'`);
    }
  });

  it('un poste résolu remplace la salutation ET l’intro, pas seulement le corps', () => {
    // Sans cela le client lit deux salutations : la nôtre puis celle de
    // l'entreprise, qui porte la sienne dans son texte.
    const occurrences = (ROUTES.match(/modeleOrg \? null :/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(postesParcours.length);
  });

  it('le sujet écrit par l’entreprise est utilisé à l’envoi', () => {
    const occurrences = (ROUTES.match(/modeleOrg\?\.sujet/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(postesParcours.length);
  });

  it('le bouton et le pied restent posés par nous, quoi que l’entreprise écrive', () => {
    // La promesse faite au propriétaire : il ne peut pas produire un courriel
    // où son client est incapable de payer. `bouton:` n'est jamais conditionné
    // à l'absence de modèle.
    expect(ROUTES).not.toMatch(/bouton:\s*modeleOrg\s*\?/);
  });

  it('chaque poste offert a un objet et un texte de départ', () => {
    // Un champ vide ne dit pas à l'entreprise ce qu'elle remplace, et laissé
    // vide il n'enregistre rien : elle croit avoir personnalisé.
    for (const e of postesParcours) {
      expect(e.objetOrigine?.fr, `objet manquant : ${e.titre.fr}`).toBeTruthy();
      expect(e.texteOrigine?.fr, `texte manquant : ${e.titre.fr}`).toBeTruthy();
    }
  });
});

describe('import de HTML', () => {
  it('retire ce qu’un courriel ne peut pas exécuter', () => {
    const sale = `<div>Bonjour<script>vol()</script><style>x{}</style>`
      + `<img src=x onerror="vol()"><a href="javascript:vol()">clic</a></div>`;
    const propre = nettoyerPourApercu(sale);
    expect(propre).not.toContain('<script');
    expect(propre).not.toContain('<style');
    expect(propre).not.toContain('onerror');
    expect(propre).not.toContain('javascript:');
    // Le contenu légitime survit : nettoyer ne veut pas dire vider.
    expect(propre).toContain('Bonjour');
    expect(propre).toContain('clic');
  });

  it('dit ce qui a été retiré, au lieu de le faire en silence', () => {
    expect(elementsRetires('<div><script>x</script></div>')).toContain('script');
    expect(elementsRetires('<a href="javascript:x">y</a>')).toContain('javascript:');
    expect(elementsRetires('<p>Bonjour</p>')).toEqual([]);
  });

  it('l’aperçu est obligatoire avant d’enregistrer', () => {
    // On ne laisse personne mettre en service un courriel qu'il n'a pas vu.
    const src = lire('src/components/settings/ImportHtmlCourriel.tsx');
    expect(src).toContain('disabled={!apercuVu || enregistrement}');
  });

  it('un import est marqué comme tel, sinon le serveur ne l’assainit pas', () => {
    // `source: 'import'` est le drapeau qui déclenche l'assainissement serveur.
    // Sans lui, un HTML collé passe pour du texte d'éditeur et n'est pas nettoyé.
    const page = lire('src/pages/settings/EmailTemplatesSettings.tsx');
    expect(page).toContain("source: 'import'");
    expect(lire('src/lib/emailTemplatesApi.ts')).toContain("source: input.source ?? 'editeur'");
    expect(lire('server/lib/courriels/modeles.ts')).toContain('assainirHtmlCourriel');
  });
});
