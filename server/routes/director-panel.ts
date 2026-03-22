import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { buildSupabaseWithAuth, getServiceClient, resolveOrgId } from '../lib/supabase';

const router = Router();

// ─── Provider execution proxy ────────────────────────────────────────────────
// The frontend NEVER calls providers directly. All requests go through here.
// This protects API keys and enforces org-level credit checks.

// Normalize model IDs: catalog may use hyphens (flux-pro-1-1) while server uses dots (flux-pro-1.1)
function resolveModelId(raw: string): string {
  if (FAL_MODELS[raw]) return raw;

  // Try replacing version-like hyphens with dots: "1-1" → "1.1", "2-5" → "2.5"
  const dotted = raw.replace(/(\d)-(\d)/g, '$1.$2');
  if (FAL_MODELS[dotted]) return dotted;

  // Try common name mappings
  const ALIASES: Record<string, string> = {
    'flux-kontext-multi-image': 'flux-kontext-multi',
    'bria-remove-background': 'bria-remove-bg',
    'topaz-image-upscale': 'topaz-upscale',
    'topaz-video-upscaler': 'topaz-video-upscaler',
    'real-esrgan-video-upscaler': 'real-esrgan-video',
    'kling-o3-edit-video': 'kling-o3-edit',
    'veo-3-1-text': 'veo-3.1',
    'pixverse-v4-5': 'pixverse-v4.5',
    'seedance-v1-5-pro': 'seedance-v1.5-pro',
    'omnihuman-v1-5': 'omnihuman-v1.5',
    'seedream-v4-5-edit': 'seedream-v4.5-edit',
    'gpt-image-1-5': 'gpt-image-1.5',
    'gpt-image-1-5-edit': 'gpt-image-1.5-edit',
    'relight-2-0': 'relight-2.0',
    'wan-2-5': 'wan-2.5',
    'wan-2-2': 'wan-2.2',
    'kling-1-6': 'kling-1.6',
  };
  if (ALIASES[raw] && FAL_MODELS[ALIASES[raw]]) return ALIASES[raw];
  if (ALIASES[dotted] && FAL_MODELS[ALIASES[dotted]]) return ALIASES[dotted];

  return raw; // fallback — will fail with clear error
}

