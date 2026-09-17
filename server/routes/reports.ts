/**
 * Rapports (Réglages → Rapports).
 *
 *  GET /api/reports/catalogue                      → rapports visibles par l'utilisateur, par catégorie
 *  GET /api/reports/definition?report=<id>         → colonnes, filtres (options résolues), tri par défaut
 *  GET /api/reports/rows?report=<id>&…             → une page de lignes + total + totaux (JSON)
 *  GET /api/reports/export.csv?report=<id>&…       → TOUTES les lignes filtrées/triées, en flux CSV
 *
 * Paramètres communs : from, to (YYYY-MM-DD), dateField, sort, dir,
 * f_<filtre>=valeur, page, pageSize, lang.
 *
 * Sécurité :
 *  - `financial.view_reports` pour lire, `financial.export_data` pour le CSV
 *    (déclarés dans route-permissions.ts ET revérifiés ici) ;
 *  - lecture des données sous le JWT de l'utilisateur (RLS : isolation par
 *    org, portée « ses propres données » des vendeurs, masquage des montants) ;
 *  - l'org vient de requireAuthedClient (header x-org-id validé par
 *    appartenance), jamais de la requête ;
 *  - plafond d'export explicite (EXPORT_MAX_ROWS) : au-delà on refuse avec un
 *    message, jamais de fichier tronqué en silence ;
 *  - chaque CSV est journalisé dans data_export_log (type « report »).
 */
import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { getUserContext, hasPermission } from '../lib/rbac';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { sendSafeError } from '../lib/error-handler';
import { logDataExport } from '../lib/data-export-log';
import { dateDuJour } from '../lib/date-seule';
import { logger } from '../lib/logger';
import { REPORT_CATEGORIES, EXPORT_MAX_ROWS, type Lang, type ReportContext, type ReportQuery } from '../lib/reports/types';
import { getReport, listReports, publicDefinition } from '../lib/reports/registry';
import { fetchPage, countAll, iterateAll } from '../lib/reports/engine';
import { csvHeader, csvRows, csvFilename } from '../lib/reports/csv';
import { DATE_ONLY_RE } from '../lib/reports/dates';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

const REPORT_ID_RE = /^[a-z0-9-]{2,40}$/;
const PAGE_SIZES = [20, 50, 100];

function lang(req: any): Lang {
  return String(req.query.lang || '').toLowerCase() === 'en' ? 'en' : 'fr';
}

/** Contexte de rapport : auth + rôle + clients. Répond lui-même en cas de refus. */
async function buildContext(req: any, res: any, needed: 'financial.view_reports' | 'financial.export_data'): Promise<ReportContext | null> {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  const userCtx = await getUserContext(auth.client, auth.user.id, auth.orgId);
  if (!userCtx) { res.status(403).json({ error: 'Membership not found.' }); return null; }
  if (!hasPermission(userCtx, 'financial.view_reports') || !hasPermission(userCtx, needed)) {
    res.status(403).json({ error: `Permission denied: ${needed}` });
    return null;
  }
  return {
    user: auth.client,
    service: getServiceClient(),
    orgId: auth.orgId,
    userId: auth.user.id,
    role: userCtx.role,
    isAdmin: userCtx.role === 'owner' || userCtx.role === 'admin',
    lang: lang(req),
    today: dateDuJour(),
  };
}

/** Lit et borne les paramètres de requête d'un rapport. */
function parseQuery(req: any): ReportQuery {
  const q = req.query || {};
  const from = DATE_ONLY_RE.test(String(q.from || '')) ? String(q.from) : undefined;
  const to = DATE_ONLY_RE.test(String(q.to || '')) ? String(q.to) : undefined;
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (!k.startsWith('f_')) continue;
    const key = k.slice(2);
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) continue;
    const val = Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
    if (val.length > 200) continue;
    filters[key] = val;
  }
  const dateField = /^[a-zA-Z0-9_]{1,40}$/.test(String(q.dateField || '')) ? String(q.dateField) : undefined;
  const sortKey = /^[a-zA-Z0-9_]{1,60}$/.test(String(q.sort || '')) ? String(q.sort) : '';
  const dir = String(q.dir) === 'asc' ? 'asc' : String(q.dir) === 'desc' ? 'desc' : undefined;
  return {
    from: from && to && from > to ? to : from,
    to: from && to && from > to ? from : to,
    dateField,
    filters,
    sort: { key: sortKey, dir: dir as 'asc' | 'desc' },
  };
}

