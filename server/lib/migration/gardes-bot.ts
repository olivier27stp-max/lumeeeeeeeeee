/**
 * Gardes en dur du bot de migration — sans modèle, testées.
 * ─────────────────────────────────────────────────────────────────
 * Le modèle propose, les gardes tranchent ce qui est TOUJOURS faux quel
 * que soit le CRM source (pièges vus sur de vrais exports Jobber) :
 *  - type incompatible (booléen / date vers un nom, un id, un montant…) ;
 *  - deux colonnes vers le même champ (la plus à droite écraserait l'autre) ;
 *  - « tags » vers l'identifiant externe ; champs personnalisés CF[...] ;
 *  - rapport d'utilisation « Products & Services » pris pour un catalogue.
 * Une garde ne devine jamais un champ : elle met null et explique (alerte).
 */
import type { DetectedType, FieldDef, TargetEntity } from './types';

export interface VerdictGarde {
  position: number;
  field: string | null;
  confidence: number;
  raison?: string;
  candidats?: string[];
  alerte?: string;
}
export interface ColonneGarde {
  position: number;
  header: string;
  detected_type: string | null;
}
export interface AlerteBot {
  fichier: string;
  colonne: string;
  message: string;
  /** Ce que le bot a fait (ou ce qu'un humain devrait faire). */
  action: string;
}

const TYPES_STRICTS: ReadonlyArray<DetectedType> = ['boolean', 'date', 'datetime'];
/** Champs d'identité / clés : un booléen, une date ou un tag n'y vont jamais. */
const CHAMPS_IDENTITE = new Set([
  'external_id', 'first_name', 'last_name', 'full_name', 'company', 'name', 'email', 'phone', 'phone_secondary',
  'client_ref', 'client_email_ref', 'client_name_ref', 'client_phone_ref', 'job_ref', 'invoice_ref', 'property_ref',
  'invoice_number', 'job_number', 'quote_number', 'title', 'item_name',
]);
const RE_TAG = /\btags?\b|\bétiquettes?\b|\betiquettes?\b|\blabels?\b/i;
const RE_CHAMP_PERSO = /^CF[TL]\[/i;
const RE_RAPPORT_USAGE = /\b(quoted|jobs|invoiced)\s*(qty|\$)/i;

export function estRapportUtilisation(headers: string[]): boolean {
  return headers.filter((h) => RE_RAPPORT_USAGE.test(h)).length >= 2;
}

function typeCompatible(detected: string | null, def: FieldDef | undefined): boolean {
  if (!detected || !def) return true;
  if (!TYPES_STRICTS.includes(detected as DetectedType)) return true;
  if (detected === 'boolean') return def.types.includes('boolean');
  return def.types.includes('date') || def.types.includes('datetime');
}

/**
 * Applique les gardes aux verdicts d'UN fichier. `fixes` = champs déjà décidés
 * par un humain sur ce fichier (position → champ) : un verdict qui vise le même
 * champ est refusé (l'humain a raison).
 */
export function appliquerGardes(p: {
  fichier: string;
  entity: TargetEntity;
  colonnes: ColonneGarde[];
  verdicts: VerdictGarde[];
  champs: FieldDef[];
  fixes?: Array<{ position: number; field: string }>;
}): { verdicts: VerdictGarde[]; alertes: AlerteBot[]; nature: string | null } {
  const alertes: AlerteBot[] = [];
  const colParPos = new Map(p.colonnes.map((c) => [c.position, c]));
  const defParChamp = new Map(p.champs.map((c) => [c.field, c]));
  const rapportUsage = p.entity === 'service' && estRapportUtilisation(p.colonnes.map((c) => c.header));
  const nature = rapportUsage ? 'Rapport d\'utilisation « Products & Services » (compteurs et totaux cumulés), pas un catalogue : seul le nom est importé.' : null;

  const refuser = (v: VerdictGarde, message: string, action: string): VerdictGarde => {
    const col = colParPos.get(v.position);
    alertes.push({ fichier: p.fichier, colonne: col?.header ?? `#${v.position}`, message, action });
    return { ...v, field: null, confidence: 0, candidats: [], alerte: message };
  };

  let out: VerdictGarde[] = p.verdicts.map((v) => {
    const col = colParPos.get(v.position);
    if (!v.field || !col) return v;
    const def = defParChamp.get(v.field);
    if (!def) return refuser(v, `champ « ${v.field} » inconnu du catalogue`, 'ne pas importer');
    if (rapportUsage && v.field !== 'name') {
      return refuser(v, 'colonne d\'un rapport d\'utilisation (compteur ou total cumulé), pas une donnée de catalogue', 'ne pas importer (les prix viennent de l\'export du catalogue Réglages › Produits et services)');
    }
    if (!typeCompatible(col.detected_type, def)) {
      return refuser(v, `colonne détectée « ${col.detected_type} » vers le champ « ${def.labelFr} » (${def.types.join('/')}) : type incompatible`, 'ne pas importer (valeur conservée dans les notes)');
    }
    if (RE_TAG.test(col.header) && CHAMPS_IDENTITE.has(v.field)) {
      return refuser(v, `« ${col.header} » ressemble à des étiquettes : jamais vers « ${def.labelFr} » (aurait écrasé la clé de rattachement de toutes les fiches)`, 'ne pas importer (valeur conservée dans les notes)');
    }
    if (RE_CHAMP_PERSO.test(col.header) && CHAMPS_IDENTITE.has(v.field)) {
      return refuser(v, `champ personnalisé de l'ancien CRM (${col.header}) vers « ${def.labelFr} »`, 'ne pas importer (valeur conservée dans les notes)');
    }
    return v;
  });

  // Deux colonnes → même champ : la plus confiante gagne, à égalité la plus à gauche ; les autres → null.
  const pris = new Map<string, VerdictGarde>();
  for (const f of p.fixes ?? []) pris.set(f.field, { position: f.position, field: f.field, confidence: 2 });
  const ordre = [...out].sort((a, b) => (b.confidence - a.confidence) || (a.position - b.position));
  const refus = new Set<number>();
  for (const v of ordre) {
    if (!v.field) continue;
    const deja = pris.get(v.field);
    if (!deja) { pris.set(v.field, v); continue; }
    refus.add(v.position);
  }
  out = out.map((v) => {
    if (!v.field || !refus.has(v.position)) return v;
    const gagnant = pris.get(v.field)!;
    const colG = colParPos.get(gagnant.position);
    const def = defParChamp.get(v.field);
    const qui = gagnant.confidence > 1 ? `déjà décidée par un humain (« ${colG?.header ?? '?'} »)` : `« ${colG?.header ?? '?'} » plus sûre`;
    return refuser(v, `deux colonnes vers « ${def?.labelFr ?? v.field} » : ${qui} ; la colonne la plus à droite aurait écrasé l'autre`, 'ne pas importer (valeur conservée dans les notes)');
  });

  return { verdicts: out, alertes, nature };
}
