/**
 * Le catalogue de la page « Modèles de courriel » (2026-09-18).
 *
 * Ce que ces tests protègent : la page promet à une entreprise qu'elle voit
 * TOUS les courriels qui partent vers ses clients. Un poste oublié, et le
 * courriel reste inmodifiable sans que personne ne s'en aperçoive ; un poste
 * en trop, et on promet de modifier un courriel qui ne part jamais.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CATALOGUE_COURRIELS,
  TYPES_PARCOURS,
  nombreDeCourriels,
} from '../../src/lib/catalogueCourriels';

const entrees = CATALOGUE_COURRIELS.flatMap((g) => g.entrees);

describe('catalogue des courriels', () => {
  it('couvre les 26 courriels d’automatisation réellement définis', () => {
    // Le compte vient de automationPresets.data.ts, relevé un par un.
    const auto = entrees
      .filter((e) => e.origine === 'automatisation')
      .reduce((n, e) => n + (e.variantes ?? 1), 0);
    expect(auto).toBe(26);
  });

  it('chaque poste du parcours porte un type, chaque automatisation n’en porte pas', () => {
    for (const e of entrees) {
      if (e.origine === 'parcours') expect(e.type, e.titre.fr).toBeTruthy();
      else expect(e.type, e.titre.fr).toBeUndefined();
    }
  });

  it('aucun type en double : deux postes sur le même type se marcheraient dessus', () => {
    expect(new Set(TYPES_PARCOURS).size).toBe(TYPES_PARCOURS.length);
  });

  it('tout est traduit dans les deux langues', () => {
    for (const g of CATALOGUE_COURRIELS) {
      expect(g.titre.fr, g.cle).toBeTruthy();
      expect(g.titre.en, g.cle).toBeTruthy();
      for (const e of g.entrees) {
        expect(e.titre.fr).toBeTruthy();
        expect(e.titre.en).toBeTruthy();
        expect(e.quand.fr).toBeTruthy();
        expect(e.quand.en).toBeTruthy();
      }
    }
  });

  it('les types du parcours sont acceptés par la contrainte CHECK de la base', () => {
    // Un type absent de la contrainte fait échouer l'enregistrement AU MOMENT
    // où le propriétaire clique « Enregistrer », pas au déploiement : la
    // migration doit couvrir tout ce que la page peut écrire.
    const migrations = path.join(process.cwd(), 'supabase', 'migrations');
    const sql = fs.readdirSync(migrations)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => fs.readFileSync(path.join(migrations, f), 'utf8'))
      .join('\n');
    for (const type of TYPES_PARCOURS) {
      expect(sql, `type « ${type} » jamais autorisé par une migration`).toContain(`'${type}'`);
    }
  });

  it('le total annoncé reste cohérent', () => {
    expect(nombreDeCourriels()).toBe(entrees.reduce((n, e) => n + (e.variantes ?? 1), 0));
    expect(nombreDeCourriels()).toBeGreaterThanOrEqual(35);
  });
});

describe('textes d’origine montrés dans l’éditeur', () => {
  it('sont ceux que le serveur envoie réellement, au mot près', () => {
    // L'éditeur ouvre sur ce texte quand l'entreprise n'a rien écrit. S'il
    // diverge de server/routes/emails.ts, le propriétaire corrige une phrase
    // que son client ne reçoit pas — et il ne s'en apercevra jamais.
    const emails = fs.readFileSync(path.join(process.cwd(), 'server', 'routes', 'emails.ts'), 'utf8');
    const avecTexte = CATALOGUE_COURRIELS
      .flatMap((g) => g.entrees)
      .filter((e) => e.texteOrigine);

    expect(avecTexte.length).toBeGreaterThan(0);
    for (const e of avecTexte) {
      expect(emails, `fr « ${e.titre.fr} »`).toContain(e.texteOrigine!.fr);
      expect(emails, `en « ${e.titre.fr} »`).toContain(e.texteOrigine!.en);
    }
  });

  it('n’existent que sur des postes du parcours', () => {
    // Une automatisation porte son texte dans sa règle : un texte d'origine ici
    // serait une deuxième source de vérité, donc une divergence garantie.
    for (const e of CATALOGUE_COURRIELS.flatMap((g) => g.entrees)) {
      if (e.texteOrigine) expect(e.origine, e.titre.fr).toBe('parcours');
    }
  });
});
