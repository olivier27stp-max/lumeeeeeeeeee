/**
 * Unification du modèle des automatisations — ESSAI À BLANC, par bureau.
 *
 * Une ligne `automation_rules` porte ce qu'elle fait sous deux formes : `steps`
 * (le parcours de l'éditeur) et `actions` + `delay_seconds` (le format d'origine,
 * à plat). La cible : UNE forme, `steps`, pour toutes les règles. Ce script dit,
 * SANS RIEN ÉCRIRE, ce que la conversion ferait à chaque bureau :
 *
 *   · combien de règles par forme (parcours, à plat, neuve, vide, corbeille) ;
 *   · pour chaque règle à plat : le parcours qu'elle recevrait, si la conversion
 *     est possible sans rien perdre (`apercuConversion`), si l'aller-retour rend
 *     exactement les mêmes actions et le même délai, et si une règle PUBLIÉE
 *     deviendrait refusée par les contrôles de publication une fois convertie ;
 *   · pour chaque règle à parcours : si sa copie `actions` est périmée (elle ne
 *     dit plus ce que le parcours fait) ;
 *   · les envois déjà planifiés (tâches en attente) attachés à une règle à
 *     convertir — à ne pas perdre en route.
 *
 * Entrée : un fichier JSON (tableau de lignes), produit par la requête SQL
 * ci-dessous en LECTURE SEULE. Le fichier contient les messages des entreprises :
 * il reste HORS du dépôt.
 *
 *   select o.name as org_nom, r.org_id, r.id, r.name, r.trigger_event, r.is_active,
 *          r.is_preset, r.preset_key, r.deleted_at, r.delay_seconds, r.steps,
 *          r.actions, r.conditions,
 *          (select count(*) from automation_scheduled_tasks t
 *            where t.automation_rule_id = r.id and t.status = 'pending') as taches_en_attente
 *     from automation_rules r join orgs o on o.id = r.org_id
 *
 * Lancer :
 *   npx tsx scripts/qa/finale/unification-essai-a-blanc.mts --fichier <regles.json> --sortie <dossier hors dépôt>
 *
 * Sorties : <dossier>/unification-essai.json et <dossier>/unification-essai.md
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { apercuConversion, estFormatOrigine, TEXTES_ACTION_PROVISOIRE } from '../../../src/lib/sequenceTypes';
import { actionsDuParcours, bloquantsPublication } from '../../../src/lib/publicationAutomatisation';
import { actionsDepuisEtapes, aUnParcours } from '../../../server/lib/automations-etapes';

interface Ligne {
  org_nom: string;
  org_id: string;
  id: string;
  name: string | null;
  trigger_event: string | null;
  is_active: boolean | null;
  is_preset: boolean | null;
  preset_key: string | null;
  deleted_at: string | null;
  delay_seconds: number | null;
  steps: unknown;
  actions: unknown;
  conditions: Record<string, unknown> | null;
  taches_en_attente: number | string | null;
}

type Forme = 'parcours' | 'a_plat' | 'neuve' | 'vide' | 'corbeille';

interface Verdict {
  id: string;
  nom: string;
  declencheur: string;
  publiee: boolean;
  prereglage: boolean;
  forme: Forme;
  taches_en_attente: number;
  /** Règle à plat : la conversion est-elle possible sans rien perdre ? */
  convertible?: boolean;
  /** Types d'action que le serveur refuserait dans un parcours. */
  bloquants_conversion?: string[];
  /** L'aller-retour (à plat → parcours → actions) rend-il les mêmes actions et le même délai ? */
  aller_retour_identique?: boolean;
  /** Nombre d'étapes du parcours qu'elle recevrait. */
  etapes?: number;
  /** Une règle PUBLIÉE que les contrôles de publication refuseraient une fois convertie. */
  refus_apres_conversion?: string[];
  /** Règle à parcours : sa copie `actions` ne dit plus ce que le parcours fait. */
  copie_actions_perimee?: boolean;
}

