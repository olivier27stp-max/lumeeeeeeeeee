/**
 * La visite guidée (2026-09-24).
 *
 * Trois bulles qui montrent une page à quelqu'un qui arrive. Ce qui la rend
 * acceptable, et que ce test protège :
 *
 *   - elle ne revient JAMAIS une fois vue ou passée ;
 *   - « Passer » existe à chaque étape, pas seulement à la première ;
 *   - Échap ferme, et le focus revient où il était ;
 *   - une étape dont la cible n'est pas sur la page est sautée, pas affichée
 *     sur du vide ;
 *   - elle vise des repères `data-visite`, pas des classes Tailwind qui
 *     changent au premier coup de peinture.
 *
 * Une visite qu'on ne peut pas faire taire est pire que pas de visite : elle
 * apprend à cliquer n'importe où pour s'en débarrasser.
 *
 * Statique : ni DOM, ni réseau.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const racine = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(racine, p), 'utf8');

const composant = lire('src/components/ui/VisiteGuidee.tsx');
const page = lire('src/pages/settings/EmailTemplatesSettings.tsx');

describe('visite guidée — les règles qui la rendent supportable', () => {
  it('ne revient jamais : le « déjà vu » est persisté', () => {
    expect(composant).toContain('localStorage');
    expect(composant).toContain('lume-visite-');
    // Et le stockage peut être bloqué (mode privé) : on ne montre RIEN plutôt
    // que de remontrer la visite à chaque chargement.
    expect(composant).toMatch(/catch\s*\{[^}]*return true/s);
  });

  it('marque la visite vue dès qu’on la ferme, quel que soit le chemin', () => {
    // Fermer par la croix, par « Passer », par Échap ou par le voile passe
    // toutes par `fermer()` — une seule porte, une seule écriture.
    expect(composant).toContain('const fermer = useCallback(');
    expect(composant).toContain('marquerVue(cle)');
  });

  it('« Passer » est offert à chaque étape, pas seulement à la première', () => {
    expect(composant).toMatch(/!dernière && \(/);
    expect(composant).toContain('passerLabel');
  });

  it('Échap ferme et le focus revient où il était', () => {
    expect(composant).toContain("e.key === 'Escape'");
    expect(composant).toContain('focusAvant.current');
    expect(composant).toContain('.focus()');
  });

  it('une cible absente de la page est sautée, jamais encadrée à vide', () => {
    expect(composant).toContain('etapes.filter((e) => rectangleDe(e.cible) !== null)');
    // Une cible de taille nulle est présente mais invisible : l'encadrer
    // poserait la bulle sur du vide.
    expect(composant).toContain('r.width > 0 && r.height > 0');
  });

  it('accessible : rôle, libellés liés, bouton icône nommé', () => {
    expect(composant).toContain('role="dialog"');
    expect(composant).toContain('aria-modal="true"');
    expect(composant).toContain('aria-labelledby');
    expect(composant).toContain('aria-describedby');
    // Les identifiants viennent de useId : ce composant peut apparaître deux
    // fois sur une page sans que les libellés se croisent.
    expect(composant).toContain('useId()');
    expect(composant).toContain('aria-label={passerLabel}');
  });
});

describe('la visite de la page Modèles de courriel', () => {
  it('vise des repères stables, pas des classes Tailwind', () => {
    /* Une visite qui vise `.flex.items-center.gap-4` casse au premier coup de
       peinture, et en silence : la bulle disparaît sans que personne ne le
       voie. Les repères `data-visite` n'existent que pour ça. */
    for (const repere of ['identite', 'courriels', 'relances']) {
      expect(composant.includes('data-visite') || page.includes(`data-visite="${repere}"`)).toBe(true);
      expect(page, `repère ${repere} absent de la page`).toContain(`data-visite="${repere}"`);
      expect(page, `étape ${repere} absente de la visite`).toContain(`[data-visite="${repere}"]`);
    }
  });

  it('ne démarre qu’une fois les données chargées', () => {
    // Encadrer des cartes qui n'existent pas encore poserait les bulles sur
    // du vide — et l'étape serait sautée pour de bon.
    expect(page).toContain('actif={!chargement}');
  });

  it('est en français, comme le reste du CRM', () => {
    const etapes = page.slice(page.indexOf('<VisiteGuidee'), page.indexOf('/>', page.indexOf('<VisiteGuidee')));
    expect(etapes).toContain('Votre identité');
    expect(etapes).not.toMatch(/\b(Your|Here|Click|Next|Skip)\b/);
  });
});
