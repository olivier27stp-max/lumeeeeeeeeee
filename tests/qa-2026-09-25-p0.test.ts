/**
 * QA DU 2026-09-25 — les bloquants.
 *
 * Trois défauts relevés par l'audit navigateur. Chacun a son test ici,
 * et chacun échoue si on retire le correctif.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { insererEtape, type Etape } from '../src/lib/sequenceTypes';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

describe('P0-3 — insérer une condition ne doit RIEN faire disparaître', () => {
  /** Le parcours du rapport : déclencheur → attendre → courriel. */
  function parcours(): Etape[] {
    return [
      { id: 'a', type: 'attendre', delai_secondes: 300, suivant: 'b' },
      { id: 'b', type: 'action', action: { type: 'send_email', config: {} }, suivant: null },
    ];
  }

  it('les étapes suivantes SURVIVENT à l’insertion', () => {
    /*
     * Le bug : « les étapes Attendre et Envoyer un courriel ont DISPARU
     * du canevas ». L'utilisateur qui enregistrait sans le voir perdait
     * son parcours.
     */
    const apres = insererEtape(parcours(), { id: 'c', type: 'si', conditions: {} }, null);
    const ids = apres.map((e) => e.id).sort();
    expect(ids, 'les 2 étapes d’origine doivent rester').toEqual(['a', 'b', 'c']);
  });

  it('la condition REPREND la suite sous « alors »', () => {
    // Sinon les cartes existent en mémoire mais ne sont plus reliées :
    // elles disparaissent quand même du canevas.
    const apres = insererEtape(parcours(), { id: 'c', type: 'si', conditions: {} }, null);
    const si = apres.find((e) => e.id === 'c') as Extract<Etape, { type: 'si' }>;
    expect(si.alors, 'la suite du parcours doit passer sous « alors »').toBe('a');
  });

  it('insérée AU MILIEU, elle reprend aussi la suite', () => {
    // Le chemin exact du rapport : « + » entre le déclencheur et l'attente.
    const apres = insererEtape(parcours(), { id: 'c', type: 'si', conditions: {} }, 'a');
    const si = apres.find((e) => e.id === 'c') as Extract<Etape, { type: 'si' }>;
    const a = apres.find((e) => e.id === 'a') as Extract<Etape, { type: 'attendre' }>;
    expect(apres.map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
    expect(a.suivant, 'l’étape précédente pointe vers la condition').toBe('c');
    expect(si.alors, 'la condition reprend ce qui suivait').toBe('b');
  });

  it('« Arrêter » termine vraiment — la queue est abandonnée exprès', () => {
    // Non-régression : ce type-là ne doit PAS rattacher la suite.
    const apres = insererEtape(parcours(), { id: 'c', type: 'arreter' }, 'a');
    const stop = apres.find((e) => e.id === 'c');
    expect(stop?.type).toBe('arreter');
    // « Arrêter » n'a NI suivant NI branches : rien ne le suit, par nature.
    expect(Object.keys(stop ?? {})).toEqual(['id', 'type']);
  });

  it('une action insérée garde le comportement d’avant', () => {
    const apres = insererEtape(
      parcours(),
      { id: 'c', type: 'action', action: { type: 'send_sms', config: {} }, suivant: null },
      'a',
    );
    const c = apres.find((e) => e.id === 'c') as Extract<Etape, { type: 'action' }>;
    expect(c.suivant).toBe('b');
  });
});

describe('P0-2 — on doit TOUJOURS pouvoir se déconnecter', () => {
  const src = lire('src/components/CompanySelector.tsx');

  it('la sortie ne dépend pas d’un appel réseau', () => {
    /*
     * Le bug : `await signOut()` puis redirection dans le `finally`. Si
     * l'appel ne rendait jamais la main, le bouton restait désactivé
     * POUR TOUJOURS — compte enfermé, constaté au QA.
     *
     * La session LOCALE s'efface sans réseau : c'est elle qui décide de
     * ce que voit ce navigateur.
     */
    expect(src, 'la session locale doit être vidée en premier')
      .toMatch(/signOut\(\{ scope: 'local' \}\)/);
  });

  it('un filet fait sortir même si tout échoue', () => {
    expect(src).toMatch(/setTimeout\(partir, 3000\)/);
  });

  it('la révocation serveur n’est jamais bloquante', () => {
    // Souhaitable, mais elle ne doit pas retenir l'utilisateur dehors.
    expect(src).toMatch(/void supabase\.auth\.signOut\(\{ scope: 'global' \}\)/);
  });
});

