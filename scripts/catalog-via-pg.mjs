/**
 * catalog-via-pg.mjs — exécute une requête SQL (lue sur stdin) via une
 * connexion Postgres directe (DB_URL) et imprime les lignes en JSON.
 *
 * Sert à check-schema-refs.py en CI : le jeton de l'API de gestion Supabase
 * (SUPABASE_ACCESS_TOKEN) peut appliquer du SQL sur la PROD — on ne le met pas
 * dans GitHub Actions. La CI n'a que RLS_TEST_DB_URL (staging, Postgres) ;
 * ce pont lui suffit pour lire pg_catalog.
 */
import pg from 'pg';
const sql = await new Promise((resolve, reject) => {
  let s = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => resolve(s)); process.stdin.on('error', reject);
});
const url = process.env.DB_URL;
if (!url) { console.error('DB_URL manquant'); process.exit(2); }
const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows } = await client.query(sql);
  process.stdout.write(JSON.stringify(rows));
} finally {
  await client.end();
}
