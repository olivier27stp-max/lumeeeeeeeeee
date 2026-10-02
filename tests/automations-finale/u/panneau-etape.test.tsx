// @vitest-environment jsdom
/**
 * LE PANNEAU D'UNE ÉTAPE — corrections du triage « actions » (2026-10-01),
 * côté COMPOSANT : le vrai `PanneauEtape`, monté seul. Un bloc `describe` par
 * ligne du triage.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const confirmerMock = vi.hoisted(() => vi.fn(async (_o: unknown) => true));
vi.mock('../../../src/components/ui/ConfirmDialog', () => ({ confirmer: (o: unknown) => confirmerMock(o), default: () => null }));
vi.mock('../../../src/hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ isEnabled: false, loading: false }) }));
vi.mock('../../../src/lib/supabase', () => {
  const chaine: unknown = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === 'then') return (res: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(res);
      return () => chaine;
    },
    apply: () => chaine,
  });
  return {
    supabase: {
      from: () => chaine,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getUser: async () => ({ data: { user: null } }),
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});

import PanneauEtape from '../../../src/components/automations/PanneauEtape';
import type { Etape } from '../../../src/lib/sequenceTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Proprietes = Partial<React.ComponentProps<typeof PanneauEtape>>;

let conteneur: HTMLDivElement;
let racine: Root | null = null;
/** Ce que « Enregistrer » a renvoyé au parent. */
let enregistrees: Etape[] = [];

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
/** Rend (ou RE-rend, sur la même racine : c'est le parent qui change l'étape) le panneau. */
async function rendre(etape: Etape, props: Proprietes = {}) {
  await act(async () => {
    racine!.render(
      <QueryClientProvider client={qc}>
        <PanneauEtape
          etape={etape} fr declencheur="quote.sent" membres={[]} etiquettes={[]}
          onEnregistrer={(e) => { enregistrees.push(e); }} onSupprimer={() => {}} onFermer={() => {}}
          {...props}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function monterEtape(etape: Etape, props: Proprietes = {}) {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await rendre(etape, props);
}
const monter = (type: string, config: Record<string, string>, props: Proprietes = {}) =>
  monterEtape({ id: 'e1', type: 'action', action: { type, config }, suivant: null }, props);

beforeEach(() => { enregistrees = []; confirmerMock.mockClear(); });
afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
});

const texte = () => conteneur.textContent || '';
const boutons = () => Array.from(conteneur.querySelectorAll('button'));
const boutonExact = (t: string) => boutons().find((b) => b.textContent?.trim() === t);
const enregistrer = () => (boutonExact('Enregistrer') ?? boutonExact('Save action') ?? boutonExact('Save'))!;
function cliquer(el: Element | undefined | null) {
  if (!el) throw new Error('rien à cliquer');
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
/** Le contrôle (champ, zone, menu) dont le libellé COMMENCE par ce texte. */
function champ<T extends HTMLElement = HTMLInputElement>(libelle: string): T | null {
  const etiquette = Array.from(conteneur.querySelectorAll('label')).find((l) => (l.textContent ?? '').startsWith(libelle));
  const id = etiquette?.getAttribute('for');
  return id ? conteneur.querySelector<T>(`[id="${id}"]`) : null;
}
function saisir(el: Element | null | undefined, v: string) {
  if (!el) throw new Error('champ introuvable');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
  act(() => { el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
const configEnregistree = () => {
  const e = enregistrees.at(-1);
  return e?.type === 'action' ? e.action.config : null;
};

// ─── Priorité — bug n° 1 (constat A-01) ─────────────────────────

describe('A-01 — l’étape ouverte change par ailleurs (Lumi, annuler / rétablir) : le panneau ne garde pas un brouillon périmé', () => {
  const EXEMPLE = 'Bonjour [client_name], c’est [company_name]. Merci !';
  const DE_LUMI = 'Bonjour [client_first_name], votre facture [invoice_number] est en retard. Réglez-la ici : [invoice_link]. [company_name]';
  const texto = (body: string): Etape => ({ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body } }, suivant: null });
  const zone = () => champ<HTMLTextAreaElement>('Texte du message *');
  const alerte = () => conteneur.querySelector('[role="alert"]')?.textContent ?? null;

  it('rien de tapé dans le panneau : il prend aussitôt le texte de Lumi, sans question', async () => {
    const onModifie = vi.fn();
    await monterEtape(texto(EXEMPLE), { declencheur: 'invoice.overdue', onModifie });
    expect(zone()?.value).toBe(EXEMPLE);
    // Lumi rend la MÊME étape (e1), avec un autre texte.
    await rendre(texto(DE_LUMI), { declencheur: 'invoice.overdue', onModifie, modifieePar: 'lumi' });
    expect(zone()?.value).toBe(DE_LUMI);
    expect(alerte()).toBeNull();
    // Le panneau ne se croit pas « modifié » : le fermer ne demande rien.
    expect(onModifie).toHaveBeenLastCalledWith(false);
    cliquer(boutonExact('Annuler'));
    await act(async () => { await Promise.resolve(); });
    expect(confirmerMock).not.toHaveBeenCalled();
  });

  it('… et « Enregistrer » renvoie le texte de Lumi, jamais l’ancien', async () => {
    await monterEtape(texto(EXEMPLE), { declencheur: 'invoice.overdue' });
    await rendre(texto(DE_LUMI), { declencheur: 'invoice.overdue', modifieePar: 'lumi' });
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: DE_LUMI });
  });

  it('une étape qui vient du tiroir, que Lumi fait entrer dans le parcours avec un autre texte : même chose', async () => {
    await monterEtape(texto(EXEMPLE), { declencheur: 'invoice.overdue', nouvelle: true });
    await rendre(texto(DE_LUMI), { declencheur: 'invoice.overdue', nouvelle: false, modifieePar: 'lumi' });
    expect(zone()?.value).toBe(DE_LUMI);
    expect(alerte()).toBeNull();
  });

  it('une saisie en cours : rien n’est écrasé — un bandeau nomme Lumi, et « Enregistrer » attend le choix', async () => {
    await monterEtape(texto(EXEMPLE), { declencheur: 'invoice.overdue' });
    saisir(zone(), 'Mon texte à moi, en cours de frappe.');
    await rendre(texto(DE_LUMI), { declencheur: 'invoice.overdue', modifieePar: 'lumi' });
    expect(zone()?.value).toBe('Mon texte à moi, en cours de frappe.');
    expect(alerte()).toContain('Lumi a modifié cette étape pendant que vous l’éditiez.');
    expect(boutonExact('Voir la version de Lumi')).toBeDefined();
    expect(boutonExact('Garder ma version')).toBeDefined();
    expect(enregistrer().disabled).toBe(true);
    expect(texte()).toContain('Choisissez d’abord quelle version garder.');
    cliquer(enregistrer());
    expect(enregistrees).toEqual([]);
  });

  it('« Voir la version de Lumi » : le panneau prend son texte, le brouillon est abandonné', async () => {
    await monterEtape(texto(EXEMPLE), { declencheur: 'invoice.overdue' });
    saisir(zone(), 'Mon texte à moi.');
    await rendre(texto(DE_LUMI), { declencheur: 'invoice.overdue', modifieePar: 'lumi' });
    cliquer(boutonExact('Voir la version de Lumi'));
    expect(zone()?.value).toBe(DE_LUMI);
    expect(alerte()).toBeNull();
    expect(enregistrer().disabled).toBe(false);
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: DE_LUMI });
  });

  it('« Garder ma version » : le brouillon reste, et « Enregistrer » l’applique — en connaissance de cause', async () => {
    await monterEtape(texto(EXEMPLE), { declencheur: 'invoice.overdue' });
    saisir(zone(), 'Mon texte à moi.');
    await rendre(texto(DE_LUMI), { declencheur: 'invoice.overdue', modifieePar: 'lumi' });
    cliquer(boutonExact('Garder ma version'));
    expect(zone()?.value).toBe('Mon texte à moi.');
    expect(alerte()).toBeNull();
    expect(enregistrer().disabled).toBe(false);
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: 'Mon texte à moi.' });
  });

  it('un changement qui ne vient pas de Lumi (annuler / rétablir) : le bandeau ne l’accuse pas', async () => {
    await monterEtape(texto(EXEMPLE), { declencheur: 'invoice.overdue' });
    saisir(zone(), 'Mon texte à moi.');
    await rendre(texto('Version d’avant'), { declencheur: 'invoice.overdue', modifieePar: 'autre' });
    expect(alerte()).toContain('Cette étape a été modifiée ailleurs pendant que vous l’éditiez.');
    expect(boutonExact('Voir l’autre version')).toBeDefined();
  });

  it('le parent rend un objet NEUF au contenu identique (chaque modification du parcours) : la saisie en cours ne bouge pas', async () => {
    await monterEtape(texto(EXEMPLE), { declencheur: 'invoice.overdue' });
    saisir(zone(), 'Mon texte à moi.');
    await rendre(texto(EXEMPLE), { declencheur: 'invoice.overdue' });
    expect(zone()?.value).toBe('Mon texte à moi.');
    expect(alerte()).toBeNull();
  });

  it('une attente : même règle (3 jours ailleurs → le panneau montre 3 jours)', async () => {
    const attente = (jours: number): Etape => ({ id: 'e2', type: 'attendre', delai_secondes: jours * 86400, suivant: null });
    await monterEtape(attente(1));
    await rendre(attente(3), { modifieePar: 'lumi' });
    expect(champ('Attendre')?.value).toBe('3');
  });

  it('en anglais', async () => {
    await monterEtape(texto(EXEMPLE), { fr: false });
    saisir(champ('Message text *'), 'My own text.');
    await rendre(texto(DE_LUMI), { fr: false, modifieePar: 'lumi' });
    expect(alerte()).toContain('Lumi changed this step while you were editing it.');
    expect(boutonExact('See Lumi’s version')).toBeDefined();
    expect(boutonExact('Keep my version')).toBeDefined();
    expect(texte()).toContain('First choose which version to keep.');
  });
});

