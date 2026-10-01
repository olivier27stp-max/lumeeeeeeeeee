/**
 * Glossaire de Lumi — l'AGENT DE SUPPORT (phase 5 de « Lumi 100 % fiable »).
 *
 * Ce que la phase exige de lui : répondre à partir de la base de connaissances,
 * citer la bonne page de l'app, ne promettre aucune fonctionnalité qui n'existe
 * pas, donner les bons tarifs, passer à un humain quand il ne sait pas, et ne
 * faire aucune action réservée à Lumi. Le support VOUVOIE (Lumi, lui, tutoie).
 *
 * Tout ce qui se vérifie SANS appeler le modèle est figé ici ; les écarts
 * connus sont en `it.fails` avec leur fichier:ligne (LUMI_GLOSSARY.md,
 * « Écarts constatés »). Ce que le modèle écrit réellement ne se prouve pas
 * par un test statique : voir « Ce qui n'a pas pu être vérifié » du glossaire.
 *
 * Tests statiques : aucune base, aucun modèle, aucun réseau.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fr from '../src/i18n/fr';
import { ARTICLES } from '../src/components/supportArticles';
import { SYSTEM_PROMPT as PROMPT_VENTE } from '../server/lib/agent/promptVente';
import { REPONSES_FIXES } from '../server/lib/agent/reponsesFixes';
import { CARTE_APP } from '../server/lib/support/carte-app';
import { promptsPourMesure } from '../server/lib/support/ia';
import { AGENT_TOOLS } from '../server/lib/agent/tools';

const racine = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(racine, p), 'utf8');

const TU = /(?<![a-zà-ÿ])(tu|toi|ton|ta|tes)(?![a-zà-ÿ])/i;

/* ── La grille tarifaire qui fait foi dans le dépôt : la page Tarifs ──────────
 * (verrouillée contre la table `plans` par tests/tarifs-coherence.test.ts).
 * Lue ici, pas recopiée : un changement de prix n'a pas à toucher ce test. */
const pageTarifs = lire('src/pages/marketing/Pricing.tsx');
const NOMS_FORFAITS = ['Minimum', 'Scale', 'Autopilot'] as const;
const GRILLE = Object.fromEntries(NOMS_FORFAITS.map((nom) => {
  const bloc = pageTarifs.slice(pageTarifs.indexOf(`name: '${nom}'`), pageTarifs.indexOf(`name: '${nom}'`) + 900);
  const m = /CAD: \{ monthly: (\d+), extraUser: (\d+) \}/.exec(bloc);
  if (!m) throw new Error(`Prix CAD introuvable pour ${nom} dans Pricing.tsx`);
  return [nom, { mensuel: Number(m[1]), utilisateurSuppl: Number(m[2]) }];
})) as Record<(typeof NOMS_FORFAITS)[number], { mensuel: number; utilisateurSuppl: number }>;

/** Tous les montants « N $/mois » (ou « $N/month », « $N/mo ») écrits dans un texte. */
const montantsParMois = (texte: string): number[] => [
  ...[...texte.matchAll(/(\d[\d  ]*)\s?\$\s?\/\s?mois/g)].map((m) => Number(m[1].replace(/[^\d]/g, ''))),
  ...[...texte.matchAll(/\$\s?(\d[\d,]*)\s?\/\s?(?:month|mo)\b/g)].map((m) => Number(m[1].replace(/[^\d]/g, ''))),
];

const promptSupportFr = promptsPourMesure('fr', 'app', null).stable;
const promptSupportEn = promptsPourMesure('en', 'app', null).stable;
const faqFr = ARTICLES.map((a) => `${a.q_fr} ${a.a_fr}`).join('\n');

