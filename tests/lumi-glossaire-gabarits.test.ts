/**
 * Glossaire de Lumi — les GABARITS SANS MODÈLE (phase 5 de « Lumi 100 % fiable »).
 *
 * Quand Lumi répond sans le modèle (raccourcis, actions directes, reçus,
 * aperçus de carte), personne ne « traduit » : ce que le code écrit est ce que
 * l'utilisateur lit. Ces tests figent ce qui est juste aujourd'hui et gardent,
 * en `it.fails`, la liste des écarts connus (LUMI_GLOSSARY.md, section
 * « Écarts constatés ») : la correction d'un écart fait passer son test au
 * vert — il suffit alors de retirer le `.fails`.
 *
 * Tests statiques : aucune base, aucun modèle, aucun réseau.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { detecterActionDirecte, rendreActionDirecte } from '../server/lib/lumi/actions-directes';
import { rendreRaccourci } from '../server/lib/lumi/raccourcis';
import { texteRecus } from '../server/lib/lumi/recus';

const racine = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(racine, p), 'utf8');

/** Les fichiers dont le texte part tel quel à l'utilisateur, sans modèle. */
const GABARITS = [
  'server/lib/lumi/raccourcis.ts',
  'server/lib/lumi/actions-directes.ts',
  'server/lib/lumi/recus.ts',
  'server/lib/lumi/fiches.ts',
  'server/lib/lumi/briefing.ts',
  'server/lib/lumi/avis-credits.ts',
  'server/lib/lumi/hors-scope.ts',
  'server/lib/lumi/escalade.ts',
  'server/lib/lumi/optimiserJournee.ts',
  'server/lib/lumi/apercu-action.ts',
];

interface Chaine { fichier: string; ligne: number; texte: string }

/**
 * Les chaînes d'un fichier (littéraux et gabarits, trous remplacés par « ⟦⟧ »),
 * SANS les commentaires, les imports ni les motifs de détection (`new RegExp(…)`).
 */
function chainesDe(fichier: string): Chaine[] {
  const sf = ts.createSourceFile(fichier, lire(fichier), ts.ScriptTarget.Latest, true);
  const out: Chaine[] = [];
  const ligne = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const motif = (n: ts.Node) => !!n.parent && ts.isNewExpression(n.parent) && n.parent.expression.getText(sf) === 'RegExp';
  const voir = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !motif(n)) out.push({ fichier, ligne: ligne(n), texte: n.text });
    else if (ts.isTemplateExpression(n) && !motif(n)) {
      out.push({ fichier, ligne: ligne(n), texte: n.head.text + n.templateSpans.map((s) => `⟦⟧${s.literal.text}`).join('') });
    }
    ts.forEachChild(n, voir);
  };
  voir(sf);
  return out;
}

/** Une PHRASE française : des mots français ET de la ponctuation ou un accent (écarte les listes de mots-clés). */
function phraseFrancaise(s: string): boolean {
  if (!/[àâçéèêëîïôùûœ«»’.!?:]/i.test(s)) return false;
  const fr = (s.match(/(?<![a-zà-ÿ])(le|la|les|des|une|est|pour|avec|dans|ton|ta|tes|tu|sur|pas|aucun|aucune|du|au|ce|cette|qui|que|et|ou|en|déjà|tout)(?![a-zà-ÿ])/gi) ?? []).length;
  const en = (s.match(/\b(the|your|you|is|are|with|for|and|not|this|that|will|has|have|was|from|of|to)\b/gi) ?? []).length;
  return fr > 0 && fr >= en;
}

const phrases = GABARITS.flatMap(chainesDe).filter((c) => phraseFrancaise(c.texte));
const ou = (c: Chaine) => `${c.fichier}:${c.ligne} « ${c.texte.slice(0, 70)} »`;

/** Valeurs rangées en base (contraintes CHECK de supabase/SCHEMA_SNAPSHOT.md) : jamais dans une phrase. */
const STATUT_BRUT = /(?<![a-zà-ÿ_.{[/-])(scheduled|in_progress|in progress|overdue|past_due|sent_not_due|sent|draft|completed|cancelled|canceled|awaiting_response|changes_requested|approved|declined|expired|converted|succeeded|refunded|closed_won|closed_lost|new_prospect|no_response|quote_sent|requires_invoicing|action_required|unscheduled|pending|paid|unpaid|void|sales_rep|technician|owner|both)(?![a-zà-ÿ_}\]=/:-])/i;
const TU = /(?<![a-zà-ÿ])(tu|toi|ton|ta|tes)(?![a-zà-ÿ])/i;
const VOUS = /(?<![a-zà-ÿ-])(vous|votre|vos|veuillez)(?![a-zà-ÿ])/i;

