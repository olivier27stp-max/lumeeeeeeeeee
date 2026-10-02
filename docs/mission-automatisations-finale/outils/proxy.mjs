#!/usr/bin/env node
/**
 * Proxy local façon Kong pour la pile `lumefinal` : le navigateur et supabase-js parlent à
 * http://localhost:44921 comme à un projet Supabase (/auth/v1 → GoTrue, /rest/v1 → PostgREST).
 * Le temps réel et le stockage ne sont pas servis (404).
 *
 * Robuste sous charge (plusieurs agents à la fois) : connexions gardées ouvertes longtemps côté
 * client (le défaut de Node, 5 s, faisait tomber des « fetch failed » quand un client réutilisait
 * une connexion tout juste fermée), agent à connexions persistantes vers l'amont, erreurs de
 * socket absorbées, jamais d'exception non gérée.
 */
import http from 'node:http';
import { LOCAL } from './local.mjs';

const CIBLES = [['/auth/v1', LOCAL.authUrl], ['/rest/v1', LOCAL.restUrl]];
const port = Number(new URL(LOCAL.proxyUrl).port);
const agent = new http.Agent({ keepAlive: true, maxSockets: 128, keepAliveMsecs: 30_000 });

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Total-Count');
}

const serveur = http.createServer((req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const cible = CIBLES.find(([prefixe]) => req.url.startsWith(prefixe));
  if (!cible) { res.writeHead(404); res.end(); return; }
  const url = new URL(req.url.slice(cible[0].length) || '/', cible[1]);
  const entetes = { ...req.headers, host: url.host };
  delete entetes.connection;
  const amont = http.request(url, { method: req.method, headers: entetes, agent, timeout: 120_000 }, (r) => {
    const sortie = { ...r.headers };
    delete sortie['access-control-allow-origin'];
    delete sortie.connection;
    if (!res.headersSent) res.writeHead(r.statusCode || 502, sortie);
    r.on('error', () => res.destroy());
    r.pipe(res);
  });
  amont.on('timeout', () => amont.destroy(new Error('délai amont dépassé')));
  amont.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } else res.destroy(); });
  req.on('error', () => amont.destroy());
  res.on('close', () => { if (!res.writableEnded) amont.destroy(); });
  req.pipe(amont);
});
serveur.keepAliveTimeout = 120_000;
serveur.headersTimeout = 125_000;
serveur.on('clientError', (_e, socket) => { try { socket.destroy(); } catch { /* déjà fermé */ } });
process.on('uncaughtException', (e) => console.error('[proxy] exception absorbée :', e?.message || e));
serveur.listen(port, () => console.log(`proxy lumefinal sur http://localhost:${port}`));
