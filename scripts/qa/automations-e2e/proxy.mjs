#!/usr/bin/env node
/**
 * Proxy local façon Kong pour la pile des E2E des automatisations : le navigateur et l'API parlent à
 * http://127.0.0.1:48421 comme à un projet Supabase.
 *   /auth/v1     → GoTrue
 *   /rest/v1     → PostgREST
 *   /realtime/v1 → Realtime (HTTP et WebSocket ; l'hôte « realtime-dev.… » désigne le locataire semé)
 * Le stockage n'est pas servi (404) : la section Automatisations ne téléverse rien.
 */
import http from 'node:http';
import net from 'node:net';
import { PILE } from './local.mjs';

const CIBLES = [
  ['/auth/v1', PILE.authUrl, null],
  ['/rest/v1', PILE.restUrl, null],
  ['/realtime/v1', PILE.realtimeUrl, 'realtime-dev.localhost'],
];
const port = Number(new URL(PILE.proxyUrl).port);
const trouver = (chemin) => CIBLES.find(([prefixe]) => chemin.startsWith(prefixe));

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
  const cible = trouver(req.url);
  if (!cible) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"message":"non servi par la pile locale"}'); return; }
  // Realtime attend ses routes HTTP sous /api, son WebSocket sous /socket (comme derrière Kong).
  const reste = req.url.slice(cible[0].length) || '/';
  const chemin = cible[0] === '/realtime/v1' ? (reste.startsWith('/api') ? reste : `/api${reste}`) : reste;
  const url = new URL(chemin, cible[1]);
  const amont = http.request(url, { method: req.method, headers: { ...req.headers, host: cible[2] ?? url.host } }, (r) => {
    const entetes = { ...r.headers };
    for (const e of Object.keys(entetes)) if (e.startsWith('access-control-')) delete entetes[e];
    res.writeHead(r.statusCode || 502, entetes);
    r.pipe(res);
  });
  amont.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(amont);
});

// WebSocket du temps réel : on relaie la poignée de main telle quelle, puis les deux sens du tuyau.
serveur.on('upgrade', (req, socket, tete) => {
  const cible = trouver(req.url);
  if (!cible || cible[0] !== '/realtime/v1') { socket.destroy(); return; }
  const amontUrl = new URL(cible[1]);
  const chemin = `/socket${req.url.slice(cible[0].length)}`;
  const amont = net.connect(Number(amontUrl.port), amontUrl.hostname, () => {
    const lignes = [`${req.method} ${chemin} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const nom = req.rawHeaders[i];
      lignes.push(`${nom}: ${nom.toLowerCase() === 'host' ? cible[2] : req.rawHeaders[i + 1]}`);
    }
    amont.write(`${lignes.join('\r\n')}\r\n\r\n`);
    if (tete?.length) amont.write(tete);
    socket.pipe(amont);
    amont.pipe(socket);
  });
  const fermer = () => { socket.destroy(); amont.destroy(); };
  amont.on('error', fermer);
  socket.on('error', fermer);
  amont.on('close', fermer);
  socket.on('close', fermer);
});

serveur.listen(port, '127.0.0.1', () => console.log(`proxy de la pile locale sur ${PILE.proxyUrl}`));
