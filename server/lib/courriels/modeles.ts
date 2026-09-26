/**
 * Modèles de courriel de l'entreprise (2026-09-18).
 * ─────────────────────────────────────────────────
 * Le bogue que ce fichier corrige : `email_templates` existait, la RLS était
 * complète, le CRUD serveur aussi… mais `is_default` n'était JAMAIS lu. Un
 * modèle n'était chargé que si le front passait un `emailTemplateId` explicite,
 * ce qu'aucune page ne faisait. Les modèles semés en prod étaient morts.
 *
 * Ici, UNE résolution : `texteDuCourriel(orgId, type, variables)`. Elle renvoie
 * `null` quand l'entreprise n'a rien défini — et l'appelant garde alors EXACTEMENT
 * son texte d'origine. C'est la règle qui protège l'existant : brancher la
 * personnalisation ne doit rien changer pour les 99 % d'orgs sans modèle.
 *
 * Trois décisions prises avec le propriétaire, et qu'il ne faut pas contourner :
 *
 *   1. Le HTML d'une entreprise se pose DANS notre charpente, via `corpsHtml` du
 *      gabarit — jamais en remplacement du courriel entier. Une entreprise ne
 *      peut donc pas casser l'affichage chez le client.
 *   2. Le bouton d'action, la carte du montant, les numéros de taxes et le pied
 *      sont TOUJOURS ajoutés par nous, quoi que l'entreprise importe. Un client
 *      doit toujours pouvoir payer, même derrière un modèle bâclé.
 *   3. Pas de bibliothèque de modèles à choisir : il y a le texte d'origine
 *      (le défaut) et le texte de l'entreprise s'il existe. Rien entre les deux.
 *
 * Testé dans tests/courriels/modeles.test.ts (résolution, isolation entre orgs,
 * assainissement, survie du bouton et des taxes à un import).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '../supabase';
import { applyTemplate } from '../notificationHelpers';
import { logger } from '../logger';
import { variablesChamps } from '../champs/service';

/** Le texte d'un courriel tel que l'entreprise l'a écrit, variables déjà remplacées. */
export interface TexteCourriel {
  /** Sujet du courriel. Vide si l'entreprise n'a rempli que le corps. */
  sujet: string;
  /** Corps, en HTML assaini, à passer tel quel à `corpsHtml` du gabarit. */
  corpsHtml: string;
}

/**
 * Balises dont le CONTENU doit disparaître avec elles : vider juste les chevrons
 * laisserait le code JavaScript ou le CSS en texte brut au milieu du courriel.
 */
const BALISES_A_VIDER = ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template'];

/**
 * Assainit le HTML qu'une entreprise a importé.
 *
 * Ce n'est PAS une simple précaution d'affichage : ce HTML part vers les clients
 * de l'entreprise, et il est assemblé côté serveur avec le reste du courriel. Un
 * `<script>` ne s'exécuterait pas dans une boîte de réception moderne, mais il
 * s'exécuterait dans l'aperçu que nous rendons dans l'app — c'est là le vrai
 * risque (un membre de l'org en piège un autre).
 *
 * Ce qu'on retire :
 *   - `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<noscript>`,
 *     `<template>` — balise ET contenu ;
 *   - tout attribut `on*` (`onclick`, `onerror`, `onload`…), guillemets simples,
 *     doubles ou absents ;
 *   - `javascript:` et `data:text/html` dans les `href`/`src`, neutralisés en `#` ;
 *   - les commentaires conditionnels `<!--[if …]>` qui peuvent réintroduire du
 *     balisage chez Outlook.
 *
 * Ce qu'on GARDE : tout le HTML de mise en forme légitime (`<p>`, `<strong>`,
 * `<a href="https://…">`, `<table>`, `<img>`, attributs `style`). Un modèle
 * importé doit rester joli ; on coupe le dangereux, pas le décoratif.
 */
