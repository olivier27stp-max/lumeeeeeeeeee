#!/usr/bin/env node
/**
 * Proxy local façon Kong pour la stack de l'audit Statistiques : le navigateur parle à
 * http://localhost:47421 comme à un projet Supabase (/auth/v1 → GoTrue, /rest/v1 → PostgREST).
 * Le temps réel et le stockage ne sont pas servis (404) : /insights n'en dépend pas.
 */
import http from 'node:http';
import { STATS_LOCAL } from './stats-local.mjs';

const CIBLES = [['/auth/v1', STATS_LOCAL.authUrl], ['/rest/v1', STATS_LOCAL.restUrl]];
const port = Number(new URL(STATS_LOCAL.proxyUrl).port);

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Total-Count');
}

http.createServer((req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const cible = CIBLES.find(([prefixe]) => req.url.startsWith(prefixe));
  if (!cible) { res.writeHead(404); res.end(); return; }
  const url = new URL(req.url.slice(cible[0].length) || '/', cible[1]);
  const amont = http.request(url, { method: req.method, headers: { ...req.headers, host: url.host } }, (r) => {
    const entetes = { ...r.headers };
    delete entetes['access-control-allow-origin'];
    res.writeHead(r.statusCode || 502, entetes);
    r.pipe(res);
  });
  amont.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(amont);
}).listen(port, () => console.log(`proxy stats sur http://localhost:${port}`));
