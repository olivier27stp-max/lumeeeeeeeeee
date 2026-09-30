/**
 * Inventaire des outils de Lumi, GÉNÉRÉ depuis le code (audit 2026-09-30).
 *   npx tsx scripts/audit/inventaire-outils-lumi.mts [--json sortie.json]
 * Lit le registre réel (TOOLS_BY_NAME), la garde (PERMISSION_PAR_OUTIL,
 * OUTILS_FINANCIERS), le registre des écritures (sensible / réversible /
 * vers le client), les topics, les préréglages de rôle, et le SOURCE de
 * chaque handler (idempotence, routes de l'app, RPC, tables écrites).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOLS_BY_NAME } from '../../server/lib/agent/tools';
import { PERMISSION_PAR_OUTIL, OUTILS_FINANCIERS } from '../../server/lib/agent/garde';
import { REGISTRE_ECRITURES } from '../../server/lib/agent/registre';
import { TOPICS } from '../../server/lib/lumi/topics';
import { ROLE_PRESETS, type TeamRole } from '../../src/lib/permissions';

const RACINE = resolve(import.meta.dirname, '../..');
const MODULES = ['tools.ts', 'tools-etendus.ts', 'tools-leads.ts', 'tools-argent.ts', 'tools-terrain.ts', 'tools-equipe.ts', 'tools-reglages.ts', 'tools-d2d-formations.ts', 'tools-rapports.ts', 'tools-aide.ts'];
const sources = Object.fromEntries(MODULES.map((m) => [m, readFileSync(resolve(RACINE, 'server/lib/agent', m), 'utf8')]));
const moduleDe = (nom: string) => MODULES.find((m) => new RegExp(`name:\\s*'${nom}'`).test(sources[m])) ?? '?';

const fichiersTests = readdirSync(resolve(RACINE, 'tests'), { recursive: true }).map(String).filter((f) => /\.(test|spec)\.tsx?$/.test(f));
const textesTests = fichiersTests.map((f) => [f, readFileSync(resolve(RACINE, 'tests', f), 'utf8')] as const);

const topicDe = (nom: string) => TOPICS.filter((t) => t.outils.includes(nom)).map((t) => t.id).join(', ') || '(différé)';
const ROLES: TeamRole[] = ['owner', 'admin', 'sales_rep', 'technician'];

function categorie(nom: string, attrs: (typeof REGISTRE_ECRITURES)[string] | undefined): string | null {
  if (/refund|charge_card|card_on_file|payment|invoice|paid|deposit|tip|payout|dispute|milestone|recurring_invoice|tax/.test(nom)) return 'argent';
  if (attrs?.vers_client || /^send_|_sms|_email|resend_|agreement/.test(nom)) return 'envoi client';
  if (/member|role|permission|invit|preset|reactivate/.test(nom)) return 'droits';
  if (/payroll|hourly_rate|punch|break|timesheet|pay_period/.test(nom)) return 'paie';
  return attrs?.sensible ? 'autre sensible' : null;
}

const lignes = Object.values(TOOLS_BY_NAME).map((t) => {
  const nom = t.declaration.name;
  const ecriture = t.kind === 'write';
  const attrs = REGISTRE_ECRITURES[nom];
  const regle = PERMISSION_PAR_OUTIL[nom];
  const src = t.handler ? t.handler.toString() : '';
  const routes = [...src.matchAll(/viaRoute\(\s*ctx,\s*[`'"]([^`'"]+)/g), ...src.matchAll(/fetch\([^)]*?(\/api\/[a-z0-9/_:-]+)/gi)].map((m) => m[1]);
  const rpcs = [...src.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
  const tablesEcrites = [...src.matchAll(/\.from\('([a-z0-9_]+)'\)\s*\.(insert|update|upsert|delete)/g)].map((m) => `${m[1]}.${m[2]}`);
  const tests = textesTests.filter(([, x]) => x.includes(`'${nom}'`) || x.includes(`"${nom}"`)).map(([f]) => f);
  const cat = ecriture ? categorie(nom, attrs) : null;
  return {
    nom,
    module: moduleDe(nom),
    topic: topicDe(nom),
    genre: ecriture ? 'action' : 'lecture',
    sensible: ecriture ? (attrs?.sensible || cat === 'argent' || cat === 'envoi client' || cat === 'droits' || cat === 'paie') : false,
    categorie: cat,
    registre: attrs ? { sensible: attrs.sensible, reversible: attrs.reversible, vers_client: attrs.vers_client, anodine: attrs.anodine } : null,
    permission: regle?.cle ?? null,
    financier: OUTILS_FINANCIERS.has(nom),
    identite_requise: Boolean(t.needsIdentity),
    idempotent: /executerIdempotent\(/.test(src),
    routes_app: [...new Set(routes)],
    rpc: [...new Set(rpcs)],
    tables_ecrites: [...new Set(tablesEcrites)],
    presets: regle ? Object.fromEntries(ROLES.map((r) => [r, r === 'owner' || ROLE_PRESETS[r]?.[regle.cle] === true])) : null,
    tests,
  };
});

const out = process.argv.indexOf('--json');
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(lignes, null, 1));
const n = (p: (l: (typeof lignes)[number]) => boolean) => lignes.filter(p).length;
console.log(`outils ${lignes.length} · actions ${n((l) => l.genre === 'action')} · lectures ${n((l) => l.genre === 'lecture')}`);
console.log(`actions sensibles ${n((l) => l.genre === 'action' && l.sensible)} · sans permission de la page Rôles ${n((l) => !l.permission)} (dont actions ${n((l) => !l.permission && l.genre === 'action')})`);
console.log(`actions non idempotentes ${n((l) => l.genre === 'action' && !l.idempotent)} · actions sans entrée au registre ${n((l) => l.genre === 'action' && !l.registre)}`);
console.log(`actions qui écrivent en direct (sans route de l'app ni RPC) ${n((l) => l.genre === 'action' && !l.routes_app.length && !l.rpc.length && l.tables_ecrites.length > 0)}`);
console.log(`outils sans aucun test qui les nomme ${n((l) => l.tests.length === 0)}`);
