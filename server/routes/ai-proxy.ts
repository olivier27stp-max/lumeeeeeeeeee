import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { geminiHealthCheck, geminiChat, geminiStream } from '../lib/gemini';

const router = Router();

// GET /api/ai/health — Check Gemini connectivity (public — instant check)
router.get('/ai/health', async (_req, res) => {
  try {
    // Fast check: just verify API key exists (don't burn a Gemini call)
    const hasKey = Boolean(process.env.GEMINI_API_KEY);
    return res.json({ ok: hasKey, models: hasKey ? ['gemini-2.5-flash'] : [] });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message });
  }
});

// POST /api/ai/chat — Non-streaming Gemini call
router.post('/ai/chat', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { messages, systemPrompt, jsonMode, temperature, maxTokens } = req.body;
    if (!messages) {
      return res.status(400).json({ error: 'messages are required' });
    }

    const result = await geminiChat({
      systemPrompt,
      messages,
      jsonMode,
      temperature,
      maxTokens,
    });

    return res.json({ message: { content: result.content }, done: true });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Gemini call failed' });
  }
});

// POST /api/ai/chat/stream — Streaming Gemini call via SSE
router.post('/ai/chat/stream', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { messages, systemPrompt, temperature, maxTokens } = req.body;
    if (!messages) {
      return res.status(400).json({ error: 'messages are required' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let clientDisconnected = false;
    req.on('close', () => { clientDisconnected = true; });

    await geminiStream(
      { systemPrompt, messages, temperature, maxTokens },
      (token) => {
        if (!clientDisconnected) {
          try {
            res.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`);
          } catch { clientDisconnected = true; }
        }
      }
    );

    if (!clientDisconnected) {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    }
    res.end();
  } catch (err: any) {
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err?.message || 'Stream failed' })}\n\n`);
      res.end();
    } else {
      res.status(502).json({ error: err?.message || 'Gemini stream failed' });
    }
  }
});

export default router;
