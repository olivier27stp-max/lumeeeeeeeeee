/**
 * Les courriels des préréglages d'automatisation suivent les normes des
 * courriels (audit du 2026-09-29) — un préréglage est envoyé tel quel par
 * toutes les entreprises qui ne l'ont pas réécrit.
 *
 * Ce qui a été trouvé, et que ces tests empêchent de revenir :
 *  - « [company_name] — … » en tête de chaque objet : l'expéditeur affiche
 *    déjà le nom, et un nom vide laissait un « — » orphelin ;
 *  - des courriels en ANGLAIS envoyés par des entreprises francophones
 *    (le seed SQL n'avait pas de version française) ;
 *  - un lien brut affiché en clair ([signed_contract_link] comme texte) ;
 *  - « Merci de faire affaire avec Plomberie Tremblay inc.. ».
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { AUTOMATION_PRESETS, COURRIELS_HERITES_DU_SEED } from '../../server/lib/automationPresets.data';
import { PACK_PARCOURS } from '../../server/lib/automationPack.data';
import { ecartsObjet } from '../../server/lib/courriels/garde-envoi';
import { resolveTemplate, sansPrenomVide } from '../../server/lib/actions';

type Courriel = { cle: string; subject: string; subject_en: string; body: string; body_en: string };

const courriels: Courriel[] = [];
const cfgCourriel = (cle: string, c: Record<string, unknown>) =>
  courriels.push({ cle, subject: String(c.subject ?? ''), subject_en: String(c.subject_en ?? ''), body: String(c.body ?? ''), body_en: String(c.body_en ?? '') });
for (const p of AUTOMATION_PRESETS) for (const a of p.actions) if (a.type === 'send_email') cfgCourriel(p.preset_key, a.config);
for (const [cle, c] of Object.entries(COURRIELS_HERITES_DU_SEED)) cfgCourriel(`${cle} (seed)`, c);
// Les courriels des parcours du pack, où qu'ils soient dans les étapes.
const fouiller = (cle: string, v: unknown): void => {
  if (Array.isArray(v)) { v.forEach((x) => fouiller(cle, x)); return; }
  if (!v || typeof v !== 'object') return;
  const o = v as Record<string, unknown>;
  if (o.type === 'send_email' && o.config && typeof o.config === 'object') cfgCourriel(cle, o.config as Record<string, unknown>);
  Object.values(o).forEach((x) => fouiller(cle, x));
};
for (const p of PACK_PARCOURS) fouiller(p.preset_key, p.steps);

// Des valeurs réalistes, et longues : l'objet doit tenir avec un vrai numéro.
const VARS: Record<string, string> = {
  client_first_name: 'Marie-Christine', client_name: 'Marie-Christine Tremblay', company_name: 'Plomberie Tremblay inc.',
  invoice_number: 'INV-2026-00042', quote_number: 'Q-2026-018', appointment_date: 'mercredi 14 octobre 2026',
  appointment_time: '13 h 30', invoice_total: '1 487,50 $', signed_contract_link: 'https://lumecrm.net/contract/x',
};

describe('préréglages : les courriels suivent les normes', () => {
  it('il y a bien des courriels à vérifier (préréglages, seed, pack)', () => {
    expect(courriels.length).toBeGreaterThan(30);
  });

  it.each(courriels.map((c) => [c.cle, c] as const))('%s : objets FR et EN conformes (≤ 60, sans emoji ni référence interne)', (_cle, c) => {
    for (const objet of [c.subject, c.subject_en]) {
      expect(objet, 'objet absent').not.toBe('');
      expect(objet).not.toMatch(/^\s*\[company_name\]\s*[—–-]/);
      expect(ecartsObjet(sansPrenomVide(resolveTemplate(objet, VARS)))).toEqual([]);
    }
  });

  it.each(courriels.map((c) => [c.cle, c] as const))('%s : une seule langue par version', (_cle, c) => {
    const anglais = /\b(Hi|Hello|Thank you|Thanks|your|please)\b/i;
    const francais = /\b(Bonjour|Merci|votre|vous)\b/i;
    expect(`${c.subject} ${c.body}`).not.toMatch(anglais);
    expect(`${c.subject_en} ${c.body_en}`).not.toMatch(francais);
  });

  it.each(courriels.map((c) => [c.cle, c] as const))('%s : aucun lien affiché en clair', (_cle, c) => {
    for (const corps of [c.body, c.body_en]) expect(corps).not.toMatch(/>\s*\[[a-z_]*(link|url)\]\s*</);
  });
});

describe('nettoyage après substitution', () => {
  it('prénom vide : ponctuation recollée', () => {
    expect(sansPrenomVide('Bonjour , merci !')).toBe('Bonjour, merci!');
  });
  it('nom qui finit par un point : plus de « inc.. », les points de suspension restent', () => {
    expect(sansPrenomVide('Merci de faire affaire avec Plomberie Tremblay inc..')).toBe('Merci de faire affaire avec Plomberie Tremblay inc.');
    expect(sansPrenomVide('On vous attend...')).toBe('On vous attend...');
  });
});

describe('migration des préréglages', () => {
  const sql = readFileSync('supabase/migrations/20261003600000_courriels_prereglages.sql', 'utf8');
  const fonctions = sql.slice(0, sql.indexOf('═══ C ═══'));
  it('le seed et la traduction FR ne posent plus d’objet « [company_name] — »', () => {
    expect(fonctions).not.toMatch(/"subject":"\[company_name\] —/);
    expect(fonctions).not.toMatch(/'\[company_name\] — /);
  });
  it('le seed pose chaque courriel en français ET en anglais', () => {
    const seed = fonctions.slice(fonctions.indexOf('seed_automation_presets'), fonctions.indexOf('seed_agreement_signed_preset'));
    const sujets = [...seed.matchAll(/"subject":"([^"]*)"/g)].length;
    const sujetsEn = [...seed.matchAll(/"subject_en":"([^"]*)"/g)].length;
    expect(sujets).toBeGreaterThan(20);
    expect(sujetsEn).toBe(sujets);
  });
  it('les règles existantes ne sont réécrites que si chaque texte est un texte livré par Lume', () => {
    expect(sql).toMatch(/if not connu then return a; end if;/);
  });
});
