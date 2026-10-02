#!/usr/bin/env node
/**
 * Lecture seule dans la base de la pile LOCALE (service) — pour trancher un échec sans ouvrir de console.
 *   node D:/lume-uiaudit/outils/roles/lire-local.mjs <table> "<colonnes>" [col=valeur …] [--limit=N] [--order=col]
 * `col=valeur` : égalité ; `col~motif` : ilike ; `col=null` : is null. `@A` / `@B` = bureau A / B du jeu « roles ».
 * Parle à PostgREST directement (client-local.mjs) ; refuse toute adresse qui n'est pas 127.0.0.1. N'écrit rien.
 */
import { clientService } from './client-local.mjs';

const a = clientService();
const [table, colonnes, ...reste] = process.argv.slice(2);
if (!table) { console.error('usage : lire-local.mjs <table> "<colonnes>" [col=valeur …]'); process.exit(1); }
const bureau = async (l) => {
  const { data } = await a.from('orgs').select('id').eq('name', `[TEST] QA Automatisations ${l} (roles) — ne pas utiliser`).is('deleted_at', null).maybeSingle();
  return data?.id ?? `bureau-${l}-introuvable`;
};
let q = a.from(table).select(colonnes || '*', { count: 'exact' });
let limite = 20;
for (const arg of reste) {
  if (arg.startsWith('--limit=')) { limite = Number(arg.slice(8)); continue; }
  if (arg.startsWith('--order=')) { q = q.order(arg.slice(8), { ascending: false }); continue; }
  const ilike = arg.indexOf('~');
  const egal = arg.indexOf('=');
  if (ilike !== -1 && (egal === -1 || ilike < egal)) { q = q.ilike(arg.slice(0, ilike), arg.slice(ilike + 1)); continue; }
  const col = arg.slice(0, egal);
  let val = arg.slice(egal + 1);
  if (val === '@A') val = await bureau('A');
  if (val === '@B') val = await bureau('B');
  q = val === 'null' ? q.is(col, null) : q.eq(col, val);
}
const { data, error, count } = await q.limit(limite);
if (error) { console.error(`ERREUR ${error.code ?? ''} ${error.message}`); process.exitCode = 3; } else {
  console.log(`${count} ligne(s)`);
  for (const l of data) console.log(JSON.stringify(l));
}
