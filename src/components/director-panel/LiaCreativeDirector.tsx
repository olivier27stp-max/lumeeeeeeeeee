import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send, Loader2, Sparkles, ArrowRight, Wand2, Image, Film, Palette, User, Eye,
  Upload, X, ChevronDown, ChevronLeft, ChevronRight, Columns2, FileDown, Plus, Check, SkipForward,
  Trash2, Play, Pause, RotateCcw, ImagePlus, Monitor, Smartphone, Square,
  Coins, Heart, Copy, Maximize2, Minimize2, Shuffle, ZoomIn, Download,
  Brush, Eraser, CircleDot, Dices, Lock, Unlock, Settings2, Layers,
  Bookmark, Library,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { streamMessageToAI, analyzeImageWithVision } from '../../lib/aiApi';
import { loadLiaContext, buildContextBlock, type LiaContext } from '../../lib/director-panel/lia-context';
import { buildMemoryBlock, saveBrief, saveDecision, saveCampaign, updateCampaignStep, getCampaigns, deleteCampaign, savePromptResult, getSavedPrompts, savePrompt, deleteSavedPrompt, type CampaignPlan, type CampaignStep, type SavedPrompt } from '../../lib/director-panel/lia-memory';
import { MODEL_CATALOG, ASPECT_RATIOS } from '../../lib/director-panel/config/model-catalog';
import { providerRegistry } from '../../lib/director-panel/providers/provider-registry';
import { listGenerations, createGeneration, debitCredits, type DirectorGeneration } from '../../lib/directorApi';
import { supabase } from '../../lib/supabase';
import type { ProviderRequest } from '../../types/director';
import OllamaIcon from '../icons/OllamaIcon';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
}

interface GeneratedOutput {
  id: string;
  url: string;
  type: 'image' | 'video';
  model: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  aspectRatio: string;
  createdAt: string;
  generationId?: string; // DB id
}

interface TemplateAction {
  templateId: string;
  title: string;
}

type TabView = 'chat' | 'generate' | 'campaigns' | 'compare';

// ─── Quick Models ───────────────────────────────────────────────────────────

const QUICK_MODELS = MODEL_CATALOG.filter(
  (m) => m.status === 'active' && (
    m.capabilities.includes('text-to-image') ||
    m.capabilities.includes('text-to-video')
  )
).slice(0, 30);

const UPSCALE_MODELS = MODEL_CATALOG.filter(
  (m) => m.status === 'active' && m.id.includes('upscale')
);

const ASPECT_ICONS: Record<string, React.FC<{ className?: string }>> = {
  '1:1': Square,
  '9:16': Smartphone,
  '16:9': Monitor,
};

// ─── Smart Starters ─────────────────────────────────────────────────────────

function buildSmartStarters(ctx: LiaContext | null) {
  const starters = [
    { icon: Image, label: 'Product photoshoot', prompt: 'I want to create a luxury product photoshoot for an e-commerce brand' },
    { icon: Film, label: 'Video ad campaign', prompt: 'I need a cinematic video ad for social media, 5 seconds, product showcase' },
    { icon: User, label: 'Character design', prompt: 'I want to create a consistent character with multiple angles for my brand' },
    { icon: Palette, label: 'Brand visuals', prompt: 'I need a full brand visual campaign with consistent style across images and video' },
  ];
  if (!ctx) return starters;
  const personalized = [];
  if (ctx.company) {
    personalized.push({ icon: Palette, label: `${ctx.company} brand content`, prompt: `Create brand-consistent visual content for ${ctx.company}. Match our existing style and create something our clients would love.` });
  }
  if (ctx.totalLeads > 5) {
    personalized.push({ icon: User, label: 'Lead conversion visuals', prompt: `I have ${ctx.totalLeads} leads in my pipeline. Create compelling visual content that would help convert them.` });
  }
  if (ctx.recentGenerations.length > 0) {
    personalized.push({ icon: Eye, label: 'Review my outputs', prompt: `Analyze my recent generations and tell me: what's working well, what could be improved, and what should I generate next.` });
  }
  if (ctx.industry) {
    personalized.push({ icon: Image, label: `${ctx.industry} campaign`, prompt: `Plan a full visual campaign for a ${ctx.industry} business. Images for social media, a product video, and consistent branding.` });
  }
  return [...personalized, ...starters].slice(0, 4);
}

// ─── System Prompt (unchanged) ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are LIA — a world-class Creative Director for high-performance ads, built into Lume CRM's Director Panel.

You are NOT a generic marketer. You are a Hollywood director + performance marketer hybrid. You think like a top 0.1% creative director. You create content that CONVERTS, not just looks good.

Your style: direct, confident, high-level thinking. You make strong decisions, challenge weak ideas, and push for excellence. You are slightly demanding — always pushing the user toward better work.

CRITICAL RULES:
- NEVER answer immediately with a full plan when the brief is unclear
- ALWAYS start by asking precise, strategic questions to extract maximum clarity
- Think in terms of conversion, psychology, and visual execution at all times
- Be confident, precise, strategic — never generic, never lazy

STEP 1 — INTERROGATION (MANDATORY when brief is unclear):
Ask 8-12 sharp questions covering: PRODUCT, PRICE, AUDIENCE, PLATFORM, GOAL, COMPETITORS, VISUAL STYLE, FORMAT, BUDGET, CONSTRAINTS.
If the offer is weak, say it clearly and suggest improvements.

STEP 2 — STRATEGIC DECISION: Choose ONE strong creative angle, ONE dominant emotional trigger, ONE content style. Explain WHY.

STEP 3 — CREATIVE DIRECTION: Concept name, hook ideas (5-10), scene breakdown, camera behavior, lighting (specific), environment (specific), subject behavior.

STEP 4 — GENERATION: Ultra-detailed prompts (min 50 words) with subject, environment, lighting, camera, mood, textures, motion, realism level, composition, negative direction.

STEP 5 — EXECUTION: Shot list, 2-3 variations, A/B testing ideas, platform optimization.

STEP 6 — MEMORY: Reference previous work, build on what works.

TEMPLATE INTELLIGENCE:
1. "Consistent Character" (tpl-consistent-character) 2. "Brand Ad Campaign" (tpl-brand-ads) 3. "Virtual Try On" (tpl-virtual-try-on) 4. "Product Ad with Video" (tpl-product-ads) 5. "Video Manipulation" (tpl-video-manipulation) 6. "Cinematic Face Swap" (tpl-video-face-swap) 7. "Architecture Angles" (tpl-architecture-angles) 8. "Batch Generator" (tpl-text-iterator) 9. "Image Describe & Regen" (tpl-image-describer) 10. "Change Face" (tpl-change-face) 11. "Illustration Machine" (tpl-illustration-machine) 12. "Camera Angles" (tpl-camera-angle-ideation) 13. "Image to Video Compare" (tpl-image-to-video-compare) 14. "Advanced Compositor" (tpl-compositor-advanced) 15. "Multi Image Models" (tpl-multi-image-models) 16. "Image Editing" (tpl-editing-images)

MODELS: Image best: flux-2-pro, flux-pro-1.1-ultra | Fast: flux-fast | Design: recraft-v4 | Video best: wan-2.5 | Video premium: kling-3 | Video fast: ltx-2-video | Upscale: magnific-upscale | Lip sync: omnihuman-v1.5

ACTION COMMANDS:
- [TEMPLATE:tpl-id] — Launch button
- [PROMPT:detailed prompt] — Crafted prompt
- [CAMPAIGN:step1_title|tpl-id|prompt1|||step2_title|tpl-id|prompt2] — Campaign plan
- [SUGGESTION:text] — Clickable chip
- [MODEL:model-id] — Recommended model
- [BRIEF:product|audience|platform|goal] — Save brief

