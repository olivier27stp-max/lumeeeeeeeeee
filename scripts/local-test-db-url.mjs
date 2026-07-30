/**
 * Vérifie une chaîne de connexion Postgres AVANT de la coller dans un secret.
 *
 * Le cycle « coller dans GitHub → pousser → attendre la CI → lire le log »
 * prend plusieurs minutes par essai. Ce script donne la même réponse en
 * quelques secondes, en local, et dit précisément lequel des quatre
 * problèmes se produit.
 *
 * Usage :
 *   node scripts/local-test-db-url.mjs "postgresql://user:pass@host:5432/postgres"
 *
 * Le mot de passe n'est jamais affiché ni enregistré.
 */
import { Client } from 'pg';

const raw = process.argv[2];
if (!raw) {
  console.error('Usage: node scripts/local-test-db-url.mjs "postgresql://..."');
  process.exit(2);
}

// Même découpage que scripts/test-rls-isolation.ts : sur le DERNIER "@" et le
// PREMIER ":", pour qu'un mot de passe contenant @ / # ? % survive intact.
function parseConn(url) {
  const m = /^postgres(?:ql)?:\/\/(.+)$/i.exec(url.trim());
  if (!m) throw new Error('doit commencer par postgresql://');
  const rest = m[1];
  const at = rest.lastIndexOf('@');
  if (at < 0) throw new Error('il manque le "@" avant l\'hôte');
  const creds = rest.slice(0, at);
  const hostPart = rest.slice(at + 1);
  const colon = creds.indexOf(':');
  if (colon < 0) throw new Error('il manque le ":" entre l\'utilisateur et le mot de passe');
  const slash = hostPart.indexOf('/');
  const hostPort = slash < 0 ? hostPart : hostPart.slice(0, slash);
  const [host, portRaw] = hostPort.split(':');
  return {
    host,
    port: Number(portRaw || 5432),
    user: decodeURIComponent(creds.slice(0, colon)),
    password: creds.slice(colon + 1),
    database: slash < 0 ? 'postgres' : (hostPart.slice(slash + 1).split('?')[0] || 'postgres'),
  };
}

let conn;
try {
  conn = parseConn(raw);
} catch (e) {
  console.error('✗ Chaîne malformée :', e.message);
  process.exit(1);
}

console.log('Lecture de la chaîne :');
console.log('  hôte           :', conn.host);
console.log('  port           :', conn.port, conn.port === 6543 ? '⚠ le pooler transaction ne convient pas — utilisez 5432' : '');
console.log('  utilisateur    :', conn.user);
console.log('  base           :', conn.database);
console.log('  mot de passe   :', conn.password.length, 'caractères');
console.log('');

const c = new Client({ ...conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });

try {
  await c.connect();
  const r = await c.query('select current_user, current_database()');
  console.log('✅ CONNEXION RÉUSSIE —', r.rows[0].current_user, '/', r.rows[0].current_database);
  console.log('\nCette chaîne est valide : collez-la telle quelle dans le secret RLS_TEST_DB_URL.');
  await c.end();
  process.exit(0);
} catch (e) {
  const msg = e.message || String(e);
  console.error('✗', msg, '\n');
  if (/password authentication failed/i.test(msg)) {
    console.error('  L\'hôte et le format sont bons — seul le mot de passe est refusé.');
    console.error('  → Régénérez-le : Supabase → Project Settings → Database → Database password,');
    console.error('    puis copiez-le IMMÉDIATEMENT (il n\'est affiché qu\'une fois).');
  } else if (/tenant or user not found|ENOTFOUND/i.test(msg)) {
    console.error('  Hôte ou utilisateur non reconnu.');
    console.error('  → L\'hôte doit être aws-1-<région>.pooler.supabase.com (et non aws-0-).');
    console.error('  → L\'utilisateur doit être postgres.<ref-du-projet>.');
  }
  process.exit(1);
}
