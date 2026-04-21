import fs from 'fs';
import path from 'path';

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const tablesReferenced = new Set();
for (const f of walk('src').concat(walk('server'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\.from\(['"](\w+)['"]\)/g)) {
    tablesReferenced.add(m[1]);
  }
}

const tablesCreated = new Set();
const sqlDirs = ['supabase/migrations', 'supabase'];
for (const d of sqlDirs) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.sql')) continue;
    const src = fs.readFileSync(path.join(d, f), 'utf8');
    for (const m of src.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi)) {
      tablesCreated.add(m[1]);
    }
    // Also pick up CREATE OR REPLACE VIEW
    for (const m of src.matchAll(/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?(\w+)/gi)) {
      tablesCreated.add(m[1]);
    }
    // Materialized views
    for (const m of src.matchAll(/create\s+materialized\s+view\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi)) {
      tablesCreated.add(m[1]);
    }
  }
}

const missing = [...tablesReferenced].filter((t) => !tablesCreated.has(t)).sort();
console.log('Tables referenced in code but NEVER created in SQL:');
for (const t of missing) console.log('  - ' + t);
console.log('\nTotal referenced:', tablesReferenced.size, '| found:', tablesReferenced.size - missing.length, '| missing:', missing.length);
