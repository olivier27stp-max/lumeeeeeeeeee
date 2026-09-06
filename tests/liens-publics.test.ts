/**
 * LES LIENS QU'UN CLIENT REÇOIT DOIVENT FONCTIONNER — ET ÊTRE COMPTÉS.
 *
 * Trois pages publiques, atteintes par un jeton dans un courriel, sans
 * session : le devis à accepter, la facture à payer, le portail. Le
 * 2026-09-06, en les ouvrant comme un client (npm run qa:liens), deux
 * bugs sont sortis :
 *
 *   1. AUCUNE OUVERTURE DE DEVIS OU DE FACTURE N'ÉTAIT COMPTÉE.
 *      POST /api/quotes/:id/track-view rejetait « par sécurité » tout
 *      identifiant en forme d'UUID. Or les jetons de vue SONT des UUID
 *      (gen_random_uuid()). Prod : 10 documents envoyés, 0 ouverture
 *      enregistrée, 0 notification « le client a ouvert votre devis ».
 *
 *   2. LE LIEN DU PORTAIL ÉTAIT MORT POUR TOUT CLIENT CRÉÉ DEPUIS LE
 *      31 JUILLET. L'interface construit le lien avec portal_token
 *      (rempli par défaut) ; le serveur ne cherche que portal_token_hash,
 *      que plus rien ne remplissait depuis le rattrapage unique de juillet.
 *
 * CE QUE CES TESTS FIGENT
 * Le garde UUID ne revient pas ; la recherche reste par jeton seul (c'est
 * elle qui protège) ; le hash du portail se calcule par trigger, avec la
 * formule exacte du serveur.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

describe('track-view accepte les jetons en forme d UUID', () => {
  const src = lire('server/routes/quotes.ts');
  const bloc = src.slice(src.indexOf("router.post('/quotes/:id/track-view'"), src.indexOf("router.post('/quotes/:id/track-view'") + 2500);

  it('ne rejette plus un identifiant parce qu il ressemble à un UUID', () => {
    // Si ce test rougit : quelqu'un a remis le garde. Les view_token SONT
    // des UUID ; le garde rejette 100 % des jetons légitimes.
    expect(bloc).not.toMatch(/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}[^\n]*test\(id\)/);
  });

  it('la recherche reste par view_token uniquement — c est elle qui protège', () => {
    // Un identifiant de document deviné ne correspond à aucun view_token.
    expect(bloc).toContain(".eq('view_token', id)");
    expect(bloc).not.toMatch(/\.eq\('id',\s*id\)/);
  });

  it('un identifiant vide est toujours refusé', () => {
    expect(bloc).toMatch(/if \(!id\)\s*\{\s*return res\.status\(404\)/);
  });
});

describe('le hash du jeton de portail se calcule tout seul', () => {
  const MIG = lire('supabase/migrations/20260906130000_portail_hash_automatique.sql');

  it('un trigger BEFORE INSERT OR UPDATE OF portal_token existe', () => {
    expect(MIG).toMatch(/create trigger trg_clients_portal_token_hash\s+before insert or update of portal_token on public\.clients/);
  });

  it('la formule est celle du serveur : sha256 hex du jeton en clair', () => {
    // server/routes/portal.ts : crypto.createHash('sha256').update(token).digest('hex')
    expect(MIG).toContain("encode(sha256(convert_to(new.portal_token, 'UTF8')), 'hex')");
    const serveur = lire('server/routes/portal.ts');
    expect(serveur).toContain("crypto.createHash('sha256').update(token).digest('hex')");
  });

  it('un jeton mis à null vide le hash — la révocation reste possible', () => {
    expect(MIG).toMatch(/if new\.portal_token is null then\s+new\.portal_token_hash := null;/);
  });

  it('les clients existants sans hash sont rattrapés', () => {
    expect(MIG).toMatch(/update public\.clients\s+set portal_token_hash = [^;]+where portal_token is not null\s+and portal_token_hash is null/);
  });

  it('l interface construit toujours le lien avec portal_token', () => {
    // C'est ce lien-là que le trigger rend valide. S'il change de colonne,
    // le trigger doit suivre.
    expect(lire('src/pages/ClientDetails.tsx')).toMatch(/\/portal\/\$\{\(client as any\)\.portal_token\}/);
  });
});

describe('le robot des liens publics existe et couvre les trois pages', () => {
  const robot = lire('scripts/qa/liens-publics.mjs');
  it('ouvre chaque page dans un contexte de navigateur vierge', () => {
    expect(robot).toContain('createBrowserContext()');
  });
  for (const chemin of ['/quote/', '/pay/', '/portal/']) {
    it(`couvre ${chemin}`, () => { expect(robot).toContain('`' + chemin + '${'); });
  }
  it('vérifie qu une ouverture est comptée', () => {
    expect(robot).toContain("select('is_viewed, view_count')");
  });
  it('accepte avec une signature dessinée, comme un vrai client', () => {
    expect(robot).toContain('page.mouse.down()');
  });
  it('est branché : npm run qa:liens', () => {
    expect(JSON.parse(lire('package.json')).scripts['qa:liens']).toContain('liens-publics.mjs');
  });
});
