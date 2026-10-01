/**
 * Glossaire de Lumi — les AUTOMATISATIONS (phase 5 de « Lumi 100 % fiable »).
 *
 * « create_automation_from_text, toggle, update_automation_message,
 * update_automation_sms_body et set_automation_language produisent des
 * automatisations dont les messages respectent le glossaire et la langue
 * choisie. »
 *
 * Ce qu'un test statique peut tenir :
 *  - les messages PRÉRÉGLÉS (ceux que Lume fournit) vouvoient le client final
 *    et ne contiennent aucune valeur de base ;
 *  - la consigne donnée au générateur (« Construire avec Lumi ») impose le
 *    vouvoiement au client, le tutoiement à l'utilisateur, la langue de
 *    l'entreprise et les seules variables connues ;
 *  - les outils de Lumi lisent et écrivent la langue au bon endroit.
 * Ce que le générateur ÉCRIT réellement se mesure avec le vrai modèle
 * (npm run qa:construire-lumi), pas ici.
 *
 * Tests statiques : aucune base, aucun modèle, aucun réseau.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUTOMATION_PRESETS } from '../server/lib/automationPresets.data';

const racine = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(racine, p), 'utf8');

const TU = /(?<![a-zà-ÿ])(tu|toi|ton|ta|tes)(?![a-zà-ÿ])/i;
const VALEUR_DE_BASE = /(?<![a-zà-ÿ_.{[/-])(scheduled|in_progress|overdue|past_due|draft|completed|cancelled|awaiting_response|changes_requested|approved|declined|succeeded|refunded|closed_won|closed_lost|new_prospect|requires_invoicing|action_required|pending|unpaid|sales_rep|technician)(?![a-zà-ÿ_}\]=/:-])/i;

/** Ce qu'un préréglage ENVOIE : le corps et l'objet de ses textos, courriels et notifications. */
const messages = AUTOMATION_PRESETS.flatMap((p) => p.actions.flatMap((a) => {
  const c = a.config as Record<string, unknown>;
  return ['body', 'subject', 'message', 'title'].filter((k) => typeof c[k] === 'string' && String(c[k]).trim())
    .map((k) => ({ preset: p.preset_key, type: a.type, champ: k, texte: String(c[k]).replace(/<[^>]+>/g, ' ') }));
}));
const versClient = messages.filter((m) => m.type === 'send_sms' || m.type === 'send_email' || m.type === 'request_review');

describe('automatisations — les messages préréglés', () => {
  it('le relevé voit les messages (textos et courriels vers le client)', () => {
    expect(AUTOMATION_PRESETS.length).toBeGreaterThan(20);
    expect(versClient.length).toBeGreaterThan(30);
  });

  it('aucun message au client ne le tutoie', () => {
    expect(versClient.filter((m) => TU.test(m.texte)).map((m) => `${m.preset} (${m.champ})`)).toEqual([]);
  });

  it('les messages au client vouvoient', () => {
    const vous = versClient.filter((m) => /(?<![a-zà-ÿ-])(vous|votre|vos)(?![a-zà-ÿ])/i.test(m.texte));
    expect(vous.length).toBeGreaterThan(versClient.length / 2);
  });

  it('aucun message ne contient une valeur de base (pending, draft, overdue…)', () => {
    expect(messages.filter((m) => VALEUR_DE_BASE.test(m.texte)).map((m) => `${m.preset} (${m.champ}) : ${m.texte.slice(0, 60)}`)).toEqual([]);
  });

  it('« courriel » et « texto », jamais « email » ni « SMS » dans un message', () => {
    expect(messages.filter((m) => /(?<![a-zà-ÿ_.@[-])(e-?mails?|sms)(?![a-zà-ÿ_.@\]-])/i.test(m.texte)).map((m) => `${m.preset} : ${m.texte.slice(0, 70)}`)).toEqual([]);
  });

  it('un préréglage semé sous un nom anglais a toujours sa traduction pour l’affichage', () => {
    // Les noms sont rangés en anglais (« Job Reminder — 1 Day Before ») et traduits à l'écran
    // par src/lib/automationNames.ts — la table que le gabarit « mes automatisations » de Lumi utilise aussi.
    const table = lire('src/lib/automationNames.ts');
    const anglais = AUTOMATION_PRESETS.map((p) => p.name).filter((n) => !/[àâçéèêëîïôùû«»’]/i.test(n) && /^[A-Z]/.test(n) && /\b(Reminder|Follow-Up|Request|After|Before|Signed|Confirmation|Alert|Welcome|Thank|Anniversary|Cross-Sell|No-Show|Lead|Days?)\b/.test(n));
    expect(anglais.length).toBeGreaterThan(10);
    expect(anglais.filter((n) => !table.includes(`'${n}'`))).toEqual([]);
  });

  /**
   * ÉCART (b) — les préréglages disent « soumission » (48 fois), sauf trois
   * messages restés en « devis » :
   *   server/lib/automationPresets.data.ts:335  « On vous a envoyé un devis récemment… »
   *   server/lib/automationPresets.data.ts:337  « Suivi de votre devis »
   *   server/lib/automationPresets.data.ts:1178 « Répondez à ce message pour un devis. »
   * (et une description, :64). Messages déjà semés chez les clients : non modifiés ici.
   */
  it.fails('ÉCART : les préréglages n’emploient qu’un mot pour le devis (automationPresets.data.ts:335, :337, :1178)', () => {
    const textes = [...AUTOMATION_PRESETS.flatMap((p) => [p.name, p.description]), ...messages.map((m) => m.texte)].join('\n');
    const nb = (re: RegExp) => (textes.match(re) ?? []).length;
    expect(Math.min(nb(/(?<![a-zà-ÿ])devis(?![a-zà-ÿ])/gi), nb(/(?<![a-zà-ÿ.{[_])soumissions?(?![a-zà-ÿ.}\]_])/gi))).toBe(0);
  });
});