describe('P0-1 — le bureau ne doit jamais changer selon la route', () => {
  const src = lire('src/lib/apiOrgHeader.ts');

  it('une requête ATTEND que le bureau soit connu', () => {
    /*
     * Le bug : au chargement direct d'une route (lien collé, F5), le
     * bureau n'est pas encore publié — `CompanyContext` le fait dans un
     * `useEffect`, donc après le premier rendu. Les requêtes parties
     * avant n'avaient pas d'en-tête.
     *
     * Vérifié au navigateur le 2026-09-25 : sans bureau mémorisé,
     * AUCUN `x-org-id` n'était envoyé sur /automations, /apercu ni
     * /reglages. Le serveur répond alors 400 `org_required` pour un
     * compte à plusieurs bureaux — d'où « introuvable » et les données
     * d'un autre bureau.
     */
    expect(src, 'le wrapper doit attendre le bureau').toMatch(/await attendreBureau\(\)/);
    expect(src, 'il s’abonne au lieu de deviner').toMatch(/abonnerBureauActif\(/);
  });

  it('l’attente est BORNÉE — un compte sans bureau ne bloque pas', () => {
    /*
     * Une invitation en attente n'a aucun bureau : sans plafond, tous
     * ses appels resteraient suspendus pour toujours. Passé le délai on
     * part sans en-tête, et le serveur tranche — c'est lui qui détient
     * la vérité.
     */
    expect(src).toMatch(/MS_ATTENTE_BUREAU = 5000/);
    expect(src).toMatch(/setTimeout\(\(\) => terminer\(bureauActif\(\)\), MS_ATTENTE_BUREAU\)/);
  });

  it('le serveur REFUSE toujours de deviner le bureau', () => {
    /*
     * Non-régression du correctif de 2026-09-24 : avec plusieurs
     * bureaux et sans en-tête, le serveur répond 400 plutôt que de
     * prendre « le premier ». C'est ce qui ferme la fuite inter-bureau,
     * et le correctif client ne doit pas l'affaiblir.
     */
    const serveur = lire('server/lib/supabase.ts');
    expect(serveur).toMatch(/code: 'org_required'/);
    expect(serveur).toMatch(/if \(\(count \?\? 0\) > 1\)/);
  });
});

describe('P0-2 — « Aucune compagnie » ne doit JAMAIS s’afficher pendant une reprise', () => {
  const src = lire('src/contexts/CompanyContext.tsx');

  it('l’échec est marqué AVANT de réessayer', () => {
    /*
     * Le `finally` pose `loading = false` à CHAQUE essai, reprise
     * comprise. Sans drapeau, on obtenait pendant la reprise :
     * `loading` faux + `lectureEchouee` faux + `companies` vide
     * = `hasNoCompany` VRAI — l'écran s'affichait sur une session
     * parfaitement valide.
     *
     * Reproduit au navigateur le 2026-09-25 : 3 lectures en 401,
     * « Aucune compagnie » sur les trois routes, alors que le compte
     * avait bien ses 2 bureaux actifs en base (vérifié côté serveur).
     */
    const i = src.indexOf('if (essai < ESSAIS_MAX)');
    expect(i).toBeGreaterThan(-1);
    const bloc = src.slice(i, i + 900);
    expect(bloc, 'la reprise doit marquer l’échec avant de repartir')
      .toMatch(/setLectureEchouee\(true\);[\s\S]{0,200}?return fetchMemberships\(essai \+ 1\)/);
  });

  it('le drapeau n’est réarmé qu’au PREMIER essai', () => {
    // Sinon chaque reprise effaçait l'échec précédent et rouvrait la
    // même fenêtre d'affichage.
    expect(src).toMatch(/if \(essai === 1\) setLectureEchouee\(false\)/);
  });

  it('« Aucune compagnie » reste réservé aux comptes qui n’en ont vraiment aucune', () => {
    // Non-régression du calcul : les trois conditions doivent rester.
    expect(src).toMatch(/hasNoCompany: !loading && !lectureEchouee && companies\.length === 0/);
  });
});