export function assainirHtmlCourriel(html: string | null | undefined): string {
  let s = String(html ?? '');
  if (!s) return '';

  // Balises à contenu : on boucle, car un `<scr<script>ipt>` imbriqué se
  // reconstitue après un seul passage.
  for (const balise of BALISES_A_VIDER) {
    const motif = new RegExp(`<${balise}\\b[^>]*>[\\s\\S]*?<\\/${balise}\\s*>`, 'gi');
    let avant: string;
    do { avant = s; s = s.replace(motif, ''); } while (s !== avant);
    // Balise ouvrante ou fermante orpheline (jamais refermée) : on retire aussi.
    s = s.replace(new RegExp(`<\\/?${balise}\\b[^>]*>`, 'gi'), '');
  }

  // Commentaires, y compris les conditionnels Outlook.
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  // Gestionnaires d'évènements, quelle que soit la façon de citer la valeur.
  let avantAttributs: string;
  do {
    avantAttributs = s;
    s = s.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  } while (s !== avantAttributs);

  /* Schémas d'URL exécutables. `java\nscript:` est une esquive connue : on
     enlève les blancs, les caractères de contrôle et les entités entre les
     lettres avant de comparer — un navigateur les ignore dans un schéma.

     Cette classe s'écrivait `[\s -]` mais contenait, dans le fichier, deux
     caractères de CONTRÔLE littéraux (0x00 et 0x1f) à la place de l'espace et
     du tiret : un éditeur les avait avalés, et le fichier passait pour binaire
     aux yeux de grep. Elle valait donc `[\s\x00-\x1f]`.

     Vérifié avant de la réécrire : elle couvrait PLUS que prévu, et ne
     laissait passer aucun schéma exécutable. Seul `java-script:` passait, ce
     qu'aucun navigateur n'exécute. Le comportement ne change pas ; la ligne se
     relit, simplement. */
  s = s.replace(/\b(href|src|xlink:href|action|background|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (complet, attribut: string, doubles?: string, simples?: string, nu?: string) => {
      const valeur = doubles ?? simples ?? nu ?? '';
      const aplatie = valeur.replace(/[\s\x00-\x1f]|&#x?0*(9|a|d|10|13);?/gi, '').toLowerCase();
      const dangereuse = /^(javascript|vbscript|livescript):/.test(aplatie)
        || /^data:(?!image\/(png|jpe?g|gif|webp|svg\+xml);)/.test(aplatie);
      return dangereuse ? `${attribut}="#"` : complet;
    });

  s = encadrerImages(s);

  return s.trim();
}

/**
 * Les images d'un HTML importé, mises au pas.
 *
 * Trois problèmes, dans l'ordre de gravité :
 *
 * 1. LE PIXEL ESPION. Une image de 1×1 pointant vers un domaine tiers suit le
 *    client à son insu. Ce n'est pas notre suivi, l'entreprise ne l'a souvent
 *    pas voulu (elle a copié un gabarit trouvé ailleurs), et c'est son client
 *    qui en porte la conséquence. On les retire.
 *
 * 2. LA SOURCE INUTILISABLE. `file://` pointe sur le disque de l'expéditeur et
 *    `//exemple.ca` hérite du schéma de la page — dans un courriel il n'y en a
 *    pas. Les deux donnent une image cassée chez le client.
 *
 * 3. LA LARGEUR. Une image de 900 px déborde d'un courriel de 600 px et casse
 *    la mise en page sur téléphone. On la borne sans la déformer.
 *
 * On ne retire PAS une image faute de texte alternatif : elle est peut-être
 * l'essentiel du message. On en pose un vide, qui dit aux lecteurs d'écran de
 * la passer plutôt que d'ânonner une adresse.
 */
function encadrerImages(html: string): string {
  return html.replace(/<img[^>]*>/gi, (balise) => {
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(balise);
    const valeur = (src?.[1] ?? src?.[2] ?? src?.[3] ?? '').trim();

    // Source absente, ou inutilisable dans un courriel.
    if (!valeur || /^file:/i.test(valeur) || valeur.startsWith('//')) return '';

    // Pixel espion : 1×1 déclaré en attribut ou en style.
    const minuscule = /\s(width|height)\s*=\s*["']?[01]["']?/i.test(balise)
      || /(width|height)\s*:\s*[01](px)?\s*[;"']/i.test(balise);
    if (minuscule) return '';

    let sortie = balise;

    // Un texte alternatif, même vide : sans lui un lecteur d'écran lit l'URL.
    if (!/\salt\s*=/i.test(sortie)) sortie = sortie.replace(/<img/i, '<img alt=""');

    // Bornage : on AJOUTE aux styles existants, on ne les remplace pas.
    const borne = 'max-width:100%;height:auto';
    if (/\sstyle\s*=\s*"/i.test(sortie)) {
      sortie = sortie.replace(/(\sstyle\s*=\s*")/i, `$1${borne};`);
    } else if (/\sstyle\s*=\s*'/i.test(sortie)) {
      sortie = sortie.replace(/(\sstyle\s*=\s*')/i, `$1${borne};`);
    } else {
      sortie = sortie.replace(/<img/i, `<img style="${borne}"`);
    }

    return sortie;
  });
}

/**
 * Le texte d'un modèle devient du HTML. Un modèle « éditeur » est du texte
 * brut : on échappe et on convertit les sauts de ligne — sinon un `<` tapé par
 * l'entreprise casserait le courriel. Un modèle « import » est déjà du HTML :
 * on l'assainit.
 */
function corpsEnHtml(corps: string, source: string): string {
  if (source === 'import') return assainirHtmlCourriel(corps);
  // Le texte d'éditeur peut déjà contenir du balisage simple si l'interface en
  // pose (gras, liens) : on l'assainit aussi, mais sans échapper — échapper
  // afficherait « <strong> » en toutes lettres au client.
  const paraitHtml = /<\/?(p|br|div|strong|b|em|i|u|a|ul|ol|li|h[1-6]|span|table)\b/i.test(corps);
  if (paraitHtml) return assainirHtmlCourriel(corps);
  return corps
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
    .replace(/\r\n|\r|\n/g, '<br/>');
}

/**
 * Le modèle que l'entreprise a défini pour ce type de courriel, variables
 * remplacées — ou `null` si elle n'en a pas.
 *
 * `null` est le cas NORMAL et il est capital : l'appelant garde alors son texte
 * d'origine, donc brancher cette fonction ne change rien pour une org qui n'a
 * jamais ouvert la page Modèles.
 *
 * Toute erreur de lecture renvoie aussi `null` : un modèle illisible ne doit
 * jamais empêcher une facture de partir. On journalise, on n'interrompt pas.
 *
 * @param orgId     Garde-fou tenant — on filtre TOUJOURS dessus. Sans lui, un
 *                  service_role lirait le modèle d'une autre entreprise.
 * @param type      Un des types du CHECK de `email_templates.type`.
 * @param variables `{client_name}`, `{invoice_number}`… ; une variable absente
 *                  devient une chaîne vide (comportement d'`applyTemplate`).
 */
export async function texteDuCourriel(
  orgId: string,
  type: string,
  variables: Record<string, string | null | undefined> = {},
  client?: SupabaseClient,
  /** Fiches dont les champs personnalisés peuvent être cités ({invoice_cf_…}, {client_cf_…}). */
  refsChamps?: Partial<Record<'client' | 'deal' | 'job' | 'quote' | 'invoice', string | null>>,
): Promise<TexteCourriel | null> {
  if (!orgId || !type) return null;

  try {
    const db = client ?? getServiceClient();
    const { data, error } = await db
      .from('email_templates')
      .select('subject, body, source')
      .eq('org_id', orgId) // garde-fou tenant : jamais le modèle d'une autre org
      .eq('type', type)
      .eq('is_active', true)
      // Ceinture et bretelles : l'index unique partiel garantit une seule ligne,
      // mais tant qu'il n'est pas appliqué partout, `limit(1)` évite que
      // `maybeSingle()` échoue sur un doublon et tue la personnalisation en silence.
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      logger.error('[courriels/modeles] lecture du modèle impossible, texte d’origine conservé', {
        orgId, type, error: error.message,
      });
      return null;
    }

    const modele = data?.[0];
    if (!modele) return null;

    // Champs personnalisés : lus SEULEMENT si le modèle en cite un — aucun
    // coût pour les modèles qui n'en utilisent pas.
    if (refsChamps && /_cf_|\{\{\s*[a-z]+\.[a-z]/.test(`${modele.subject ?? ''} ${modele.body ?? ''}`)) {
      try {
        const { data: cs } = await db.from('company_settings').select('default_language').eq('org_id', orgId).maybeSingle();
        variables = { ...(await variablesChamps(db, orgId, refsChamps, cs?.default_language === 'en' ? 'en' : 'fr')), ...variables };
      } catch (err: unknown) {
        logger.error('[courriels/modeles] champs personnalisés illisibles, variables laissées vides', {
          orgId, type, error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const sujet = applyTemplate(String(modele.subject ?? ''), variables).trim();
    const corps = applyTemplate(String(modele.body ?? ''), variables);
    const corpsHtml = corpsEnHtml(corps, String(modele.source ?? 'editeur'));

    // Un modèle vide des deux côtés ne vaut pas mieux que pas de modèle : on
    // retombe sur le texte d'origine plutôt que d'envoyer un courriel vide.
    if (!sujet && !corpsHtml.trim()) return null;

    return { sujet, corpsHtml };
  } catch (err: unknown) {
    logger.error('[courriels/modeles] résolution du modèle en échec, texte d’origine conservé', {
      orgId, type, error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