// ─── Ligne 4 du triage « actions » (= déclencheurs 05:290 et 05:313) ───

describe('ligne 4 — étape « Attendre » : retaper le nombre garde l’unité choisie (3 jours ne deviennent pas 5 minutes)', () => {
  const attente = (secondes: number, plus: Record<string, unknown> = {}): Etape => ({ id: 'e1', type: 'attendre', delai_secondes: secondes, suivant: 'e2', ...plus } as Etape);
  const nombre = () => champ('Attendre')!;
  const unite = () => conteneur.querySelector<HTMLSelectElement>('select[aria-label="Unité de temps"]')!;
  const enregistree = () => enregistrees.at(-1) as Extract<Etape, { type: 'attendre' }> | undefined;

  it('3 jours : effacer le nombre puis taper 5 → « 5 » et « jours », et 5 jours sont enregistrés', async () => {
    await monterEtape(attente(3 * 86400));
    expect(nombre().value).toBe('3');
    expect(unite().value).toBe('jours');
    // Comme au clavier : le champ est vidé, puis on tape 5.
    saisir(nombre(), '');
    expect(unite().value).toBe('jours');
    expect(nombre().value).toBe('');
    saisir(nombre(), '5');
    expect(nombre().value).toBe('5');
    expect(unite().value).toBe('jours');
    cliquer(enregistrer());
    expect(enregistree()?.delai_secondes).toBe(5 * 86400);
  });

  it('un champ laissé vide n’est pas « 0 » : « Enregistrer » est refusé, avec la raison', async () => {
    await monterEtape(attente(3 * 86400));
    saisir(nombre(), '');
    expect(enregistrer().disabled).toBe(true);
    expect(texte()).toContain('Indiquez combien de temps attendre (0 ou plus).');
    cliquer(enregistrer());
    expect(enregistrees).toEqual([]);
  });

  it('à 0, choisir « jours » garde « jours » ; puis 2 → 2 jours', async () => {
    await monterEtape(attente(0));
    expect(unite().value).toBe('minutes');
    saisir(unite(), 'jours');
    expect(unite().value).toBe('jours');
    saisir(nombre(), '2');
    cliquer(enregistrer());
    expect(enregistree()?.delai_secondes).toBe(2 * 86400);
  });

  it('1 heure : taper 24 reste « 24 » « heures » à l’écran (pas « 1 » « jours »)', async () => {
    await monterEtape(attente(3600));
    saisir(nombre(), '24');
    expect(nombre().value).toBe('24');
    expect(unite().value).toBe('heures');
    cliquer(enregistrer());
    expect(enregistree()?.delai_secondes).toBe(86400);
  });

  it('changer l’unité convertit le nombre affiché, sans le toucher', async () => {
    await monterEtape(attente(3 * 86400));
    saisir(unite(), 'heures');
    expect(nombre().value).toBe('3');
    cliquer(enregistrer());
    expect(enregistree()?.delai_secondes).toBe(3 * 3600);
  });

  it('« Ce délai AVANT le rendez-vous » : le nombre retapé garde son unité, et c’est `secondes_avant` qui suit', async () => {
    await monterEtape(attente(0, { mode: 'avant_date', secondes_avant: 2 * 86400 }), { declencheur: 'appointment.created' });
    expect(nombre().value).toBe('2');
    expect(unite().value).toBe('jours');
    saisir(nombre(), '');
    saisir(nombre(), '7');
    expect(unite().value).toBe('jours');
    cliquer(enregistrer());
    expect(enregistree()).toMatchObject({ mode: 'avant_date', secondes_avant: 7 * 86400, delai_secondes: 0 });
  });

  it('passer à « avant le rendez-vous » reprend le délai À L’ÉCRAN', async () => {
    await monterEtape(attente(86400), { declencheur: 'appointment.created' });
    saisir(nombre(), '3');
    saisir(champ<HTMLSelectElement>('Ce qu’on attend'), 'avant_date');
    cliquer(enregistrer());
    expect(enregistree()).toMatchObject({ mode: 'avant_date', secondes_avant: 3 * 86400, delai_secondes: 0 });
  });

  it('ouvrir sans rien toucher n’est pas une modification', async () => {
    const onModifie = vi.fn();
    await monterEtape(attente(3 * 86400), { onModifie });
    expect(onModifie).toHaveBeenLastCalledWith(false);
    cliquer(enregistrer());
    expect(enregistree()?.delai_secondes).toBe(3 * 86400);
  });
});