describe('support — les tarifs écrits sont ceux de la grille', () => {
  it('la grille lue sur la page Tarifs est complète', () => {
    expect(Object.keys(GRILLE)).toEqual(['Minimum', 'Scale', 'Autopilot']);
    for (const p of Object.values(GRILLE)) { expect(p.mensuel).toBeGreaterThan(0); expect(p.utilisateurSuppl).toBeGreaterThan(0); }
  });

  it.each([
    ['le prompt de l’agent du site (promptVente.ts)', PROMPT_VENTE],
    ['la réponse fixe « Combien ça coûte ? » (reponsesFixes.ts)', REPONSES_FIXES.find((r) => r.id === 'prix')!.reponse],
  ])('%s donne le prix mensuel de chaque forfait, et aucun autre', (_nom, texte) => {
    for (const nom of NOMS_FORFAITS) {
      const m = new RegExp(`« ${nom} »[^«]*?(\\d+) \\$/mois`).exec(texte);
      expect(m, `prix de ${nom} introuvable`).not.toBeNull();
      expect(Number(m![1]), nom).toBe(GRILLE[nom].mensuel);
    }
    const permis = NOMS_FORFAITS.map((n) => GRILLE[n].mensuel);
    expect(montantsParMois(texte).filter((x) => !permis.includes(x))).toEqual([]);
  });

  it('le prompt de l’agent du site donne le bon prix par utilisateur supplémentaire', () => {
    for (const nom of NOMS_FORFAITS) {
      const m = new RegExp(`« ${nom} »[^«]*?\\+(\\d+) \\$/utilisateur`).exec(PROMPT_VENTE);
      expect(Number(m?.[1]), nom).toBe(GRILLE[nom].utilisateurSuppl);
    }
  });

  it.each([
    ['la FAQ (supportArticles.ts)', ARTICLES.map((a) => `${a.a_fr} ${a.a_en}`).join('\n')],
    ['la carte de l’app (carte-app.ts)', CARTE_APP],
    ['le prompt du support dans l’app (ia.ts)', `${promptSupportFr}\n${promptSupportEn}`],
    ['la doc d’aide (fonctionsData.ts)', lire('src/pages/marketing/fonctionsData.ts')],
  ])('%s n’écrit aucun prix hors grille', (_nom, texte) => {
    const permis = NOMS_FORFAITS.map((n) => GRILLE[n].mensuel);
    expect(montantsParMois(texte).filter((x) => !permis.includes(x))).toEqual([]);
  });

  it('les trois forfaits portent leur nom partout où ils sont vendus, jamais un ancien nom', () => {
    for (const nom of NOMS_FORFAITS) {
      expect(PROMPT_VENTE).toContain(`« ${nom} »`);
      expect(REPONSES_FIXES.find((r) => r.id === 'prix')!.reponse).toContain(`« ${nom} »`);
    }
    // Anciens noms de forfaits : ni la FAQ, ni la carte, ni les prompts ne les citent.
    const sources = [faqFr, CARTE_APP, PROMPT_VENTE, promptSupportFr];
    for (const s of sources) expect(s).not.toMatch(/forfait (Débutant|Starter|Pro|Entreprise|Solo|Gratuit)\b/);
  });

  /**
   * ÉCART (e) — le nombre de bureaux inclus. Le code qui applique le quota
   * (server/lib/platformFeatures.ts:108-112) et la page Tarifs
   * (src/pages/marketing/Pricing.tsx:213) disent 1 / 1 / 2. L'agent du site dit
   * 1 / 2 / 5 : server/lib/agent/promptVente.ts:30-32 et
   * server/lib/agent/reponsesFixes.ts:28.
   */
  // CORRIGÉ le 2026-10-01 (prompt et réponse fixe alignés sur le code et la page Tarifs) : cliquet.
  it('l’agent du site annonce le nombre de bureaux que le code accorde', () => {
    const quotas = /BUREAUX_PAR_FORFAIT[^{]*\{\s*starter: (\d+),\s*pro: (\d+),\s*autopilot: (\d+)/.exec(lire('server/lib/platformFeatures.ts'))!;
    const attendu = { Minimum: Number(quotas[1]), Scale: Number(quotas[2]), Autopilot: Number(quotas[3]) };
    for (const texte of [PROMPT_VENTE, REPONSES_FIXES.find((r) => r.id === 'prix')!.reponse]) {
      for (const nom of NOMS_FORFAITS) {
        const m = new RegExp(`« ${nom} »[^«]*?(\\d+) bureaux?`).exec(texte);
        expect(Number(m?.[1]), nom).toBe(attendu[nom]);
      }
    }
  });

  /**
   * ÉCART (f) — où commencent le porte-à-porte et l'API. La page Tarifs les
   * réserve à Autopilot (src/pages/marketing/Pricing.tsx:204 et :206, cellules
   * [non, non, oui]). L'agent du site les promet dès Scale :
   * server/lib/agent/promptVente.ts:31 et :33, server/lib/agent/reponsesFixes.ts:28.
   * Laquelle des deux dit vrai dépend de la table `plans` en production, que
   * ce test ne peut pas lire.
   */
  // CORRIGÉ le 2026-10-01 ; la table plans de la prod (includes_d2d : Autopilot seulement) confirme la page Tarifs.
  it('l’agent du site place le porte-à-porte dans le même forfait que la page Tarifs', () => {
    const ligne = /label: \{[^}]*fr: 'Porte-à-porte[^']*' \}, cells: \[(\w+), (\w+), (\w+)\]/.exec(pageTarifs)!;
    const dansScaleSelonLaPage = ligne[2] === 'true';
    const ligneScale = PROMPT_VENTE.split('\n').find((l) => l.includes('« Scale »')) ?? '';
    expect(/porte-à-porte/i.test(ligneScale)).toBe(dansScaleSelonLaPage);
  });
});

describe('support — vouvoiement, escalade, aucune action réservée à Lumi', () => {
  it('le prompt du support demande le vouvoiement en français, et rien de tel en anglais', () => {
    expect(promptSupportFr).toMatch(/French \(Québec, vouvoiement/);
    expect(promptSupportEn).not.toMatch(/vouvoiement|tutoiement/);
  });

  it('les réponses écrites de la FAQ vouvoient toutes', () => {
    const tutoyees = ARTICLES.filter((a) => TU.test(a.a_fr)).map((a) => a.id);
    expect(tutoyees).toEqual([]);
    // Les autres sont à l'impératif (« Ouvrez… », « Allez dans… ») sans pronom.
    expect(ARTICLES.filter((a) => /(?<![a-zà-ÿ-])(vous|votre|vos)(?![a-zà-ÿ])/i.test(a.a_fr)).length).toBeGreaterThanOrEqual(15);
  });

  it('le prompt interdit d’inventer une fonction, un prix, un bouton, et dit quand passer à un humain', () => {
    expect(promptSupportFr).toContain('Never invent a feature, a price, a button or a setting');
    expect(promptSupportFr).toContain('Call transfer_to_human');
    expect(promptSupportFr).toContain('the user asks for a human');
    expect(promptSupportFr).toContain('Never promise anything else on behalf of the team');
    expect(promptSupportFr).toContain('call it BEFORE answering any "how do I…"');
  });

  it('le support n’a que ses quatre outils — aucun outil d’action de Lumi', () => {
    const source = lire('server/lib/support/ia.ts');
    const bloc = source.slice(source.indexOf('function outilsPour'), source.indexOf('export interface MessageSupport'));
    const outils = [...bloc.matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(outils).toEqual(['get_migration_status', 'search_help', 'start_migration', 'transfer_to_human']);
    const ecrituresLumi = new Set(AGENT_TOOLS.filter((t) => t.kind === 'write').map((t) => t.declaration.name));
    expect(ecrituresLumi.size).toBeGreaterThan(50);
    expect(outils.filter((o) => ecrituresLumi.has(o))).toEqual([]);
  });

  it('la FAQ dit comment joindre un humain', () => {
    const article = ARTICLES.find((a) => a.id === 'talk-to-human')!;
    expect(article.a_fr).toMatch(/je transmets la conversation à l'équipe/);
  });

  /**
   * ÉCART (d) — la réponse d'aide servie SANS modèle se termine par « Si ça ne
   * règle pas ton cas, dis-le-moi et je creuse. » (server/lib/support/articles-dabord.ts:136).
   * La même phrase part dans le chat de SUPPORT (server/routes/support.ts:144),
   * qui vouvoie, juste après un extrait de FAQ au vouvoiement.
   * À l'inverse, Lumi (qui tutoie) sert les réponses de la FAQ écrites au « vous »
   * (server/routes/lumi.ts:614).
   */
  // CORRIGÉ dans le même lot (voix de l'aide) : la relance suit la voix de celui qui
  // parle — « dites-le-moi » par défaut (support), « dis-le-moi » seulement quand Lumi
  // le demande. Le sens inverse (Lumi qui vouvoie) est tenu par lumi-aide-tutoiement.test.ts.
  it('la réponse d’aide sans modèle vouvoie dans le chat de support, et ne tutoie que pour Lumi', async () => {
    const { reponseAideDirecte } = await import('../server/lib/support/articles-dabord');
    const q = 'est-ce que le GPS suit mes employés en dehors des heures ?';
    const support = reponseAideDirecte(q, 'fr', { premierMessage: true })?.texte ?? '';
    const lumi = reponseAideDirecte(q, 'fr', { premierMessage: true, voix: 'tu' })?.texte ?? '';
    expect(support).toContain('Si ça ne règle pas votre cas, dites-le-moi');
    expect(/dis-le-moi/.test(support)).toBe(false);
    expect(lumi).toContain('Si ça ne règle pas ton cas, dis-le-moi');
    // La route du support n'a pas à demander de voix : le défaut est le « vous ».
    expect(lire('server/routes/support.ts')).not.toMatch(/voix: 'tu'/);
  });

  /**
   * ÉCART (d) — le courriel « Réponse du support » tutoie
   * (server/lib/support/tickets.ts:427 « te répond », :430 « Tu peux aussi répondre… »)
   * alors que le chat de support vouvoie.
   */
  it.fails('ÉCART : le courriel de réponse du support ne tutoie pas (tickets.ts:427, :430)', () => {
    const source = lire('server/lib/support/tickets.ts');
    expect(source).not.toMatch(/'Tu peux aussi répondre directement à ce courriel\.'/);
  });
});

describe('support — la FAQ cite de vraies pages', () => {
  const routes = [lire('src/App.tsx'), lire('src/pages/settings/SettingsLayout.tsx'), lire('src/routes/PublicRoutes.tsx')].join('\n');
  const menuParametres = (() => {
    const source = lire('src/pages/settings/SettingsLayout.tsx');
    const s = fr.settings as Record<string, unknown>;
    return new Set<string>([
      ...[...source.matchAll(/isFr \? '([^']+)'/g)].map((m) => m[1]),
      ...[...source.matchAll(/label: '([^']+)'/g)].map((m) => m[1]),
      ...['companySettings', 'productsServices', 'requestForm', 'automations', 'payroll', 'archives', 'team'].map((k) => String(s[k])),
    ]);
  })();

  it('chaque article qui renvoie à une page renvoie à une route qui existe', () => {
    const inconnues = ARTICLES.filter((a) => a.path && !new RegExp(`["'\`]${a.path}["'\`]`).test(routes)).map((a) => `${a.id} → ${a.path}`);
    expect(inconnues).toEqual([]);
  });

  it('chaque « Paramètres → … » de la FAQ nomme une vraie entrée du menu Paramètres', () => {
    const cites = ARTICLES.flatMap((a) => [...a.a_fr.matchAll(/Paramètres → ([A-ZÉ][^,.:;()«»]*?)(?=\s*(?:[,.:;(]|puis|section|$))/g)].map((m) => ({ id: a.id, entree: m[1].trim() })));
    expect(cites.length).toBeGreaterThan(8);
    expect(cites.filter((c) => !menuParametres.has(c.entree)).map((c) => `${c.id} : « ${c.entree} »`)).toEqual([]);
  });

  it('les boutons que la FAQ cite entre guillemets existent à l’écran', () => {
    const boutons: Array<[string, string]> = [
      ['Convertir en facture', 'src/pages/QuoteDetails.tsx'],
      ['Ajouter une région', 'src/pages/TaxSettings.tsx'],
      ['Définir par défaut', 'src/pages/TaxSettings.tsx'],
      ['Afficher la rentabilité', 'src/pages/JobDetails.tsx'],
      ['Modifier la visite', 'src/pages/JobDetails.tsx'],
      ['Marquer payée', 'src/pages/Invoices.tsx'],
    ];
    for (const [libelle, fichier] of boutons) {
      expect(faqFr, libelle).toContain(libelle);
      expect(lire(fichier), `${libelle} dans ${fichier}`).toContain(libelle);
    }
  });

  /**
   * ÉCART (b)/(f) — la FAQ envoie dans « Soumissions → Modèles et préréglages »
   * (src/components/supportArticles.ts:45 et :54). Le menu dit « Devis »
   * (src/App.tsx:1110) et le bouton de cette page dit « Modèles »
   * (src/pages/Quotes.tsx:360) : ni la page ni l'onglet ne portent ce nom.
   */
  it.fails('ÉCART : la FAQ nomme la page des devis comme le menu (supportArticles.ts:45, :54)', () => {
    expect(faqFr).not.toMatch(/Soumissions → /);
  });

  /**
   * ÉCART (f) — « La vue Répartition permet de déplacer les visites par
   * glisser-déposer » (src/components/supportArticles.ts:99). Le Calendrier a
   * les vues Jour, Semaine, Mois et Agenda (server/lib/support/carte-app.ts:51) :
   * aucune ne s'appelle « Répartition ».
   */
  it.fails('ÉCART : la FAQ ne cite pas une vue « Répartition » que le Calendrier n’a pas (supportArticles.ts:99)', () => {
    expect(faqFr).not.toMatch(/vue Répartition/);
  });

  /**
   * ÉCART (b) — dans la FAQ, « devis » (:61, :63, :126, :211, :265) et
   * « soumission » (:34, :36, :45, :54, :184, :274) désignent le même document ;
   * « travail » (:97, :99, :106, :108) et « job » (:193, :200, :202, :227, :229,
   * :283, :290, :292) aussi ; « SMS » (:115, :117) et « texto » (:283).
   */
  it.fails('ÉCART : la FAQ n’emploie qu’un mot pour le devis (supportArticles.ts:34 contre :61)', () => {
    const nb = (re: RegExp) => (faqFr.match(re) ?? []).length;
    expect(Math.min(nb(/(?<![a-zà-ÿ])devis(?![a-zà-ÿ])/gi), nb(/(?<![a-zà-ÿ])soumissions?(?![a-zà-ÿ])/gi))).toBe(0);
  });
});
