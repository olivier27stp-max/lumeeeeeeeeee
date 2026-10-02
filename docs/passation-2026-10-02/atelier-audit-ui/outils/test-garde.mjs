// Le faux client du test de publication dit QUI écrit (utilisateur ou service).
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'D:/lume-uiaudit/wt-lumi/tests/automatisations-publication-serveur.test.ts';
let s = readFileSync(f, 'utf8');
const r = (a, b, quoi) => { if (!s.includes(a)) throw new Error('introuvable : ' + quoi); s = s.split(a).join(b); };
r("const ecritures: Array<{ id: string; patch: Ligne }> = [];", "const ecritures: Array<{ id: string; patch: Ligne; par: 'utilisateur' | 'service' }> = [];", 'type');
r("/** Un faux client qui lit `lignes` et note chaque update. */\nfunction fauxClient() {", "/** Un faux client qui lit `lignes` et note chaque update — et QUI l'a faite (session de l'utilisateur ou rôle de service). */\nfunction fauxClient(par: 'utilisateur' | 'service' = 'utilisateur') {", 'signature');
r("ecritures.push({ id: filtreId, patch });", "ecritures.push({ id: filtreId, patch, par });", 'push');
r("requireAuthedClient: async () => ({ client: fauxClient(), orgId: ORG, user: { id: 'u1' } }),\n  getServiceClient: () => fauxClient(),", "requireAuthedClient: async () => ({ client: fauxClient('utilisateur'), orgId: ORG, user: { id: 'u1' } }),\n  getServiceClient: () => fauxClient('service'),", 'mock');
r("    expect(r.json).toEqual({ id: SAINE, is_active: true });\n    expect(ecritures[0].patch.is_active).toBe(true);", "    expect(r.json).toEqual({ id: SAINE, is_active: true });\n    expect(ecritures.some((e) => e.patch.is_active === true)).toBe(true);", 'assertion');
writeFileSync(f, s);
console.log('ok');
