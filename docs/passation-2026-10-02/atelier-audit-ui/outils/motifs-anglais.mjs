// Relève les messages d'échec en ANGLAIS que le moteur peut écrire dans les journaux (lecture de source).
import { readFileSync } from 'node:fs';
const racine = process.argv[2] ?? 'D:/lume-uiaudit/wt-lumi/';
const fichiers = ['server/lib/actions/index.ts', 'server/lib/automationEngine.ts', 'server/lib/notificationHelpers.ts', 'server/lib/mailer.ts'];
const anglais = /\b(the|not|no|was|is|has|have|for|already|failed|missing|skipped|reached|disabled|cannot|invalid|unknown|found|configured|required)\b/i;
const francais = /[àâçéèêëîïôùûœ’]|\b(le|la|les|pas|aucune?|introuvable|une?|est|pour|déjà|ce|cette|des|du|sans|ne|rien)\b/i;
const vus = new Map();
for (const f of fichiers) {
  let s; try { s = readFileSync(racine + f, 'utf8'); } catch { continue; }
  for (const m of s.matchAll(/error:\s*(?:'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g)) {
    const t = (m[1] ?? m[2] ?? '').replace(/\\'/g, "'");
    if (t.length < 8 || !anglais.test(t) || francais.test(t)) continue;
    if (!vus.has(t)) vus.set(t, f);
  }
}
for (const [t, f] of vus) console.log(`${f.split('/').pop()} :: ${t}`);
console.log('total', vus.size);