describe('gabarits de Lumi — aucun statut brut écrit dans une phrase française', () => {
  it('il y a bien des phrases à vérifier (le relevé n’est pas vide)', () => {
    expect(phrases.length).toBeGreaterThan(80);
  });

  it('aucune phrase française ne contient une valeur de base (scheduled, sent, draft, both…)', () => {
    const fautives = phrases.filter((c) => STATUT_BRUT.test(c.texte)).map(ou);
    expect(fautives).toEqual([]);
  });

  it('relances automatiques : le canal se dit « courriel », « texto », « courriel et texto »', () => {
    const action = detecterActionDirecte('mes relances automatiques')!;
    expect(action).toMatchObject({ id: 'relances-auto', tool: 'get_reminder_settings' });
    // La forme exacte que renvoie get_reminder_settings (tools-argent.ts) : `canal` = valeur de base.
    const resultat = { enabled: true, schedule: [{ jours_apres_echeance: 1, canal: 'email' }, { jours_apres_echeance: 7, canal: 'sms' }, { jours_apres_echeance: 14, canal: 'both' }] };
    const fr = rendreActionDirecte(action, resultat, { fr: true, fuseau: 'America/Toronto' })!;
    expect(fr).toContain('1 jour(s) après l’échéance · courriel');
    expect(fr).toContain('7 jour(s) après l’échéance · texto');
    expect(fr).toContain('14 jour(s) après l’échéance · courriel et texto');
    expect(fr).not.toMatch(/\b(email|sms|both)\b/i);
    const en = rendreActionDirecte(action, resultat, { fr: false, fuseau: 'America/Toronto' })!;
    expect(en).toContain('7 day(s) after due · text');
    expect(en).toContain('14 day(s) after due · email and text');
    expect(en).not.toMatch(/\b(sms|both|courriel|texto)\b/i);
  });

  it('une fiche de job reprend le statut AFFICHÉ fourni par l’outil, pas la valeur de base', () => {
    // list_jobs fournit `statut` déjà traduit (ETIQUETTES_DERIVED) : le gabarit le reprend tel quel.
    const texte = rendreRaccourci(
      { id: 'job-numero', tool: 'list_jobs', args: {}, numero: '33' },
      { jobs: [{ job_number: 33, title: 'Lavage', client: 'Luc Lavoie', statut: 'en retard', status: 'scheduled' }] },
      { fr: true, fuseau: 'America/Toronto', prenom: null, maintenant: new Date('2026-10-01T15:00:00Z') },
    );
    expect(texte).toContain('Statut : en retard');
    expect(texte).not.toContain('scheduled');
  });

  it('un reçu nomme l’action en mots d’écran, jamais par son nom d’outil', () => {
    const recu = texteRecus([{ recu: { ok: true } as never, erreur: null, outil: 'update_job_status', resultat: null }], 'confirm', true);
    expect(recu).not.toMatch(/update_job_status|status/);
    expect(recu).toContain('statut');
  });

  /**
   * ÉCART (a) — statut brut visible sur la CARTE de confirmation.
   * server/lib/lumi/apercu-action.ts pose la valeur de base à côté du nom :
   *   :77-78  facture → txt(f.status)        (« sent », « partial »)
   *   :90-91  devis → txt(q.status)          (« awaiting_response »)
   *   :105-106 paiement → txt(p.method || p.provider)
   *   :113    membre → txt(m.role)           (« sales_rep »)
   *   :136    tâche → txt(t.status)          (« open », « done »)
   *   :141    automatisation → txt(a.trigger_event)
   *   :149    invitation → txt(i.role), txt(i.status)
   *   :158    carte du pipeline → txt(d.stage)   (« new_prospect »)
   *   :171    modèle de courriel → txt(c.type)
   *   :182 et :200 rapport et facture récurrente → txt(r.frequency) (« weekly »)
   *   :191    contrat → txt(c.status)
   *   :220    note → txt(n.entity_type)
   * Fichier réservé à une autre session : rapporté, pas corrigé ici.
   */
  it.fails('ÉCART : la carte de confirmation ne pose aucune valeur de base à côté d’un nom (apercu-action.ts)', () => {
    const source = lire('server/lib/lumi/apercu-action.ts');
    const bruts = source.match(/txt\([a-z]+\??\.(status|stage|role|frequency|trigger_event|type|entity_type|method)\b[^)]*\)/g) ?? [];
    expect(bruts).toEqual([]);
  });

  /**
   * ÉCART (a) — en anglais, le statut reste en français : les outils ne
   * fournissent le libellé affiché qu'en français (ETIQUETTES_DERIVED, STATUT_*
   * de server/lib/agent/tools-etendus.ts) et le gabarit le reprend tel quel.
   *   server/lib/lumi/raccourcis.ts:434        « Status : en retard »
   *   server/lib/lumi/actions-directes.ts:499  (fiche de facture ou de devis)
   *   server/lib/lumi/actions-directes.ts:514  (fiche client)
   *   server/lib/lumi/actions-directes.ts:533  (jobs d'un client)
   *   server/lib/lumi/actions-directes.ts:543  (devis d'un client)
   */
  it.fails('ÉCART : en anglais, une fiche de job n’affiche pas un statut en français (raccourcis.ts:434)', () => {
    const texte = rendreRaccourci(
      { id: 'job-numero', tool: 'list_jobs', args: {}, numero: '33' },
      { jobs: [{ job_number: 33, title: 'Window cleaning', client: 'Luc Lavoie', statut: 'en retard' }] },
      { fr: false, fuseau: 'America/Toronto', prenom: null, maintenant: new Date('2026-10-01T15:00:00Z') },
    );
    expect(texte).toContain('Status : ');
    expect(texte).not.toMatch(/en retard|à venir|planifié|terminé/);
  });
});

