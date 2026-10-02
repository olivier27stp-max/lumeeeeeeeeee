/**
 * API directe, par rôle — la matrice rôle × route (carte §3 et §5.2).
 *
 * Pour CHACUNE des routes serveur des automatisations (tableau `_routes.ts`),
 * la route est appelée sans passer par l'interface :
 *   · avec le jeton de chacun des six rôles du bureau A (propriétaire, admin,
 *     membre `read`+`update` non admin, membre `read` seul, vendeur, technicien) ;
 *   · avec le jeton du propriétaire d'un AUTRE bureau (B), d'abord dans son
 *     propre bureau en visant un identifiant de A, puis en se réclamant du
 *     bureau A par l'en-tête `x-org-id` ;
 *   · sans jeton.
 * Deux choses sont vérifiées à chaque appel : le CODE de réponse, et l'EFFET
 * réel en base lu par le service (un 403 qui a quand même écrit, ou un 2xx sans
 * droit, est un défaut de sécurité). Une réponse faite à un rôle refusé ou à un
 * autre bureau ne doit contenir aucune donnée du bureau A.
 *
 * La matrice observée est écrite dans `sorties/roles/matrice-api.json` : c'est
 * elle qui alimente `couverture.md`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { test, expect, api, erreurDe, ROLES_A, LIBELLE, SORTIES_LOT, type Role } from './_roles';
import { ROUTES, type Ctx, type RouteApi } from './_routes';

const FICHIER = `${SORTIES_LOT}/matrice-api.json`;

interface Case { cas: string; attendu: string; code: number; ecrit: boolean | null; fuite: boolean | null; erreur: string; conforme: boolean }

function consigner(route: RouteApi, cases: Case[]): void {
  mkdirSync(SORTIES_LOT, { recursive: true });
  const tout: Record<string, unknown> = existsSync(FICHIER) ? JSON.parse(readFileSync(FICHIER, 'utf8')) as Record<string, unknown> : {};
  tout[route.id] = { methode: route.methode, chemin: route.gabarit, cle: route.cle, famille: route.famille, cases };
  writeFileSync(FICHIER, JSON.stringify(tout, null, 1));
}

test.describe('API directe — chaque route, chaque rôle', () => {
  for (const route of ROUTES) {
    test(`[${route.id}] ${route.methode} ${route.gabarit} — code et effet en base pour chaque rôle, un autre bureau et sans jeton`, async ({ jeton, outils, bureau, baseURL }) => {
      test.setTimeout(900_000);
      const base = baseURL!; // fixé par la config Playwright
      const cases: Case[] = [];

      const appeler = async (nom: string, j: string | null, org: string | null, ctx: Ctx, suffixe: string, patienceMs: number) => {
        const r = await api(base, j, org, route.methode, route.chemin(ctx, outils), route.corps?.(ctx, outils, suffixe));
        const ecrit = route.aEcrit ? await route.aEcrit(outils, ctx, suffixe, patienceMs) : null;
        const fuite = route.secret ? r.texte.includes(route.secret(ctx, outils, suffixe)) : null;
        return { nom, r, ecrit, fuite };
      };

      // ── Rôles AUTORISÉS : un état neuf par rôle, la route doit réussir ET écrire. ──
      for (const role of ROLES_A.filter((x) => route.autorises.includes(x))) {
        const s = `ok-${role}`;
        const ctx = route.preparer ? await route.preparer(outils, s) : {};
        // Certaines routes n'écrivent que pour un rôle précis (job terminé : seul le technicien émet « prêt à facturer »).
        const doitEcrire = !route.ecritSeulementPour || route.ecritSeulementPour.includes(role);
        const { r, ecrit, fuite } = await appeler(role, await jeton(role), bureau.orgA, ctx, s, doitEcrire ? 30_000 : 1_500);
        const conforme = route.succes.includes(r.status) && (ecrit === null || ecrit === doitEcrire);
        cases.push({ cas: role, attendu: route.succes.join('/'), code: r.status, ecrit, fuite, erreur: erreurDe(r), conforme });
        expect.soft(route.succes, `${LIBELLE[role]} : autorisé (${route.cle}) — réponse ${r.status} ${r.texte.slice(0, 200)}`).toContain(r.status);
        if (ecrit !== null) expect.soft(ecrit, `${LIBELLE[role]} : la route a répondu ${r.status} — effet attendu en base : ${doitEcrire ? 'oui' : 'non'}`).toBe(doitEcrire);
        if (route.menage) await route.menage(outils, ctx, s);
      }

      // ── Tous les REFUS partagent un même état : aucun ne doit le modifier. ──
      const s = 'refus';
      const ctx = route.preparer ? await route.preparer(outils, s) : {};
      const refus = async (nom: string, libelle: string, j: string | null, org: string | null, codes: readonly number[], strict: boolean) => {
        const { r, ecrit, fuite } = await appeler(nom, j, org, ctx, s, 1_500);
        const codeOk = strict ? codes.includes(r.status) : true;
        const conforme = codeOk && ecrit !== true && fuite !== true;
        cases.push({ cas: nom, attendu: strict ? codes.join('/') : 'aucun effet dans A', code: r.status, ecrit, fuite, erreur: erreurDe(r), conforme });
        if (strict) expect.soft(codes, `${libelle} : refus attendu — réponse ${r.status} ${r.texte.slice(0, 200)}`).toContain(r.status);
        if (ecrit !== null) expect.soft(ecrit, `${libelle} : réponse ${r.status} — RIEN ne doit avoir été écrit dans le bureau A`).toBe(false);
        if (fuite !== null) expect.soft(fuite, `${libelle} : la réponse ${r.status} ne doit contenir aucune donnée du bureau A`).toBe(false);
      };

      for (const role of ROLES_A.filter((x) => !route.autorises.includes(x))) {
        await refus(role, `${LIBELLE[role]} (sans ${route.cle})`, await jeton(role), bureau.orgA, [403], true);
      }
      // Autre bureau, dans SON bureau, en visant l'objet de A : 403 ou 404 quand la route cible un identifiant.
      // (La publication en lot répond toujours 200 avec un résultat par règle ; l'ancien pipeline n'est pas relu : S-18.)
      const codeLibre = !route.cibleA || route.id === 'API-25' || route.id === 'API-34';
      await refus('proprioB (son bureau, objet de A)', 'autre bureau', await jeton('proprioB'), bureau.orgB, [403, 404], !codeLibre);
      await refus('proprioB (x-org-id = A)', 'autre bureau se réclamant du bureau A', await jeton('proprioB'), bureau.orgA, [403], true);
      await refus('sans jeton', 'sans jeton', null, bureau.orgA, [401], true);
      // Dernier regard, plus patient : aucun des refus ci-dessus n'a laissé de trace tardive dans le bureau A.
      if (route.aEcrit) expect.soft(await route.aEcrit(outils, ctx, s, 5_000), 'après tous les refus, rien n’a été écrit dans le bureau A').toBe(false);
      if (route.menage) await route.menage(outils, ctx, s);

      consigner(route, cases);
    });
  }
});

test.describe('API directe — adresse d’appel publique', () => {
  test('[API-43] POST /api/hooks/:cle — la clé seule ouvre la porte : bonne clé = reçu dans SON bureau, clé inconnue ou coupée = 404, jamais un autre bureau', async ({ outils, bureau, baseURL }) => {
    test.setTimeout(300_000);
    const base = baseURL!; // fixé par la config Playwright
    const ins = async (org: string, nom: string, extra: Record<string, unknown> = {}) => {
      const { data, error } = await bureau.admin.from('automation_webhooks').insert({ org_id: org, name: `${outils.marque} ${nom}`, ...extra }).select('id, api_key').single();
      if (error || !data) throw new Error(`adresse d’appel : ${error?.message}`);
      return data as { id: string; api_key: string };
    };
    const active = await ins(bureau.orgA, 'active');
    const coupee = await ins(bureau.orgA, 'coupée', { enabled: false });
    const recus = async (id: string) => {
      const { data } = await bureau.admin.from('automation_webhook_receipts').select('org_id, statut, corps').eq('webhook_id', id);
      return data ?? [];
    };
    try {
      const charge = { prenom: 'Test', courriel: 'prospect-roles@lume-qa.test', telephone: '+15555550178' };
      // Aucune session : seul le chemin compte.
      const bon = await api(base, null, null, 'POST', `/api/hooks/${active.api_key}`, charge);
      expect(bon.status, bon.texte.slice(0, 200)).toBe(200);
      const lignes = await recus(active.id);
      expect(lignes.length, 'un reçu est tracé').toBe(1);
      expect(lignes[0].org_id, 'le reçu appartient au bureau de la clé').toBe(bureau.orgA);

      const inconnue = await api(base, null, null, 'POST', `/api/hooks/${'0'.repeat(64)}`, charge);
      expect(inconnue.status).toBe(404);
      const off = await api(base, null, null, 'POST', `/api/hooks/${coupee.api_key}`, charge);
      expect(off.status, 'une adresse désactivée ne répond plus').toBe(404);
      expect((await recus(coupee.id)).filter((l) => l.statut === 'accepte'), 'aucun appel accepté sur une adresse coupée').toHaveLength(0);

      // Se réclamer d'un autre bureau par en-tête ne change rien : le bureau vient de la clé.
      const usurpe = await api(base, null, bureau.orgB, 'POST', `/api/hooks/${active.api_key}`, charge);
      expect(usurpe.status).toBe(200);
      const { count } = await bureau.admin.from('automation_webhook_receipts').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgB).eq('webhook_id', active.id);
      expect(count ?? 0, 'aucun reçu ne naît dans le bureau B').toBe(0);
    } finally {
      await bureau.admin.from('automation_webhook_receipts').delete().in('webhook_id', [active.id, coupee.id]);
      await bureau.admin.from('automation_webhooks').delete().in('id', [active.id, coupee.id]);
    }
  });
});

// Garde : les six rôles du bureau A ont bien, en base, les droits que ce fichier suppose.
test('[MAT-00] les comptes de la matrice portent les rôles et surcharges attendus', async ({ bureau, perso }) => {
  const attendu: Array<{ role: Role; id: string; r: string; p: Record<string, boolean> | null }> = [
    { role: 'proprioA', id: bureau.comptes.proprioA.id, r: 'owner', p: null },
    { role: 'adminA', id: bureau.comptes.adminA.id, r: 'admin', p: null },
    { role: 'techA', id: bureau.comptes.techA.id, r: 'technician', p: null },
    { role: 'vendeurA', id: perso.vendeurA.id, r: 'sales_rep', p: null },
    { role: 'lecteurA', id: perso.lecteurA.id, r: 'sales_rep', p: { 'automations.read': true } },
    { role: 'editeurA', id: perso.editeurA.id, r: 'sales_rep', p: { 'automations.read': true, 'automations.update': true } },
  ];
  for (const a of attendu) {
    const { data } = await bureau.admin.from('memberships').select('role, status, permissions').eq('org_id', bureau.orgA).eq('user_id', a.id).maybeSingle();
    expect(data?.role, a.role).toBe(a.r);
    expect(data?.status, a.role).toBe('active');
    const p = (data?.permissions ?? {}) as Record<string, boolean>;
    expect(p['automations.read'] ?? null, `${a.role} : surcharge automations.read`).toBe(a.p?.['automations.read'] ?? null);
    expect(p['automations.update'] ?? null, `${a.role} : surcharge automations.update`).toBe(a.p?.['automations.update'] ?? null);
  }
  // Et le propriétaire de B n'a aucune adhésion dans A.
  const { count } = await bureau.admin.from('memberships').select('user_id', { count: 'exact', head: true }).eq('org_id', bureau.orgA).eq('user_id', bureau.comptes.proprioB.id);
  expect(count ?? 0).toBe(0);
});