describe('automatisations — la consigne du générateur (« Construire avec Lumi »)', () => {
  const generateur = lire('server/lib/lumi/generer-parcours.ts');

  it('les messages au client : français québécois au VOUVOIEMENT, ou anglais simple, selon la langue', () => {
    expect(generateur).toContain('français québécois, VOUVOIEMENT');
    expect(generateur).toContain('plain, polite English');
    expect(generateur).toContain('Bonjour [client_first_name],');
  });

  it('la phrase adressée à l’utilisateur reste au tutoiement', () => {
    expect(generateur).toMatch(/Parle à l'utilisateur au\s+tutoiement ; ce sont les MESSAGES AU CLIENT qui sont au vouvoiement/);
  });

  it('seules les variables connues sont permises (une variable inventée part vide au client)', () => {
    expect(generateur).toContain('UNIQUEMENT celles-ci');
    expect(generateur).toContain('VARIABLES_CONNUES');
  });
});

describe('automatisations — les outils de Lumi et la langue choisie', () => {
  const outils = lire('server/lib/agent/tools-reglages.ts');
  /** Le code d'un outil : de sa déclaration jusqu'à l'outil suivant (`kind: '…'`). */
  const bloc = (nom: string) => {
    const i = outils.indexOf(`name: '${nom}'`);
    if (i < 0) throw new Error(`Outil introuvable : ${nom}`);
    const fin = outils.indexOf("kind: '", i);
    return outils.slice(i, fin > i ? fin : i + 9000);
  };

  it('create_automation_from_text écrit dans la langue des automatisations de l’entreprise, et crée EN PAUSE', () => {
    const b = bloc('create_automation_from_text');
    expect(b).toContain("select('default_language')");
    expect(b).toMatch(/default_language === 'en' \? 'en' : 'fr'/);
    expect(b).toContain('is_active: false');
  });

  it('set_automation_language n’accepte que « fr » ou « en » et écrit la langue de l’entreprise', () => {
    const b = bloc('set_automation_language');
    expect(b).toContain("enum: ['fr', 'en']");
    expect(b).toContain('default_language: langue');
  });

  it('update_automation_message et update_automation_sms_body nomment le message « courriel » ou « texto »', () => {
    expect(outils).toContain("const quoi = actionType === 'send_sms' ? 'texto' : 'courriel';");
    expect(outils).toContain('Texte du texto de l’automatisation mis à jour.');
    expect(outils).toContain('Texte du courriel de l’automatisation mis à jour.');
  });

  it('toggle_automation_rule dit ce que ça change pour les envois', () => {
    const b = bloc('toggle_automation_rule');
    expect(b).toContain('elle partira dès son prochain déclenchement');
    expect(b).toContain('plus rien ne partira');
  });
});
