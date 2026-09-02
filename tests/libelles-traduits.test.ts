import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Garde-fou contre les libellés en dur.
 *
 * L'application est bilingue : un texte écrit directement dans le code reste
 * dans sa langue d'origine quand l'utilisateur change de langue. Ces tests
 * verrouillent les composants qu'on vient de corriger, pour qu'une prochaine
 * modification ne les fasse pas repartir en anglais sans qu'on le voie.
 *
 * Trouvés par `npm run qa:carte-boutons`, corrigés le 2026-09-01.
 */

const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8');

/** Textes littéraux entre balises : `>Bonjour<`, hors expressions JSX. */
function textesEnDur(source: string): string[] {
  return [...source.matchAll(/>([^<>{}]{3,60})</g)]
    .map((m) => m[1].trim())
    .filter((t) => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ,.'!?%$-]*$/.test(t));
}

describe('la cloche de notifications est traduite', () => {
  const source = lire('src/components/NotificationBell.tsx');

  it('ne contient aucun texte en dur', () => {
    expect(textesEnDur(source)).toEqual([]);
  });

  it('passe par les traductions', () => {
    expect(source).toContain('useTranslation');
    expect(source).toContain('t.notifications.titre');
    expect(source).toContain('t.notifications.toutMarquerLu');
    expect(source).toContain('t.notifications.aucune');
  });

  it('réutilise le formateur de temps partagé plutôt qu\'une copie locale', () => {
    // Une copie anglaise vivait ici ; le projet en a déjà un bilingue.
    expect(source).toContain("from '../lib/utils'");
    expect(source).toContain('timeAgo(notif.created_at');
    expect(source).not.toMatch(/const timeAgo = /);
    expect(source).not.toContain("'Just now'");
  });
});

describe('la modale de modèle de facture est traduite', () => {
  const source = lire('src/components/InvoiceTemplateModal.tsx');

  it('le bouton d\'annulation passe par les traductions', () => {
    expect(source).toContain('t.common.cancel');
    expect(source).not.toMatch(/>\s*Cancel\s*</);
  });
});

describe('les deux langues restent alignées', () => {
  const fr = lire('src/i18n/fr.ts');
  const en = lire('src/i18n/en.ts');

  it('les clés de notifications existent des deux côtés', () => {
    for (const cle of ['titre:', 'toutMarquerLu:', 'aucune:']) {
      expect(fr).toContain(cle);
      expect(en).toContain(cle);
    }
  });

  it('le français n\'a pas gardé de valeur anglaise', () => {
    const bloc = fr.slice(fr.indexOf('  notifications: {'));
    const fin = bloc.slice(0, bloc.indexOf('},'));
    expect(fin).toContain('Tout marquer comme lu');
    expect(fin).toContain('Aucune notification');
  });
});

describe('les remboursements passent par Stripe, pas par Lume', () => {
  // Décision du 2026-09-01 : le propriétaire rembourse depuis le tableau de
  // bord Stripe. Le client `refundPayment` qui vivait dans connectApi.ts
  // n'était appelé par aucune page et laissait croire le contraire.
  it('aucun client de remboursement ne traîne dans le code du navigateur', () => {
    const api = lire('src/lib/connectApi.ts');
    expect(api).not.toContain('export async function refundPayment');
  });

  it('aucune page ne tente de rembourser', () => {
    const dossiers = ['src/pages', 'src/components'];
    const fautifs: string[] = [];
    const parcourir = (dir: string) => {
      const abs = path.join(RACINE, dir);
      if (!fs.existsSync(abs)) return;
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) parcourir(rel);
        else if (/\.tsx?$/.test(e.name)) {
          const src = fs.readFileSync(path.join(RACINE, rel), 'utf8');
          if (/refundPayment\s*\(|['"]\/api\/payments\/refund['"]/.test(src)) fautifs.push(rel);
        }
      }
    };
    dossiers.forEach(parcourir);
    expect(fautifs).toEqual([]);
  });

  it('le webhook Stripe met toujours à jour un remboursement fait au tableau de bord', () => {
    // C'est ce qui fait que le statut redescend dans Lume : sans lui, un
    // remboursement fait dans Stripe resterait invisible pour toujours.
    const routes = lire('server/routes/payments.ts');
    expect(routes).toContain("event.type === 'charge.refunded'");
    expect(routes).toContain('partially_refunded');
  });
});
