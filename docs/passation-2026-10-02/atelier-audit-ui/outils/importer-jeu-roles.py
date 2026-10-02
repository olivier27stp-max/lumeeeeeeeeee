# -*- coding: utf-8 -*-
"""Entre le script de préparation du jeu « roles » dans le dépôt (chemins relatifs, jeu en argument)."""
import io

SRC = 'D:/lume-uiaudit/outils/roles/'
DST = 'D:/lume-uiaudit/wt-e2e/scripts/qa/automations-e2e/'


def porter(src, dst, paires):
    s = io.open(SRC + src, encoding='utf-8', newline='').read()
    for a, b in paires:
        if s.count(a) < 1:
            raise SystemExit('%s : absent : %s' % (src, a[:60].encode('ascii', 'replace')))
        s = s.replace(a, b)
    if 'lume-uiaudit' in s:
        raise SystemExit('%s : chemin de l atelier restant' % src)
    io.open(DST + dst, 'w', encoding='utf-8', newline='').write(s)
    print('ok', dst)


porter('client-local.mjs', 'client-local.mjs', [
    ("export const WT = 'D:/lume-uiaudit/wt-e2e';\n"
     "const { PILE, clesLocales } = await import(pathToFileURL(`${WT}/scripts/qa/automations-e2e/local.mjs`).href);\n"
     "const { createClient } = createRequire(`${WT}/package.json`)('@supabase/supabase-js');",
     "import { PILE, clesLocales } from './local.mjs';\n\n"
     "/** La racine du dépôt : ces outils se lancent depuis elle (`node scripts/qa/automations-e2e/…`). */\n"
     "export const WT = process.cwd().replace(/[\\\\]/g, '/');\n"
     "const { createClient } = createRequire(pathToFileURL(`${WT}/package.json`).href)('@supabase/supabase-js');"),
])
porter('preparer-jeu-local.mjs', 'preparer-jeu-roles.mjs', [
    (" *   node D:/lume-uiaudit/outils/roles/preparer-jeu-local.mjs",
     " *   node scripts/qa/automations-e2e/preparer-jeu-roles.mjs [jeu]      (défaut : roles ; « roles1 » pour un 2e worker)"),
    ("const JEU = 'roles';", "const JEU = (process.argv[2] || 'roles').replace(/[^a-z0-9-]/gi, '');"),
    ("      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || 'D:/lume-uiaudit/pw-browsers',\n", ""),
    ("      E2E_SORTIES: process.env.E2E_SORTIES || 'D:/lume-uiaudit/sorties/tri-roles',\n", ""),
])
