/**
 * La porte mobile ne doit jamais se refermer sur les clients de nos clients.
 *
 * lumecrm.net sert deux publics avec le même domaine : nos utilisateurs, qu'on
 * veut envoyer vers l'application, et LEURS clients, qui reçoivent par texto un
 * lien vers une soumission ou un contrat à signer. Ces derniers ouvrent
 * forcément le lien sur un téléphone et n'installeront jamais notre app.
 *
 * Une porte trop large leur barrerait la route — donc ferait perdre des
 * contrats à nos utilisateurs. C'est la seule erreur vraiment coûteuse de ce
 * chantier, et ces tests existent pour l'empêcher.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHEMINS_PUBLICS, estCheminPublic, estTelephone, afficherPorteMobile } from '../src/lib/mobileGate';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Simule un appareil : agent utilisateur + largeur d'écran. */
function appareil(ua: string, largeur: number) {
  vi.stubGlobal('navigator', { userAgent: ua });
  vi.stubGlobal('window', { innerWidth: largeur });
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120';

afterEach(() => vi.unstubAllGlobals());

describe('les pages ouvertes par les clients finaux restent accessibles', () => {
  it('une soumission envoyée par texto s’ouvre sur téléphone', () => {
    // LE cas critique. Ce lien part par SMS, il est ouvert au téléphone dans
    // 100 % des cas, et le client n'a pas de compte Lume.
    appareil(IPHONE, 390);
    expect(afficherPorteMobile('/quote/abc123def456')).toBe(false);
  });

  it('les six routes à jeton passent toutes', () => {
    appareil(IPHONE, 390);
    for (const p of ['/quote/t', '/contract/t', '/survey/t', '/portal/t', '/pay/t', '/invite/t']) {
      expect(afficherPorteMobile(p), `${p} devrait rester accessible`).toBe(false);
    }
  });

  it('un formulaire public de demande passe', () => {
    appareil(ANDROID, 412);
    expect(afficherPorteMobile('/form/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(false);
  });

  it('les pages légales restent joignables partout', () => {
    // Obligation réglementaire : elles ne peuvent pas dépendre de l'appareil.
    appareil(IPHONE, 390);
    for (const p of ['/privacy', '/terms', '/subprocessors']) {
      expect(afficherPorteMobile(p)).toBe(false);
    }
  });

  it('le parcours d’abonnement passe, succès compris', () => {
    appareil(IPHONE, 390);
    expect(afficherPorteMobile('/checkout')).toBe(false);
    expect(afficherPorteMobile('/checkout/success')).toBe(false);
  });

  it('la liste blanche couvre toutes les routes à jeton du routeur', () => {
    // Garde-fou contre la dérive : `detectTokenKind` est la source de vérité
    // des liens envoyés aux clients. Une route ajoutée là sans être inscrite
    // ici partirait à un client et se heurterait à la porte.
    const src = read('src/routes/TokenRoutes.tsx');
    const bloc = src.slice(src.indexOf('export function detectTokenKind'));
    const routes = [...bloc.matchAll(/startsWith\('([^']+)'\)/g)].map((m) => m[1]);
    expect(routes.length, 'aucune route extraite — le test ne vérifie rien').toBeGreaterThan(3);
    for (const r of routes) {
      expect(CHEMINS_PUBLICS as readonly string[], `${r} absent de CHEMINS_PUBLICS`).toContain(r);
    }
  });
});

describe('la porte s’ouvre pour nos utilisateurs sur téléphone', () => {
  it('un iPhone sur le tableau de bord voit la page', () => {
    appareil(IPHONE, 390);
    expect(afficherPorteMobile('/dashboard')).toBe(true);
  });

  it('un Android sur les soumissions la voit aussi', () => {
    appareil(ANDROID, 412);
    expect(afficherPorteMobile('/quotes')).toBe(true);
  });

  it('/quotes ne doit pas être confondu avec /quote/', () => {
    // Un préfixe mal écrit (`/quote` sans barre finale) aurait laissé passer
    // la liste des soumissions du CRM — une page inutilisable sur mobile.
    appareil(IPHONE, 390);
    expect(estCheminPublic('/quotes')).toBe(false);
    expect(estCheminPublic('/quote/abc')).toBe(true);
  });
});

describe('un ordinateur n’est jamais bloqué', () => {
  it('un Mac en plein écran garde le CRM', () => {
    appareil(MAC, 1440);
    expect(afficherPorteMobile('/dashboard')).toBe(false);
  });

  it('une fenêtre rétrécie sur ordinateur ne déclenche rien', () => {
    // Sans le double critère, réduire sa fenêtre éjecterait l'utilisateur du
    // CRM — comportement absurde, et impossible à comprendre pour lui.
    appareil(MAC, 500);
    expect(estTelephone()).toBe(false);
    expect(afficherPorteMobile('/dashboard')).toBe(false);
  });

  it('un iPad reste un poste de travail', () => {
    // Le CRM est utilisable sur tablette en paysage : l'exclure ferait perdre
    // un usage réel sur le terrain.
    appareil(IPAD, 1024);
    expect(estTelephone()).toBe(false);
  });

  it('un téléphone en paysage large reste un téléphone… mais passe', () => {
    // Choix assumé : au-delà de 768 px l'affichage tient, on ne bloque pas.
    appareil(IPHONE, 844);
    expect(estTelephone()).toBe(false);
  });
});

describe('la page de téléchargement', () => {
  const page = read('src/pages/MobileAppGate.tsx');

  it('n’affiche pas de bouton mort tant qu’aucun lien n’existe', () => {
    // L'app est en bêta fermée. Un bouton « Télécharger » qui ne mène nulle
    // part est pire que pas de bouton du tout.
    expect(page).toContain('ios: null');
    expect(page).toContain("L'application arrive bientôt");
  });

  it('rassure sur les données', () => {
    // La question de quelqu'un qui voit son CRM remplacé par une page.
    expect(page).toContain('Vos données sont intactes');
  });

  it('dit quoi faire en attendant', () => {
    expect(page).toContain('lumecrm.net');
    expect(page).toMatch(/ordinateur/i);
  });

  it('est en français', () => {
    expect(page).not.toMatch(/Download the app|Coming soon|Your data is safe/);
  });
});

describe('la route d’aperçu', () => {
  const app = read('src/App.tsx');

  it('existe et ne demande aucun compte', () => {
    // Le but est de la regarder sur un vrai téléphone, où l'on n'est pas
    // forcément connecté.
    expect(app).toContain("location.pathname === '/apercu-mobile'");
    expect(app).toContain('<MobileAppGate />');
  });

  it('ne redirige personne — elle s’ouvre volontairement', () => {
    // Un aperçu qui bloquerait l'accès au CRM serait exactement ce qu'on
    // cherche à éviter tant que la porte n'est pas validée.
    const i = app.indexOf("location.pathname === '/apercu-mobile'");
    const bloc = app.slice(i, i + 200);
    expect(bloc).not.toMatch(/estTelephone|afficherPorteMobile/);
  });

  it('la porte n’est toujours PAS branchée', () => {
    // Garde-fou du lot : tant que le texte n'est pas validé, aucun utilisateur
    // ne doit être redirigé. Ce test tombera volontairement au lot suivant.
    expect(app).not.toContain('afficherPorteMobile(');
  });
});
