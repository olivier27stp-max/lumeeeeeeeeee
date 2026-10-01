/**
 * Glossaire de Lumi — les STATUTS (phase 5 de « Lumi 100 % fiable »).
 *
 * Règle : Lumi dit toujours le statut AFFICHÉ (« en retard »), jamais la
 * valeur rangée en base (« scheduled »). Trois tables entrent en jeu :
 *   1. la base — les valeurs permises (contraintes CHECK, lues dans
 *      supabase/SCHEMA_SNAPSHOT.md, généré depuis la prod) ;
 *   2. l'écran — le libellé de la pastille de statut (StatusBadge lit
 *      `status` de src/i18n/fr.ts et en.ts) ;
 *   3. Lumi — le libellé que ses outils fournissent au modèle et à ses
 *      gabarits (server/lib/agent/tools-*.ts).
 *
 * Ces tests exigent qu'aucune valeur de base ne soit orpheline, et gardent en
 * `it.fails` les statuts où Lumi et l'écran ne disent pas le même mot
 * (LUMI_GLOSSARY.md, « Écarts constatés »).
 *
 * Tests statiques : aucune base, aucun modèle, aucun réseau.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fr from '../src/i18n/fr';
import en from '../src/i18n/en';
import { ROLE_LABELS } from '../src/lib/permissions';
import { ETIQUETTES_DERIVED, STATUT_DEVIS, STATUT_FACTURE, STATUT_ROLE, STATUT_CLIENT } from '../server/lib/agent/tools-etendus';
import { STATUT_PROSPECT } from '../server/lib/agent/tools-leads';

const racine = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(racine, p), 'utf8');
const schema = lire('supabase/SCHEMA_SNAPSHOT.md');

/** Les valeurs d'une contrainte CHECK du relevé de schéma. */
function valeursCheck(contrainte: string): string[] {
  const ligne = schema.split(/\r?\n/).find((l) => l.startsWith(`- \`${contrainte}\``));
  if (!ligne) throw new Error(`Contrainte introuvable dans SCHEMA_SNAPSHOT.md : ${contrainte}`);
  return [...ligne.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
}

/** Une table de libellés déclarée dans un fichier sans être exportée (`const NOM … = { … }`). */
function tableLocale(fichier: string, nom: string): Record<string, string> {
  const m = new RegExp(`const ${nom}[^=]*=\\s*\\{([^}]*)\\}`).exec(lire(fichier));
  if (!m) throw new Error(`Table ${nom} introuvable dans ${fichier}`);
  return Object.fromEntries([...m[1].matchAll(/([a-z_]+):\s*'([^']+)'/g)].map((x) => [x[1], x[2]]));
}

/** Statuts CALCULÉS d'un job (vue jobs_active.derived_status) : ceux du filtre « Statut » de la page Jobs. */
const JOB_CALCULES = ['upcoming', 'late', 'action_required', 'requires_invoicing', 'archived'];
/** Statuts CALCULÉS d'une facture par l'écran (onglets de Finances → Facturation). */
const FACTURE_CALCULES = ['sent_not_due', 'past_due'];

const ecranFr = fr.status as Record<string, string>;
const ecranEn = en.status as Record<string, string>;

const ENTITES: Array<{ nom: string; bruts: string[]; lumi: Record<string, string>; source: string }> = [
  { nom: 'job', bruts: [...valeursCheck('jobs_status_check'), ...JOB_CALCULES], lumi: ETIQUETTES_DERIVED, source: 'server/lib/agent/tools-etendus.ts (ETIQUETTES_DERIVED)' },
  { nom: 'devis', bruts: valeursCheck('quotes_status_check'), lumi: STATUT_DEVIS, source: 'server/lib/agent/tools-etendus.ts (STATUT_DEVIS)' },
  { nom: 'facture', bruts: [...valeursCheck('invoices_status_check'), ...FACTURE_CALCULES], lumi: STATUT_FACTURE, source: 'server/lib/agent/tools-etendus.ts (STATUT_FACTURE)' },
  { nom: 'paiement', bruts: valeursCheck('payments_status_check'), lumi: tableLocale('server/lib/agent/tools-argent.ts', 'STATUT_PAIEMENT'), source: 'server/lib/agent/tools-argent.ts (STATUT_PAIEMENT)' },
  { nom: 'client', bruts: valeursCheck('clients_status_check'), lumi: STATUT_CLIENT, source: 'server/lib/agent/tools-etendus.ts (STATUT_CLIENT)' },
  { nom: 'prospect (étape)', bruts: valeursCheck('pipeline_deals_stage_check'), lumi: STATUT_PROSPECT, source: 'server/lib/agent/tools-leads.ts (STATUT_PROSPECT)' },
];

/** Minuscules, sans accent, sans marque de genre ni de nombre : « Planifiée » et « planifié » sont le même mot. */
const racineMot = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  .split(/[^a-z]+/).filter(Boolean).map((m) => m.replace(/(es|e|s)$/, '')).join(' ');
/** Même terme : l'un contient l'autre (« converti en job » ⊇ « Converti », « client actif » ⊇ « Actif »). */
const memeTerme = (a: string, b: string) => { const x = racineMot(a), y = racineMot(b); return x.includes(y) || y.includes(x); };

/**
 * ÉCARTS (b) connus — Lumi et la pastille de l'écran ne disent pas le même mot.
 * Clé : « entité.valeur ». Chaque ligne donne les deux endroits à réconcilier.
 */
const ECARTS_CONNUS: Record<string, string> = {
  'job.completed': 'Lumi « terminé » (server/lib/agent/tools-etendus.ts:378) · écran « Complétée » (src/i18n/fr.ts:3288)',
  'devis.approved': 'Lumi « accepté » (server/lib/agent/tools-etendus.ts:387) · écran « Approuvé » (src/i18n/fr.ts:3306)',
  'devis.changes_requested': 'Lumi « modifications demandées » (server/lib/agent/tools-etendus.ts:387) · écran « Changements demandés » (src/i18n/fr.ts:3305)',
  'facture.sent_not_due': 'Lumi « envoyée (pas encore due) » (server/lib/agent/tools-etendus.ts:392) · écran « En attente de paiement » (src/i18n/fr.ts:3279)',
};

describe('statuts — aucune valeur de base sans libellé', () => {
  it.each(ENTITES)('$nom : chaque valeur de base a un libellé français chez Lumi', ({ bruts, lumi, source }) => {
    const orphelins = bruts.filter((b) => !lumi[b]);
    expect(orphelins, `sans libellé dans ${source}`).toEqual([]);
  });

  it.each(ENTITES)('$nom : chaque valeur de base a un libellé affiché, en français ET en anglais', ({ bruts }) => {
    expect(bruts.filter((b) => !ecranFr[b]), 'sans libellé dans status de src/i18n/fr.ts').toEqual([]);
    expect(bruts.filter((b) => !ecranEn[b]), 'sans libellé dans status de src/i18n/en.ts').toEqual([]);
  });

  it('un libellé de Lumi n’est jamais la valeur de base elle-même', () => {
    for (const { bruts, lumi } of ENTITES) {
      for (const brut of bruts) {
        const libelle = lumi[brut];
        expect(libelle, brut).not.toMatch(/_/);
        // Une valeur de base anglaise ne passe pas pour un libellé (« archived » ≠ « archivé »).
        expect(libelle.toLowerCase(), brut).not.toBe(brut.toLowerCase());
      }
    }
  });

  it('rôles : chaque rôle a son libellé chez Lumi, le même qu’à la page Rôles', () => {
    const roles = ['owner', ...valeursCheck('invitations_role_check')];
    for (const r of roles) {
      expect(STATUT_ROLE[r], r).toBeTruthy();
      expect(memeTerme(STATUT_ROLE[r], ROLE_LABELS[r as keyof typeof ROLE_LABELS].fr), `${r} : ${STATUT_ROLE[r]} / ${ROLE_LABELS[r as keyof typeof ROLE_LABELS].fr}`).toBe(true);
    }
  });

  it('tâches et invitations : chaque valeur de base a son libellé chez Lumi', () => {
    const taches = tableLocale('server/lib/agent/tools-terrain.ts', 'STATUT_TACHE');
    expect(valeursCheck('tasks_status_check').filter((b) => !taches[b])).toEqual([]);
    const invitations = tableLocale('server/lib/agent/tools-equipe.ts', 'STATUT_INVITATION');
    expect(valeursCheck('invitations_status_check').filter((b) => !invitations[b])).toEqual([]);
  });

  it('jobs en anglais : le rapport PDF a un libellé anglais pour chaque statut', () => {
    // Seule table anglaise de Lumi aujourd'hui (server/lib/agent/tools-rapports.ts, ETIQ_EN).
    const source = lire('server/lib/agent/tools-rapports.ts');
    const bloc = /const ETIQ_EN[^=]*=\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    const cles = [...bloc.matchAll(/([a-z_]+):\s*'/g)].map((m) => m[1]);
    expect([...valeursCheck('jobs_status_check'), ...JOB_CALCULES].filter((b) => !cles.includes(b))).toEqual([]);
  });
});

describe('statuts — Lumi dit le mot de l’écran', () => {
  const paires = ENTITES.flatMap(({ nom, bruts, lumi }) => bruts.map((b) => ({ cle: `${nom}.${b}`, lumi: lumi[b], ecran: ecranFr[b] })));

  it('hors écarts connus, le libellé de Lumi et celui de la pastille sont le même terme', () => {
    const differents = paires
      .filter((p) => !ECARTS_CONNUS[p.cle] && p.lumi && p.ecran && !memeTerme(p.lumi, p.ecran))
      .map((p) => `${p.cle} : Lumi « ${p.lumi} » / écran « ${p.ecran} »`);
    expect(differents).toEqual([]);
  });

  it('la liste des écarts connus ne contient que de vrais écarts (un écart corrigé se retire de la liste)', () => {
    const corriges = Object.keys(ECARTS_CONNUS).filter((cle) => {
      const p = paires.find((x) => x.cle === cle);
      return !p || memeTerme(p.lumi, p.ecran);
    });
    expect(corriges).toEqual([]);
  });

  it.fails('ÉCART : job terminé, devis accepté, modifications demandées, facture pas encore due — Lumi et l’écran s’accordent', () => {
    // Voir ECARTS_CONNUS ci-dessus pour le fichier:ligne de chaque paire.
    const differents = paires.filter((p) => ECARTS_CONNUS[p.cle] && !memeTerme(p.lumi, p.ecran)).map((p) => `${p.cle} — ${ECARTS_CONNUS[p.cle]}`);
    expect(differents).toEqual([]);
  });

  /**
   * ÉCART (b) — une tâche non faite : Lumi dit « à faire »
   * (server/lib/agent/tools-etendus.ts:731, tools-terrain.ts:91), la page Tâches
   * affiche « Ouverte » (src/pages/Tasks.tsx:81).
   */
  it.fails('ÉCART : une tâche non faite porte le même mot chez Lumi et à la page Tâches', () => {
    const lumi = tableLocale('server/lib/agent/tools-terrain.ts', 'STATUT_TACHE').open;
    const ecran = /status === 'done' \? \(isFr \? '([^']+)' : '[^']+'\) : \(isFr \? '([^']+)'/.exec(lire('src/pages/Tasks.tsx'))?.[2] ?? '';
    expect(ecran).toBeTruthy();
    expect(memeTerme(lumi, ecran), `Lumi « ${lumi} » / écran « ${ecran} »`).toBe(true);
  });

  /**
   * ÉCART (b) — une automatisation : Lumi dit « active » / « en pause »
   * (server/lib/lumi/actions-directes.ts:464, server/lib/agent/tools-reglages.ts:373),
   * la page Automatisations affiche « Publiée » / « Brouillon »
   * (src/pages/Automations.tsx:1609-1610, src/components/automations/InterrupteurPublication.tsx:56).
   */
  it.fails('ÉCART : une automatisation porte le même état chez Lumi et à la page Automatisations', () => {
    const page = lire('src/components/automations/InterrupteurPublication.tsx');
    expect(page).toMatch(/'Publiée'/);
    const gabarit = lire('server/lib/lumi/actions-directes.ts');
    expect(gabarit).toMatch(/is_active \? \(fr \? 'publiée'/i);
  });
});

describe('statuts — l’écran ne se contredit pas (relevé)', () => {
  /**
   * ÉCART (UI) — huit libellés de src/i18n/fr.ts (:2718, :2721, :2722, :2726,
   * :2727, :2731, :2732, :2733) contiennent la SUITE DE CARACTÈRES « \u00e9 »
   * au lieu de l'accent. L'un d'eux est affiché : supprimer un devis montre
   * « Devis supprim\u00e9 », lettre pour lettre (src/pages/Quotes.tsx:246).
   */
  it.fails('ÉCART : aucun libellé français n’affiche un code « \\u00e9 » à la place d’un accent (src/i18n/fr.ts:2731)', () => {
    const aplatir = (o: unknown, sortie: string[] = []): string[] => {
      if (typeof o === 'string') sortie.push(o);
      else if (o && typeof o === 'object') Object.values(o).forEach((v) => aplatir(v, sortie));
      return sortie;
    };
    expect(aplatir(fr).filter((v) => /\\u00[0-9a-f]{2}/i.test(v))).toEqual([]);
  });

  /**
   * ÉCART (UI) — le filtre de la page Devis dit « Décliné » (src/pages/Quotes.tsx:57)
   * quand la pastille de la même page dit « Refusé » (src/i18n/fr.ts:3307).
   */
  it.fails('ÉCART : le filtre et la pastille de la page Devis disent le même mot pour un devis refusé', () => {
    // Le libellé du filtre (majuscule initiale), pas la classe de couleur (`declined: 'badge-danger'`).
    const filtre = /declined: '([A-ZÉ][^']+)'/.exec(lire('src/pages/Quotes.tsx'))?.[1] ?? '';
    expect(filtre).toMatch(/^[A-ZÉ]/);
    expect(memeTerme(filtre, ecranFr.declined), `filtre « ${filtre} » / pastille « ${ecranFr.declined} »`).toBe(true);
  });
});