const arg = (nom: string): string | undefined => {
  const i = process.argv.indexOf(`--${nom}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const fichier = arg('fichier');
const sortie = arg('sortie');
if (!fichier || !sortie) {
  console.error('Usage : npx tsx scripts/qa/finale/unification-essai-a-blanc.mts --fichier <regles.json> --sortie <dossier hors dépôt>');
  process.exit(2);
}
if (resolve(sortie).toLowerCase().startsWith(process.cwd().toLowerCase())) {
  console.error(`--sortie (${resolve(sortie)}) est DANS le dépôt : le résultat contient des messages d'entreprises, il reste dehors.`);
  process.exit(2);
}

const lignes = JSON.parse(readFileSync(fichier, 'utf8').replace(/^﻿/, '')) as Ligne[];

/** Comparaison stable de deux valeurs JSON (clés triées). */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const actionsNormalisees = (actions: unknown) =>
  (Array.isArray(actions) ? actions : []).map((a) => {
    const x = (a ?? {}) as { type?: unknown; config?: unknown };
    return { type: String(x.type ?? ''), config: x.config && typeof x.config === 'object' ? x.config : {} };
  });

function estProvisoire(actions: unknown): boolean {
  const liste = Array.isArray(actions) ? actions : [];
  if (liste.length !== 1) return false;
  const a = liste[0] as { type?: string; config?: { body?: unknown } } | null;
  return a?.type === 'send_sms' && TEXTES_ACTION_PROVISOIRE.includes(String(a.config?.body ?? ''));
}

function juger(l: Ligne): Verdict {
  const base = {
    id: l.id,
    nom: l.name ?? '(sans nom)',
    declencheur: l.trigger_event ?? '(aucun)',
    publiee: !!l.is_active,
    prereglage: !!l.is_preset,
    taches_en_attente: Number(l.taches_en_attente ?? 0),
  };
  if (l.deleted_at) return { ...base, forme: 'corbeille' };

  if (aUnParcours(l)) {
    // La copie `actions` doit être le REFLET du parcours, tel que l'écrit chaque enregistrement
    // (`actionsDuParcours` : fil principal puis branche « si non », 20 au plus).
    const duParcours = actionsDuParcours(l.steps);
    return {
      ...base, forme: 'parcours', etapes: (l.steps as unknown[]).length,
      copie_actions_perimee: canon(duParcours) !== canon(actionsNormalisees(l.actions)),
    };
  }

  if (!estFormatOrigine({ steps: l.steps, actions: l.actions })) {
    return { ...base, forme: estProvisoire(l.actions) ? 'neuve' : 'vide' };
  }

  const apercu = apercuConversion({ actions: l.actions, delay_seconds: l.delay_seconds });
  const retour = actionsDepuisEtapes(apercu.etapes);
  const attente = apercu.etapes.find((e) => e.type === 'attendre') as
    | { delai_secondes?: number; mode?: string; secondes_avant?: number } | undefined;
  const delaiRendu = !attente ? 0 : attente.mode === 'avant_date' ? -(attente.secondes_avant ?? 0) : attente.delai_secondes ?? 0;
  const identique = canon(retour) === canon(actionsNormalisees(l.actions)) && delaiRendu === (Number(l.delay_seconds) || 0);

  // Une règle publiée ne doit pas devenir « publiée mais refusée » parce qu'on l'a convertie.
  const refus = l.is_active
    ? bloquantsPublication({
        trigger_event: l.trigger_event, steps: apercu.etapes, actions: retour,
        conditions: l.conditions, is_preset: l.is_preset, fr: true,
      }).map((p) => p.message)
    : [];

  return {
    ...base, forme: 'a_plat', convertible: apercu.possible, bloquants_conversion: apercu.bloquants,
    aller_retour_identique: identique, etapes: apercu.etapes.length, refus_apres_conversion: refus,
  };
}

const parBureau = new Map<string, { nom: string; regles: Verdict[] }>();
for (const l of lignes) {
  const b = parBureau.get(l.org_id) ?? { nom: l.org_nom, regles: [] };
  b.regles.push(juger(l));
  parBureau.set(l.org_id, b);
}

const compter = (regles: Verdict[], test: (v: Verdict) => boolean) => regles.filter(test).length;

const bilan = [...parBureau.entries()].map(([orgId, b]) => {
  const vivantes = b.regles.filter((v) => v.forme !== 'corbeille');
  const aPlat = vivantes.filter((v) => v.forme === 'a_plat');
  return {
    org_id: orgId,
    bureau: b.nom,
    total: b.regles.length,
    corbeille: compter(b.regles, (v) => v.forme === 'corbeille'),
    parcours: compter(vivantes, (v) => v.forme === 'parcours'),
    a_plat: aPlat.length,
    a_plat_publiees: compter(aPlat, (v) => v.publiee),
    neuves: compter(vivantes, (v) => v.forme === 'neuve'),
    vides: compter(vivantes, (v) => v.forme === 'vide'),
    convertibles_sans_perte: compter(aPlat, (v) => !!v.convertible && !!v.aller_retour_identique && !(v.refus_apres_conversion?.length)),
    non_convertibles: aPlat.filter((v) => !v.convertible),
    aller_retour_different: aPlat.filter((v) => v.convertible && !v.aller_retour_identique),
    refusees_apres_conversion: aPlat.filter((v) => v.refus_apres_conversion?.length),
    copies_actions_perimees: vivantes.filter((v) => v.copie_actions_perimee),
    taches_en_attente_sur_a_plat: aPlat.reduce((n, v) => n + v.taches_en_attente, 0),
    regles: b.regles,
  };
}).sort((a, b) => b.a_plat - a.a_plat || a.bureau.localeCompare(b.bureau));

const total = (cle: 'total' | 'parcours' | 'a_plat' | 'a_plat_publiees' | 'neuves' | 'vides' | 'corbeille' | 'convertibles_sans_perte' | 'taches_en_attente_sur_a_plat') =>
  bilan.reduce((n, b) => n + b[cle], 0);

const md: string[] = [];
md.push('# Unification du modèle des automatisations — essai à blanc', '');
md.push(`Lecture seule. ${lignes.length} règles lues, ${bilan.length} bureaux. Rien n'a été écrit.`, '');
md.push('## Ensemble', '');
md.push('| Règles | À parcours | À plat | dont publiées | Neuves | Vides | Corbeille | Convertibles sans perte | Envois en attente sur des règles à plat |');
md.push('|---|---|---|---|---|---|---|---|---|');
md.push(`| ${total('total')} | ${total('parcours')} | ${total('a_plat')} | ${total('a_plat_publiees')} | ${total('neuves')} | ${total('vides')} | ${total('corbeille')} | ${total('convertibles_sans_perte')} / ${total('a_plat')} | ${total('taches_en_attente_sur_a_plat')} |`);
md.push('', '## Par bureau', '');
md.push('| Bureau | Règles | À parcours | À plat | dont publiées | Convertibles sans perte | Non convertibles | Aller-retour différent | Refusées après conversion | Copies `actions` périmées | Envois en attente |');
md.push('|---|---|---|---|---|---|---|---|---|---|---|');
for (const b of bilan) {
  md.push(`| ${b.bureau} | ${b.total} | ${b.parcours} | ${b.a_plat} | ${b.a_plat_publiees} | ${b.convertibles_sans_perte} | ${b.non_convertibles.length} | ${b.aller_retour_different.length} | ${b.refusees_apres_conversion.length} | ${b.copies_actions_perimees.length} | ${b.taches_en_attente_sur_a_plat} |`);
}

const detail = (titre: string, choisir: (b: (typeof bilan)[number]) => Verdict[], dire: (v: Verdict) => string) => {
  const lignesDetail = bilan.flatMap((b) => choisir(b).map((v) => `| ${b.bureau} | ${v.nom} | ${v.declencheur} | ${v.publiee ? 'oui' : 'non'} | ${dire(v)} |`));
  md.push('', `## ${titre} (${lignesDetail.length})`, '');
  if (lignesDetail.length === 0) { md.push('Aucune.'); return; }
  md.push('| Bureau | Automatisation | Déclencheur | Publiée | Détail |', '|---|---|---|---|---|', ...lignesDetail);
};

detail('Règles à plat NON convertibles', (b) => b.non_convertibles, (v) => `types refusés dans un parcours : ${(v.bloquants_conversion ?? []).join(', ') || '(aucune action)'}`);
detail('Règles dont l\'aller-retour ne rend pas les mêmes actions', (b) => b.aller_retour_different, (v) => `${v.etapes} étapes`);
detail('Règles publiées que les contrôles refuseraient une fois converties', (b) => b.refusees_apres_conversion, (v) => (v.refus_apres_conversion ?? []).join(' · '));
detail('Règles à parcours dont la copie `actions` est périmée', (b) => b.copies_actions_perimees, (v) => `${v.etapes} étapes`);

mkdirSync(sortie, { recursive: true });
writeFileSync(join(sortie, 'unification-essai.json'), JSON.stringify({ lues: lignes.length, bureaux: bilan }, null, 2));
writeFileSync(join(sortie, 'unification-essai.md'), `${md.join('\n')}\n`);
console.log(md.slice(0, 8 + bilan.length + 4).join('\n'));
console.log(`\nÉcrit : ${join(sortie, 'unification-essai.md')}`);
