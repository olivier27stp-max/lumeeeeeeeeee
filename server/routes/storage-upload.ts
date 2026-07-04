/* Authenticated image upload relay.

   Browser uploads straight to Supabase Storage hit storage.objects RLS —
   and the live DB's storage policies have drifted from the migrations
   ("new row violates row-level security policy" on company-logos). This
   route authenticates the user, enforces org-scoped paths, then uploads
   through the service client, which is immune to policy drift. */

import express, { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';

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

      const admin = getServiceClient();
      const { data, error } = await admin.storage
        .from(bucket)
        .upload(path, buffer, { contentType, upsert: false, cacheControl: '3600' });
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
