/**
 * A — Rendu des variables et du courriel.
 *
 *  · `resolveTemplate` (server/lib/actions/index.ts) : TOUT message
 *    d'automatisation (courriel, texto, notification, tâche) ;
 *  · `applyTemplate` (server/lib/notificationHelpers.ts) : modèles de
 *    courriel et relances de paiement ;
 *  · aperçus de l'éditeur (`remplacerVariables`, `remplacerParExemples`) :
 *    ce que l'entreprise croit que son client recevra ;
 *  · post-traitements (`sansPrenomVide`, `accorderPluriels`, `echapperHtml`)
 *    et enveloppe du courriel (`buildEmailLayout` → `rendreCourrielClient`).
 *
 * Unitaire pur : aucune base, aucun réseau, aucun envoi.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveTemplate, echapperHtml, sansPrenomVide, accorderPluriels,
} from '../../../server/lib/actions/index';
import { applyTemplate } from '../../../server/lib/notificationHelpers';
import { buildEmailLayout } from '../../../server/routes/emails';
import { rendreCourrielClient, preheaderDepuis, echapper, couleurBouton } from '../../../server/lib/courriels/gabarit';
import { remplacerVariables, variablesInconnues } from '../../../src/lib/emailBodyText';
import { remplacerParExemples } from '../../../src/lib/variablesCourriel';

const VARS: Record<string, string | null | undefined> = {
  client_first_name: 'Marie',
  client_name: 'Marie Tremblay',
  company_name: 'Lavage Côté & Fils',
  quote_number: 'SOU-218',
  'client.nom': 'Marie Tremblay',
  client_cf_nom: 'CHAMP PERSO NOM',
  client_cf_type_toiture: 'Bardeau',
  deal_cf_budget: '12 000 $',
  vide: '',
  nul: null,
  contract_html: '<p>Contrat : <a href="https://x.test/c/1">signer</a></p>',
};

const r = (t: string, v: Record<string, string | null | undefined> = VARS, html = false) => resolveTemplate(t, v, { html });

// ─────────────────────────────────────────────────────────────
describe('A-180…A-189 — formats de variables reconnus', () => {
  it.each([
    ['A-180', '[client_first_name]', 'Marie'],
    ['A-180', '{client_first_name}', 'Marie'],
    ['A-181', '{{client.nom}}', 'Marie Tremblay'],
    ['A-181', '{{ client.nom }}', 'Marie Tremblay'],
    ['A-182', '{{client.type_toiture}}', 'Bardeau'],
    ['A-182', '{{deal.budget}}', '12 000 $'],
    ['A-183', 'Bonjour [client_first_name] de {company_name}, soumission {{client.nom}} [quote_number].',
      'Bonjour Marie de Lavage Côté & Fils, soumission Marie Tremblay SOU-218.'],
    // Format répandu (Mailchimp, Lumi : « Variables like {{client_name}} ») :
    // rendu « {Marie} » avant la correction — accolades orphelines chez le client.
    ['A-184', '{{client_first_name}}', 'Marie'],
    ['A-184', 'Bonjour {{ client_first_name }},', 'Bonjour Marie,'],
  ])('[%s] « %s » → « %s »', (_id, gabarit, attendu) => {
    expect(r(gabarit)).toBe(attendu);
  });

  it('[A-185] une variable pointée intégrée passe AVANT le champ perso de même clé', () => {
    expect(r('{{client.nom}}')).toBe('Marie Tremblay');
    expect(r('{{client.nom}}', { client_cf_nom: 'Perso' })).toBe('Perso');
  });

  it.each([
    ['A-186', 'inconnue entre crochets', 'Bonjour [prenom].', 'Bonjour .'],
    ['A-186', 'inconnue entre accolades', 'N° {invoice_number}', 'N° '],
    ['A-186', 'champ perso inconnu', '{{client.inconnu}}', ''],
    ['A-186', 'valeur vide', '[vide]x', 'x'],
    ['A-186', 'valeur null', '[nul]x', 'x'],
  ])('[%s] %s → effacée (« %s » → « %s »)', (_id, _l, gabarit, attendu) => {
    expect(r(gabarit)).toBe(attendu);
  });

  it.each([
    ['A-187', 'Rabais [50] %', 'Rabais [50] %'],
    ['A-187', 'Étape {0} de {3}', 'Étape {0} de {3}'],
    ['A-187', 'Option [2b]', 'Option [2b]'],
    ['A-187', 'Réf. [123_abc]', 'Réf. [123_abc]'],
  ])('[%s] une « clé » qui commence par un chiffre n\'est pas une variable : « %s » intact', (_id, gabarit, attendu) => {
    expect(r(gabarit)).toBe(attendu);
    expect(r(gabarit, VARS, true)).toBe(attendu);
  });

  it.each([
    ['A-188', '{{Client.Nom}}'], ['A-188', '{{client.}}'], ['A-188', '{{.nom}}'], ['A-188', '{ client_name }'],
    ['A-188', '[client name]'], ['A-188', '{{client.nom-complet}}'],
  ])('[%s] syntaxe non reconnue « %s » : laissée telle quelle (visible, donc corrigeable)', (_id, gabarit) => {
    expect(r(gabarit)).toBe(gabarit);
  });

  it('[A-189] UNE seule passe : une valeur qui contient une variable n\'est jamais relue', () => {
    const v = { client_first_name: '[client_email] {company_name} {{client.nom}}', client_email: 'fuite@x.test', company_name: 'X' };
    expect(r('Bonjour [client_first_name]', v)).toBe('Bonjour [client_email] {company_name} {{client.nom}}');
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-190…A-199 — clés du prototype : jamais Object.prototype', () => {
  const pieges = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '__defineGetter__'];
  it.each(pieges.flatMap((k) => [`[${k}]`, `{${k}}`, `{{${k}}}`].map((g) => ['A-190', g] as const)))(
    '[%s] « %s » → vide, sans lever (texte)', (_id, gabarit) => {
      expect(r(`a${gabarit}b`)).toBe('ab');
    },
  );
  it.each(pieges.flatMap((k) => [`[${k}]`, `{${k}}`].map((g) => ['A-191', g] as const)))(
    '[%s] « %s » → vide, sans lever (corps HTML du courriel)', (_id, gabarit) => {
      expect(() => r(`a${gabarit}b`, VARS, true)).not.toThrow();
      expect(r(`a${gabarit}b`, VARS, true)).toBe('ab');
    },
  );
  it('[A-192] {{client.constructor}} ne lit pas le prototype non plus', () => {
    expect(r('{{client.constructor}}|{{client.valueof}}')).toBe('|');
    // `__proto__` ne commence pas par une lettre : pas une variable pointée, le texte reste.
    expect(r('{{client.__proto__}}')).toBe('{{client.__proto__}}');
  });
  it('[A-193] applyTemplate garde la clé inconnue telle quelle, même un nom du prototype', () => {
    expect(applyTemplate('[constructor] {toString} {{hasOwnProperty}}', {})).toBe('[constructor] {toString} {{hasOwnProperty}}');
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-200…A-209 — contenu des valeurs : accents, spéciaux, emojis, longueur', () => {
  it.each([
    ['A-200', 'accents FR', 'é è ê ë ç à â ô œ Œ ù û ï « » ’ – —'],
    ['A-201', 'emojis simples', '🧽🪣✨'],
    ['A-201', 'emojis multi-codepoint (ZWJ, drapeaux, teintes)', '👩‍🔧 👨‍👩‍👧‍👦 🇨🇦 👍🏽'],
    ['A-202', 'motifs spéciaux de String.replace', '$& $1 $$ $` $\''],
    ['A-202', 'antislash et accolades', '\\ { } [ ] \\n'],
    ['A-203', 'texte très long (10 000+ caractères)', 'Lavage '.repeat(1_500)],
    ['A-203', 'retours de ligne', 'ligne 1\nligne 2\r\nligne 3'],
  ])('[%s] %s : insérée telle quelle en texte', (_id, _l, valeur) => {
    expect(r('<[x]>', { x: valeur })).toBe(`<${valeur}>`);
    expect(r('<{x}>', { x: valeur })).toBe(`<${valeur}>`);
  });

  it('[A-204] gabarit très long avec beaucoup de variables : toutes remplacées', () => {
    const gabarit = 'Bonjour [client_first_name]. '.repeat(2_000);
    const rendu = r(gabarit);
    expect(rendu).toBe('Bonjour Marie. '.repeat(2_000));
    expect(rendu.length).toBeGreaterThan(10_000);
  });

  it('[A-205] accents dans le GABARIT (texte de l\'entreprise) conservés', () => {
    expect(r('Allô [client_first_name], votre « soumission » n’attend que vous — à bientôt !'))
      .toBe('Allô Marie, votre « soumission » n’attend que vous — à bientôt !');
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-210…A-219 — échappement HTML (corps du courriel)', () => {
  it.each([
    ['A-210', '<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    ['A-210', '<a href="https://hameconnage.test">Payez ici</a>', '&lt;a href=&quot;https://hameconnage.test&quot;&gt;Payez ici&lt;/a&gt;'],
    ['A-211', `Tom & Jerry's "Lavage"`, 'Tom &amp; Jerry&#39;s &quot;Lavage&quot;'],
    ['A-211', '&amp;', '&amp;amp;'],
    ['A-212', '<img src=x onerror=alert(1)>', '&lt;img src=x onerror=alert(1)&gt;'],
  ])('[%s] valeur %j → %j', (_id, valeur, attendu) => {
    expect(r('<p>[x]</p>', { x: valeur }, true)).toBe(`<p>${attendu}</p>`);
    expect(r('<p>{{client.x}}</p>', { client_cf_x: valeur }, true)).toBe(`<p>${attendu}</p>`);
    expect(echapperHtml(valeur)).toBe(attendu);
  });

  it('[A-213] sans html:true (texto, objet, notification) : aucune entité', () => {
    expect(r('[x]', { x: `Côté & Fils <inc> "l'as"` })).toBe(`Côté & Fils <inc> "l'as"`);
  });

  it('[A-214] [contract_html] (HTML produit par Lume) reste du HTML', () => {
    expect(r('[contract_html]', VARS, true)).toBe(VARS.contract_html);
  });

  // Un champ perso de clé « …_html » (« Notes HTML » → notes_html, clé
  // permise) échappait à l'échappement : injection dans le courriel.
  it.each([
    ['A-215', '{{client.notes_html}}', { client_cf_notes_html: '<script>alert(1)</script>' }],
    ['A-215', '{client_cf_notes_html}', { client_cf_notes_html: '<script>alert(1)</script>' }],
    ['A-215', '[deal_cf_lien_html]', { deal_cf_lien_html: '<a href="https://hameconnage.test">Payer</a>' }],
    ['A-215', '[autre_html]', { autre_html: '<b>x</b>' }],
  ])('[%s] %s (champ perso en _html) est ÉCHAPPÉ', (_id, gabarit, v) => {
    const rendu = r(gabarit, v as Record<string, string>, true);
    expect(rendu).not.toMatch(/<(script|a|b)\b/);
    expect(rendu).toContain('&lt;');
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-220…A-229 — le courriel ENVOYÉ (enveloppe complète)', () => {
  const entreprise = { company_name: 'Lavage "Côté" & Fils <inc>', company_phone: '(514) 555-0142', company_email: 'info@cote.test', brand_color: '#0b5cad', default_language: 'fr' };

  it('[A-220] une valeur piégée dans le corps arrive échappée dans le HTML final', () => {
    const corps = r('<p>Bonjour [client_first_name],</p><p>{{client.notes}}</p>', {
      client_first_name: '<script>alert("x")</script>',
      client_cf_notes: '<img src=x onerror=alert(1)>',
    }, true);
    const html = buildEmailLayout(entreprise, corps);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('[A-221] le nom de l\'entreprise est échappé partout (en-tête, <title>, pied)', () => {
    const html = buildEmailLayout(entreprise, '<p>Bonjour</p>');
    expect(html).not.toContain('<inc>');
    expect(html).toContain('Lavage &quot;Côté&quot; &amp; Fils &lt;inc&gt;');
  });

  it('[A-222] accents et emojis du corps survivent à l\'enveloppe', () => {
    const corps = r('<p>Allô [client_first_name] 🧽 — « ça brille » ! Œuvre à 9 h.</p>', { client_first_name: 'Zoé 👩‍🔧' }, true);
    const html = buildEmailLayout(entreprise, corps);
    expect(html).toContain('Allô Zoé 👩‍🔧 🧽 — « ça brille » ! Œuvre à 9 h.');
    expect(html).toContain('<html lang="fr"');
  });

  it('[A-223] l\'aperçu de la boîte de réception ne montre pas d\'entités brutes (&quot; &lt;)', () => {
    const corps = r('<p>Votre soumission pour [x] est prête.</p>', { x: 'le "Grand" ménage <2026>' }, true);
    const apercu = preheaderDepuis(corps);
    expect(apercu).toBe('Votre soumission pour le "Grand" ménage <2026> est prête.');
    // Et dans le HTML final, l'aperçu est ré-échappé une seule fois.
    const html = rendreCourrielClient({ langue: 'fr', marque: { nom: 'X' }, corpsHtml: corps, signature: null });
    expect(html).toContain('le &quot;Grand&quot; ménage &lt;2026&gt; est prête.');
    expect(html).not.toContain('&amp;quot;');
    expect(html).not.toContain('&amp;lt;');
  });

  it('[A-224] un logo ou un lien social piégé ne sort pas de son attribut', () => {
    const html = rendreCourrielClient({
      langue: 'en', marque: { nom: 'X', logoUrl: 'https://x.test/l.png" onerror="alert(1)', couleur: 'red;background:url(x)' },
      corpsHtml: '<p>Hi</p>',
    });
    expect(html).not.toContain('" onerror="');
    expect(html).toContain('&quot; onerror=&quot;');
    expect(html).not.toContain('red;background');
    expect(html).toContain('<html lang="en"');
  });

  it.each([['#ffffff', '#111827'], ['#ffff00', '#111827'], ['#0b5cad', '#0b5cad'], ['0B5CAD', '#0b5cad'], ['bleu', '#111827'], [null, '#111827']])(
    '[A-225] couleur de marque %j → bouton %s (contraste avec le blanc)', (c, attendu) => {
      expect(couleurBouton(c)).toBe(attendu);
    },
  );

  it('[A-226] echapper (gabarit) = echapperHtml (actions) sur les 5 caractères', () => {
    const s = `& < > " '`;
    expect(echapper(s)).toBe(echapperHtml(s));
    expect(echapper(null)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-230…A-239 — post-traitements : sansPrenomVide, accorderPluriels', () => {
  it.each([
    ['A-230', 'Bonjour ,', 'Bonjour,'],
    ['A-230', 'Bonjour  ,', 'Bonjour,'],
    ['A-230', 'Hi , thanks', 'Hi, thanks'],
    ['A-230', 'Merci !', 'Merci!'],
    ['A-230', 'Bonjour Marie,', 'Bonjour Marie,'],
    ['A-231', 'Plomberie Tremblay inc..', 'Plomberie Tremblay inc.'],
    ['A-231', 'À bientôt...', 'À bientôt...'],
    ['A-231', 'Côté..', 'Côté.'],
    ['A-232', '<h2>Bonjour ,</h2>', '<h2>Bonjour,</h2>'],
  ])('[%s] sansPrenomVide(%j) = %j', (_id, entree, attendu) => {
    expect(sansPrenomVide(entree)).toBe(attendu);
  });

  it('[A-233] un prénom vide dans un vrai gabarit ne laisse pas « Bonjour , »', () => {
    expect(sansPrenomVide(r('Bonjour [client_first_name], merci.', { client_first_name: '' }))).toBe('Bonjour, merci.');
  });

  it.each([
    ['A-234', 'fr', '0 vue(s)', '0 vue'], ['A-234', 'fr', '1 vue(s)', '1 vue'], ['A-234', 'fr', '2 vue(s)', '2 vues'],
    ['A-234', 'fr', '1 000 vue(s)', '1 000 vues'], ['A-234', 'fr', 'Ouverte 12 fois, 3 jour(s)', 'Ouverte 12 fois, 3 jours'],
    ['A-235', 'en', '0 view(s)', '0 views'], ['A-235', 'en', '1 view(s)', '1 view'], ['A-235', 'en', '2 view(s)', '2 views'],
    ['A-236', 'fr', 'vue(s) sans nombre', 'vue(s) sans nombre'], ['A-236', 'fr', '3 équipe(s)', '3 équipes'],
  ])('[%s] accorderPluriels(%s, %j) = %j', (_id, langue, entree, attendu) => {
    expect(accorderPluriels(entree, langue as 'fr' | 'en')).toBe(attendu);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-240…A-249 — les autres moteurs de rendu disent la même chose', () => {
  it.each([
    ['A-240', '{client_first_name}', 'Marie'],
    ['A-240', '[client_first_name]', 'Marie'],
    ['A-240', '{{client.type_toiture}}', 'Bardeau'],
    ['A-241', '{{client_first_name}}', 'Marie'],
    ['A-242', 'Rabais [50] %', 'Rabais [50] %'],
    ['A-243', '[inconnue] {faute_de_frappe}', '[inconnue] {faute_de_frappe}'],
    ['A-243', '[vide]', ''],
  ])('[%s] applyTemplate « %s » → « %s »', (_id, gabarit, attendu) => {
    expect(applyTemplate(gabarit, VARS)).toBe(attendu);
  });

  it('[A-244] aperçu de l\'éditeur d\'automatisation : {{client_first_name}} montre « Marie », pas « {Marie} »', () => {
    expect(remplacerVariables('Bonjour {{client_first_name}}, [client_first_name], {client_first_name}'))
      .toBe('Bonjour Marie, Marie, Marie');
  });

  it('[A-245] aperçu des modèles de courriel : {{client_name}} montre l\'exemple, pas « {…} »', () => {
    const rendu = remplacerParExemples('Bonjour {{client_name}}', undefined, true);
    expect(rendu).not.toMatch(/[{}]/);
  });

  it('[A-246] le détecteur de l\'éditeur accepte {{client_first_name}} (donc le serveur doit le rendre)', () => {
    expect(variablesInconnues('Bonjour {{client_first_name}}')).toEqual([]);
    expect(variablesInconnues('Bonjour [prenom]')).toEqual(['prenom']);
  });
});