describe('gabarits de Lumi — tutoiement constant', () => {
  it('Lumi tutoie : des phrases en « tu » existent dans ses gabarits', () => {
    expect(phrases.filter((c) => TU.test(c.texte)).length).toBeGreaterThan(10);
  });

  it('aucun gabarit ne vouvoie l’utilisateur', () => {
    // Seule exception : le texto de relance préparé pour le CLIENT de l'entreprise
    // (actions-directes.ts, « Merci de régulariser quand vous pourrez ») — on
    // vouvoie le client final, c'est le registre de tous les messages préréglés.
    const fautives = phrases.filter((c) => VOUS.test(c.texte) && !/Merci de régulariser quand vous pourrez/.test(c.texte)).map(ou);
    expect(fautives).toEqual([]);
  });
});

describe('gabarits de Lumi — un seul mot pour une même chose', () => {
  const compte = (re: RegExp) => phrases.reduce((n, c) => n + (c.texte.match(re) ?? []).length, 0);

  it('« courriel » et « texto », jamais « email », « e-mail » ni « SMS » dans une phrase', () => {
    const fautives = phrases.filter((c) => /(?<![a-zà-ÿ_.@-])(e-?mails?|sms)(?![a-zà-ÿ_.@-])/i.test(c.texte)).map(ou);
    expect(fautives).toEqual([]);
    expect(compte(/(?<![a-zà-ÿ])courriels?(?![a-zà-ÿ])/gi)).toBeGreaterThan(0);
    expect(compte(/(?<![a-zà-ÿ])textos?(?![a-zà-ÿ])/gi)).toBeGreaterThan(0);
  });

  /**
   * ÉCART (b) — « devis » partout, sauf trois phrases en « soumission » :
   *   server/lib/lumi/fiches.ts:246   « Soumission ${num} » (objet de la carte d'envoi)
   *   server/lib/lumi/fiches.ts:252   « … accepter la soumission en ligne »
   *   server/lib/lumi/briefing.ts:156 « … en soumissions sans réponse (N devis) » — les deux mots dans la même phrase
   * L'écran dit « Devis » (menu) ; les courriels envoyés au client disent
   * « soumission ». Hésitation signalée dans le glossaire, non tranchée ici.
   */
  it.fails('ÉCART : les gabarits n’emploient qu’un mot pour le devis (fiches.ts:246, :252 ; briefing.ts:156)', () => {
    const devis = compte(/(?<![a-zà-ÿ])devis(?![a-zà-ÿ])/gi);
    const soumission = compte(/(?<![a-zà-ÿ])soumissions?(?![a-zà-ÿ])/gi);
    expect(Math.min(devis, soumission)).toBe(0);
  });

  /**
   * ÉCART (b) — le genre du mot « job » :
   *   server/lib/lumi/recus.ts:40, :42, :44  « la job », « le statut de la job »
   *   server/lib/lumi/actions-directes.ts:532 « Aucun job pour … »
   *   server/lib/lumi/raccourcis.ts:429 « pas encore planifiée » (féminin) sous « Job #… »
   * L'écran traduit écrit « la job » (62 fois sur 62 dans src/i18n/fr.ts).
   */
  it.fails('ÉCART : « job » a un seul genre dans les gabarits (recus.ts:40 ; actions-directes.ts:532)', () => {
    // Toutes les chaînes, pas seulement les phrases : « la job » est un fragment (nom d'action d'un reçu).
    const toutes = GABARITS.flatMap(chainesDe);
    const nb = (re: RegExp) => toutes.reduce((n, c) => n + (c.texte.match(re) ?? []).length, 0);
    const feminin = nb(/(?<![a-zà-ÿ|(])(la|une|cette|aucune|nouvelle) jobs?(?![a-zà-ÿ])/gi);
    const masculin = nb(/(?<![a-zà-ÿ|(])(un|ce|aucun|nouveau|du|au) jobs?(?![a-zà-ÿ])/gi);
    expect(feminin).toBeGreaterThan(0); // garde-fou : le relevé voit bien les deux formes
    expect(Math.min(feminin, masculin)).toBe(0);
  });
});
