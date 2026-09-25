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
    // 26 presets relevés un par un dans automationPresets.data.ts, PLUS les
    // cinq postes que le serveur ne résout pas (rendez-vous, reçu, avis…) :
    // leur courriel part bien, mais d'une automatisation, et c'est là que son
    // texte se modifie. Les classer « parcours » ferait écrire dans le vide.
    const auto = entrees
      .filter((e) => e.origine === 'automatisation')
      .reduce((n, e) => n + (e.variantes ?? 1), 0);
    expect(auto).toBe(31);
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
    /* Le serveur coupe ses longues phrases en concaténations :
         'n’est pas encore réglée. Si c’est déjà fait, ' +
         'ce message se croise avec votre paiement.'
       On les recolle et on écrase les espaces avant de comparer, sinon un
       texte parfaitement fidèle échouerait pour une raison de mise en forme
       du code — et on serait tenté de mutiler la phrase montrée à
       l'entreprise pour faire passer le test. */
    const routes = ['emails.ts', 'agreements.ts', 'payment-requests.ts', 'reminders-cron.ts']
      .map((f) => fs.readFileSync(path.join(process.cwd(), 'server', 'routes', f), 'utf8'))
      .join('\n')
      .replace(/'\s*\+\s*\n\s*'/g, '')
      .replace(/\[(\w+)\]/g, '{$1}')
      .replace(/\s+/g, ' ');

    /* La SYNTAXE des variables ne compte pas dans la comparaison.

       `applyTemplate` accepte les deux formes, `{cle}` et `[cle]`. Le cron
       écrit ses gabarits en accolades (sa convention interne), l'éditeur
       insère des crochets quand quelqu'un clique « Insérer ». Exiger la même
       forme des deux côtés obligeait à montrer des accolades au propriétaire
       dans un éditeur qui, lui, produit des crochets — deux conventions sous
       ses yeux, sans qu'il sache laquelle copier.

       On compare donc le TEXTE, en ramenant les deux syntaxes à une seule. */
    const norm = (x: string) => x
      .replace(/\[(\w+)\]/g, '{$1}')
      .replace(/\s+/g, ' ')
      .trim();
    const avecTexte = CATALOGUE_COURRIELS
      .flatMap((g) => g.entrees)
      .filter((e) => e.texteOrigine);

    expect(avecTexte.length).toBeGreaterThan(0);
    for (const e of avecTexte) {
      expect(routes, `fr « ${e.titre.fr} »`).toContain(norm(e.texteOrigine!.fr));
      expect(routes, `en « ${e.titre.fr} »`).toContain(norm(e.texteOrigine!.en));
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
