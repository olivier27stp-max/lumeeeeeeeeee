/* Authenticated image upload relay.

   Browser uploads straight to Supabase Storage hit storage.objects RLS —
   and the live DB's storage policies have drifted from the migrations
   ("new row violates row-level security policy" on company-logos). This
   route authenticates the user, enforces org-scoped paths, then uploads
   through the service client, which is immune to policy drift. */

import express, { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { detourerLogo } from '../lib/images/detourer-logo';
import { logger } from '../lib/logger';

const router = Router();

const ALLOWED_BUCKETS = new Set(['company-logos', 'attachments', 'job-photos', 'avatars']);

router.post(
  '/storage/upload',
  express.raw({ type: 'image/*', limit: '15mb' }),
  async (req, res) => {
    try {
      const auth = await requireAuthedClient(req, res);
      if (!auth) return;

      const bucket = String(req.query.bucket || '');
      if (!ALLOWED_BUCKETS.has(bucket)) {
        return res.status(400).json({ error: 'Bucket not allowed.' });
      }

      const rawPath = String(req.query.path || '');
      // No traversal, no leading slash, and the object must live under the
      // caller's org folder so one tenant can't overwrite another's files.
      const path = rawPath.replace(/^\/+/, '');
      if (!path || path.includes('..') || !path.startsWith(`${auth.orgId}/`)) {
        return res.status(403).json({ error: 'Path must be inside your organization folder.' });
      }

      const buffer = req.body;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return res.status(400).json({ error: 'No image data received.' });
      }
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim();
      if (!contentType.startsWith('image/')) {
        return res.status(400).json({ error: 'Only image uploads are allowed.' });
      }

      // Upsert opt-in for stable per-user paths (avatar/bannière) — safe here
      // because the path is already forced under the caller's org folder.
      const upsert = String(req.query.upsert || '') === 'true';

      /* Un logo d'entreprise se pose sur le ciel des courriels et sur les pages
         publiques : son fond blanc y dessinerait un rectangle. La plupart des
         entreprises n'ont qu'un JPEG, où le blanc est cuit dans l'image — aucun
         CSS ne peut l'enlever, il faut réécrire les pixels ici, une seule fois.
         `detourerLogo` rend l'original dès que le résultat ne serait pas sûr
         (fond non uni, dessin mangé) : ce chemin ne peut donc pas dégrader un
         téléversement, et seuls les logos sont concernés. */
      let corps = buffer;
      let typeFinal = contentType;
      let cheminFinal = path;
      if (bucket === 'company-logos') {
        try {
          const r = detourerLogo(buffer, contentType);
          if (r.detoure) {
            corps = r.buffer;
            typeFinal = r.contentType;
            // Le contenu est devenu du PNG : l'extension doit suivre, sinon
            // certains clients de courriel se fient au nom et affichent une
            // image cassée.
            cheminFinal = path.replace(/\.[a-z0-9]+$/i, '') + '.png';
          } else {
            logger.info('[storage/upload] logo laissé tel quel', { raison: r.raison });
          }
        } catch (err: any) {
          // Un logo publié tel quel vaut mieux qu'un téléversement refusé.
          logger.error('[storage/upload] détourage échoué, original conservé', { message: err?.message });
        }
      }

      const admin = getServiceClient();
      const { data, error } = await admin.storage
        .from(bucket)
        .upload(cheminFinal, corps, { contentType: typeFinal, upsert, cacheControl: '3600' });
      if (error) throw error;

      const { data: pub } = admin.storage.from(bucket).getPublicUrl(data.path);
      return res.json({ url: pub.publicUrl, path: data.path });
    } catch (err: any) {
      console.error('[storage/upload] failed:', err.message);
      return res.status(500).json({ error: err.message || 'Upload failed.' });
    }
  },
);

export default router;
