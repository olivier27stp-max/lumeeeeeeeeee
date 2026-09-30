/**
 * Faux serveur OSRM pour les tests de l'Agenda (aucun appel réel).
 *
 *   node --import tsx scripts/qa/agenda/osrm-simule.mts   → http://127.0.0.1:5899
 *   puis OSRM_BASE_URL=http://127.0.0.1:5899 pour l'API locale.
 *
 * Même matrice déterministe que la carte simulée des tests navigateur :
 * vol d'oiseau × 1,3 à 60 km/h. GET /_compteurs rend le nombre d'appels
 * reçus (mesure des coûts), POST /_zero le remet à zéro.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.OSRM_SIMULE_PORT || 5899);
let appels = 0;

function volOiseau(a: [number, number], b: [number, number]): number {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/_compteurs') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ appels })); }
  if (url.pathname === '/_zero') { appels = 0; return res.end('{}'); }
  const m = url.pathname.match(/^\/table\/v1\/driving\/(.+)$/);
  if (!m) { res.statusCode = 404; return res.end('{}'); }
  appels++;
  const pts = decodeURIComponent(m[1]).split(';').map((p) => p.split(',').map(Number) as [number, number]);
  const distances = pts.map((a) => pts.map((b) => Math.round(volOiseau(a, b) * 1.3)));
  const durations = distances.map((l) => l.map((d) => Math.round(d / (60000 / 3600))));
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ code: 'Ok', durations, distances }));
}).listen(PORT, '127.0.0.1', () => console.log(`OSRM simulé sur http://127.0.0.1:${PORT}`));
