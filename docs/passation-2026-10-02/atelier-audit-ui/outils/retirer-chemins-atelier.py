# -*- coding: utf-8 -*-
"""Retire les chemins de l'atelier (D:/lume-uiaudit) des specs avant leur entrée dans le dépôt."""
import io

RACINE = 'D:/lume-uiaudit/wt-e2e/e2e/automations/'


def maj(fichier, paires):
    p = RACINE + fichier
    s = io.open(p, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'
    for a, b in paires:
        a = a.replace('\n', nl)
        b = b.replace('\n', nl)
        if s.count(a) != 1:
            raise SystemExit('%s : %d occurrence(s) de %s' % (fichier, s.count(a), a[:60].encode('ascii', 'replace')))
        s = s.replace(a, b)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print('ok', fichier)


maj('_outils/banc.ts', [
    ("// ── Moniteur console + réseau ─",
     "/**\n"
     " * Dossier des captures d'un lot, HORS du dépôt (un fichier écrit dans le worktree ferait recharger Vite) :\n"
     " * `<E2E_SORTIES>/captures/<lot>`. Playwright crée le dossier à la première capture.\n"
     " */\n"
     "export function capturesDe(lot: string): string {\n"
     "  return join(resolve(process.env.E2E_SORTIES || join(tmpdir(), 'lume-e2e-automations')), 'captures', lot).replace(/\\\\/g, '/');\n"
     "}\n\n"
     "// ── Moniteur console + réseau ─"),
])
maj('actions/_aides.ts', [
    ("export const CAPTURES = 'D:/lume-uiaudit/sorties/actions/captures';",
     "export const CAPTURES = capturesDe('actions');"),
    ("import { mkdirSync } from 'node:fs';",
     "import { mkdirSync } from 'node:fs';\nimport { capturesDe } from '../_outils/banc';"),
])
maj('editeur/_aides.ts', [
    ("export const CAPTURES = 'D:/lume-uiaudit/sorties/editeur/captures';",
     "export const CAPTURES = capturesDe('editeur');"),
    ("import type { BrowserContext } from '@playwright/test';",
     "import type { BrowserContext } from '@playwright/test';\nimport { capturesDe } from '../_outils/banc';"),
])
maj('liste/_aides.ts', [
    ("export const CAPTURES = 'D:/lume-uiaudit/sorties/liste/captures';",
     "export const CAPTURES = capturesDe('liste');"),
    ("import { join, resolve } from 'node:path';",
     "import { join, resolve } from 'node:path';\nimport { capturesDe } from '../_outils/banc';"),
])
maj('liste/07-lot.spec.ts', [
    ("await page.screenshot({ path: 'D:/lume-uiaudit/sorties/liste/captures/S-25-refus-en-lot.png' });",
     "await page.screenshot({ path: `${capturesDe('liste')}/S-25-refus-en-lot.png` });"),
    ("import { randomUUID } from 'node:crypto';",
     "import { randomUUID } from 'node:crypto';\nimport { capturesDe } from '../_outils/banc';"),
])
maj('liste/10-volume.spec.ts', [
    ("await page.screenshot({ path: 'D:/lume-uiaudit/sorties/liste/captures/bulle-aide-sur-pagination.png' });",
     "await page.screenshot({ path: `${capturesDe('liste')}/bulle-aide-sur-pagination.png` });"),
    ("import { randomUUID } from 'node:crypto';",
     "import { randomUUID } from 'node:crypto';\nimport { capturesDe } from '../_outils/banc';"),
])
maj('modeles/aides.ts', [
    ("export const CAPTURES = 'D:/lume-uiaudit/sorties/modeles/captures';",
     "export const CAPTURES = capturesDe('modeles');"),
    ("import { base } from './connexion';",
     "import { base } from './connexion';\nimport { capturesDe } from '../_outils/banc';"),
])
maj('modeles/connexion.ts', [
    ("const DOSSIER_ETAT = process.env.E2E_MODELES_ETAT || 'D:/lume-uiaudit/sorties/modeles/etat';",
     "const DOSSIER_ETAT = process.env.E2E_MODELES_ETAT || join(process.env.E2E_SORTIES || join(tmpdir(), 'lume-e2e-automations'), 'modeles-etat');"),
    ("import { join } from 'node:path';",
     "import { tmpdir } from 'node:os';\nimport { join } from 'node:path';"),
])
maj('roles/_roles.ts', [
    ("Pile locale : node D:/lume-uiaudit/outils/roles/preparer-jeu-local.mjs.",
     "Pile locale : node scripts/qa/automations-e2e/preparer-jeu-roles.mjs."),
    (": 'D:/lume-uiaudit/sorties/roles';", ": 'lot-roles';"),
])
maj('roles/20-points-entree.spec.ts', [
    ("sonde D:/lume-uiaudit/outils/roles/sonde-etiquette-local.mjs", "sonde du tri du 2026-10-01"),
])
maj('roles/_routes.ts', [
    ("(D:/lume-uiaudit/outils/roles/)", "(atelier de l'audit du 2026-10-01)"),
])