router.post('/director-panel/providers/execute', async (req: Request, res: Response) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const client = buildSupabaseWithAuth(auth);
    const orgId = await resolveOrgId(client);
    if (!orgId) return res.status(403).json({ error: 'No org found' });

    const { provider, model: rawModel, params, inputs } = req.body;
    if (!provider || !rawModel) {
      return res.status(400).json({ error: 'Missing provider or model' });
    }

    // Normalize model ID: try exact match, then with dots, then with hyphens
    const model = resolveModelId(rawModel);

    // Check credits
    const admin = getServiceClient();
    const { data: balance } = await admin
      .from('org_credit_balances')
      .select('credits_balance')
      .eq('org_id', orgId)
      .maybeSingle();

    const estimatedCost = estimateProviderCost(provider, model);
    if (!balance || balance.credits_balance < estimatedCost) {
      return res.status(402).json({
        error: 'Insufficient credits',
        required: estimatedCost,
        available: balance?.credits_balance ?? 0,
      });
    }

    // Route to provider
    let result;
    switch (provider) {
      // ALL providers route through fal.ai — they host everything
      case 'fal':
      case 'google':
      case 'runway':
      case 'kling':
      case 'openai':
      case 'luma':
      case 'stability':
      case 'recraft':
      case 'topaz':
      case 'bria':
      case 'minimax':
      case 'higgsfield':
      case 'ideogram':
      case 'nvidia':
        result = await executeFal(model, params, inputs);
        break;
      default:
        return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }

    if (!result.success) {
      return res.status(502).json({
        error: result.error || 'Provider execution failed',
        message: result.error,
      });
    }

    // Debit credits
    const actualCost = result.cost?.credits ?? estimatedCost;
    await admin.from('org_credit_transactions').insert({
      org_id: orgId,
      kind: 'debit',
      amount: -actualCost,
      reason: `${provider}/${model} generation`,
      metadata_json: { provider, model },
    });

    // Direct balance update
    await admin
      .from('org_credit_balances')
      .update({ credits_balance: (balance.credits_balance - actualCost), updated_at: new Date().toISOString() })
      .eq('org_id', orgId);

    return res.json({
      outputs: result.outputs,
      metadata: result.metadata,
      cost: { credits: actualCost, provider_cost_usd: result.providerCostUsd },
    });
  } catch (err: any) {
    console.error('[director-panel] Provider execution error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ─── Storage: ensure bucket exists ───────────────────────────────────────────

router.post('/director-panel/storage/ensure-bucket', async (req: Request, res: Response) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const admin = getServiceClient();

    // Check if bucket exists
    const { data: buckets } = await admin.storage.listBuckets();
    const exists = buckets?.some((b: any) => b.name === 'director-panel');

    if (!exists) {
      const { error } = await admin.storage.createBucket('director-panel', {
        public: true,
        fileSizeLimit: 104857600, // 100MB
        allowedMimeTypes: ['image/*', 'video/*'],
      });
      if (error && !error.message?.includes('already exists')) {
        return res.status(500).json({ error: error.message });
      }
    }

    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/director-panel/storage/ensure-training-bucket', async (req: Request, res: Response) => {
  try {
    const admin = getServiceClient();
    const { data: buckets } = await admin.storage.listBuckets();
    const exists = buckets?.some((b: any) => b.name === 'director-assets');
    if (!exists) {
      const { error } = await admin.storage.createBucket('director-assets', {
        public: true,
        fileSizeLimit: 20971520, // 20MB
        allowedMimeTypes: ['image/*'],
      });
      if (error && !error.message?.includes('already exists')) {
        return res.status(500).json({ error: error.message });
      }
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Save output to assets ───────────────────────────────────────────────────

router.post('/director-panel/assets/save', async (req: Request, res: Response) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const client = buildSupabaseWithAuth(auth);
    const orgId = await resolveOrgId(client);
    if (!orgId) return res.status(403).json({ error: 'No org found' });

    const { url, filename, metadata, flowId, runId } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing url' });

    // SSRF protection: only allow HTTPS URLs from known AI provider domains
    const ALLOWED_HOSTS = [
      'fal.media', 'cdn.fal.ai', 'storage.googleapis.com',
      'oaidalleapiprodscus.blob.core.windows.net', 'replicate.delivery',
      'pbxt.replicate.delivery', 'tjzk.replicate.delivery',
    ];
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    if (parsedUrl.protocol !== 'https:') {
      return res.status(400).json({ error: 'Only HTTPS URLs allowed' });
    }
    const hostAllowed = ALLOWED_HOSTS.some(
      (h) => parsedUrl.hostname === h || parsedUrl.hostname.endsWith(`.${h}`),
    );
    if (!hostAllowed) {
      return res.status(400).json({ error: `Domain not allowed: ${parsedUrl.hostname}` });
    }

    // Download the file from the provider URL
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to download asset from provider' });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const ext = contentType.includes('video') ? 'mp4' : contentType.includes('png') ? 'png' : 'jpg';
    const finalFilename = filename || `output_${Date.now()}.${ext}`;
    const storagePath = `org/${orgId}/director-panel/${flowId || 'unknown'}/${runId || 'unknown'}/${finalFilename}`;

    const admin = getServiceClient();
    const { data, error } = await admin.storage
      .from('director-panel')
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const { data: urlData } = admin.storage
      .from('director-panel')
      .getPublicUrl(data.path);

    return res.json({
      path: data.path,
      publicUrl: urlData.publicUrl,
      metadata,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Credit balance ──────────────────────────────────────────────────────────

router.get('/director-panel/credits', async (req: Request, res: Response) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const client = buildSupabaseWithAuth(auth);
    const orgId = await resolveOrgId(client);
    if (!orgId) return res.status(403).json({ error: 'No org found' });

    const admin = getServiceClient();
    const { data } = await admin
      .from('org_credit_balances')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle();

    return res.json(data || { org_id: orgId, credits_balance: 0 });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── fal.ai Model Registry (endpoint + USD cost) ────────────────────────────

type FalModelDef = { endpoint: string; usdCost: number; kind: 'image' | 'video' | '3d' | 'audio' | 'text' };

const FAL_MODELS: Record<string, FalModelDef> = {
  // ── Image: Generate from text ──
  'flux-2-pro':           { endpoint: 'fal-ai/flux-2-pro',                    usdCost: 0.05,  kind: 'image' },
  'flux-2-flex':          { endpoint: 'fal-ai/flux-2-flex',                   usdCost: 0.03,  kind: 'image' },
  'flux-2-dev-lora':      { endpoint: 'fal-ai/flux/dev',                      usdCost: 0.025, kind: 'image' },
  'flux-fast':            { endpoint: 'fal-ai/flux/schnell',                  usdCost: 0.003, kind: 'image' },
  'flux-pro-1.1':         { endpoint: 'fal-ai/flux-pro/v1.1',                usdCost: 0.04,  kind: 'image' },
  'flux-pro-1.1-ultra':   { endpoint: 'fal-ai/flux-pro/v1.1-ultra',          usdCost: 0.06,  kind: 'image' },
  'flux-dev-lora':        { endpoint: 'fal-ai/flux-lora',                     usdCost: 0.025, kind: 'image' },
  'reve':                 { endpoint: 'fal-ai/reve',                          usdCost: 0.03,  kind: 'image' },
  'mystic':               { endpoint: 'fal-ai/mystic',                        usdCost: 0.03,  kind: 'image' },
  'recraft-v4':           { endpoint: 'fal-ai/recraft/v4/pro/text-to-image',  usdCost: 0.04,  kind: 'image' },
  'recraft-v3':           { endpoint: 'fal-ai/recraft-v3',                    usdCost: 0.04,  kind: 'image' },
  'gpt-image-1.5':        { endpoint: 'fal-ai/gpt-image-1.5',                usdCost: 0.04,  kind: 'image' },
  'seedream-v4':          { endpoint: 'fal-ai/bytedance/seedream/v4',         usdCost: 0.03,  kind: 'image' },
  'seedream-v5':          { endpoint: 'fal-ai/bytedance/seedream/v5',         usdCost: 0.03,  kind: 'image' },
  'nano-banana-2':        { endpoint: 'fal-ai/nano-banana-2',                 usdCost: 0.04,  kind: 'image' },
  'nano-banana-pro':      { endpoint: 'fal-ai/nano-banana-pro',               usdCost: 0.04,  kind: 'image' },
  'qwen-image':           { endpoint: 'fal-ai/qwen-image-2',                  usdCost: 0.02,  kind: 'image' },
  'z-image-turbo':        { endpoint: 'fal-ai/z-image/turbo',                 usdCost: 0.02,  kind: 'image' },

  // ── Image: Edit / Kontext ──
  'flux-kontext':         { endpoint: 'fal-ai/flux-pro/kontext',              usdCost: 0.04,  kind: 'image' },
  'flux-kontext-lora':    { endpoint: 'fal-ai/flux-pro/kontext/lora',         usdCost: 0.04,  kind: 'image' },
  'flux-kontext-multi':   { endpoint: 'fal-ai/flux-pro/kontext/multi',        usdCost: 0.05,  kind: 'image' },
  'flux-fill-pro':        { endpoint: 'fal-ai/flux-pro/v1/fill',              usdCost: 0.04,  kind: 'image' },
  'flux-2-max':           { endpoint: 'fal-ai/flux-2-max',                    usdCost: 0.05,  kind: 'image' },
  'gpt-image-1.5-edit':   { endpoint: 'fal-ai/gpt-image-1.5/edit',           usdCost: 0.05,  kind: 'image' },
  'qwen-image-edit-plus': { endpoint: 'fal-ai/qwen-image-edit-plus',          usdCost: 0.03,  kind: 'image' },
  'seedream-v4.5-edit':   { endpoint: 'fal-ai/bytedance/seedream/v4.5/edit',  usdCost: 0.03,  kind: 'image' },
  'seedream-v5-edit':     { endpoint: 'fal-ai/bytedance/seedream/v5/edit',    usdCost: 0.03,  kind: 'image' },
  'relight-2.0':          { endpoint: 'fal-ai/relight-2.0',                   usdCost: 0.03,  kind: 'image' },
  'replace-background':   { endpoint: 'fal-ai/bria/background/replace',       usdCost: 0.02,  kind: 'image' },
  'bria-remove-bg':       { endpoint: 'fal-ai/bria/background/remove',        usdCost: 0.01,  kind: 'image' },

  // ── Image: Generate from image ──
  'flux-dev-redux':       { endpoint: 'fal-ai/flux/dev/redux',                usdCost: 0.025, kind: 'image' },
  'flux-canny-pro':       { endpoint: 'fal-ai/flux-pro/v1/canny',             usdCost: 0.04,  kind: 'image' },
  'flux-depth-pro':       { endpoint: 'fal-ai/flux-pro/v1/depth',             usdCost: 0.04,  kind: 'image' },
  'flux-controlnet-lora': { endpoint: 'fal-ai/flux-controlnet-lora',          usdCost: 0.03,  kind: 'image' },

  // ── Image: Enhance / Upscale ──
  'topaz-upscale':        { endpoint: 'fal-ai/topaz/upscale',                 usdCost: 0.05,  kind: 'image' },
  'topaz-sharpen':        { endpoint: 'fal-ai/topaz/sharpen',                 usdCost: 0.05,  kind: 'image' },
  'magnific-upscale':     { endpoint: 'fal-ai/magnific/upscale',              usdCost: 0.04,  kind: 'image' },
  'recraft-crisp-upscale':{ endpoint: 'fal-ai/recraft/crisp-upscale',         usdCost: 0.03,  kind: 'image' },

  // ── Image: Vector ──
  'recraft-vectorizer':   { endpoint: 'fal-ai/recraft/vectorizer',            usdCost: 0.04,  kind: 'image' },
  'recraft-v3-svg':       { endpoint: 'fal-ai/recraft-v3/svg',                usdCost: 0.04,  kind: 'image' },

  // ── Video: Generate from text/image ──
  'wan-2.5':              { endpoint: 'fal-ai/wan/v2.5',                      usdCost: 0.25,  kind: 'video' },
  'wan-2.2':              { endpoint: 'fal-ai/wan/v2.2-a14b',                 usdCost: 0.20,  kind: 'video' },
  'wan-video':            { endpoint: 'fal-ai/wan/v2.5',                      usdCost: 0.25,  kind: 'video' },
  'ltx-2-video':          { endpoint: 'fal-ai/ltx-2',                         usdCost: 0.15,  kind: 'video' },
  'kling-video':          { endpoint: 'fal-ai/kling-video/v2.5/turbo/pro',    usdCost: 0.35,  kind: 'video' },
  'kling-1.6':            { endpoint: 'fal-ai/kling-video/v1.6/pro',          usdCost: 0.35,  kind: 'video' },
  'kling-3':              { endpoint: 'fal-ai/kling-video/v3',                usdCost: 0.35,  kind: 'video' },
  'kling-o3-edit':        { endpoint: 'fal-ai/kling-video/o3',                usdCost: 0.35,  kind: 'video' },
  'veo-3.1':              { endpoint: 'fal-ai/veo3.1',                        usdCost: 2.00,  kind: 'video' },
  'sora-2':               { endpoint: 'fal-ai/sora-2',                        usdCost: 0.50,  kind: 'video' },
  'pixverse-v4.5':        { endpoint: 'fal-ai/pixverse/v5',                   usdCost: 0.20,  kind: 'video' },
  'seedance-v1.5-pro':    { endpoint: 'fal-ai/seedance/v1.5/pro',             usdCost: 0.20,  kind: 'video' },
  'moonvalley':           { endpoint: 'fal-ai/moonvalley',                    usdCost: 0.20,  kind: 'video' },
  'hunyuan':              { endpoint: 'fal-ai/hunyuan-video',                 usdCost: 0.20,  kind: 'video' },
  'grok-imagine-video':   { endpoint: 'fal-ai/grok-imagine-video',            usdCost: 0.30,  kind: 'video' },

  // ── Video: Lip sync / Avatar ──
  'omnihuman-v1.5':       { endpoint: 'fal-ai/bytedance/omnihuman/v1.5',      usdCost: 0.30,  kind: 'video' },
  'sync-2-pro':           { endpoint: 'fal-ai/sync-lipsync/v2',               usdCost: 0.20,  kind: 'video' },
  // ── Audio: TTS ──
  'f5-tts':               { endpoint: 'fal-ai/f5-tts',                        usdCost: 0.02,  kind: 'audio' },
  'minimax-tts':          { endpoint: 'fal-ai/minimax/speech-02-hd',          usdCost: 0.03,  kind: 'audio' },
  'kokoro-tts':           { endpoint: 'fal-ai/kokoro/american-english',       usdCost: 0.01,  kind: 'audio' },
  'dia-tts':              { endpoint: 'fal-ai/nari-labs/dia-1.6b',            usdCost: 0.02,  kind: 'audio' },
  // ── Audio: Music / SFX ──
  'ace-step-music':       { endpoint: 'fal-ai/ace-step',                       usdCost: 0.05,  kind: 'audio' },
  'stable-audio':         { endpoint: 'fal-ai/stable-audio',                   usdCost: 0.04,  kind: 'audio' },

  // ── Video: Enhance ──
  'topaz-video-upscaler': { endpoint: 'fal-ai/topaz/video-upscale',           usdCost: 0.10,  kind: 'video' },
  'real-esrgan-video':    { endpoint: 'fal-ai/real-esrgan/video',              usdCost: 0.08,  kind: 'video' },

  // ── 3D ──
  'trellis-3d-v2':        { endpoint: 'fal-ai/trellis-2',                     usdCost: 0.10,  kind: '3d' },
  'meshy-v6':             { endpoint: 'fal-ai/meshy/v6',                       usdCost: 0.15,  kind: '3d' },

  // ── AI Tools (Mask, Depth, Describer, LLM) ──
  'mask-extractor':       { endpoint: 'fal-ai/bria/background/remove',         usdCost: 0.01,  kind: 'image' },
  'mask-by-text':         { endpoint: 'fal-ai/sam2/text-segment',              usdCost: 0.02,  kind: 'image' },
  'depth-anything-v2':    { endpoint: 'fal-ai/depth-anything-video',           usdCost: 0.02,  kind: 'image' },
  'image-describer':      { endpoint: 'fal-ai/llava-next',                     usdCost: 0.01,  kind: 'text' },
  'video-describer':      { endpoint: 'fal-ai/llava-next',                     usdCost: 0.02,  kind: 'image' },
  'video-matte':          { endpoint: 'fal-ai/bria/background/remove/video',   usdCost: 0.05,  kind: 'video' },
  'prompt-enhancer':      { endpoint: 'fal-ai/flux-prompt-enhance',            usdCost: 0.005, kind: 'text' },
  'run-any-llm':          { endpoint: 'fal-ai/llava-next',                     usdCost: 0.01,  kind: 'text' },

  // ── Missing models from frontend catalog ──
  'nano-banana':          { endpoint: 'fal-ai/nano-banana',                    usdCost: 0.03,  kind: 'image' },
  'flux-pro-outpaint':    { endpoint: 'fal-ai/flux-pro/v1/outpaint',           usdCost: 0.04,  kind: 'image' },
  'seedance-v1.0':        { endpoint: 'fal-ai/seedance/v1.0',                  usdCost: 0.15,  kind: 'video' },
  'video-smoother':       { endpoint: 'fal-ai/video-smoother',                 usdCost: 0.05,  kind: 'video' },
  'magnific-skin-enhancer': { endpoint: 'fal-ai/magnific/skin-enhancer',       usdCost: 0.04,  kind: 'image' },
  'magnific-precision-upscale': { endpoint: 'fal-ai/magnific/precision-upscale', usdCost: 0.04, kind: 'image' },
  'magnific-precision-upscale-v2': { endpoint: 'fal-ai/magnific/precision-upscale-v2', usdCost: 0.04, kind: 'image' },
  'enhancor-image-upscale': { endpoint: 'fal-ai/enhancor/upscale',             usdCost: 0.03,  kind: 'image' },
  'enhancor-realistic-skin': { endpoint: 'fal-ai/enhancor/realistic-skin',     usdCost: 0.03,  kind: 'image' },
  'sam-3d-objects':       { endpoint: 'fal-ai/sam-3d',                          usdCost: 0.10,  kind: '3d' },
  'rodin-v2':             { endpoint: 'fal-ai/rodin/v2',                        usdCost: 0.15,  kind: '3d' },
  'rodin':                { endpoint: 'fal-ai/rodin',                           usdCost: 0.12,  kind: '3d' },
  'hunyuan-3d-v3':        { endpoint: 'fal-ai/hunyuan-3d/v3',                  usdCost: 0.12,  kind: '3d' },
  'hunyuan-3d-v2.1':      { endpoint: 'fal-ai/hunyuan-3d/v2.1',               usdCost: 0.10,  kind: '3d' },
  'hunyuan-3d-v2.0':      { endpoint: 'fal-ai/hunyuan-3d/v2.0',               usdCost: 0.10,  kind: '3d' },
  'vectorizer':           { endpoint: 'fal-ai/vectorizer',                      usdCost: 0.03,  kind: 'image' },
  'text-to-vector':       { endpoint: 'fal-ai/text-to-vector',                 usdCost: 0.03,  kind: 'image' },
  'seededit-3.0':         { endpoint: 'fal-ai/seededit/v3',                     usdCost: 0.03,  kind: 'image' },
  'qwen-image-edit-2511': { endpoint: 'fal-ai/qwen-image-edit-2511',           usdCost: 0.03,  kind: 'image' },
  'qwen-edit-multiangle': { endpoint: 'fal-ai/qwen-edit-multiangle',           usdCost: 0.03,  kind: 'image' },
};

// ─── Provider implementations ────────────────────────────────────────────────

function estimateProviderCost(_provider: string, model: string): number {
  const def = FAL_MODELS[model];
  if (def) {
    // Convert USD to credits (1 credit ≈ $0.01)
    return Math.max(1, Math.ceil(def.usdCost * 100));
  }
  return 3; // fallback
}

async function executeFal(
  model: string,
  params: Record<string, any>,
  inputs: Record<string, any>
): Promise<ProviderResult> {
  const falApiKey = process.env.FAL_API_KEY;
  if (!falApiKey) {
    return { success: false, error: 'FAL_API_KEY not configured. Add it to .env.local', outputs: [] };
  }

  const modelDef = FAL_MODELS[model];
  if (!modelDef) {
    return { success: false, error: `Model "${model}" is not mapped to a fal.ai endpoint. Available: ${Object.keys(FAL_MODELS).join(', ')}`, outputs: [] };
  }

  try {
    // Build payload based on model kind
    const falPayload: Record<string, any> = {};

    // ── Prompt optimization pipeline ──────────────────────────────────
    let prompt = inputs.prompt || params.prompt || params.text || '';
    const qualityPreset = params.quality_preset || 'standard';
    const stylePreset = params.style_preset || 'none';
    const hasRefImage = !!(inputs.reference_image || inputs.image || inputs.start_image);

    if (prompt) {
      // 1. Quality enhancement — add quality markers based on preset
      const qualityBoosts: Record<string, string> = {
        high: ', highly detailed, professional quality, sharp focus, 8k resolution',
        ultra: ', masterpiece, ultra-detailed, professional DSLR photography, 8k, sharp focus, intricate detail, depth of field',
      };
      if (qualityBoosts[qualityPreset] && !prompt.includes('8k') && !prompt.includes('detailed')) {
        prompt += qualityBoosts[qualityPreset];
      }

      // 2. Style enhancement — add style direction
      const styleBoosts: Record<string, string> = {
        cinematic: ', cinematic lighting, film color grading, dramatic atmosphere, depth of field, anamorphic lens',
        photographic: ', professional photography, natural lighting, DSLR quality, shallow depth of field',
        anime: ', anime style, cel shading, vibrant colors, clean linework',
        digital_art: ', digital art, trending on artstation, highly detailed illustration',
        comic_book: ', comic book style, bold outlines, dynamic composition, vivid colors',
        fantasy: ', fantasy art, magical atmosphere, ethereal lighting, epic composition',
        neon_punk: ', neon lights, cyberpunk aesthetic, vibrant neon colors, dark atmosphere, futuristic',
        isometric: ', isometric view, 3D render, clean design, orthographic projection',
        pixel_art: ', pixel art, retro game style, 8-bit aesthetic, clean pixels',
      };
      if (stylePreset !== 'none' && styleBoosts[stylePreset] && !prompt.toLowerCase().includes(stylePreset)) {
        prompt += styleBoosts[stylePreset];
      }

      // 3. Model-specific optimization
      if (model.includes('flux')) {
        // Flux models respond well to descriptive, comma-separated prompts
        if (!prompt.includes('.') && prompt.split(',').length < 3) {
          // Short prompt — add structure hints
          if (!hasRefImage && !prompt.toLowerCase().includes('photo') && !prompt.toLowerCase().includes('illustration')) {
            prompt += ', professional composition';
          }
        }
      }
      if (model.includes('kling') || model.includes('wan') || model.includes('seedance')) {
        // Video models — emphasize motion and cinematography
        if (modelDef.kind === 'video' && !prompt.toLowerCase().includes('camera') && !prompt.toLowerCase().includes('movement')) {
          prompt += ', smooth cinematic camera movement, natural motion';
        }
      }

      falPayload.prompt = prompt;
    }

    // ── Auto negative prompt ─────────────────────────────────────────
    let negPrompt = inputs.negative_prompt || params.negative_prompt || '';
    if (modelDef.kind === 'image' && !negPrompt) {
      // Auto-generate a quality negative prompt
      const autoNegatives = [
        'blurry', 'low quality', 'distorted', 'watermark', 'text',
        'bad anatomy', 'deformed', 'disfigured', 'cropped', 'out of frame',
      ];
      if (qualityPreset === 'high' || qualityPreset === 'ultra') {
        autoNegatives.push('ugly', 'duplicate', 'morbid', 'mutation', 'extra limbs');
      }
      negPrompt = autoNegatives.join(', ');
    }
    if (negPrompt) falPayload.negative_prompt = negPrompt;

    // ── Image size ───────────────────────────────────────────────────
    if (modelDef.kind === 'image') {
      falPayload.image_size = params.aspect_ratio === '16:9' ? 'landscape_16_9'
        : params.aspect_ratio === '9:16' ? 'portrait_16_9'
        : params.aspect_ratio === '4:3' ? 'landscape_4_3'
        : params.aspect_ratio === '3:4' ? 'portrait_4_3'
        : 'square';
      falPayload.num_images = Math.min(params.num_outputs || 1, 4);
    }

    // ── Audio params ─────────────────────────────────────────────────
    if (modelDef.kind === 'audio') {
      // TTS models expect 'gen_text' or 'text', music models expect 'prompt'
      if (model.includes('tts') || model.includes('dia') || model.includes('kokoro') || model.includes('f5')) {
        falPayload.gen_text = prompt || inputs.text || params.text || '';
        if (inputs.reference_audio || params.reference_audio_url) {
          falPayload.ref_audio_url = inputs.reference_audio || params.reference_audio_url;
        }
        if (params.voice) falPayload.voice = params.voice;
      }
      // Music models use prompt directly (already set above)
      if (params.duration) falPayload.duration = Number(params.duration);
    }

    // ── Video duration ───────────────────────────────────────────────
    if (modelDef.kind === 'video') {
      if (params.duration) falPayload.duration = String(params.duration);
      if (params.aspect_ratio) falPayload.aspect_ratio = params.aspect_ratio;
    }

    // ── Input image ──────────────────────────────────────────────────
    if (hasRefImage) {
      falPayload.image_url = inputs.reference_image || inputs.image || inputs.start_image;
    }

    // ── Input video ──────────────────────────────────────────────────
    if (inputs.reference_video || inputs.video) {
      falPayload.video_url = inputs.reference_video || inputs.video;
    }

    // ── Input audio (for lip sync, voice-to-video) ──────────────────
    if (inputs.audio) {
      falPayload.audio_url = inputs.audio;
    }

    // ── Seed ─────────────────────────────────────────────────────────
    if (params.seed && params.seed > 0) {
      falPayload.seed = params.seed;
    }

    // ── LoRA ─────────────────────────────────────────────────────────
    if (params.lora_url && typeof params.lora_url === 'string' && params.lora_url.startsWith('http')) {
      falPayload.loras = [{ path: params.lora_url, scale: params.lora_scale ?? 0.8 }];
    }

    // ── Upscale params ───────────────────────────────────────────────
    if (params.scale && (model.includes('upscale') || model.includes('magnific') || model.includes('enhancor'))) {
      falPayload.scale = Number(params.scale) || 2;
    }

    // ── Inpaint mask ─────────────────────────────────────────────────
    if (inputs.mask) {
      falPayload.mask_url = inputs.mask;
    }

    console.log(`[fal.ai] Calling ${modelDef.endpoint} for model "${model}" | quality=${qualityPreset} style=${stylePreset} prompt_len=${(falPayload.prompt || '').length}`);

    const response = await fetch(`https://fal.run/${modelDef.endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(falPayload),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      return { success: false, error: `Rate limited by fal.ai. ${retryAfter ? `Retry after ${retryAfter}s` : 'Try again in a moment.'}`, outputs: [] };
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      return { success: false, error: `fal.ai ${response.status}: ${errBody.slice(0, 300)}`, outputs: [] };
    }

    const data = await response.json();

    // Normalize response → outputs
    const outputs: Array<{ kind: string; url?: string; data?: string; metadata?: Record<string, any> }> = [];

    // Text outputs (prompt enhancer, LLM, image describer)
    if (modelDef.kind === 'text') {
      const text = data.output || data.text || data.prompt || data.response || data.content
        || (data.choices?.[0]?.message?.content) || (data.message?.content) || '';
      if (text) {
        outputs.push({ kind: 'text', data: String(text), metadata: { model } });
      }
    }

    if (data.images && Array.isArray(data.images)) {
      for (const img of data.images) {
        outputs.push({ kind: 'image', url: img.url || img, metadata: { width: img.width, height: img.height } });
      }
    }
    if (data.video?.url) {
      outputs.push({ kind: 'video', url: data.video.url, metadata: { duration: data.video.duration } });
    }
    if (data.image?.url) {
      outputs.push({ kind: 'image', url: data.image.url });
    }
    if (data.mesh?.url || data.glb?.url) {
      outputs.push({ kind: '3d', url: data.mesh?.url || data.glb?.url });
    }
    // Audio outputs (TTS, music)
    if (data.audio?.url) {
      outputs.push({ kind: 'audio', url: data.audio.url, metadata: { duration: data.audio.duration } });
    }
    if (data.audio_url) {
      outputs.push({ kind: 'audio', url: data.audio_url });
    }
    // Fallback
    if (outputs.length === 0 && data.url) {
      outputs.push({ kind: modelDef.kind === 'text' ? 'text' : modelDef.kind, url: data.url });
    }
    if (outputs.length === 0 && data.output?.url) {
      outputs.push({ kind: modelDef.kind === 'text' ? 'text' : modelDef.kind, url: data.output.url });
    }
    // Text fallback — if kind is text and still no output, stringify the response
    if (outputs.length === 0 && modelDef.kind === 'text') {
      outputs.push({ kind: 'text', data: JSON.stringify(data).slice(0, 2000), metadata: { model, raw: true } });
    }

    return {
      success: true,
      outputs,
      metadata: { requestId: data.request_id, seed: data.seed, model },
      providerCostUsd: modelDef.usdCost,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error calling fal.ai', outputs: [] };
  }
}

async function executeStubProvider(provider: string, model: string): Promise<ProviderResult> {
  return {
    success: false,
    error: `Provider "${provider}" (model: ${model}) is not available through fal.ai. Only fal.ai-hosted models work in V1.`,
    outputs: [],
  };
}

type ProviderResult = {
  success: boolean;
  error?: string;
  outputs: Array<{ kind: string; url?: string; data?: any; metadata?: Record<string, any> }>;
  metadata?: Record<string, any>;
  providerCostUsd?: number;
  cost?: { credits: number };
};

// ─── LoRA Training ──────────────────────────────────────────────────────────

router.post('/director-panel/training/start', async (req: Request, res: Response) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const client = buildSupabaseWithAuth(auth);
    const orgId = await resolveOrgId(client);
    if (!orgId) return res.status(403).json({ error: 'No org found' });

    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) return res.status(500).json({ error: 'FAL_API_KEY not configured' });

    const { name, trigger_word, base_model, steps, images } = req.body;
    if (!name || !trigger_word || !images?.length) {
      return res.status(400).json({ error: 'Missing name, trigger_word, or images' });
    }

    // Submit training job to fal.ai
    const response = await fetch('https://queue.fal.run/fal-ai/flux-lora-fast-training', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        images_data_url: images.map((img: any) => img.url),
        trigger_word,
        steps: steps || 1000,
        create_masks: true,
        is_style: false,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      return res.status(502).json({ error: `fal.ai training failed: ${response.status} ${errBody.slice(0, 200)}` });
    }

    const data = await response.json();
    const trainingId = data.request_id || data.id || crypto.randomUUID();

    // Store training job in DB
    const admin = getServiceClient();
    await admin.from('director_training_jobs').insert({
      id: trainingId,
      org_id: orgId,
      name,
      trigger_word,
      base_model: base_model || 'flux-dev-lora',
      steps: steps || 1000,
      image_count: images.length,
      status: 'training',
      fal_request_id: data.request_id || null,
      metadata_json: { images: images.map((img: any) => ({ url: img.url, caption: img.caption })) },
    }); // Non-blocking insert

    return res.json({ training_id: trainingId, status: 'training' });
  } catch (err: any) {
    console.error('[director-panel] Training start error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.get('/director-panel/training/status/:trainingId', async (req: Request, res: Response) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) return res.status(500).json({ error: 'FAL_API_KEY not configured' });

    const { trainingId } = req.params;

    // Check fal.ai queue status
    const response = await fetch(`https://queue.fal.run/fal-ai/flux-lora-fast-training/requests/${trainingId}/status`, {
      headers: { 'Authorization': `Key ${falApiKey}` },
    });

    if (!response.ok) {
      // Check DB fallback
      const admin = getServiceClient();
      const { data: job } = await admin.from('director_training_jobs').select('*').eq('id', trainingId).maybeSingle();
      if (job) return res.json({ status: job.status, progress: job.status === 'completed' ? 100 : 50, model_id: job.model_id });
      return res.status(404).json({ error: 'Training job not found' });
    }

    const data = await response.json();

    // Map fal.ai status to our status
    let status = 'training';
    let progress = 50;
    let modelId = null;
    let error = null;

    if (data.status === 'COMPLETED') {
      status = 'completed';
      progress = 100;
      // Get the result to find the LoRA URL
      try {
        const resultRes = await fetch(`https://queue.fal.run/fal-ai/flux-lora-fast-training/requests/${trainingId}`, {
          headers: { 'Authorization': `Key ${falApiKey}` },
        });
        if (resultRes.ok) {
          const resultData = await resultRes.json();
          modelId = resultData.diffusers_lora_file?.url || resultData.config_file?.url || null;
          // Update DB
          const admin = getServiceClient();
          await admin.from('director_training_jobs').update({ status: 'completed', model_id: modelId, completed_at: new Date().toISOString() }).eq('id', trainingId);
        }
      } catch { /* non-blocking */ }
    } else if (data.status === 'FAILED') {
      status = 'failed';
      error = data.error || 'Training failed';
      const admin = getServiceClient();
      await admin.from('director_training_jobs').update({ status: 'failed', error_json: { error } }).eq('id', trainingId);
    } else if (data.status === 'IN_PROGRESS') {
      progress = data.logs?.length ? Math.min(90, 30 + data.logs.length * 5) : 50;
    } else if (data.status === 'IN_QUEUE') {
      progress = 10;
    }

    return res.json({ status, progress, model_id: modelId, error });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Image proxy for CORS (canvas operations on external URLs) ──────────────

router.get('/director-panel/proxy-image', async (req: Request, res: Response) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url parameter' });

    // SSRF protection: only allow known AI provider domains
    const ALLOWED_HOSTS = [
      'fal.media', 'cdn.fal.ai', 'storage.googleapis.com',
      'oaidalleapiprodscus.blob.core.windows.net', 'replicate.delivery',
      'pbxt.replicate.delivery', 'tjzk.replicate.delivery',
    ];
    let parsedUrl: URL;
    try { parsedUrl = new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
    if (parsedUrl.protocol !== 'https:') return res.status(400).json({ error: 'Only HTTPS allowed' });
    const hostAllowed = ALLOWED_HOSTS.some((h) => parsedUrl.hostname === h || parsedUrl.hostname.endsWith(`.${h}`));
    if (!hostAllowed) return res.status(400).json({ error: `Domain not allowed: ${parsedUrl.hostname}` });

    const response = await fetch(url);
    if (!response.ok) return res.status(502).json({ error: 'Failed to fetch image' });

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(buffer);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
