/**
 * Lumi tutoie, même quand il sert un article d'aide écrit au « vous ».
 *
 * Passe de référence du 2026-10-01 : les réponses gratuites (FAQ) arrivaient
 * au « vous » (« Vous pouvez la renvoyer en un clic… ») au milieu d'un
 * assistant qui tutoie partout ailleurs. Le support, lui, vouvoie : il garde
 * les articles tels quels.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARTICLES } from '../src/components/supportArticles';
import { REPONSES_TU } from '../server/lib/support/faq-tutoiement';
import { reponseFaqPour } from '../server/lib/support/faq';
import { reponseAideDirecte } from '../server/lib/support/articles-dabord';
import { reponseAideMulti } from '../server/lib/support/aide-multi';

/** « rendez-vous » n'est pas un vouvoiement. */
const VOUS = /(?<!rendez-)\b(vous|votre|vos|vôtre)\b/i;
/** Impératifs de politesse : « Ouvrez », « cliquez », « choisissez »… (un mot en -ez qui n'est pas « chez », « assez », « nez »). */
const IMPERATIF_VOUS = /\b(?!chez\b|assez\b|nez\b|rez\b|rendez\b)[\p{L}]{3,}ez\b/iu;

describe('la FAQ à la voix de Lumi', () => {
  it('chaque article a sa version tutoyée — un article ajouté sans elle fait échouer ce test', () => {
    const manquants = ARTICLES.filter((a) => !REPONSES_TU[a.id]).map((a) => a.id);
    expect(manquants).toEqual([]);
    const orphelins = Object.keys(REPONSES_TU).filter((id) => !ARTICLES.some((a) => a.id === id));
    expect(orphelins).toEqual([]);
  });

  it('aucune version tutoyée ne vouvoie', () => {
    for (const [id, texte] of Object.entries(REPONSES_TU)) {
      expect(VOUS.test(texte), `${id} : « vous / votre / vos »`).toBe(false);
      expect(IMPERATIF_VOUS.test(texte), `${id} : impératif en -ez (${texte.match(IMPERATIF_VOUS)?.[0]})`).toBe(false);
    }
  });

  it('même contenu que l’article : chemins de l’app, boutons entre guillemets et chiffres sont tous repris', () => {
    for (const a of ARTICLES) {
      const tu = REPONSES_TU[a.id];
      const reperes = [
        // « → Membres », « → Forfait & facturation », « → Modèles et préréglages » : la page visée.
        ...(a.a_fr.match(/→ \p{Lu}[\p{L}&]*(?: [\p{L}&]+)*/gu) ?? []),
        ...(a.a_fr.match(/« [^»]+ »/g) ?? []),
        ...(a.a_fr.match(/\d[\d,]*\s?(?:%|\$)/g) ?? []),
      ];
      for (const r of reperes) {
        // Deux reprises changent de personne, par construction : « à quelqu'un » reste, « à Lumi » devient « moi ».
        if (/Lumi/.test(r)) continue;
        expect(tu.includes(r), `${a.id} : « ${r} » absent de la version tutoyée`).toBe(true);
      }
    }
  });

  it('Lumi (voix « tu ») reçoit la version tutoyée ; le support (défaut) garde le « vous »', () => {
    const q = 'Comment transformer un devis en facture ?';
    const lumi = reponseFaqPour(q, 'fr', 'tu');
    const support = reponseFaqPour(q, 'fr');
    expect(lumi?.id).toBe('quote-to-invoice');
    expect(lumi?.reponse).toMatch(/^Ouvre le devis approuvé/);
    expect(VOUS.test(lumi?.reponse ?? '')).toBe(false);
    expect(support?.reponse).toMatch(/^Ouvrez le devis approuvé/);
    // L'anglais n'a pas de tutoiement : la voix n'y change rien.
    expect(reponseFaqPour(q, 'en', 'tu')?.reponse).toBe(reponseFaqPour(q, 'en')?.reponse);
  });

  it('la relance de l’aide directe suit la voix : « dis-le-moi » pour Lumi, « dites-le-moi » pour le support', () => {
    const q = 'est-ce que le GPS suit mes employés en dehors des heures ?';
    const lumi = reponseAideDirecte(q, 'fr', { premierMessage: true, voix: 'tu' });
    const support = reponseAideDirecte(q, 'fr', { premierMessage: true });
    expect(lumi?.texte).toContain('Si ça ne règle pas ton cas, dis-le-moi');
    expect(support?.texte).toContain('Si ça ne règle pas votre cas, dites-le-moi');
  });

  it('plusieurs questions d’un coup : chaque morceau garde la voix demandée', () => {
    const bloc = 'Comment transformer un devis en facture ?\nComment me faire payer par carte ?';
    const lumi = reponseAideMulti(bloc, 'fr', 'tu');
    expect(lumi).not.toBeNull();
    expect(VOUS.test(lumi!.texte)).toBe(false);
    expect(VOUS.test(reponseAideMulti(bloc, 'fr')!.texte)).toBe(true);
  });

  it('la route de Lumi demande la voix « tu » aux trois étages d’aide', () => {
    const r = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8');
    expect(r).toContain("reponseFaqPour(message, langueTour, 'tu')");
    expect(r).toContain("reponseAideDirecte(message, langueTour, { premierMessage: true, voix: 'tu' })");
    expect(r).toContain("reponseAideMulti(message, langueTour, 'tu')");
  });
});