// ─── Ligne 3 du triage « actions » ──────────────────────────────

describe('ligne 3 — le courriel d’une automatisation fournie s’ouvre en texte lisible, pas en balises HTML', () => {
  const HTML_FR = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Vous nous avez contactés récemment.</p><p>Merci,<br/>[company_name]</p></div>';
  const HTML_EN = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Hi [client_first_name],</h2><p>You reached out to us recently.</p><p>Thank you,<br/>[company_name]</p></div>';
  const fourni = { subject: 'Votre demande n’est pas oubliée', subject_en: 'We haven’t forgotten your request', body: HTML_FR, body_en: HTML_EN };

  it('« Message » montre le texte, sans balise ni style — la version anglaise aussi', async () => {
    await monter('send_email', fourni, { declencheur: 'lead.created' });
    const message = champ<HTMLTextAreaElement>('Message *');
    expect(message?.value).toBe('Bonjour [client_first_name],\nVous nous avez contactés récemment.\nMerci,\n[company_name]');
    expect(champ<HTMLTextAreaElement>('Message — version anglaise')?.value).toBe('Hi [client_first_name],\nYou reached out to us recently.\nThank you,\n[company_name]');
    for (const zone of Array.from(conteneur.querySelectorAll('textarea'))) expect(zone.value).not.toMatch(/<div|<p>|<h2>|style=/);
  });

  it('ouvrir n’est pas modifier : ni « Fermer sans enregistrer ? », ni réécriture — le HTML d’origine revient à l’octet près', async () => {
    const onFermer = vi.fn();
    await monter('send_email', fourni, { declencheur: 'lead.created', onFermer });
    cliquer(boutonExact('Annuler'));
    await act(async () => { await Promise.resolve(); });
    expect(confirmerMock).not.toHaveBeenCalled();
    expect(onFermer).toHaveBeenCalledTimes(1);
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual(fourni);
  });

  it('corriger une phrase : le courriel repart en HTML, avec la phrase corrigée — et l’anglais, intact, garde son HTML d’origine', async () => {
    await monter('send_email', fourni, { declencheur: 'lead.created' });
    saisir(champ('Message *'), 'Bonjour [client_first_name],\nVotre demande est entre bonnes mains.\nMerci,\n[company_name]');
    saisir(champ('Message — version anglaise'), 'Hi [client_first_name],\nYour request is in good hands.\nThank you,\n[company_name]');
    cliquer(enregistrer());
    const config = configEnregistree() ?? {};
    expect(config.body).toMatch(/^<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">/);
    expect(config.body).toContain('<h2 style="color:#1a1a1a;font-size:18px;">Bonjour [client_first_name],</h2>');
    expect(config.body).toContain('Votre demande est entre bonnes mains.</p>');
    expect(config.body).not.toContain('contactés récemment');
    expect(config.body_en).toContain('Your request is in good hands.</p>');
    expect(config.subject).toBe(fourni.subject);
  });

  it('un seul des deux textes corrigé : l’autre garde son HTML d’origine, inchangé', async () => {
    await monter('send_email', fourni, { declencheur: 'lead.created' });
    saisir(champ('Message — version anglaise'), 'Hi [client_first_name],\nShort version.');
    cliquer(enregistrer());
    expect(configEnregistree()?.body).toBe(HTML_FR);
    expect(configEnregistree()?.body_en).toContain('Short version.</p>');
  });

  it('un corps écrit en TEXTE (étape créée dans l’éditeur) est enregistré tel qu’on l’a tapé, « < » compris', async () => {
    const corps = 'Bonjour [client_name],\n\nVotre devis « été » est prêt : 2 options & 1 rabais si total < 500 $.\n\n— L’équipe';
    await monter('send_email', { subject: 'Objet', body: 'Corps' });
    saisir(champ('Message *'), corps);
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ subject: 'Objet', body: corps });
  });

  it('passer ce courriel en texto : c’est le TEXTE qui suit, jamais le balisage', async () => {
    await monter('send_email', fourni, { declencheur: 'lead.created' });
    saisir(champ<HTMLSelectElement>('Quoi faire'), 'send_sms');
    expect(champ<HTMLTextAreaElement>('Texte du message *')?.value).toBe('Bonjour [client_first_name],\nVous nous avez contactés récemment.\nMerci,\n[company_name]');
    saisir(champ('Texte du message — version anglaise'), '');
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: 'Bonjour [client_first_name],\nVous nous avez contactés récemment.\nMerci,\n[company_name]' });
  });
});