function resolveReport(req: any, res: any) {
  const id = String(req.query.report || '');
  if (!REPORT_ID_RE.test(id)) { res.status(400).json({ error: 'Invalid report id.' }); return null; }
  const def = getReport(id);
  if (!def || def.link) { res.status(404).json({ error: 'Unknown report.' }); return null; }
  return def;
}

// ── Catalogue ───────────────────────────────────────────────────────
router.get('/reports/catalogue', async (req, res) => {
  try {
    const ctx = await buildContext(req, res, 'financial.view_reports');
    if (!ctx) return;
    const userCtx = await getUserContext(ctx.user, ctx.userId, ctx.orgId);
    const canExport = !!userCtx && hasPermission(userCtx, 'financial.export_data');
    const reports = listReports()
      .filter((def) => !!userCtx && hasPermission(userCtx, def.permission))
      .map((def) => ({
        id: def.id,
        category: def.category,
        title: def.title,
        description: def.description,
        link: def.link || null,
      }));
    return res.json({ categories: REPORT_CATEGORIES, reports, canExport, exportMaxRows: EXPORT_MAX_ROWS });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to load reports.', '[reports/catalogue]');
  }
});

// ── Définition (colonnes + filtres avec options) ────────────────────
router.get('/reports/definition', async (req, res) => {
  try {
    const ctx = await buildContext(req, res, 'financial.view_reports');
    if (!ctx) return;
    const def = resolveReport(req, res);
    if (!def) return;
    return res.json(await publicDefinition(def, ctx));
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to load report definition.', '[reports/definition]');
  }
});

// ── Une page de lignes ──────────────────────────────────────────────
router.get('/reports/rows', async (req, res) => {
  try {
    const ctx = await buildContext(req, res, 'financial.view_reports');
    if (!ctx) return;
    const def = resolveReport(req, res);
    if (!def) return;
    const q = parseQuery(req);
    const page = Math.max(1, Math.min(100_000, Number(req.query.page) || 1));
    const requested = Number(req.query.pageSize) || 50;
    const pageSize = PAGE_SIZES.includes(requested) ? requested : 50;
    const out = await fetchPage(def, ctx, q, page, pageSize);
    return res.json({ ...out, page, pageSize, exportMaxRows: EXPORT_MAX_ROWS });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to load report rows.', '[reports/rows]');
  }
});

// ── Export CSV complet (flux) ───────────────────────────────────────
router.get('/reports/export.csv', async (req, res) => {
  try {
    const ctx = await buildContext(req, res, 'financial.export_data');
    if (!ctx) return;
    const def = resolveReport(req, res);
    if (!def) return;
    const q = parseQuery(req);

    const { total, preloaded } = await countAll(def, ctx, q);
    if (total > EXPORT_MAX_ROWS) {
      return res.status(413).json({
        error: ctx.lang === 'fr'
          ? `Export refusé : ${total.toLocaleString('fr-CA')} lignes dépassent le plafond de ${EXPORT_MAX_ROWS.toLocaleString('fr-CA')}. Réduis la période ou ajoute un filtre.`
          : `Export refused: ${total.toLocaleString('en-CA')} rows exceed the ${EXPORT_MAX_ROWS.toLocaleString('en-CA')} row limit. Narrow the period or add a filter.`,
        code: 'EXPORT_TOO_LARGE',
        total,
        max: EXPORT_MAX_ROWS,
      });
    }

    // Journalisé AVANT l'envoi : si le flux casse en cours de route, on sait
    // quand même qui a demandé quoi (l'intention compte, pas le nombre d'octets).
    await logDataExport({
      orgId: ctx.orgId,
      userId: ctx.userId,
      exportType: 'report',
      entityType: def.id,
      recordCount: total,
      req,
    });

    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilename(def.id, q.from, q.to, ctx.today)}"`);
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Report-Rows', String(total));
    res.flushHeaders();
    res.write(csvHeader(def.columns, ctx.lang));
    for await (const batch of iterateAll(def, ctx, q, preloaded)) {
      if (!res.write(csvRows(def.columns, batch, ctx.lang))) {
        await new Promise<void>((resolve) => res.once('drain', () => resolve()));
      }
    }
    return res.end();
  } catch (err: any) {
    if (res.headersSent) {
      // Le flux est entamé : on ne peut plus renvoyer de JSON. On coupe la
      // connexion pour que le navigateur signale un téléchargement échoué
      // plutôt que de livrer un fichier partiel qui a l'air complet.
      logger.error('[reports/export] flux CSV interrompu', { message: err?.message || String(err) });
      res.destroy(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    return sendSafeError(res, err, 'Failed to export report.', '[reports/export]');
  }
});

export default router;