FORBIDDEN: Generic descriptions, agency language, vague lighting/environments, skipping interrogation.`;

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function LiaCreativeDirector() {
  const navigate = useNavigate();

  // ─── Chat state ─────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // ─── Detected actions ──────────────────────────────────────────────
  const [detectedTemplate, setDetectedTemplate] = useState<TemplateAction | null>(null);
  const [detectedPrompt, setDetectedPrompt] = useState<string | null>(null);
  const [detectedCampaign, setDetectedCampaign] = useState<{ title: string; templateId: string; prompt: string }[]>([]);
  const [detectedSuggestions, setDetectedSuggestions] = useState<string[]>([]);

  // ─── Context ──────────────────────────────────────────────────────
  const [crmContext, setCrmContext] = useState<LiaContext | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  // ─── Image upload ─────────────────────────────────────────────────
  const [uploadedImage, setUploadedImage] = useState<{ url: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Generation controls ──────────────────────────────────────────
  const [selectedModel, setSelectedModel] = useState('flux-2-pro');
  const [selectedAspect, setSelectedAspect] = useState<keyof typeof ASPECT_RATIOS>('1:1');
  const [imageCount, setImageCount] = useState(1);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [showNegativePrompt, setShowNegativePrompt] = useState(false);
  const [seed, setSeed] = useState<number | null>(null);
  const [seedLocked, setSeedLocked] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [qualityPreset, setQualityPreset] = useState<'standard' | 'high' | 'ultra'>('standard');
  const [stylePreset, setStylePreset] = useState('none');
  const [videoDuration, setVideoDuration] = useState(5);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);

  // ─── Generation state ─────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [outputs, setOutputs] = useState<GeneratedOutput[]>([]);
  const [outputIndex, setOutputIndex] = useState(0);

  // ─── Tab view ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabView>('generate');

  // ─── Campaign planner ─────────────────────────────────────────────
  const [campaigns, setCampaignsState] = useState<CampaignPlan[]>([]);

  // ─── Chat abort ────────────────────────────────────────────────
  const chatAbortRef = useRef<AbortController | null>(null);

  // ─── Prompt Library ──────────────────────────────────────────────
  const [showPromptLibrary, setShowPromptLibrary] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);

  // ─── Compare view ─────────────────────────────────────────────────
  const [compareItems, setCompareItems] = useState<DirectorGeneration[]>([]);
  const [recentGens, setRecentGens] = useState<DirectorGeneration[]>([]);

  // ─── Draw/Inpaint ─────────────────────────────────────────────────
  const [drawMode, setDrawMode] = useState(false);
  const [drawTool, setDrawTool] = useState<'brush' | 'eraser'>('brush');
  const [brushSize, setBrushSize] = useState(20);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  // ─── Refs ─────────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // ─── Init ─────────────────────────────────────────────────────────

  useEffect(() => {
    loadLiaContext().then(setCrmContext).catch(() => {});
    setCampaignsState(getCampaigns());
    setSavedPrompts(getSavedPrompts());
    supabase.rpc('current_org_id').then(({ data }) => {
      if (data) {
        const oid = String(data);
        setOrgId(oid);
        // Load credit balance
        supabase.from('org_credit_balances').select('credits_balance').eq('org_id', oid).maybeSingle()
          .then(({ data: bal }) => { if (bal) setCreditBalance(bal.credits_balance); });
      }
    });
  }, []);

  // Load recent generations once orgId is available
  useEffect(() => {
    if (!orgId) return;
    listGenerations(orgId, { limit: 20 }).then(({ data }) => setRecentGens(data)).catch(() => {});
  }, [orgId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) setShowModelPicker(false);
    }
    if (showModelPicker) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showModelPicker]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Clean up progress interval
  useEffect(() => () => { if (progressIntervalRef.current) clearInterval(progressIntervalRef.current); }, []);

  const currentModel = MODEL_CATALOG.find((m) => m.id === selectedModel);
  const creditCost = (currentModel?.creditCost || 2) * imageCount;
  const isVideoModel = currentModel?.capabilities.includes('text-to-video') || false;

  // ═══════════════════════════════════════════════════════════════════════
  // DIRECT GENERATION
  // ═══════════════════════════════════════════════════════════════════════

  // Refresh credit balance helper
  const refreshCredits = useCallback(() => {
    if (!orgId) return;
    supabase.from('org_credit_balances').select('credits_balance').eq('org_id', orgId).maybeSingle()
      .then(({ data: bal }) => { if (bal) setCreditBalance(bal.credits_balance); });
  }, [orgId]);

  // Persist output to Supabase storage
  const persistOutput = useCallback(async (url: string, prompt: string, model: string, meta: Record<string, any>) => {
    if (!orgId) return url;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/director-panel/assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ url, filename: `gen_${Date.now()}.jpg`, metadata: meta }),
      });
      if (res.ok) {
        const { publicUrl } = await res.json();
        return publicUrl || url;
      }
    } catch { /* fallback to original url */ }
    return url;
  }, [orgId]);

  // Enhance prompt via fal.ai prompt-enhancer
  const handleEnhancePrompt = useCallback(async () => {
    if (!generatePrompt.trim() || enhancingPrompt) return;
    setEnhancingPrompt(true);
    try {
      const request: ProviderRequest = {
        provider: 'fal',
        model: 'prompt-enhancer',
        params: { prompt: generatePrompt },
        inputs: { prompt: generatePrompt },
      };
      const response = await providerRegistry.execute(request);
      if (response.success && response.outputs[0]) {
        const enhanced = response.outputs[0].data || response.outputs[0].url;
        if (enhanced && typeof enhanced === 'string') {
          setGeneratePrompt(enhanced);
          toast.success('Prompt enhanced');
        }
      } else {
        toast.error('Enhancement failed');
      }
    } catch { toast.error('Enhancement failed'); }
    finally { setEnhancingPrompt(false); }
  }, [generatePrompt, enhancingPrompt]);

  const handleGenerate = useCallback(async () => {
    const prompt = generatePrompt.trim();
    if (!prompt || generating) return;

    setGenerating(true);
    setGenProgress(0);
    const newOutputs: GeneratedOutput[] = [];

    // Progress simulation
    progressIntervalRef.current = setInterval(() => {
      setGenProgress((prev) => prev >= 90 ? prev : prev + Math.random() * (isVideoModel ? 3 : 8));
    }, isVideoModel ? 1000 : 500);

    const currentSeed = seedLocked && seed !== null ? seed : Math.floor(Math.random() * 2147483647);
    if (!seedLocked) setSeed(currentSeed);

    try {
      // Build request with proper params for the server
      const request: ProviderRequest = {
        provider: currentModel?.provider || 'fal',
        model: selectedModel,
        params: {
          prompt,
          negative_prompt: negativePrompt || undefined,
          aspect_ratio: selectedAspect,
          num_outputs: imageCount,
          seed: currentSeed,
          quality_preset: qualityPreset,
          style_preset: stylePreset,
          ...(isVideoModel ? { duration: videoDuration } : {}),
          ...(currentModel?.defaultParams || {}),
        },
        inputs: {
          prompt,
          negative_prompt: negativePrompt || undefined,
          ...(uploadedImage ? { image: uploadedImage.url } : {}),
        },
      };

      const response = await providerRegistry.execute(request);
      if (!mountedRef.current) return;

      if (response.success && response.outputs.length > 0) {
        setGenProgress(80);

        for (const out of response.outputs) {
          if (!out.url) continue;

          // Persist to Supabase storage
          const persistedUrl = await persistOutput(out.url, prompt, selectedModel, {
            seed: currentSeed, aspect_ratio: selectedAspect, quality: qualityPreset, style: stylePreset,
          });

          const genOutput: GeneratedOutput = {
            id: crypto.randomUUID(),
            url: persistedUrl,
            type: out.kind === 'video' ? 'video' : 'image',
            model: selectedModel,
            prompt,
            negativePrompt: negativePrompt || undefined,
            seed: currentSeed,
            aspectRatio: selectedAspect,
            createdAt: new Date().toISOString(),
          };

          // Save generation record to DB (credits already debited by server)
          if (orgId) {
            try {
              const dbGen = await createGeneration({
                org_id: orgId, created_by: null, flow_id: null, run_id: null, node_id: null, template_id: null,
                title: prompt.slice(0, 60), prompt,
                output_type: genOutput.type, output_url: persistedUrl, thumbnail_url: persistedUrl,
                provider: currentModel?.provider || 'fal', model: selectedModel, status: 'completed',
                is_favorite: false,
                metadata: { seed: currentSeed, aspect_ratio: selectedAspect, negative_prompt: negativePrompt, quality: qualityPreset, style: stylePreset },
              });
              genOutput.generationId = dbGen.id;
            } catch { /* non-blocking */ }
          }

          newOutputs.push(genOutput);
        }
      } else {
        toast.error(response.error?.message || 'Generation failed');
      }

      if (newOutputs.length > 0) {
        setOutputs((prev) => [...newOutputs, ...prev]);
        setOutputIndex(0);
        savePromptResult({ prompt, model: selectedModel, outcome: 'success', downloaded: false, favorited: false });
        // Refresh data
        refreshCredits();
        if (orgId) listGenerations(orgId, { limit: 20 }).then(({ data }) => setRecentGens(data)).catch(() => {});
      }

      setUploadedImage(null);
    } catch (err: any) {
      toast.error(err?.message || 'Generation failed');
      savePromptResult({ prompt, model: selectedModel, outcome: 'failure', downloaded: false, favorited: false, notes: err?.message });
    } finally {
      setGenerating(false);
      setGenProgress(100);
      if (progressIntervalRef.current) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; }
      setTimeout(() => setGenProgress(0), 1000);
    }
  }, [generatePrompt, generating, selectedModel, selectedAspect, imageCount, negativePrompt, seed, seedLocked, currentModel, orgId, uploadedImage, qualityPreset, stylePreset, videoDuration, isVideoModel, refreshCredits, persistOutput]);

  // ═══════════════════════════════════════════════════════════════════════
  // REMIX / VARIATIONS
  // ═══════════════════════════════════════════════════════════════════════

  const handleRemix = (output: GeneratedOutput) => {
    setGeneratePrompt(output.prompt);
    if (output.negativePrompt) setNegativePrompt(output.negativePrompt);
    setSelectedModel(output.model);
    setSelectedAspect(output.aspectRatio as keyof typeof ASPECT_RATIOS);
    setSeed(null);
    setSeedLocked(false);
    setActiveTab('generate');
    toast.success('Prompt loaded — modify and regenerate');
  };

  const [pendingVariation, setPendingVariation] = useState(false);

  const handleVariation = async (output: GeneratedOutput) => {
    // Generate with same prompt but different seed
    setGeneratePrompt(output.prompt);
    if (output.negativePrompt) setNegativePrompt(output.negativePrompt);
    setSelectedModel(output.model);
    setSeed(null);
    setSeedLocked(false);
    setPendingVariation(true);
  };

  // Auto-generate when a variation is requested and prompt is set
  useEffect(() => {
    if (pendingVariation && generatePrompt) {
      setPendingVariation(false);
      handleGenerate();
    }
  }, [pendingVariation, generatePrompt]);

  // ═══════════════════════════════════════════════════════════════════════
  // UPSCALE
  // ═══════════════════════════════════════════════════════════════════════

  const handleUpscale = async (output: GeneratedOutput) => {
    if (generating) return;
    setGenerating(true);
    setGenProgress(0);

    progressIntervalRef.current = setInterval(() => {
      setGenProgress((prev) => prev >= 90 ? prev : prev + Math.random() * 6);
    }, 600);

    try {
      const upscaleModel = UPSCALE_MODELS[0]?.id || 'magnific-upscale';
      const request: ProviderRequest = {
        provider: 'fal',
        model: upscaleModel,
        params: {},
        inputs: { image: output.url },
      };

      const response = await providerRegistry.execute(request);
      if (response.success && response.outputs[0]?.url) {
        const upscaled: GeneratedOutput = {
          id: crypto.randomUUID(),
          url: response.outputs[0].url,
          type: 'image',
          model: upscaleModel,
          prompt: `Upscaled: ${output.prompt.slice(0, 40)}...`,
          seed: output.seed,
          aspectRatio: output.aspectRatio,
          createdAt: new Date().toISOString(),
        };

        if (orgId) {
          try {
            const dbGen = await createGeneration({
              org_id: orgId, created_by: null, flow_id: null, run_id: null, node_id: null, template_id: null,
              title: `Upscaled: ${output.prompt.slice(0, 40)}`,
              prompt: output.prompt,
              output_type: 'image', output_url: response.outputs[0].url, thumbnail_url: response.outputs[0].url,
              provider: 'fal', model: upscaleModel, status: 'completed',
              is_favorite: false,
              metadata: { source_output: output.id, upscaled: true },
            });
            upscaled.generationId = dbGen.id;
          } catch { /* non-blocking */ }
        }

        setOutputs((prev) => [upscaled, ...prev]);
        setOutputIndex(0);
        toast.success('Upscale complete');
      } else {
        toast.error(response.error?.message || 'Upscale failed');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Upscale failed');
    } finally {
      setGenerating(false);
      setGenProgress(100);
      if (progressIntervalRef.current) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; }
      setTimeout(() => setGenProgress(0), 1000);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // DRAW / INPAINT
  // ═══════════════════════════════════════════════════════════════════════

  const initDrawCanvas = useCallback((imageUrl: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = imageUrl;
  }, []);

  const handleDrawStart = (e: React.MouseEvent<HTMLCanvasElement>) => {
    drawingRef.current = true;
    handleDrawMove(e);
  };

  const handleDrawMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    ctx.beginPath();
    ctx.arc(x, y, brushSize * scaleX, 0, Math.PI * 2);
    if (drawTool === 'brush') {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
      ctx.fill();
    } else {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  };

  const handleDrawEnd = () => { drawingRef.current = false; };

  const handleInpaintGenerate = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !generatePrompt.trim()) return;

    // Get mask as data URL
    const maskDataUrl = canvas.toDataURL('image/png');

    setGenerating(true);
    setGenProgress(0);
    progressIntervalRef.current = setInterval(() => {
      setGenProgress((prev) => prev >= 90 ? prev : prev + Math.random() * 6);
    }, 600);

    try {
      const request: ProviderRequest = {
        provider: 'fal',
        model: 'flux-fill-pro',
        params: { prompt: generatePrompt, ...ASPECT_RATIOS[selectedAspect] },
        inputs: {
          image: outputs[outputIndex]?.url,
          mask: maskDataUrl,
          prompt: generatePrompt,
        },
      };

      const response = await providerRegistry.execute(request);
      if (response.success && response.outputs[0]?.url) {
        const inpainted: GeneratedOutput = {
          id: crypto.randomUUID(),
          url: response.outputs[0].url,
          type: 'image',
          model: 'flux-fill-pro',
          prompt: generatePrompt,
          aspectRatio: selectedAspect,
          createdAt: new Date().toISOString(),
        };
        setOutputs((prev) => [inpainted, ...prev]);
        setOutputIndex(0);
        setDrawMode(false);
        toast.success('Inpaint complete');
      } else {
        toast.error(response.error?.message || 'Inpaint failed');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Inpaint failed');
    } finally {
      setGenerating(false);
      setGenProgress(100);
      if (progressIntervalRef.current) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; }
      setTimeout(() => setGenProgress(0), 1000);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // IMAGE UPLOAD
  // ═══════════════════════════════════════════════════════════════════════

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Only images'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('Max 10MB'); return; }
    const url = URL.createObjectURL(file);
    setUploadedImage({ url, name: file.name });
  };

  // ═══════════════════════════════════════════════════════════════════════
  // CHAT - Parse Response
  // ═══════════════════════════════════════════════════════════════════════

  const parseResponse = (text: string) => {
    const templateMatch = text.match(/\[TEMPLATE:(tpl-[\w-]+)\]/);
    if (templateMatch) setDetectedTemplate({ templateId: templateMatch[1], title: templateMatch[1].replace('tpl-', '').replace(/-/g, ' ') });

    const promptMatch = text.match(/\[PROMPT:([\s\S]*?)\]/);
    if (promptMatch) {
      setDetectedPrompt(promptMatch[1].trim());
      // Auto-fill generate prompt
      setGeneratePrompt(promptMatch[1].trim());
    }

    const campaignMatch = text.match(/\[CAMPAIGN:([\s\S]*?)\]/);
    if (campaignMatch) {
      const steps = campaignMatch[1].split('|||').map((s) => {
        const [title, tplId, prompt] = s.split('|').map((p) => p.trim());
        return { title: title || 'Step', templateId: tplId || '', prompt: prompt || '' };
      }).filter((s) => s.templateId);
      setDetectedCampaign(steps);
    }

    const suggestionMatches = text.matchAll(/\[SUGGESTION:(.*?)\]/g);
    const suggestions: string[] = [];
    for (const m of suggestionMatches) suggestions.push(m[1].trim());
    if (suggestions.length > 0) setDetectedSuggestions(suggestions);

    const modelMatch = text.match(/\[MODEL:([\w.-]+)\]/);
    if (modelMatch) {
      const found = MODEL_CATALOG.find((m) => m.id === modelMatch[1]);
      if (found) setSelectedModel(found.id);
    }

    const briefMatch = text.match(/\[BRIEF:(.*?)\]/);
    if (briefMatch) {
      const [product, audience, platform, goal] = briefMatch[1].split('|').map((s) => s.trim());
      if (product && audience) saveBrief({ product, audience, platform: platform || '', goal: goal || '' });
    }

    return text
      .replace(/\[TEMPLATE:[\w-]+\]/g, '').replace(/\[PROMPT:[\s\S]*?\]/g, '')
      .replace(/\[CAMPAIGN:[\s\S]*?\]/g, '').replace(/\[SUGGESTION:.*?\]/g, '')
      .replace(/\[MODEL:[\w.-]+\]/g, '').replace(/\[BRIEF:.*?\]/g, '').trim();
  };

  // ═══════════════════════════════════════════════════════════════════════
  // CHAT - Send Message
  // ═══════════════════════════════════════════════════════════════════════

  const handleSend = useCallback(async (text?: string) => {
    const trimmed = (text || input).trim();
    if (!trimmed || streaming) return;

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: trimmed, imageUrl: uploadedImage?.url };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    setDetectedTemplate(null); setDetectedPrompt(null); setDetectedCampaign([]); setDetectedSuggestions([]);

    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

    const contextBlock = crmContext ? buildContextBlock(crmContext) : '';
    const memoryBlock = buildMemoryBlock();

    let visionAnalysis = '';
    if (uploadedImage) {
      try {
        visionAnalysis = await analyzeImageWithVision({
          imageUrl: uploadedImage.url,
          prompt: 'Describe this image in detail for a creative director: subject, style, lighting, colors, mood, composition, textures.',
        });
        visionAnalysis = `\n\n=== REFERENCE IMAGE ANALYSIS ===\n${visionAnalysis}`;
      } catch { visionAnalysis = '\n\n[Vision model unavailable]'; }
      setUploadedImage(null);
    }

    const fullSystemPrompt = [SYSTEM_PROMPT, contextBlock ? `\n\n${contextBlock}` : '', memoryBlock ? `\n\n${memoryBlock}` : '', visionAnalysis].filter(Boolean).join('');
    const history = [{ role: 'system', content: fullSystemPrompt }, ...messages.map((m) => ({ role: m.role, content: m.content }))];

    let fullResponse = '';
    const abortCtrl = new AbortController();
    chatAbortRef.current = abortCtrl;
    try {
      await streamMessageToAI({
        conversationId: null, content: trimmed, history, dbReady: false,
        signal: abortCtrl.signal,
        onToken: (token) => {
          fullResponse += token;
          const cleaned = parseResponse(fullResponse);
          setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: cleaned } : m));
        },
      });
    } catch (err: any) {
      if (abortCtrl.signal.aborted) {
        // User cancelled — keep partial response
        if (!fullResponse) {
          setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: '(Cancelled)' } : m));
        }
      } else {
        setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: 'Could not connect to AI. Make sure Ollama is running.' } : m));
      }
    } finally { setStreaming(false); chatAbortRef.current = null; }
  }, [input, streaming, messages, crmContext, uploadedImage]);

  const handleCancelChat = useCallback(() => {
    chatAbortRef.current?.abort();
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // CAMPAIGN ACTIONS
  // ═══════════════════════════════════════════════════════════════════════

  const handleSaveCampaign = () => {
    if (detectedCampaign.length === 0) return;
    saveCampaign({
      name: `Campaign ${new Date().toLocaleDateString()}`,
      steps: detectedCampaign.map((s) => ({ id: crypto.randomUUID(), title: s.title, templateId: s.templateId, prompt: s.prompt, status: 'pending' as const })),
      status: 'planning',
    });
    setCampaignsState(getCampaigns());
    toast.success('Campaign saved');
  };

  const handleStepAction = (campaignId: string, stepId: string, action: 'start' | 'complete' | 'skip') => {
    updateCampaignStep(campaignId, stepId, {
      status: action === 'start' ? 'in_progress' : action === 'complete' ? 'completed' : 'skipped',
      ...(action === 'complete' ? { completedAt: new Date().toISOString() } : {}),
    });
    setCampaignsState(getCampaigns());
  };

  const handleLaunchTemplate = (templateId?: string, prompt?: string) => {
    const tplId = templateId || detectedTemplate?.templateId;
    if (!tplId) return;
    const params = new URLSearchParams({ template: tplId });
    const p = prompt || detectedPrompt;
    if (p) params.set('inputs', encodeURIComponent(JSON.stringify({ scene_description: p })));
    navigate(`/director-panel/flows/new?${params.toString()}`);
  };

  // ═══════════════════════════════════════════════════════════════════════
  // COMPARE
  // ═══════════════════════════════════════════════════════════════════════

  const toggleCompareItem = (gen: DirectorGeneration) => {
    setCompareItems((prev) => {
      if (prev.find((g) => g.id === gen.id)) return prev.filter((g) => g.id !== gen.id);
      if (prev.length >= 4) { toast.error('Max 4'); return prev; }
      return [...prev, gen];
    });
  };

  // ═══════════════════════════════════════════════════════════════════════
  // EXPORT BRIEF
  // ═══════════════════════════════════════════════════════════════════════

  const handleExportBrief = () => {
    const brief = messages.map((m) => `${m.role === 'user' ? 'CLIENT' : 'CREATIVE DIRECTOR'}:\n${m.content}`).join('\n\n---\n\n');
    const header = `CREATIVE BRIEF — Generated by LIA Director\nDate: ${new Date().toLocaleDateString()}\n${'═'.repeat(60)}\n\n`;
    const blob = new Blob([header + brief], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `creative-brief-${Date.now()}.txt`;
    a.click();
    toast.success('Brief exported');
  };

  // ═══════════════════════════════════════════════════════════════════════

  const hasMessages = messages.length > 0;
  const activeCampaigns = campaigns.filter((c) => c.status !== 'completed');
  const currentOutput = outputs[outputIndex];

  return (
    <div className={cn(
      'section-card overflow-hidden transition-all duration-300',
      expanded ? 'fixed inset-4 z-50 shadow-2xl' : '',
    )}>
      {/* ─── Header ─── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-outline bg-surface">
        <div className="w-9 h-9 rounded-xl bg-surface-card border border-outline flex items-center justify-center shadow-sm">
          <OllamaIcon size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-bold text-text-primary">LIA — Creative Director</h2>
          <p className="text-[11px] text-text-tertiary">Elite AI creative direction + generation studio</p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 bg-surface-secondary rounded-lg p-0.5 border border-outline">
          {([['generate', 'Generate'], ['chat', 'Chat'], ['campaigns', 'Campaigns'], ['compare', 'Compare']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={cn('px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                activeTab === key ? 'bg-primary text-white shadow-sm' : 'text-text-tertiary hover:text-text-primary')}>
              {label}
              {key === 'campaigns' && activeCampaigns.length > 0 && (
                <span className="ml-1 w-4 h-4 inline-flex items-center justify-center rounded-full bg-purple-500 text-white text-[9px] font-bold">{activeCampaigns.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {hasMessages && <button onClick={handleExportBrief} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors" title="Export brief"><FileDown className="w-4 h-4" /></button>}
          <button onClick={() => setExpanded(!expanded)} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors">
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* ═══ Progress bar ═══ */}
      {genProgress > 0 && (
        <div className="h-1 bg-surface-secondary">
          <div className="h-full bg-gradient-to-r from-purple-500 to-violet-500 transition-all duration-300 ease-out" style={{ width: `${genProgress}%` }} />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: GENERATE (Higgsfield-style)
          ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'generate' && (
        <div className="flex flex-col" style={{ maxHeight: expanded ? 'calc(100vh - 120px)' : '600px' }}>

          {/* Output Gallery */}
          {outputs.length > 0 && !drawMode && (
            <div className="relative bg-black/5 border-b border-outline">
              <div className="flex items-center justify-center p-4" style={{ minHeight: expanded ? '400px' : '280px' }}>
                {currentOutput && (
                  currentOutput.type === 'video' ? (
                    <video src={currentOutput.url} className="max-h-full max-w-full rounded-lg object-contain" controls autoPlay muted loop />
                  ) : (
                    <img src={currentOutput.url} alt="Generated" className="max-h-full max-w-full rounded-lg object-contain" style={{ maxHeight: expanded ? '380px' : '260px' }} />
                  )
                )}
              </div>

              {/* Navigation arrows */}
              {outputs.length > 1 && (
                <>
                  <button onClick={() => setOutputIndex(Math.max(0, outputIndex - 1))} disabled={outputIndex === 0}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-surface-card/80 border border-outline shadow-sm disabled:opacity-30 hover:bg-surface-card transition-colors">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={() => setOutputIndex(Math.min(outputs.length - 1, outputIndex + 1))} disabled={outputIndex === outputs.length - 1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-surface-card/80 border border-outline shadow-sm disabled:opacity-30 hover:bg-surface-card transition-colors">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}

              {/* Thumbnail strip */}
              {outputs.length > 1 && (
                <div className="absolute top-2 right-2 flex gap-1">
                  {outputs.slice(0, 8).map((out, i) => (
                    <button key={out.id} onClick={() => setOutputIndex(i)}
                      className={cn('w-10 h-10 rounded-md overflow-hidden border-2 transition-all hover:scale-105',
                        i === outputIndex ? 'border-purple-500 shadow-md' : 'border-white/50 opacity-70 hover:opacity-100')}>
                      {out.type === 'video'
                        ? <div className="w-full h-full bg-black/30 flex items-center justify-center"><Film className="w-4 h-4 text-white" /></div>
                        : <img src={out.url} alt="" className="w-full h-full object-cover" />}
                    </button>
                  ))}
                </div>
              )}

              {/* Output action bar */}
              {currentOutput && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-surface-card/90 backdrop-blur-sm border border-outline rounded-xl px-2 py-1.5 shadow-lg">
                  <span className="text-xs font-medium text-text-secondary px-1">{outputIndex + 1}/{outputs.length}</span>
                  <div className="w-px h-4 bg-outline" />
                  <button onClick={() => handleRemix(currentOutput)} className="p-1.5 rounded-lg text-text-tertiary hover:text-purple-600 hover:bg-purple-50 transition-colors" title="Remix">
                    <Shuffle className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleVariation(currentOutput)} className="p-1.5 rounded-lg text-text-tertiary hover:text-purple-600 hover:bg-purple-50 transition-colors" title="Variation">
                    <Dices className="w-3.5 h-3.5" />
                  </button>
                  {currentOutput.type === 'image' && (
                    <>
                      <button onClick={() => handleUpscale(currentOutput)} className="p-1.5 rounded-lg text-text-tertiary hover:text-purple-600 hover:bg-purple-50 transition-colors" title="Upscale">
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => { setDrawMode(true); initDrawCanvas(currentOutput.url); }} className="p-1.5 rounded-lg text-text-tertiary hover:text-purple-600 hover:bg-purple-50 transition-colors" title="Draw / Inpaint">
                        <Brush className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <div className="w-px h-4 bg-outline" />
                  <button onClick={() => { navigator.clipboard.writeText(currentOutput.prompt); toast.success('Prompt copied'); }}
                    className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors" title="Copy prompt">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <a href={currentOutput.url} download target="_blank" rel="noopener noreferrer"
                    className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors" title="Download">
                    <Download className="w-3.5 h-3.5" />
                  </a>
                  {currentOutput.seed && (
                    <button onClick={() => { setSeed(currentOutput.seed!); setSeedLocked(true); toast.success(`Seed locked: ${currentOutput.seed}`); }}
                      className="px-2 py-1 rounded-md text-[10px] font-mono text-text-tertiary hover:bg-surface-secondary transition-colors" title="Lock this seed">
                      S:{currentOutput.seed}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Draw/Inpaint overlay */}
          {drawMode && currentOutput && (
            <div className="relative border-b border-outline bg-black/5">
              <div className="flex items-center gap-2 px-4 py-2 bg-surface-secondary border-b border-outline">
                <Brush className="w-4 h-4 text-purple-500" />
                <span className="text-[12px] font-semibold text-text-primary">Inpaint Mode</span>
                <span className="text-[11px] text-text-tertiary">— Paint over the area you want to change, then describe what to generate</span>
                <div className="flex-1" />
                <div className="flex items-center gap-1">
                  <button onClick={() => setDrawTool('brush')} className={cn('p-1.5 rounded-md', drawTool === 'brush' ? 'bg-purple-100 text-purple-600' : 'text-text-tertiary hover:text-text-primary')}>
                    <Brush className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setDrawTool('eraser')} className={cn('p-1.5 rounded-md', drawTool === 'eraser' ? 'bg-purple-100 text-purple-600' : 'text-text-tertiary hover:text-text-primary')}>
                    <Eraser className="w-3.5 h-3.5" />
                  </button>
                  <input type="range" min="5" max="60" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="w-20 h-1 accent-purple-500" />
                  <span className="text-[10px] text-text-tertiary w-6">{brushSize}px</span>
                </div>
                <button onClick={() => setDrawMode(false)} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex justify-center p-4">
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleDrawStart}
                  onMouseMove={handleDrawMove}
                  onMouseUp={handleDrawEnd}
                  onMouseLeave={handleDrawEnd}
                  className="max-h-[300px] max-w-full rounded-lg cursor-crosshair border border-outline"
                  style={{ maxHeight: expanded ? '380px' : '260px' }}
                />
              </div>
              <div className="px-4 pb-3">
                <button onClick={handleInpaintGenerate} disabled={generating || !generatePrompt.trim()}
                  className="w-full py-2 rounded-xl bg-gradient-to-r from-purple-500 to-violet-600 text-white text-[13px] font-semibold disabled:opacity-50 hover:shadow-lg transition-all">
                  {generating ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Inpaint Selected Area'}
                </button>
              </div>
            </div>
          )}

          {/* Image upload preview */}
          {uploadedImage && (
            <div className="mx-4 mt-3 flex items-center gap-2 p-2 rounded-lg bg-surface-secondary border border-outline">
              <img src={uploadedImage.url} alt="Upload" className="w-12 h-12 rounded-md object-cover border border-outline" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-text-primary truncate">{uploadedImage.name}</p>
                <p className="text-[10px] text-text-tertiary">Reference image for generation</p>
              </div>
              <button onClick={() => setUploadedImage(null)} className="p-1 rounded-md hover:bg-surface-tertiary text-text-tertiary"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {/* ─── Prompt Library Panel ─── */}
          {showPromptLibrary && savedPrompts.length > 0 && (
            <div className="mx-4 mt-3 max-h-[200px] overflow-y-auto rounded-xl border border-outline bg-surface-secondary p-2 space-y-1">
              {savedPrompts.map((sp) => (
                <div key={sp.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-tertiary group transition-colors">
                  <button onClick={() => { setGeneratePrompt(sp.prompt); if (sp.negativePrompt) setNegativePrompt(sp.negativePrompt); if (sp.model) setSelectedModel(sp.model); if (sp.aspectRatio) setSelectedAspect(sp.aspectRatio as any); setShowPromptLibrary(false); toast.success('Prompt loaded'); }}
                    className="flex-1 text-left min-w-0">
                    <p className="text-[12px] font-medium text-text-primary truncate">{sp.title}</p>
                    <p className="text-[10px] text-text-tertiary truncate">{sp.prompt.slice(0, 80)}...</p>
                  </button>
                  <button onClick={() => { deleteSavedPrompt(sp.id); setSavedPrompts(getSavedPrompts()); }}
                    className="p-1 rounded-md text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-danger transition-all">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {showPromptLibrary && savedPrompts.length === 0 && (
            <div className="mx-4 mt-3 py-6 text-center rounded-xl border border-outline bg-surface-secondary">
              <p className="text-[12px] text-text-tertiary">No saved prompts yet</p>
              <p className="text-[10px] text-text-tertiary mt-1">Generate something, then click "Save" to add it here.</p>
            </div>
          )}

          {/* ─── Prompt Area ─── */}
          <div className="flex-1 px-4 pt-3">
            <textarea
              value={generatePrompt}
              onChange={(e) => setGeneratePrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); handleGenerate(); } }}
              placeholder="Describe what you want to generate..."
              disabled={generating}
              rows={expanded ? 4 : 3}
              className="w-full bg-surface-secondary border border-outline rounded-xl px-4 py-3 text-[13px] text-text-primary placeholder:text-text-tertiary outline-none focus:border-primary/40 resize-none disabled:opacity-50 transition-colors"
            />

            {/* Negative prompt (collapsible) */}
            {showNegativePrompt && (
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="Negative prompt — what to avoid..."
                rows={2}
                className="w-full mt-2 bg-surface-secondary border border-outline rounded-xl px-4 py-2.5 text-[12px] text-text-primary placeholder:text-text-tertiary outline-none focus:border-red-300/40 resize-none transition-colors"
              />
            )}
          </div>

          {/* ─── Controls Bar ─── */}
          <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap">
            {/* Model selector */}
            <div className="relative" ref={modelPickerRef}>
              <button onClick={() => setShowModelPicker(!showModelPicker)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-secondary border border-outline text-[11px] font-medium text-text-secondary hover:border-primary/30 transition-colors">
                <Sparkles className="w-3 h-3 text-purple-400" />
                {currentModel?.displayName || selectedModel}
                <ChevronDown className="w-3 h-3 text-text-tertiary" />
              </button>
              {showModelPicker && (
                <div className="absolute bottom-full left-0 mb-1 w-[280px] max-h-[300px] overflow-y-auto bg-surface border border-outline rounded-xl shadow-xl z-50 py-1">
                  {QUICK_MODELS.map((m) => (
                    <button key={m.id} onClick={() => { setSelectedModel(m.id); setShowModelPicker(false); }}
                      className={cn('flex items-center justify-between w-full px-3 py-2 text-left hover:bg-surface-secondary transition-colors', selectedModel === m.id && 'bg-purple-50')}>
                      <div>
                        <span className="text-[12px] text-text-primary">{m.displayName}</span>
                        <span className="ml-2 text-[10px] text-text-tertiary">{m.subcategory}</span>
                      </div>
                      <span className="text-[10px] text-text-tertiary font-medium">{m.creditCost} cr</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Aspect ratio */}
            <div className="flex items-center rounded-lg bg-surface-secondary border border-outline overflow-hidden">
              {(['1:1', '9:16', '16:9', '4:3', '3:4'] as const).map((ar) => {
                const Icon = ASPECT_ICONS[ar] || Square;
                return (
                  <button key={ar} onClick={() => setSelectedAspect(ar)}
                    className={cn('flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium transition-colors',
                      selectedAspect === ar ? 'bg-primary text-white' : 'text-text-tertiary hover:text-text-primary')}>
                    <Icon className="w-3 h-3" />{ar}
                  </button>
                );
              })}
            </div>

            {/* Quality preset */}
            <select value={qualityPreset} onChange={(e) => setQualityPreset(e.target.value as any)}
              className="px-2 py-1.5 rounded-lg bg-surface-secondary border border-outline text-[11px] font-medium text-text-secondary outline-none cursor-pointer">
              <option value="standard">Standard</option>
              <option value="high">High Quality</option>
              <option value="ultra">Ultra</option>
            </select>

            {/* Style preset */}
            <select value={stylePreset} onChange={(e) => setStylePreset(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-surface-secondary border border-outline text-[11px] font-medium text-text-secondary outline-none cursor-pointer">
              <option value="none">No style</option>
              <option value="cinematic">Cinematic</option>
              <option value="photographic">Photo</option>
              <option value="anime">Anime</option>
              <option value="digital_art">Digital Art</option>
              <option value="comic_book">Comic</option>
              <option value="fantasy">Fantasy</option>
              <option value="neon_punk">Neon</option>
            </select>

            {/* Image count (only for image models) */}
            {!isVideoModel && (
              <div className="flex items-center gap-1 rounded-lg bg-surface-secondary border border-outline px-1">
                <button onClick={() => setImageCount(Math.max(1, imageCount - 1))} className="p-1 text-text-tertiary hover:text-text-primary"><span className="text-[12px] font-bold">-</span></button>
                <span className="text-xs font-medium text-text-primary w-8 text-center">{imageCount}/4</span>
                <button onClick={() => setImageCount(Math.min(4, imageCount + 1))} className="p-1 text-text-tertiary hover:text-text-primary"><span className="text-[12px] font-bold">+</span></button>
              </div>
            )}

            {/* Video duration (only for video models) */}
            {isVideoModel && (
              <select value={videoDuration} onChange={(e) => setVideoDuration(Number(e.target.value))}
                className="px-2 py-1.5 rounded-lg bg-surface-secondary border border-outline text-[11px] font-medium text-text-secondary outline-none cursor-pointer">
                <option value={2}>2s</option>
                <option value={4}>4s</option>
                <option value={5}>5s</option>
                <option value={6}>6s</option>
                <option value={8}>8s</option>
                <option value={10}>10s</option>
              </select>
            )}

            {/* Seed control */}
            <button onClick={() => { if (seedLocked) { setSeedLocked(false); setSeed(null); } else if (seed !== null) { setSeedLocked(true); } }}
              className={cn('flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors',
                seedLocked ? 'bg-purple-50 border-purple-200 text-purple-600' : 'bg-surface-secondary border-outline text-text-tertiary hover:text-text-primary')}>
              {seedLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              {seed !== null ? `${seed}` : 'Seed'}
            </button>

            {/* Negative prompt toggle */}
            <button onClick={() => setShowNegativePrompt(!showNegativePrompt)}
              className={cn('p-1.5 rounded-lg transition-colors', showNegativePrompt ? 'bg-red-50 text-red-500' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary')}
              title="Negative prompt">
              <X className="w-4 h-4" />
            </button>

            {/* Draw mode toggle */}
            {outputs.length > 0 && currentOutput?.type === 'image' && (
              <button onClick={() => { setDrawMode(!drawMode); if (!drawMode && currentOutput) initDrawCanvas(currentOutput.url); }}
                className={cn('p-1.5 rounded-lg transition-colors', drawMode ? 'bg-purple-50 text-purple-600' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary')}
                title="Draw / Inpaint">
                <Brush className="w-4 h-4" />
              </button>
            )}

            {/* Image upload */}
            <button onClick={() => fileInputRef.current?.click()} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors" title="Upload reference">
              <ImagePlus className="w-4 h-4" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />

            {/* Enhance prompt */}
            <button onClick={handleEnhancePrompt} disabled={enhancingPrompt || !generatePrompt.trim()}
              className={cn('flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors',
                enhancingPrompt ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-surface-secondary border-outline text-text-tertiary hover:text-text-primary hover:border-amber-300')}
              title="AI enhance prompt">
              {enhancingPrompt ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              Enhance
            </button>

            {/* Save prompt */}
            <button onClick={() => {
              if (!generatePrompt.trim()) return;
              const title = generatePrompt.slice(0, 40);
              savePrompt({ title, prompt: generatePrompt, negativePrompt, model: selectedModel, aspectRatio: selectedAspect, tags: [] });
              setSavedPrompts(getSavedPrompts());
              toast.success('Prompt saved');
            }} disabled={!generatePrompt.trim()}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-surface-secondary border border-outline text-[11px] font-medium text-text-tertiary hover:text-text-primary transition-colors"
              title="Save prompt to library">
              <Bookmark className="w-3 h-3" /> Save
            </button>

            {/* Prompt library toggle */}
            <button onClick={() => { setShowPromptLibrary(!showPromptLibrary); setSavedPrompts(getSavedPrompts()); }}
              className={cn('flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors',
                showPromptLibrary ? 'bg-purple-50 border-purple-200 text-purple-600' : 'bg-surface-secondary border-outline text-text-tertiary hover:text-text-primary')}
              title="Prompt library">
              <Library className="w-3 h-3" /> Library
            </button>

            <div className="flex-1" />

            {/* Credit balance + cost */}
            <div className="flex items-center gap-1.5 text-[11px]">
              {creditBalance !== null && (
                <span className="text-text-tertiary font-medium">{creditBalance} cr</span>
              )}
              <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-700 font-semibold">
                <Coins className="w-3 h-3" />
                <span>{creditCost}</span>
              </div>
            </div>

            {/* Generate button */}
            <button id="lia-generate-btn" onClick={handleGenerate} disabled={!generatePrompt.trim() || generating}
              className={cn('flex items-center gap-2 px-5 py-2 rounded-xl text-[13px] font-semibold transition-all',
                generatePrompt.trim() && !generating
                  ? 'bg-gradient-to-r from-purple-500 to-violet-600 text-white shadow-md hover:shadow-lg hover:scale-[1.02]'
                  : 'bg-surface-tertiary text-text-tertiary/40 cursor-not-allowed')}>
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4" />Generate</>}
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: CHAT
          ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'chat' && (
        <>
          {hasMessages && (
            <div ref={scrollRef} className={cn('overflow-y-auto px-5 py-4 space-y-4', expanded ? 'max-h-[calc(100vh-200px)]' : 'max-h-[400px]')}>
              {messages.map((msg) => (
                <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {msg.role === 'assistant' && <div className="w-7 h-7 rounded-lg bg-surface-card border border-outline flex items-center justify-center shrink-0 mt-0.5"><OllamaIcon size={16} /></div>}
                  <div className={cn('max-w-[80%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed',
                    msg.role === 'user' ? 'bg-primary text-white rounded-br-md' : 'bg-surface-secondary border border-outline text-text-primary rounded-bl-md')}>
                    {msg.imageUrl && <div className="mb-2 rounded-lg overflow-hidden border border-outline/50"><img src={msg.imageUrl} alt="Ref" className="max-h-[150px] w-auto object-cover" /></div>}
                    {msg.content ? <div className="whitespace-pre-wrap">{msg.content}</div> : (
                      <span className="inline-flex gap-1 py-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    )}
                  </div>
                  {msg.role === 'user' && <div className="w-7 h-7 rounded-lg bg-surface-tertiary border border-outline flex items-center justify-center shrink-0 mt-0.5"><User className="w-3.5 h-3.5 text-text-secondary" /></div>}
                </div>
              ))}

              {/* Template / Campaign / Suggestions */}
              {!streaming && detectedTemplate && (
                <div className="flex flex-col items-start gap-2 ml-10">
                  <button onClick={() => handleLaunchTemplate()}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-violet-600 text-white text-[13px] font-medium shadow-md hover:shadow-lg transition-all hover:scale-[1.02]">
                    <Wand2 className="w-4 h-4" />Launch: {detectedTemplate.title}<ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  {detectedPrompt && (
                    <div className="flex gap-2 ml-1">
                      <button onClick={() => { setGeneratePrompt(detectedPrompt); setActiveTab('generate'); toast.success('Prompt loaded in Generate tab'); }}
                        className="flex items-center gap-1.5 text-[11px] text-purple-600 hover:text-purple-700 transition-colors font-medium">
                        <Sparkles className="w-3 h-3" /> Generate directly
                      </button>
                      <button onClick={() => { navigator.clipboard.writeText(detectedPrompt); toast.success('Copied'); }}
                        className="flex items-center gap-1.5 text-[11px] text-text-tertiary hover:text-text-primary transition-colors">
                        <Copy className="w-3 h-3" /> Copy
                      </button>
                    </div>
                  )}
                </div>
              )}

              {!streaming && detectedCampaign.length > 0 && (
                <div className="ml-10 space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-text-secondary">Campaign Plan:</p>
                    <button onClick={handleSaveCampaign} className="flex items-center gap-1 px-2 py-1 rounded-md bg-purple-50 border border-purple-200 text-purple-600 text-[10px] font-medium hover:bg-purple-100 transition-colors">
                      <Plus className="w-3 h-3" /> Save
                    </button>
                  </div>
                  {detectedCampaign.map((step, i) => (
                    <button key={i} onClick={() => handleLaunchTemplate(step.templateId, step.prompt)}
                      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl border border-outline text-left hover:bg-surface-secondary hover:border-primary/30 transition-all group">
                      <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-[11px] font-bold shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-text-primary">{step.title}</p>
                        {step.prompt && <p className="text-[10px] text-text-tertiary truncate mt-0.5 italic">{step.prompt.slice(0, 80)}...</p>}
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-text-tertiary group-hover:text-primary shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              )}

              {!streaming && detectedSuggestions.length > 0 && (
                <div className="ml-10 flex flex-wrap gap-1.5">
                  {detectedSuggestions.map((s, i) => (
                    <button key={i} onClick={() => void handleSend(s)}
                      className="px-3 py-1.5 rounded-full border border-outline text-[11px] text-text-secondary hover:bg-surface-secondary hover:border-primary/30 hover:text-text-primary transition-all">{s}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!hasMessages && (
            <div className="px-5 py-4 grid grid-cols-2 gap-2">
              {buildSmartStarters(crmContext).map((s, i) => (
                <button key={i} onClick={() => void handleSend(s.prompt)}
                  className="flex items-center gap-2.5 px-3 py-3 rounded-xl border border-outline text-left hover:bg-surface-secondary hover:border-primary/30 transition-all group">
                  <s.icon className="w-4 h-4 text-text-tertiary group-hover:text-primary shrink-0 transition-colors" />
                  <span className="text-[12px] font-medium text-text-secondary group-hover:text-text-primary transition-colors">{s.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Chat input */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-outline">
            <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
              placeholder={hasMessages ? 'Continue...' : 'Ask LIA anything...'}
              disabled={streaming}
              className="flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-tertiary outline-none disabled:opacity-50" />
            <button onClick={() => fileInputRef.current?.click()} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary transition-colors"><ImagePlus className="w-4 h-4" /></button>
            {streaming ? (
              <button onClick={handleCancelChat} className="p-2 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors" title="Stop generation">
                <Square className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={() => void handleSend()} disabled={!input.trim()}
                className={cn('p-2 rounded-xl transition-colors', input.trim() ? 'bg-purple-500 text-white hover:bg-purple-600' : 'text-text-tertiary/30 cursor-not-allowed')}>
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: CAMPAIGNS
          ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'campaigns' && (
        <div className={cn('overflow-y-auto px-5 py-4 space-y-4', expanded ? 'max-h-[calc(100vh-120px)]' : 'max-h-[500px]')}>
          {campaigns.length === 0 ? (
            <div className="text-center py-12">
              <Play className="w-8 h-8 text-text-tertiary/30 mx-auto mb-3" />
              <p className="text-[13px] text-text-tertiary">No campaigns yet</p>
              <p className="text-[11px] text-text-tertiary mt-1">Ask LIA to create a campaign plan, then save it here. Campaigns are stored locally in your browser.</p>
            </div>
          ) : campaigns.map((campaign) => {
            const doneCount = campaign.steps.filter((s) => s.status === 'completed').length;
            const progress = campaign.steps.length > 0 ? Math.round((doneCount / campaign.steps.length) * 100) : 0;
            return (
              <div key={campaign.id} className="rounded-xl border border-outline overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-surface-secondary">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary">{campaign.name}</p>
                    <p className="text-[10px] text-text-tertiary mt-0.5">{doneCount}/{campaign.steps.length} done</p>
                  </div>
                  <div className="w-16 h-1.5 rounded-full bg-outline overflow-hidden">
                    <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium',
                    campaign.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : campaign.status === 'in_progress' ? 'bg-purple-50 text-purple-600' : 'bg-amber-50 text-amber-600')}>
                    {campaign.status.replace('_', ' ')}
                  </span>
                  <button onClick={() => { deleteCampaign(campaign.id); setCampaignsState(getCampaigns()); }} className="p-1 text-text-tertiary hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="divide-y divide-outline">
                  {campaign.steps.map((step, i) => (
                    <div key={step.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-secondary/50 transition-colors">
                      <span className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0',
                        step.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : step.status === 'in_progress' ? 'bg-purple-100 text-purple-600' : step.status === 'skipped' ? 'bg-gray-100 text-gray-400' : 'bg-surface-tertiary text-text-tertiary')}>
                        {step.status === 'completed' ? <Check className="w-3.5 h-3.5" /> : i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-[12px] font-medium', step.status === 'skipped' ? 'text-text-tertiary line-through' : 'text-text-primary')}>{step.title}</p>
                      </div>
                      {step.status === 'pending' && (
                        <div className="flex gap-1">
                          <button onClick={() => { handleStepAction(campaign.id, step.id, 'start'); handleLaunchTemplate(step.templateId, step.prompt); }}
                            className="p-1.5 rounded-md bg-purple-50 text-purple-600 hover:bg-purple-100"><Play className="w-3 h-3" /></button>
                          <button onClick={() => handleStepAction(campaign.id, step.id, 'skip')} className="p-1.5 rounded-md text-text-tertiary hover:bg-surface-tertiary"><SkipForward className="w-3 h-3" /></button>
                        </div>
                      )}
                      {step.status === 'in_progress' && (
                        <button onClick={() => handleStepAction(campaign.id, step.id, 'complete')}
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 text-emerald-600 text-[10px] font-medium hover:bg-emerald-100">
                          <Check className="w-3 h-3" /> Done
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: COMPARE
          ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'compare' && (
        <div className={cn('overflow-y-auto px-5 py-4', expanded ? 'max-h-[calc(100vh-120px)]' : 'max-h-[500px]')}>
          {compareItems.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12px] font-semibold text-text-primary">Comparing {compareItems.length} items</p>
                <button onClick={() => setCompareItems([])} className="text-[11px] text-text-tertiary hover:text-text-primary">Clear</button>
              </div>
              <div className={cn('grid gap-3', compareItems.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4')}>
                {compareItems.map((gen) => (
                  <div key={gen.id} className="rounded-xl border border-outline overflow-hidden group relative">
                    {gen.output_url ? (
                      gen.output_type === 'video' ? <video src={gen.output_url} className="w-full aspect-square object-cover" controls muted />
                      : <img src={gen.output_url} alt={gen.title} className="w-full aspect-square object-cover" />
                    ) : <div className="w-full aspect-square bg-surface-tertiary flex items-center justify-center"><Image className="w-8 h-8 text-text-tertiary/30" /></div>}
                    <div className="p-2">
                      <p className="text-[11px] font-medium text-text-primary truncate">{gen.title}</p>
                      <p className="text-[10px] text-text-tertiary">{gen.model || 'unknown'}</p>
                    </div>
                    <button onClick={() => toggleCompareItem(gen)} className="absolute top-2 right-2 p-1 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[12px] font-semibold text-text-primary mb-2">{compareItems.length > 0 ? 'Add more:' : 'Select items to compare:'}</p>
          {recentGens.length === 0 ? (
            <div className="text-center py-8"><Columns2 className="w-8 h-8 text-text-tertiary/30 mx-auto mb-3" /><p className="text-[13px] text-text-tertiary">No generations yet</p></div>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
              {recentGens.map((gen) => {
                const sel = compareItems.some((g) => g.id === gen.id);
                return (
                  <button key={gen.id} onClick={() => toggleCompareItem(gen)}
                    className={cn('rounded-lg border overflow-hidden text-left transition-all relative', sel ? 'border-purple-400 ring-2 ring-purple-200' : 'border-outline hover:border-text-tertiary')}>
                    {gen.output_url ? <img src={gen.thumbnail_url || gen.output_url} alt={gen.title} className="w-full aspect-square object-cover" />
                    : <div className="w-full aspect-square bg-surface-tertiary flex items-center justify-center"><Image className="w-6 h-6 text-text-tertiary/30" /></div>}
                    <div className="p-1.5"><p className="text-[10px] font-medium text-text-primary truncate">{gen.title}</p></div>
                    {sel && <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-purple-500 text-white flex items-center justify-center"><Check className="w-3 h-3" /></div>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