// ─── Ligne 2 du triage « actions » ──────────────────────────────

describe('ligne 2 — la version anglaise d’un texte (`body_en`, `subject_en`) est visible et modifiable', () => {
  const FR = 'Rabais de 10 % jusqu’au 1er mai.';
  const EN = '10% off until May 1st.';

  it('un texto qui porte `body_en` le montre, dans le même champ que le français (compteur compris)', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    expect(champ<HTMLTextAreaElement>('Texte du message *')?.value).toBe(FR);
    const anglais = champ<HTMLTextAreaElement>('Texte du message — version anglaise');
    expect(anglais?.tagName).toBe('TEXTAREA');
    expect(anglais?.value).toBe(EN);
    expect(anglais?.maxLength).toBe(1600);
    expect(texte()).toContain(`${EN.length} / 1600`);
    expect(texte()).toContain('Part à la place du texte français quand la langue du bureau est l’anglais.');
  });

  it('une étape SANS version anglaise n’affiche qu’un texte (rien n’est inventé)', async () => {
    await monter('send_sms', { body: FR });
    expect(conteneur.querySelectorAll('textarea')).toHaveLength(1);
    expect(texte()).not.toContain('version anglaise');
  });

  it('courriel : `subject_en` et `body_en` ont chacun leur champ', async () => {
    await monter('send_email', { subject: 'Votre devis', subject_en: 'Your quote', body: 'Bonjour', body_en: 'Hello' });
    expect(champ('Objet — version anglaise')?.value).toBe('Your quote');
    expect(champ<HTMLTextAreaElement>('Message — version anglaise')?.value).toBe('Hello');
  });

  it('corriger le français sans toucher l’anglais : « Enregistrer » est refusé, avec la raison', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    expect(enregistrer().disabled).toBe(false);
    saisir(champ('Texte du message *'), 'Rabais de 20 % jusqu’au 1er juin.');
    expect(enregistrer().disabled).toBe(true);
    expect(texte()).toContain('« Texte du message » a changé, pas sa version anglaise : mettez-la à jour, videz-la, ou confirmez qu’elle reste valable.');
    cliquer(enregistrer());
    expect(enregistrees).toEqual([]);
  });

  it('… mettre l’anglais à jour lève le refus : les DEUX textes partent', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    saisir(champ('Texte du message *'), 'Rabais de 20 % jusqu’au 1er juin.');
    saisir(champ('Texte du message — version anglaise'), '20% off until June 1st.');
    expect(enregistrer().disabled).toBe(false);
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: 'Rabais de 20 % jusqu’au 1er juin.', body_en: '20% off until June 1st.' });
  });

  it('… ou la confirmer « toujours valable » : elle est gardée telle quelle, en connaissance de cause', async () => {
    await monter('send_sms', { body: 'Bonjour [client_name], votre devis est pret.', body_en: 'Hi [client_name], your quote is ready.' });
    saisir(champ('Texte du message *'), 'Bonjour [client_name], votre devis est prêt.');
    expect(enregistrer().disabled).toBe(true);
    const case_ = Array.from(conteneur.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .find((c) => conteneur.querySelector(`label[for="${c.id}"]`)?.textContent?.includes('La version anglaise reste valable telle quelle'));
    cliquer(case_);
    expect(enregistrer().disabled).toBe(false);
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: 'Bonjour [client_name], votre devis est prêt.', body_en: 'Hi [client_name], your quote is ready.' });
  });

  it('… ou la vider : la clé disparaît de l’étape (jamais un `body_en` vide en base)', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    saisir(champ('Texte du message *'), 'Rabais de 20 % jusqu’au 1er juin.');
    saisir(champ('Texte du message — version anglaise'), '');
    // Vidée, elle reste À L'ÉCRAN : on voit qu'elle est vide, on peut la réécrire.
    expect(champ('Texte du message — version anglaise')).not.toBeNull();
    expect(enregistrer().disabled).toBe(false);
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: 'Rabais de 20 % jusqu’au 1er juin.' });
  });

  it('modifier SEULEMENT l’anglais est enregistrable', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    saisir(champ('Texte du message — version anglaise'), '10% off until May 1.');
    expect(enregistrer().disabled).toBe(false);
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: FR, body_en: '10% off until May 1.' });
  });

  it('rouvrir et réenregistrer sans rien changer ne réécrit rien', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: FR, body_en: EN });
  });

  it('une variable inconnue dans la version anglaise est signalée comme dans l’autre', async () => {
    await monter('send_sms', { body: 'Bonjour [client_name]', body_en: 'Hi [firstname]' });
    expect(conteneur.querySelector('[role="alert"]')?.textContent).toBe('Variable inconnue : [firstname] — sera vide dans le message envoyé.');
  });

  it('changer d’action (texto → courriel) garde le texte ET sa version anglaise', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    saisir(champ<HTMLSelectElement>('Quoi faire'), 'send_email');
    expect(champ<HTMLTextAreaElement>('Message *')?.value).toBe(FR);
    expect(champ<HTMLTextAreaElement>('Message — version anglaise')?.value).toBe(EN);
  });

  it('interface en anglais : libellés et refus en anglais', async () => {
    await monter('send_sms', { body: FR, body_en: EN }, { fr: false });
    expect(champ<HTMLTextAreaElement>('Message text — English version')?.value).toBe(EN);
    saisir(champ('Message text *'), '20 %');
    expect(texte()).toContain('“Message text” changed, not its English version: update it, empty it, or confirm it still holds.');
    expect(texte()).toContain('The English version still holds as is');
  });
});

