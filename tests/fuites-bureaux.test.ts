// Fuites entre bureaux relevées par l'audit du 2026-09-25 (MULTI_BUREAUX_PLAN.md §1.4).
// Chaque cas a été corrigé ; ce fichier empêche qu'il revienne.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('H1 — Lumi par SMS et le connecteur Claude écrivent dans LEUR bureau', () => {
  it('le client du membre (SMS) porte x-lume-org', () => {
    const s = lire('server/lib/sms/session-membre.ts');
    const corps = s.slice(s.indexOf('export async function clientPourMembre'));
    expect(corps).toMatch(/bureau: string/);
    expect(corps.slice(0, 900)).toMatch(/'x-lume-org': bureau/);
  });
  it('tous les appelants SMS passent le bureau', () => {
    expect(lire('server/lib/sms/lumi-sms.ts')).toMatch(/clientPourMembre\(ctx\.userId, ctx\.orgId\)/);
    expect(lire('server/lib/sms/fil-lumi.ts')).toMatch(/clientPourMembre\(membre\.userId, membre\.orgId\)/);
  });
  it('le client du jeton MCP porte le bureau choisi au consentement', () => {
    const s = lire('server/lib/oauth.ts');
    expect(s).toMatch(/function clientPourJeton\(accessToken: string, bureau: string \| null\)/);
    expect(s).toMatch(/'x-lume-org': bureau/);
    expect(s.match(/clientPourJeton\(accessToken, bureau\)/g)?.length).toBe(2);
    expect(s).not.toMatch(/clientPourJeton\(accessToken\)/);
  });
});

describe('M1 — chaque onglet agit sur SON bureau', () => {
  // localStorage est partagé entre onglets : le relire pour choisir le bureau
  // fait agir l'onglet 1 sur le bureau que l'onglet 2 vient de choisir.
  // Seule source : bureauActifSync() (mémoire de l'onglet, localStorage en repli de démarrage).
  const AUTORISES = new Set([
    'src/lib/orgApi.ts',            // bureauActifSync lui-même (repli de démarrage)
    'src/lib/supabase.ts',          // repli de démarrage de l'en-tête x-lume-org
    'src/contexts/CompanyContext.tsx', // restauration au chargement
    'src/lib/officesApi.ts',        // TEMPORAIRE : converti dans la PR P1 de la session multi-bureaux
  ]);
  it('aucun autre fichier ne relit lume-active-org pour choisir le bureau', () => {
    const racine = resolve(__dirname, '..');
    const fichiers: string[] = [];
    const parcourir = (dossier: string) => {
      for (const e of readdirSync(resolve(racine, dossier), { withFileTypes: true })) {
        const rel = `${dossier}/${e.name}`;
        if (e.isDirectory()) parcourir(rel);
        else if (/\.tsx?$/.test(e.name)) fichiers.push(rel);
      }
    };
    parcourir('src');
    const fautifs = fichiers.filter((f) => !AUTORISES.has(f) && lire(f).includes("getItem('lume-active-org')"));
    expect(fautifs).toEqual([]);
  });
});

describe('M2 — le GPS suit le bureau de la session de terrain', () => {
  const s = lire('server/routes/tracking.ts');
  it('points, lots et position en direct au bureau de la session', () => {
    expect(s.match(/org_id: bureauSession/g)?.length).toBe(4);
  });
  it("l'arrêt ne met hors ligne que CETTE session", () => {
    expect(s).toMatch(/\.eq\('user_id', auth\.user\.id\)\s*\.eq\('session_id', sessionId\)/);
  });
  it('un événement ne peut viser que sa propre session', () => {
    const corps = s.slice(s.indexOf("router.post('/tracking/event'"));
    expect(corps).toMatch(/\.eq\('user_id', auth\.user\.id\)/);
  });
});

describe('M3 — coordonnées d’un membre d’un autre bureau', () => {
  it('courriel et téléphone masqués hors bureau, sauf propriétaire/admin', () => {
    const s = lire('server/routes/leaderboard.ts');
    expect(s).toMatch(/email: null, phone: null/);
    expect(s).toMatch(/member: memberVisible/);
  });
});

describe('L1 — bureau par défaut stable', () => {
  it('les adhésions sont triées par ancienneté', () => {
    expect(lire('src/contexts/CompanyContext.tsx')).toMatch(/\.order\('created_at', \{ ascending: true \}\)/);
  });
});
