/**
 * Captures d'écran du support (2026-09-17) : chemins forcément sous l'org du
 * client, noms sûrs, transcript Slack avec liens signés, Lumi reçoit les
 * images en blocs. Pur, sans base ni stockage.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifierChemins, nomSur, typeImage, pieceJointeSlack, MAX_CAPTURES } from '../../server/lib/support/captures';
import { transcriptSlackComplet, type MessageTicket } from '../../server/lib/support/tickets';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const chemin = (n: string) => `${ORG}/${USER}/${n}`;
const racine = resolve(__dirname, '..', '..');

describe('captures', () => {
  it('n accepte que des chemins sous l org, bien formés, au plus trois', () => {
    const ok = chemin('33333333-3333-4333-8333-333333333333.jpg');
    expect(verifierChemins(ORG, [ok])).toEqual([{ chemin: ok, nom: undefined }]);
    expect(verifierChemins(ORG, [{ chemin: ok, nom: 'erreur.png' }])).toEqual([{ chemin: ok, nom: 'erreur.png' }]);
    expect(verifierChemins(ORG, [])).toEqual([]);
    expect(verifierChemins('99999999-9999-4999-8999-999999999999', [ok])).toBeNull(); // une autre entreprise
    expect(verifierChemins(ORG, [`${ORG}/../x.jpg`])).toBeNull();
    expect(verifierChemins(ORG, [chemin('pas-un-uuid.jpg')])).toBeNull();
    expect(verifierChemins(ORG, [chemin('33333333-3333-4333-8333-333333333333.exe')])).toBeNull();
    expect(verifierChemins(ORG, Array(MAX_CAPTURES + 1).fill(ok))).toBeNull();
    expect(verifierChemins(ORG, 'x')).toBeNull();
  });
  it('type d image et nom sûr', () => {
    expect(typeImage('image/png')).toBe('image/png');
    expect(typeImage('image/jpeg; charset=binary')).toBe('image/jpeg');
    expect(typeImage('text/html')).toBeNull();
    expect(nomSur('Capture d’écran 2026-09-17 à 14.03.png', 'image/png')).toBe('Capture-d-ecran-2026-09-17-a-14.03.png');
    expect(nomSur('', 'image/jpeg')).toBe('capture.jpg');
    expect(nomSur('<script>|x', 'image/webp')).toBe('script-x.webp');
  });
  it('le transcript Slack met les captures sous le message du client, par lien signé', () => {
    const p = { chemin: chemin('33333333-3333-4333-8333-333333333333.jpg'), nom: 'erreur.jpg', type: 'image/jpeg' as const, taille: 1000 };
    const messages: MessageTicket[] = [
      { id: '1', ticket_id: 't', author: 'user', author_name: 'Marie', body: 'Ça plante ici', created_at: '2026-09-17T10:00:00Z', pieces: [p] },
      { id: '2', ticket_id: 't', author: 'ai', author_name: 'Lumi', body: 'Je vois une erreur 500 sur la page Factures.', created_at: '2026-09-17T10:00:05Z' },
    ];
    const liens = new Map([[p.chemin, 'https://x.supabase.co/signed/erreur.jpg?token=abc']]);
    const [morceau] = transcriptSlackComplet(messages, 3500, liens);
    expect(morceau).toContain('Ça plante ici\n📎 <https://x.supabase.co/signed/erreur.jpg?token=abc|erreur.jpg>');
    expect(transcriptSlackComplet(messages)[0]).not.toContain('📎'); // sans liens signés, pas de lien cassé
    expect(pieceJointeSlack([])).toBe('');
  });
  it('câblage : téléversement brut image/*, chemins vérifiés avant tout, images données au modèle, réponse avec capture jamais mémorisée', () => {
    const route = readFileSync(resolve(racine, 'server', 'routes', 'support.ts'), 'utf8');
    expect(route).toContain("router.post('/support/captures', limiteChat, raw({ type: 'image/*', limit: TAILLE_MAX_OCTETS })");
    expect(route.indexOf('verifierChemins(auth.orgId, captures)')).toBeLessThan(route.indexOf("await ajouterMessage(admin, { ticket, author: 'user', body: message, authorName: ctx.userName, pieces })"));
    expect(route).toContain('lireCaptureBase64(admin, p)');
    expect(route).toContain("outilsDeDoc(r.outils) && !page && !pieces.length");
    const ia = readFileSync(resolve(racine, 'server', 'lib', 'support', 'ia.ts'), 'utf8');
    expect(ia).toContain("type: 'image' as const, source: { type: 'base64' as const");
    expect(ia).toContain('If the client attaches a screenshot');
    const migration = readFileSync(resolve(racine, 'supabase', 'migrations', '20260917130000_support_captures.sql'), 'utf8');
    expect(migration).toContain("'support-captures', 'support-captures', false");
    expect(migration).not.toMatch(/create policy/i);
  });
});