// ─── Triage « actions », lignes 8 et 9 ──────────────────────────

describe('lignes 8 et 9 — une saisie que le serveur refuserait est refusée DANS LE PANNEAU, avec la borne dite', () => {
  const tache = (jours: string) => monter('create_task', { title: 'Rappeler [client_name]', echeance_jours: jours }, { declencheur: 'lead.created' });
  const jours = () => champ('À faire dans (jours)')!;

  it('999 jours : « Enregistrer » est refusé, la borne est dite, rien ne part', async () => {
    await tache('3');
    expect(enregistrer().disabled).toBe(false);
    saisir(jours(), '999');
    expect(enregistrer().disabled).toBe(true);
    expect(texte()).toContain('« À faire dans (jours) » doit être au plus 365.');
    cliquer(enregistrer());
    expect(enregistrees).toEqual([]);
  });

  it('-5 jours : refusé (« au moins 0 ») ; revenir à 30 lève le refus, et 30 est enregistré', async () => {
    await tache('3');
    saisir(jours(), '-5');
    expect(enregistrer().disabled).toBe(true);
    expect(texte()).toContain('« À faire dans (jours) » doit être au moins 0.');
    saisir(jours(), '30');
    expect(enregistrer().disabled).toBe(false);
    expect(texte()).not.toContain('doit être au');
    cliquer(enregistrer());
    expect(configEnregistree()?.echeance_jours).toBe('30');
  });

  it('aux bornes (0 et 365) : accepté', async () => {
    await tache('3');
    for (const v of ['0', '365']) {
      saisir(jours(), v);
      expect(enregistrer().disabled, v).toBe(false);
    }
  });

  it('une valeur estimée de 10 000 001 $ : refusée', async () => {
    await monter('modifier_client', { statut: 'active', valeur: '500' }, { declencheur: 'lead.created' });
    saisir(champ('Valeur estimée ($)'), '10000001');
    expect(enregistrer().disabled).toBe(true);
    expect(texte()).toContain('« Valeur estimée ($) » doit être au plus 10000000.');
  });

  it('webhook : http://, « pas une adresse », ftp:// → « doit commencer par https:// » ; une adresse interne → refusée aussi', async () => {
    await monter('webhook', { url: 'https://crochets.lume-qa.test/entrant' }, { declencheur: 'lead.created' });
    const adresse = () => champ('L’adresse')!;
    expect(enregistrer().disabled).toBe(false);
    for (const v of ['http://crochets.lume-qa.test/entrant', 'pas une adresse', 'ftp://crochets.lume-qa.test']) {
      saisir(adresse(), v);
      expect(enregistrer().disabled, v).toBe(true);
      expect(texte(), v).toContain('« L’adresse » doit commencer par https://.');
    }
    saisir(adresse(), 'https://localhost/interne');
    expect(enregistrer().disabled).toBe(true);
    expect(texte()).toContain('« L’adresse » ne peut pas viser une adresse interne.');
    cliquer(enregistrer());
    expect(enregistrees).toEqual([]);
    saisir(adresse(), 'https://exemple.test/entrant');
    expect(enregistrer().disabled).toBe(false);
    cliquer(enregistrer());
    expect(configEnregistree()?.url).toBe('https://exemple.test/entrant');
  });

  it('en anglais', async () => {
    await monter('create_task', { title: 'Call back', echeance_jours: '3' }, { declencheur: 'lead.created', fr: false });
    saisir(champ('Due in (days)'), '999');
    expect(enregistrer().disabled).toBe(true);
    expect(texte()).toContain('“Due in (days)” must be at most 365.');
  });
});

