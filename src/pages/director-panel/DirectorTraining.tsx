import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, X, Plus, Trash2, Loader2, CheckCircle2, AlertCircle,
  Image as ImageIcon, Sparkles, Play, Clock, Zap, Settings2,
  FolderOpen, Download, Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/ui';
import { supabase } from '../../lib/supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TrainingImage {
  id: string;
  file: File;
  preview: string;
  caption: string;
}

interface TrainingJob {
  id: string;
  name: string;
  status: 'uploading' | 'training' | 'completed' | 'failed';
  progress: number;
  modelId?: string;
  imageCount: number;
  triggerWord: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DirectorTraining() {
  // Training images
  const [images, setImages] = useState<TrainingImage[]>([]);
  const [modelName, setModelName] = useState('');
  const [triggerWord, setTriggerWord] = useState('');
  const [baseModel, setBaseModel] = useState('flux-2-dev-lora');
  const [trainingSteps, setTrainingSteps] = useState(1000);
  const [isTraining, setIsTraining] = useState(false);
  const [trainProgress, setTrainProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Past training jobs
  const [jobs, setJobs] = useState<TrainingJob[]>(() => {
    try { return JSON.parse(localStorage.getItem('lia-training-jobs') || '[]'); } catch { return []; }
  });

  // Keep a ref to jobs so the poll callback always sees fresh state
  const jobsRef = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  // Cleanup poll interval on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const saveJobs = (updated: TrainingJob[]) => {
    setJobs(updated);
    localStorage.setItem('lia-training-jobs', JSON.stringify(updated));
  };

  // ─── Image upload ─────────────────────────────────────────────────

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = Array.from(e.target.files || []);
    const validFiles = files.filter((f: File) => f.type.startsWith('image/') && f.size <= 20 * 1024 * 1024);

    if (validFiles.length < files.length) {
      toast.error(`${files.length - validFiles.length} files skipped (not images or >20MB)`);
    }

    const newImages: TrainingImage[] = validFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
      caption: '',
    }));

    setImages((prev) => [...prev, ...newImages]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.preview);
      return prev.filter((i) => i.id !== id);
    });
  };

  const updateCaption = (id: string, caption: string) => {
    setImages((prev) => prev.map((img) => img.id === id ? { ...img, caption } : img));
  };

  // ─── Start training ───────────────────────────────────────────────

  const handleStartTraining = async () => {
    if (images.length < 5) { toast.error('Need at least 5 images'); return; }
    if (!modelName.trim()) { toast.error('Give your model a name'); return; }
    if (!triggerWord.trim()) { toast.error('Set a trigger word'); return; }

    setIsTraining(true);
    setTrainProgress(0);

    const job: TrainingJob = {
      id: crypto.randomUUID(),
      name: modelName,
      status: 'uploading',
      progress: 0,
      imageCount: images.length,
      triggerWord,
      createdAt: new Date().toISOString(),
    };

    saveJobs([job, ...jobsRef.current]);

    try {
      // Step 1: Upload images to Supabase storage
      setTrainProgress(5);
      job.status = 'uploading';
      saveJobs([job, ...jobsRef.current]);

      // Ensure the training storage bucket exists
      const { data: { session: earlySession } } = await supabase.auth.getSession();
      await fetch('/api/director-panel/storage/ensure-training-bucket', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${earlySession?.access_token || ''}` },
      }).catch(() => {});

      const uploadedUrls: string[] = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const path = `training/${job.id}/${img.id}.${img.file.name.split('.').pop()}`;
        const { error } = await supabase.storage.from('director-assets').upload(path, img.file);
        if (error) throw new Error(`Upload failed: ${error.message}`);

        const { data: urlData } = supabase.storage.from('director-assets').getPublicUrl(path);
        uploadedUrls.push(urlData.publicUrl);

        setTrainProgress(5 + (i / images.length) * 20);
      }

      // Step 2: Submit training job to API
      setTrainProgress(30);
      job.status = 'training';
      saveJobs([job, ...jobsRef.current.filter((j) => j.id !== job.id)]);

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const response = await fetch('/api/director-panel/training/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: modelName,
          trigger_word: triggerWord,
          base_model: baseModel,
          steps: trainingSteps,
          images: uploadedUrls.map((url, i) => ({
            url,
            caption: images[i]?.caption || `${triggerWord} portrait`,
          })),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Training request failed: ${response.status}`);
      }

      const result = await response.json();

      // Step 3: Poll for completion
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/director-panel/training/status/${result.training_id}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });

          if (statusRes.ok) {
            const statusData = await statusRes.json();

            if (statusData.status === 'completed') {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              job.status = 'completed';
              job.progress = 100;
              job.modelId = statusData.model_id;
              job.completedAt = new Date().toISOString();
              saveJobs([job, ...jobsRef.current.filter((j) => j.id !== job.id)]);
              setIsTraining(false);
              setTrainProgress(100);
              toast.success(`Model "${modelName}" trained successfully!`);
            } else if (statusData.status === 'failed') {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              job.status = 'failed';
              job.error = statusData.error || 'Training failed';
              saveJobs([job, ...jobsRef.current.filter((j) => j.id !== job.id)]);
              setIsTraining(false);
              toast.error(`Training failed: ${statusData.error}`);
            } else {
              // Still training
              const progress = Math.min(95, 30 + (statusData.progress || 0) * 0.65);
              setTrainProgress(progress);
              job.progress = progress;
              saveJobs([job, ...jobsRef.current.filter((j) => j.id !== job.id)]);
            }
          }
        } catch { /* retry next interval */ }
      }, 10000); // Poll every 10s

    } catch (err: any) {
      job.status = 'failed';
      job.error = err.message;
      saveJobs([job, ...jobsRef.current.filter((j) => j.id !== job.id)]);
      setIsTraining(false);
      toast.error(err.message);
    }
  };

  const handleDeleteJob = (jobId: string) => {
    saveJobs(jobs.filter((j) => j.id !== jobId));
    toast.success('Job removed');
  };

  return (
    <div className="space-y-6">
      <PageHeader title="LoRA Training" subtitle="Train custom AI models on your images" icon={Zap} iconColor="purple" />

      {/* ─── Training Form ─── */}
      <div className="section-card">
        <div className="px-5 py-4 border-b border-outline">
          <h3 className="text-[14px] font-semibold text-text-primary">New Training Job</h3>
          <p className="text-[11px] text-text-tertiary mt-0.5">Upload 5-30 images of your subject. More images = better results.</p>
        </div>

        <div className="p-5 space-y-4">
          {/* Config */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] font-medium text-text-secondary mb-1 block">Model Name</label>
              <input value={modelName} onChange={(e) => setModelName(e.target.value)}
                placeholder="e.g., my-brand-style" className="glass-input w-full text-[12px]" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary mb-1 block">Trigger Word</label>
              <input value={triggerWord} onChange={(e) => setTriggerWord(e.target.value)}
                placeholder="e.g., MYBRAND" className="glass-input w-full text-[12px]" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary mb-1 block">Base Model</label>
              <select value={baseModel} onChange={(e) => setBaseModel(e.target.value)}
                className="glass-input w-full text-[12px]">
                <option value="flux-2-dev-lora">Flux 2 Dev LoRA</option>
                <option value="flux-dev-lora">Flux Dev LoRA</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary mb-1 block">Training Steps</label>
              <select value={trainingSteps} onChange={(e) => setTrainingSteps(Number(e.target.value))}
                className="glass-input w-full text-[12px]">
                <option value={500}>500 (fast, lower quality)</option>
                <option value={1000}>1000 (balanced)</option>
                <option value={1500}>1500 (high quality)</option>
                <option value={2000}>2000 (maximum quality)</option>
              </select>
            </div>
          </div>

          {/* Image grid */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-medium text-text-secondary">{images.length} images uploaded (min 5, max 30)</label>
              <button onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-surface-secondary border border-outline text-[11px] font-medium text-text-secondary hover:border-primary/30 transition-colors">
                <Plus className="w-3 h-3" /> Add Images
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
            </div>

            {images.length === 0 ? (
              <button onClick={() => fileInputRef.current?.click()}
                className="w-full py-12 rounded-xl border-2 border-dashed border-outline flex flex-col items-center gap-3 text-text-tertiary hover:border-primary/30 hover:text-text-secondary transition-colors">
                <Upload className="w-8 h-8" />
                <div className="text-center">
                  <p className="text-[13px] font-medium">Drop images here or click to upload</p>
                  <p className="text-[11px] mt-1">JPEG, PNG, WebP. Max 20MB each.</p>
                </div>
              </button>
            ) : (
              <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {images.map((img) => (
                  <div key={img.id} className="group relative rounded-lg border border-outline overflow-hidden">
                    <img src={img.preview} alt="Training" className="w-full aspect-square object-cover" />
                    <div className="p-1.5">
                      <input
                        value={img.caption}
                        onChange={(e) => updateCaption(img.id, e.target.value)}
                        placeholder="Caption (optional)"
                        className="w-full bg-transparent text-[10px] text-text-primary placeholder:text-text-tertiary outline-none"
                      />
                    </div>
                    <button onClick={() => removeImage(img.id)}
                      className="absolute top-1 right-1 p-1 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button onClick={() => fileInputRef.current?.click()}
                  className="aspect-square rounded-lg border-2 border-dashed border-outline flex items-center justify-center text-text-tertiary hover:border-primary/30 hover:text-text-secondary transition-colors">
                  <Plus className="w-6 h-6" />
                </button>
              </div>
            )}
          </div>

          {/* Progress */}
          {isTraining && (
            <div className="rounded-xl bg-surface-secondary border border-outline p-4">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />
                <span className="text-[12px] font-medium text-text-primary">
                  {trainProgress < 25 ? 'Uploading images...' : trainProgress < 95 ? 'Training model...' : 'Finalizing...'}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-outline overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-500 to-violet-500 rounded-full transition-all duration-500" style={{ width: `${trainProgress}%` }} />
              </div>
              <p className="text-[10px] text-text-tertiary mt-1.5">This usually takes 10-30 minutes depending on the number of images and steps.</p>
            </div>
          )}

          {/* Start button */}
          <button onClick={handleStartTraining} disabled={isTraining || images.length < 5 || !modelName.trim() || !triggerWord.trim()}
            className={cn(
              'w-full py-3 rounded-xl text-[14px] font-semibold transition-all',
              isTraining || images.length < 5 || !modelName.trim() || !triggerWord.trim()
                ? 'bg-surface-tertiary text-text-tertiary cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-500 to-violet-600 text-white shadow-md hover:shadow-lg hover:scale-[1.01]',
            )}>
            {isTraining ? (
              <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Training...</span>
            ) : (
              <span className="flex items-center justify-center gap-2"><Zap className="w-4 h-4" /> Start Training ({trainingSteps} steps)</span>
            )}
          </button>
        </div>
      </div>

      {/* ─── Past Jobs ─── */}
      {jobs.length > 0 && (
        <div className="section-card">
          <div className="px-5 py-4 border-b border-outline">
            <h3 className="text-[14px] font-semibold text-text-primary">Training History</h3>
          </div>
          <div className="divide-y divide-outline">
            {jobs.map((job) => (
              <div key={job.id} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-secondary/50 transition-colors">
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                  job.status === 'completed' ? 'bg-emerald-50 text-emerald-600' :
                  job.status === 'failed' ? 'bg-red-50 text-red-500' :
                  'bg-purple-50 text-purple-600')}>
                  {job.status === 'completed' ? <CheckCircle2 className="w-4 h-4" /> :
                   job.status === 'failed' ? <AlertCircle className="w-4 h-4" /> :
                   <Loader2 className="w-4 h-4 animate-spin" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-text-primary">{job.name}</p>
                  <p className="text-[10px] text-text-tertiary">
                    {job.imageCount} images | Trigger: <code className="bg-surface-secondary px-1 rounded">{job.triggerWord}</code>
                    {job.error && <span className="text-red-500 ml-2">{job.error}</span>}
                  </p>
                </div>
                <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium capitalize',
                  job.status === 'completed' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' :
                  job.status === 'failed' ? 'bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400' :
                  job.status === 'training' ? 'bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400' :
                  'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400')}>
                  {job.status}
                </span>
                {job.status === 'completed' && job.modelId && (
                  <>
                    <button onClick={() => {
                      navigator.clipboard.writeText(job.modelId!);
                      toast.success('LoRA URL copied. Paste it in a Flux LoRA node\'s LoRA URL field.');
                    }} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">
                      <Download className="w-3 h-3" /> Copy LoRA URL
                    </button>
                    <button onClick={() => {
                      navigator.clipboard.writeText(job.modelId!);
                      toast.success('LoRA URL copied. Paste it in a Flux LoRA node\'s LoRA URL field.');
                    }} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors">
                      <Sparkles className="w-3 h-3" /> Use in Generation
                    </button>
                  </>
                )}
                <button onClick={() => handleDeleteJob(job.id)} className="p-1.5 text-text-tertiary hover:text-danger transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Tips ─── */}
      <div className="section-card p-5">
        <h3 className="text-[13px] font-semibold text-text-primary mb-3">Tips for Best Results</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px] text-text-secondary">
          <div className="flex gap-2"><span className="text-purple-500 font-bold shrink-0">1.</span> Use 10-20 high-quality images of your subject from different angles and lighting conditions.</div>
          <div className="flex gap-2"><span className="text-purple-500 font-bold shrink-0">2.</span> Crop images to focus on the subject. Remove distracting backgrounds when possible.</div>
          <div className="flex gap-2"><span className="text-purple-500 font-bold shrink-0">3.</span> Add captions describing each image — this significantly improves training quality.</div>
          <div className="flex gap-2"><span className="text-purple-500 font-bold shrink-0">4.</span> Use a unique trigger word (e.g., MYBRAND) that doesn't conflict with common words.</div>
          <div className="flex gap-2"><span className="text-purple-500 font-bold shrink-0">5.</span> More training steps = better quality but longer training time. 1000 steps is a good default.</div>
          <div className="flex gap-2"><span className="text-purple-500 font-bold shrink-0">6.</span> After training, use your trigger word in prompts: "MYBRAND person walking in a park"</div>
        </div>
      </div>
    </div>
  );
}
