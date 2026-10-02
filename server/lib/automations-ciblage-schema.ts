/* ═══════════════════════════════════════════════════════════════
   LE SCHÉMA DU CIBLAGE — ce que le serveur accepte sous `conditions.ciblage`.

   Il vit ICI et non dans `src/lib/automationCiblage.ts` : aucun fichier de
   `src/` n'importe Zod, et l'y mettre l'embarquerait dans le JavaScript du
   navigateur pour une vérification qui ne sert qu'au serveur. L'éditeur, lui,
   juge sa saisie avec `fautesDuCiblage` (pur, sans dépendance) ; un test garde
   les deux d'accord (tests/automations-finale/p/ciblage-schema.test.ts).

   Ce fichier n'importe PAS `validation.ts` (qui l'importera) : la forme d'une
   condition de champ est donc redite ici, et un test la compare à
   `conditionChampSchema`.
   ═══════════════════════════════════════════════════════════════ */

import { z } from 'zod';
import {
  CIBLAGE_MAX_EXCLURE, CIBLAGE_MAX_INCLURE, CIBLAGE_VALEUR_MAX, CLES_FICHE, CLE_CIBLAGE, OPERATEURS_FICHE,
  VALEURS_FICHE, type CleFiche,
} from '../../src/lib/automationCiblage';

const regleEtiquette = z.object({
  type: z.literal('etiquette'),
  valeur: z.string().trim().min(1, 'Choisissez une étiquette.').max(CIBLAGE_VALEUR_MAX),
}).strict();

const regleFiche = z.object({
  type: z.literal('fiche'),
  cle: z.enum(CLES_FICHE),
  op: z.enum(OPERATEURS_FICHE),
  value: z.string().trim().max(CIBLAGE_VALEUR_MAX).nullable().optional(),
}).strict().superRefine((r, ctx) => {
  const sansValeur = r.op === 'is_empty' || r.op === 'is_not_empty';
  const valeur = (r.value ?? '').trim();
  if (!sansValeur && valeur === '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Choisissez une valeur.' });
    return;
  }
  // Un champ à valeurs fermées (type de client, statut) : une valeur de la liste, et « est » / « n'est pas » seulement.
  const fermees = VALEURS_FICHE[r.cle as CleFiche];
  if (fermees && !sansValeur) {
    if (r.op !== 'is' && r.op !== 'is_not') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['op'], message: 'Ce champ se compare par « est » ou « n’est pas ».' });
    }
    if (!fermees.some((o) => o.cle === valeur.toLowerCase())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: `Valeur inconnue : ${fermees.map((o) => o.cle).join(', ')}.` });
    }
  }
});

/** Même forme que `conditionChampSchema` (server/lib/validation.ts), plus `type: 'champ'`. */
const regleChamp = z.object({
  type: z.literal('champ'),
  field_id: z.string().uuid(),
  op: z.enum(['is', 'is_not', 'contains', 'not_contains', 'eq', 'neq', 'gt', 'lt', 'between', 'any_of', 'none_of',
    'today', 'yesterday', 'in_last', 'more_than_ago', 'less_than_ago', 'before', 'after', 'is_empty', 'is_not_empty']),
  value: z.union([z.string().max(500), z.number().finite(), z.boolean(), z.array(z.string().max(100)).max(100)]).nullable().optional(),
  value2: z.union([z.string().max(500), z.number().finite()]).nullable().optional(),
  n: z.number().int().min(0).max(3650).optional(),
  unit: z.enum(['days', 'weeks', 'months']).optional(),
}).strict();

export const regleCiblageSchema = z.union([regleEtiquette, regleFiche, regleChamp]);

/**
 * `conditions.ciblage`. Strict : une clé inconnue est refusée plutôt que
 * retirée en silence (une faute de frappe sur « exclure » ferait écrire à ceux
 * qu'on voulait épargner).
 */
export const ciblageSchema = z.object({
  inclure: z.object({
    mode: z.enum(['toutes', 'une']),
    regles: z.array(regleCiblageSchema).max(CIBLAGE_MAX_INCLURE, `Au plus ${CIBLAGE_MAX_INCLURE} conditions d’inclusion.`),
  }).strict().optional(),
  exclure: z.array(regleCiblageSchema).max(CIBLAGE_MAX_EXCLURE, `Au plus ${CIBLAGE_MAX_EXCLURE} exclusions.`).optional(),
}).strict();

export type CiblageValide = z.infer<typeof ciblageSchema>;

/** La clé de `conditions` sous laquelle ce schéma — et lui seul — s'applique. */
export { CLE_CIBLAGE };