// ─── Triage « déclencheurs », 05-etapes-controle:470 et :501 ────

describe('étape « Si… » — ce que la zone « Conditions » ne sait pas lire ou écrire n’est jamais jeté en silence', () => {
  const si = (conditions: Record<string, unknown>): Etape => ({ id: 's1', type: 'si', conditions, alors: null, sinon: null });
  const zone = () => champ<HTMLTextAreaElement>('Conditions')!;
  const conditionsEnregistrees = () => {
    const e = enregistrees.at(-1);
    return e?.type === 'si' ? e.conditions : null;
  };
  const alerte = () => conteneur.querySelector('[role="alert"]')?.textContent ?? '';

  it('05:470 — « montant 5000 » (sans signe) et « statut = » (sans valeur) : signalées, « Enregistrer » est retenu, rien ne part', async () => {
    await monterEtape(si({}));
    expect(enregistrer().disabled).toBe(false);
    saisir(zone(), 'montant 5000\nstatut =');
    expect(enregistrer().disabled).toBe(true);
    expect(alerte()).toContain('Ligne illisible « montant 5000 » : il manque un signe (=, !=, >, >=, <, <=) ou « est l’un de » entre le champ et la valeur.');
    expect(alerte()).toContain('Ligne illisible « statut = » : il manque la valeur.');
    cliquer(enregistrer());
    expect(enregistrees).toEqual([]);
  });

  it('05:470 — … corriger les lignes lève le refus, et ce qui est tapé est ce qui part', async () => {
    await monterEtape(si({}));
    saisir(zone(), 'montant 5000\nstatut =');
    saisir(zone(), 'montant > 5000\nstatut = envoye');
    expect(alerte()).toBe('');
    expect(enregistrer().disabled).toBe(false);
    cliquer(enregistrer());
    expect(conditionsEnregistrees()).toEqual({ montant: { gt: 5000 }, statut: 'envoye' });
  });

  it('05:470 — une ligne en cours de frappe (« statut ») est signalée sans être effacée de la zone', async () => {
    await monterEtape(si({ source: 'web' }));
    saisir(zone(), 'source = web\nstatut');
    expect(zone().value).toBe('source = web\nstatut');
    expect(enregistrer().disabled).toBe(true);
  });

  it('05:470 — en anglais', async () => {
    await monterEtape(si({}), { fr: false });
    saisir(zone(), 'amount 5000');
    expect(alerte()).toBe('Unreadable line “amount 5000”: a sign (=, !=, >, >=, <, <=) or “is one of” is missing between the field and the value.');
  });

  const DE_LUMI = { source: { in: ['web', 'facebook'] }, statut: { not_in: ['perdu'] } };

  it('05:501 — des conditions « est l’un de » posées par Lumi ou un modèle : la zone les MONTRE', async () => {
    await monterEtape(si(DE_LUMI));
    expect(zone().value).toBe('source est l’un de web, facebook\nstatut n’est aucun de perdu');
    expect(alerte()).toBe('');
    expect(enregistrer().disabled).toBe(false);
  });

  it('05:501 — ajouter une condition ne les efface pas : les trois sont enregistrées, les deux d’origine à l’identique', async () => {
    await monterEtape(si(DE_LUMI));
    saisir(zone(), `${zone().value}\nmontant > 100`);
    cliquer(enregistrer());
    expect(conditionsEnregistrees()).toEqual({ ...DE_LUMI, montant: { gt: 100 } });
  });

  it('05:501 — elles se modifient : une valeur de plus dans la liste, « n’est aucun de » tapé à la main', async () => {
    await monterEtape(si(DE_LUMI));
    saisir(zone(), "source est l'un de web, facebook, appel\nstatut n’est aucun de perdu, annule");
    expect(alerte()).toBe('');
    cliquer(enregistrer());
    expect(conditionsEnregistrees()).toEqual({ source: { in: ['web', 'facebook', 'appel'] }, statut: { not_in: ['perdu', 'annule'] } });
  });

  it('05:501 — ouvrir et enregistrer sans rien toucher ne réécrit rien', async () => {
    await monterEtape(si(DE_LUMI));
    cliquer(enregistrer());
    expect(conditionsEnregistrees()).toEqual(DE_LUMI);
  });

  it('une condition que le texte ne peut pas porter (opérateur inconnu, valeur à virgule) est montrée en lecture seule et CONSERVÉE à l’enregistrement', async () => {
    const avancees = { source: 'web', ville: { in: ['Montréal, QC', 'Laval'] }, note: { contains: 'vip' } };
    await monterEtape(si(avancees));
    expect(zone().value).toBe('source = web');
    expect(texte()).toContain('Conditions avancées, conservées telles quelles (non modifiables ici) :');
    expect(texte()).toContain('ville : {"in":["Montréal, QC","Laval"]}');
    expect(texte()).toContain('note : {"contains":"vip"}');
    saisir(zone(), 'source = web\nmontant >= 250');
    cliquer(enregistrer());
    expect(conditionsEnregistrees()).toEqual({ ...avancees, montant: { gte: 250 } });
  });

  it('… même en vidant la zone : seules les lignes du texte s’en vont', async () => {
    const avancees = { source: 'web', note: { contains: 'vip' } };
    await monterEtape(si(avancees));
    saisir(zone(), '');
    cliquer(enregistrer());
    expect(conditionsEnregistrees()).toEqual({ note: { contains: 'vip' } });
  });

  it('les conditions de champs personnalisés (`champs_perso`) restent portées à côté du texte', async () => {
    const champsPerso = [{ field_id: 'aaaaaaaa-0000-4000-8000-00000000c001', op: 'gt', value: 20 }];
    await monterEtape(si({ source: { in: ['web'] }, champs_perso: champsPerso }));
    saisir(zone(), `${zone().value}\nstatut != perdu`);
    cliquer(enregistrer());
    expect(conditionsEnregistrees()).toEqual({ source: { in: ['web'] }, statut: { neq: 'perdu' }, champs_perso: champsPerso });
  });

  it('interface en anglais : les listes s’écrivent « is one of » / « is none of »', async () => {
    await monterEtape(si(DE_LUMI), { fr: false });
    expect(zone().value).toBe('source is one of web, facebook\nstatut is none of perdu');
  });
});

