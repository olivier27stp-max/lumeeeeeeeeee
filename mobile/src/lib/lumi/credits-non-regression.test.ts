/**
 * Non-régression du passage aux crédits Lumi (2026-09-30).
 *
 * Ce test lit les SOURCES. Il existe parce que les deux fautes qu'on veut
 * empêcher sont invisibles à l'exécution :
 *  - lire un champ retiré du contrat serveur (`budget_cents`, `cost_cents`,
 *    `ai_monthly_budget_cents`) ne lève pas, ça affiche « NaN $ » ou rien ;
 *  - afficher un montant en dollars d'IA ne casse rien — c'est juste interdit.
 *
 * Il doit ÉCHOUER sur le code d'avant la migration. C'est sa seule utilité.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RACINE = join(__dirname, '..', '..'); // src/

/** Les fichiers qui touchent à Lumi : c'est là que les dollars d'IA sont bannis. */
const SURFACE_LUMI = /(?:^|[\\/])(?:lumi[^\\/]*\.tsx?|(?:lumi|api)[\\/]lumi[^\\/]*\.tsx?)$|[\\/](?:lumi)[\\/]/i;

function fichiers(dossier: string, acc: string[] = []): string[] {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) fichiers(chemin, acc);
    else if (/\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom)) acc.push(chemin);
  }
  return acc;
}

/**
 * Le CODE seul : les commentaires de ces fichiers citent volontairement les
 * anciens noms pour expliquer ce qui a changé, et ça ne doit pas faire échouer.
 */
function codeSeul(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');
}

const TOUS = fichiers(RACINE).map((chemin) => ({
  chemin: chemin.slice(RACINE.length + 1),
  code: codeSeul(readFileSync(chemin, 'utf8')),
}));

const lumi = TOUS.filter((f) => SURFACE_LUMI.test(f.chemin));

describe('le banc regarde les bons fichiers', () => {
  it('trouve les sources, dont la surface Lumi', () => {
    expect(TOUS.length).toBeGreaterThan(50);
    expect(lumi.length).toBeGreaterThanOrEqual(5);
    expect(lumi.map((f) => f.chemin)).toContain(join('lib', 'api', 'lumi.ts'));
    expect(lumi.map((f) => f.chemin)).toContain(join('lib', 'lumi', 'credits.ts'));
  });
});

describe('plus aucune lecture de l ancien contrat', () => {
  // Retirés du contrat serveur : les lire ne lève pas, ça affiche « NaN $ ».
  for (const champ of ['budget_cents', 'depense_cents', 'reste_cents', 'ai_monthly_budget_cents']) {
    it(`aucun fichier ne lit « ${champ} »`, () => {
      const fautifs = TOUS.filter((f) => f.code.includes(champ)).map((f) => f.chemin);
      expect(fautifs).toEqual([]);
    });
  }

  it('aucun fichier de Lumi ne lit « cost_cents »', () => {
    // Ailleurs, `unit_cost_cents` (matériaux) et les clés de permission
    // « jobs.cost_cents » sont de l'argent CLIENT, parfaitement légitime.
    const fautifs = lumi.filter((f) => f.code.includes('cost_cents')).map((f) => f.chemin);
    expect(fautifs).toEqual([]);
  });

  it('plus de type « BudgetLumi » nulle part', () => {
    expect(TOUS.filter((f) => f.code.includes('BudgetLumi')).map((f) => f.chemin)).toEqual([]);
  });

  it('le quota se lit sous « credits », et « inclus » remplace « includes_ai »', () => {
    const api = TOUS.find((f) => f.chemin === join('lib', 'api', 'lumi.ts'))!;
    expect(api.code).toContain('credits: EtatCredits');
    expect(api.code).not.toContain('includes_ai');
  });
});

describe('aucun dollar d IA à l écran', () => {
  it('« fmtDollars » n existe plus — il ne formatait que le coût d IA', () => {
    // À distinguer de `fmtMontant`, qui reste : lui formate l'argent du CLIENT
    // (total d'un devis, taxes, lignes) dans les cartes de proposition de Lumi.
    // Ce sont des montants que l'utilisateur doit voir ; le coût de l'IA, non.
    const fautifs = TOUS.filter((f) => f.code.includes('fmtDollars')).map((f) => f.chemin);
    expect(fautifs).toEqual([]);
  });

  it('aucun littéral « $ » collé à Lumi, au budget ou à l IA', () => {
    const suspect = /(?:\$[^'"`\n]{0,40}(?:lumi|budget|\bIA\b|\bAI\b)|(?:lumi|budget|\bIA\b|\bAI\b)[^'"`\n]{0,40}\$)/i;
    const fautifs: string[] = [];
    for (const f of lumi) {
      for (const [i, ligne] of f.code.split('\n').entries()) {
        // Les gabarits JS (`${x}`) ne sont pas des dollars affichés.
        const sansGabarit = ligne.replace(/\$\{/g, '{');
        if (suspect.test(sansGabarit)) fautifs.push(`${f.chemin}:${i + 1} → ${ligne.trim().slice(0, 80)}`);
      }
    }
    expect(fautifs).toEqual([]);
  });

  it('les textes de crédits ne parlent jamais d argent', () => {
    const credits = TOUS.find((f) => f.chemin === join('lib', 'lumi', 'credits.ts'))!;
    // Les gabarits JS (`${x}`) ne sont pas des dollars affichés : on les neutralise.
    const sansGabarit = credits.code.replace(/\$\{/g, '{');
    expect(sansGabarit).not.toMatch(/\$|\bdollars?\b/i);
  });
});

describe('les textes exigés sont bien là', () => {
  it('les gabarits du web sont présents, avec leurs accents', () => {
    const credits = TOUS.find((f) => f.chemin === join('lib', 'lumi', 'credits.ts'))!.code;
    for (const attendu of [
      'crédits Lumi',
      'Lumi credits',
      '{restants} / {total} {unit}',
      'renouvellement le {date}',
      'renews {date}',
      'Il te reste {n} {unit} jusqu’au {date}.',
      'You have {n} {unit} left until {date}.',
      'Les actions rapides et tout le reste de Lume fonctionnent toujours.',
      'Quick actions and everything else in Lume still work.',
      '{Unit} épuisés jusqu’au {date}.',
      '{Unit} used up until {date}.',
      'ne sont pas reportés',
      'do not roll over',
    ]) {
      expect(credits).toContain(attendu);
    }
  });

  it('l écran Lumi branche le compteur, l avis et le blocage de la saisie', () => {
    const ecran = TOUS.find((f) => f.chemin.endsWith(join('(tabs)', 'lumi.tsx')))!.code;
    expect(ecran).toContain('CompteurCreditsLumi');
    expect(ecran).toContain('AvisCreditsLumi');
    expect(ecran).toContain('creditsBloquent');
    expect(ecran).toContain('libelleSaisieBloquee');
    // La saisie et le micro suivent `bloque`, qui inclut maintenant les crédits.
    expect(ecran).toContain('editable={!bloque}');
  });

  it('la date de renouvellement n est jamais convertie de fuseau', () => {
    const credits = TOUS.find((f) => f.chemin === join('lib', 'lumi', 'credits.ts'))!.code;
    // `new Date('2026-11-12')` serait minuit UTC, donc la veille à Montréal.
    expect(credits).not.toMatch(/new Date\(\s*iso/);
    expect(credits).toContain('new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))');
  });
});
