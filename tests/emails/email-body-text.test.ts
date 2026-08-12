/**
 * Conversion HTML ↔ texte pour l'éditeur de courriels.
 *
 * Les corps sont stockés en HTML — nécessaire pour l'envoi, illisible pour qui
 * veut changer une phrase. L'utilisateur voyait :
 *
 *   <div style="font-family:sans-serif;max-width:600px;..."><h2>Bonjour
 *   [client_first_name],</h2><p>On voulait faire un dernier suivi...</p></div>
 *
 * La conversion doit être RÉVERSIBLE : un aller-retour ne doit rien perdre du
 * texte, sinon éditer un courriel le dégraderait à chaque enregistrement.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { htmlVersTexte, texteVersHtml, remplacerVariables } from '../../src/lib/emailBodyText';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('HTML → texte lisible', () => {
  it('retire l’enveloppe et les styles', () => {
    const html = '<div style="font-family:sans-serif;max-width:600px;"><h2>Bonjour Marie,</h2><p>Merci.</p></div>';
    expect(htmlVersTexte(html)).toBe('Bonjour Marie,\nMerci.');
  });

  it('conserve les variables intactes', () => {
    // Une variable abîmée par la conversion produirait un trou dans le
    // message reçu par le client.
    const html = '<div><h2>Bonjour [client_first_name],</h2><p>De [company_name]</p></div>';
    const t = htmlVersTexte(html);
    expect(t).toContain('[client_first_name]');
    expect(t).toContain('[company_name]');
  });

  it('transforme une liste en lignes à puces', () => {
    const html = '<ul><li>Premier point</li><li>Second point</li></ul>';
    expect(htmlVersTexte(html)).toBe('- Premier point\n- Second point');
  });

  it('garde l’adresse d’un lien', () => {
    const html = '<p>Payez ici : <a href="https://exemple.ca/pay">cliquez</a></p>';
    expect(htmlVersTexte(html)).toContain('https://exemple.ca/pay');
  });

  it('ne laisse aucune balise dans le champ d’édition', () => {
    const html = '<div><h2>Titre</h2><p>Texte <strong>gras</strong><br/>suite</p></div>';
    expect(htmlVersTexte(html)).not.toMatch(/<[^>]+>/);
  });

  it('décode les entités', () => {
    expect(htmlVersTexte('<p>Vitres &amp; gouttières</p>')).toBe('Vitres & gouttières');
  });
});

describe('texte → HTML', () => {
  it('la première ligne devient le titre', () => {
    const html = texteVersHtml('Bonjour Marie,\nMerci de votre confiance.');
    expect(html).toContain('<h2');
    expect(html).toContain('Bonjour Marie,');
    expect(html).toContain('<p');
  });

  it('les puces redeviennent une liste', () => {
    const html = texteVersHtml('Titre\n- Un\n- Deux');
    expect(html).toContain('<ul');
    expect(html).toContain('<li>Un</li>');
  });

  it('une adresse devient cliquable', () => {
    const html = texteVersHtml('Titre\nPayez ici : https://exemple.ca/pay');
    expect(html).toContain('<a href="https://exemple.ca/pay"');
  });

  it('le HTML saisi par l’utilisateur est échappé', () => {
    // Sans échappement, coller du balisage dans le champ l'injecterait dans le
    // courriel envoyé au client.
    const html = texteVersHtml('Titre\n<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('un texte vide produit une enveloppe vide, pas du HTML cassé', () => {
    expect(texteVersHtml('   ')).toBe(
      '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"></div>',
    );
  });
});

describe('aller-retour — rien ne se perd', () => {
  it('les 24 courriels des presets survivent à la conversion', () => {
    // C'est le test qui compte : éditer un courriel ne doit pas le dégrader.
    const s = read('server/lib/automationPresets.data.ts');
    const debut = s.indexOf('= [', s.indexOf('AUTOMATION_PRESETS')) + 2;
    const presets = JSON.parse(s.slice(debut, s.lastIndexOf('];') + 1));

    let testes = 0;
    for (const p of presets) {
      for (const a of p.actions || []) {
        if (a.type !== 'send_email' || !a.config?.body) continue;
        testes++;
        const texte = htmlVersTexte(a.config.body);
        const retour = htmlVersTexte(texteVersHtml(texte));
        expect(
          retour.replace(/\s+/g, ' '),
          `perte de contenu sur ${p.preset_key}`,
        ).toBe(texte.replace(/\s+/g, ' '));
      }
    }
    expect(testes).toBeGreaterThan(15);
  });
});

describe('aperçu — ce que le client verra', () => {
  it('les variables sont remplacées par un exemple', () => {
    // « Bonjour [client_first_name] » ne dit rien à l'utilisateur : il doit
    // voir « Bonjour Marie ».
    const t = remplacerVariables('Bonjour [client_first_name], de [company_name]');
    expect(t).toBe('Bonjour Marie, de Votre entreprise');
  });

  it('une variable inconnue reste visible telle quelle', () => {
    // Mieux vaut afficher le nom brut que de le faire disparaître : c'est le
    // signe que la variable n'existe pas.
    expect(remplacerVariables('Valeur : [variable_inventee]')).toContain('[variable_inventee]');
  });

  it('chaque variable proposée dans l’éditeur a un exemple', () => {
    const editeur = read('src/components/automations/MessageEditor.tsx');
    const bloc = editeur.slice(editeur.indexOf('const VARIABLES'), editeur.indexOf('];', editeur.indexOf('const VARIABLES')));
    const cles = [...bloc.matchAll(/cle: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(cles.length).toBeGreaterThan(5);
    for (const c of cles) {
      expect(
        remplacerVariables(`[${c}]`),
        `variable proposée sans exemple d'aperçu : ${c}`,
      ).not.toBe(`[${c}]`);
    }
  });

  it('chaque variable proposée est fournie par le moteur', () => {
    // Proposer une variable que le serveur ne remplit pas insérerait un trou
    // dans le message réellement envoyé.
    const editeur = read('src/components/automations/MessageEditor.tsx');
    const actions = read('server/lib/actions/index.ts');
    const bloc = editeur.slice(editeur.indexOf('const VARIABLES'), editeur.indexOf('];', editeur.indexOf('const VARIABLES')));
    const cles = [...bloc.matchAll(/cle: '([a-z_]+)'/g)].map((m) => m[1]);
    for (const c of cles) {
      expect(actions, `variable proposée mais jamais résolue : ${c}`).toContain(`vars.${c}`);
    }
  });
});

describe('éditeur — plus de HTML à l’écran', () => {
  const message = read('src/components/automations/MessageEditor.tsx');
  const apercu = read('src/components/automations/EmailPreviewEditor.tsx');

  it('le courriel s’édite en texte, pas en HTML', () => {
    // La conversion vit dans l'éditeur pleine page : le courriel s'ouvre dans
    // sa propre fenêtre, où il s'affiche comme le client le recevra.
    expect(apercu).toContain('htmlVersTexte(body)');
    expect(apercu).toContain('texteVersHtml(');
  });

  it('le HTML n’est reconstruit qu’à l’enregistrement', () => {
    // L'utilisateur ne doit jamais le voir.
    expect(apercu).toContain("updateRuleMessage(ruleId, 'send_email', texteVersHtml(blocsEnTexte(blocs)), objet)");
  });

  it('le courriel s’édite bloc par bloc, pas dans un champ unique', () => {
    // Chaque paragraphe est modifiable sur place, dans le rendu.
    expect(apercu).toContain('interface Bloc');
    expect(apercu).toContain("type: 'titre' | 'paragraphe' | 'puce'");
    expect(apercu).toContain('function texteEnBlocs');
  });

  it('un aperçu montre le rendu avec des données d’exemple', () => {
    expect(apercu).toContain('remplacerVariables');
    expect(apercu).toContain('Ce que le client lira');
  });

  it('les variables sont nommées en clair, pas en jargon', () => {
    // « Prénom du client » plutôt que « [client_first_name] ».
    for (const src of [message, apercu]) {
      expect(src).toContain("fr: 'Prénom du client'");
      expect(src).toContain("fr: 'N° de facture'");
    }
  });

  it('le SMS garde son compteur de caractères', () => {
    expect(message).toContain('Math.ceil(texte.length / 160)');
  });
});

// ───────────────────────────────────────────────────────────────────
// L'éditeur pleine page : on tape dans le courriel lui-même
// ───────────────────────────────────────────────────────────────────

describe('éditeur pleine page — le courriel s’édite dans son rendu', () => {
  const ed = read('src/components/automations/EmailPreviewEditor.tsx');

  it('chaque bloc de texte est un champ modifiable sur place', () => {
    // Pas un gros champ de texte à côté d'un aperçu : le courriel EST
    // l'éditeur. On clique sur la phrase, on la corrige.
    expect(ed).toContain('const Champ = ({ bloc }');
    expect(ed).toContain('majBloc(bloc.id, e.target.value)');
    expect(ed).toContain('bloc.type === \'titre\'');
  });

  it('on peut ajouter et retirer des lignes', () => {
    expect(ed).toContain('ajouterBloc');
    expect(ed).toContain('supprimerBloc');
    expect(ed).toContain("ajouterBloc('puce')");
  });

  it('l’objet du courriel se modifie au même endroit', () => {
    expect(ed).toContain('setObjet(e.target.value)');
  });

  it('les champs s’ajustent à la hauteur du texte', () => {
    // Un texte long ne doit jamais être coupé dans un champ d'une ligne.
    expect(ed).toContain('el.style.height = `${el.scrollHeight}px`');
  });

  it('Échap ferme la fenêtre', () => {
    expect(ed).toContain("e.key === 'Escape'");
    expect(ed).toContain('removeEventListener');
  });

  it('un clic dans la fenêtre ne la referme pas', () => {
    // Le fond ferme au clic ; le contenu doit arrêter la propagation.
    expect(ed).toContain('onClick={(e) => e.stopPropagation()}');
  });

  it('l’état non enregistré est signalé', () => {
    expect(ed).toContain('Modifications non enregistrées');
  });

  it('la conversion bloc ↔ texte est réversible', () => {
    expect(ed).toContain('function texteEnBlocs');
    expect(ed).toContain('function blocsEnTexte');
    // Une puce reprend son préfixe pour survivre à l'aller-retour.
    expect(ed).toContain("b.type === 'puce' ? `- ${b.texte}`");
  });
});

// ───────────────────────────────────────────────────────────────────
// L'aperçu montre l'habillage réel — logo, en-tête, pied de page
// ───────────────────────────────────────────────────────────────────

describe('aperçu — le courriel s’affiche habillé, comme une facture', () => {
  const ed = read('src/components/automations/EmailPreviewEditor.tsx');
  const api = read('src/lib/automationRulesApi.ts');

  it('le logo et le nom de l’entreprise sont affichés', () => {
    // Le serveur enveloppe chaque envoi dans `buildEmailLayout` — même
    // traitement que les factures et devis. Sans l'afficher, on écrirait un
    // message « nu » sans voir qu'il arrive habillé.
    expect(ed).toContain('entreprise.company_logo_url');
    expect(ed).toContain('entreprise.company_name');
    expect(ed).toContain('getCompanyBranding');
  });

  it('le pied de page reprend celui du serveur', () => {
    // « Sent via LUME on behalf of X » + téléphone : le voir évite de répéter
    // la signature en fin de message.
    expect(ed).toContain('Envoyé via');
    expect(ed).toContain('entreprise.company_phone');
  });

  it('l’origine de l’habillage est expliquée à l’utilisateur', () => {
    expect(ed).toContain('vos réglages d’entreprise');
  });

  it('un aperçu sans logo reste utilisable', () => {
    // Une org sans logo ne doit pas voir l'éditeur bloqué.
    expect(ed).toContain("aperçu sans logo : pas bloquant");
    const fn = api.slice(api.indexOf('export async function getCompanyBranding'));
    expect(fn).toContain('if (error || !data) return vide;');
  });

  it('le branding est lu pour l’org courante seulement', () => {
    const fn = api.slice(api.indexOf('export async function getCompanyBranding'));
    expect(fn).toContain("eq('org_id', orgId)");
  });

  it('les colonnes lues existent bien dans company_settings', () => {
    // `logo_url` et `phone` — pas `company_logo_url` ni `company_phone`, qui
    // sont les noms côté serveur après transformation.
    const fn = api.slice(api.indexOf('export async function getCompanyBranding'));
    expect(fn).toContain("select('company_name, logo_url, phone')");
  });
});