// ─── Triage « actions », 05-panneau-etape:345 (= déclencheurs 05:338) ──

describe('étape « Attendre » — une attente plus longue que ce que le serveur accepte est refusée DANS le panneau, avec la limite', () => {
  const attente = (secondes: number, plus: Record<string, unknown> = {}): Etape => ({ id: 'e1', type: 'attendre', delai_secondes: secondes, suivant: 'e2', ...plus } as Etape);
  const nombre = () => champ('Attendre')!;
  const unite = () => conteneur.querySelector<HTMLSelectElement>('select[aria-label="Unité de temps"]')!;

  it('900 jours : « Enregistrer » est refusé, la limite (366 jours) est dite, rien ne part', async () => {
    await monterEtape(attente(86400));
    saisir(nombre(), '900');
    expect(unite().value).toBe('jours');
    expect(enregistrer().disabled).toBe(true);
    expect(texte()).toContain('Une attente ne peut pas dépasser 366 jours (un an).');
    cliquer(enregistrer());
    expect(enregistrees).toEqual([]);
  });

  it('366 jours passent, 367 non ; 9 000 heures non plus (la limite est en temps, pas en nombre)', async () => {
    await monterEtape(attente(86400));
    saisir(nombre(), '366');
    expect(enregistrer().disabled).toBe(false);
    saisir(nombre(), '367');
    expect(enregistrer().disabled).toBe(true);
    saisir(unite(), 'heures');
    saisir(nombre(), '9000');
    expect(enregistrer().disabled).toBe(true);
    saisir(nombre(), '48');
    expect(enregistrer().disabled).toBe(false);
  });

  it('« Ce délai AVANT le rendez-vous » : 45 jours refusés (au plus 30 jours), 30 jours acceptés', async () => {
    await monterEtape(attente(0, { mode: 'avant_date', secondes_avant: 86400 }), { declencheur: 'appointment.created' });
    saisir(nombre(), '45');
    expect(enregistrer().disabled).toBe(true);
    expect(texte()).toContain('On peut envoyer au plus 30 jours avant le rendez-vous.');
    saisir(nombre(), '30');
    expect(enregistrer().disabled).toBe(false);
    cliquer(enregistrer());
    expect((enregistrees.at(-1) as { secondes_avant?: number }).secondes_avant).toBe(30 * 86400);
  });

  it('en anglais', async () => {
    await monterEtape(attente(86400), { fr: false });
    saisir(champ('Wait'), '900');
    expect(texte()).toContain('A wait cannot exceed 366 days (one year).');
  });
});
