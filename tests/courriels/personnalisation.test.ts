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

describe('après le retrait de l’import HTML', () => {
  /* L'import HTML a été retiré de la page le 2026-09-24 : presque personne
     n'a de HTML à coller, et l'offrir à côté de « Modifier » mettait une
     porte d'expert au même rang que l'action courante.

     Ce qui RESTE, et qu'on vérifie ici : l'assainissement côté serveur. Des
     modèles marqués `source: 'import'` existent peut-être encore en base, et
     un jour l'import pourrait revenir. Retirer la garde avec le bouton
     laisserait passer du HTML non nettoyé dans un courriel client. */
  it('le serveur assainit toujours le HTML d’un modèle importé', () => {
    const modeles = lire('server/lib/courriels/modeles.ts');
    expect(modeles).toContain('assainirHtmlCourriel');
    expect(modeles).toContain("'import'");
  });

  it('plus rien ne propose d’importer du HTML dans la page', () => {
    const page = lire('src/pages/settings/EmailTemplatesSettings.tsx');
    expect(page).not.toContain('ImportHtmlCourriel');
    expect(page).not.toContain('importerHtml');
    const editeur = lire('src/components/automations/EmailPreviewEditor.tsx');
    expect(editeur).not.toContain('importerHtml');
  });
});
