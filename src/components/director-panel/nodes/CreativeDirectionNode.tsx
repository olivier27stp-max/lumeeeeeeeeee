import React, { useEffect, useMemo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Sparkles,
  Sun,
  Eye,
  Palette,
  Wand2,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import {
  type CreativeDirection,
  type ShotType,
  type CameraAngle,
  type CameraMovement,
  buildOptimizedPrompt,
  buildNegativePrompt,
  scorePrompt,
  directionFromIdea,
  enhanceCinematic,
  enhanceRealism,
  enhanceLuxury,
  naturalizeUGC,
} from '../../../lib/director-panel/engine/creative-direction';

interface Props {
  id: string;
  data: Record<string, any>;
  selected?: boolean;
}

const SHOT_TYPES: { value: ShotType; label: string }[] = [
  { value: 'extreme_close_up', label: 'Extreme Close-up' },
  { value: 'close_up', label: 'Close-up' },
  { value: 'medium_close_up', label: 'Medium Close-up' },
  { value: 'medium_shot', label: 'Medium Shot' },
  { value: 'full_shot', label: 'Full Shot' },
  { value: 'wide_shot', label: 'Wide Shot' },
  { value: 'extreme_wide_shot', label: 'Extreme Wide' },
  { value: 'overhead', label: 'Overhead' },
  { value: 'macro', label: 'Macro' },
  { value: 'editorial_portrait', label: 'Editorial Portrait' },
];

const CAMERA_ANGLES: { value: CameraAngle; label: string }[] = [
  { value: 'eye_level', label: 'Eye Level' },
  { value: 'low_angle', label: 'Low Angle' },
  { value: 'high_angle', label: 'High Angle' },
  { value: 'dutch_angle', label: 'Dutch Angle' },
  { value: 'birds_eye', label: 'Bird\'s Eye' },
  { value: 'worms_eye', label: 'Worm\'s Eye' },
  { value: 'pov', label: 'POV' },
];

const CAMERA_MOVEMENTS: { value: CameraMovement; label: string }[] = [
  { value: 'static', label: 'Static' },
  { value: 'dolly_in', label: 'Dolly In' },
  { value: 'dolly_out', label: 'Dolly Out' },
  { value: 'pan_left', label: 'Pan Left' },
  { value: 'pan_right', label: 'Pan Right' },
  { value: 'orbit', label: 'Orbit' },
  { value: 'tracking', label: 'Tracking' },
  { value: 'handheld', label: 'Handheld' },
  { value: 'crane_up', label: 'Crane Up' },
  { value: 'zoom_in', label: 'Zoom In' },
  { value: 'push_in', label: 'Push In' },
  { value: 'pull_back', label: 'Pull Back' },
];

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'text-emerald-400' : score >= 40 ? 'text-amber-400' : 'text-red-400';
  const bg = score >= 70 ? 'bg-emerald-400/10' : score >= 40 ? 'bg-amber-400/10' : 'bg-red-400/10';
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold tabular-nums', color, bg)}>
      {score}/100
    </span>
  );
}

export default function CreativeDirectionNode({ id, data, selected }: Props) {
  const [expanded, setExpanded] = useState<string | null>('concept');
  const onChange = data.onChange as ((d: Record<string, unknown>) => void) | undefined;

  const update = (key: string, value: any) => {
    onChange?.({ ...data, [key]: value });
  };

  const handleAutoGenerate = () => {
    const idea = (data.concept as string) || '';
    if (!idea.trim()) return;
    const dir = directionFromIdea(idea, data.isVideo ? 'video' : 'image');
    onChange?.({
      ...data,
      subject: dir.subject,
      environment: dir.environment,
      mood: dir.mood,
      lighting: dir.lighting,
      composition: dir.composition,
      shotType: dir.shotType,
      cameraAngle: dir.cameraAngle,
      cameraMovement: dir.cameraMovement || 'static',
      realismLevel: dir.realismLevel,
    });
  };

  const direction: CreativeDirection = {
    concept: (data.concept as string) || '',
    subject: (data.subject as string) || '',
    wardrobe: (data.wardrobe as string) || undefined,
    environment: (data.environment as string) || '',
    mood: (data.mood as string) || 'cinematic',
    lighting: (data.lighting as string) || 'natural',
    composition: (data.composition as string) || '',
    camera: '',
    shotType: (data.shotType as ShotType) || 'medium_shot',
    cameraAngle: (data.cameraAngle as CameraAngle) || 'eye_level',
    cameraMovement: (data.cameraMovement as CameraMovement) || undefined,
    realismLevel: (data.realismLevel as number) || 8,
    artisticDirection: (data.artisticDirection as string) || undefined,
    brandTone: (data.brandTone as string) || undefined,
    negativePrompt: (data.negativePrompt as string) || '',
    motion: [data.subjectMotion, data.envMotion, data.pacing].filter(Boolean).join('. ') || undefined,
    continuityLock: {
      characterIdentity: (data.lock_character as string) || undefined,
      face: (data.lock_face as string) || undefined,
      outfit: (data.lock_outfit as string) || undefined,
      environment: (data.lock_environment as string) || undefined,
      lighting: (data.lock_lighting as string) || undefined,
      colorPalette: (data.lock_colors as string)?.split(',').map((s: string) => s.trim()).filter(Boolean) || undefined,
    },
  };

  const optimizedPrompt = useMemo(() => buildOptimizedPrompt(direction), [
    data.concept, data.subject, data.wardrobe, data.environment, data.mood,
    data.lighting, data.composition, data.shotType, data.cameraAngle,
    data.cameraMovement, data.lensType, data.depthOfField,
    data.realismLevel, data.artisticDirection, data.brandTone, data.negativePrompt,
    data.subjectMotion, data.envMotion, data.pacing,
    data.lock_character, data.lock_face, data.lock_outfit, data.lock_environment, data.lock_lighting, data.lock_colors,
  ]);

  const score = useMemo(() => scorePrompt(optimizedPrompt, direction), [optimizedPrompt]);

  // Update the output prompt whenever direction changes
  useEffect(() => {
    if (onChange && optimizedPrompt !== data._lastPrompt) {
      onChange({ ...data, text: optimizedPrompt, _lastPrompt: optimizedPrompt, _negativePrompt: buildNegativePrompt(direction) });
    }
  }, [optimizedPrompt]);

  const Section = ({ id: sectionId, title, icon: Icon, children }: { id: string; title: string; icon: React.FC<any>; children: React.ReactNode }) => (
    <div className="border-t border-[#333]">
      <button
        type="button"
        onClick={() => setExpanded(expanded === sectionId ? null : sectionId)}
        className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-[#999] hover:text-[#ccc] transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Icon className="w-3 h-3" />
          {title}
        </span>
        {expanded === sectionId ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {expanded === sectionId && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );

  const TextInput = ({ label, field, placeholder }: { label: string; field: string; placeholder?: string }) => (
    <div>
      <label className="text-[9px] uppercase tracking-wider text-[#666] font-semibold">{label}</label>
      <textarea
        value={(data[field] as string) || ''}
        onChange={(e) => update(field, e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full mt-1 rounded bg-[#222] border border-[#333] px-2 py-1.5 text-[11px] text-[#ddd] placeholder-[#555] resize-none outline-none focus:border-purple-500/50"
      />
    </div>
  );

  const SelectInput = ({ label, field, options }: { label: string; field: string; options: { value: string; label: string }[] }) => (
    <div>
      <label className="text-[9px] uppercase tracking-wider text-[#666] font-semibold">{label}</label>
      <select
        value={(data[field] as string) || options[0]?.value}
        onChange={(e) => update(field, e.target.value)}
        className="w-full mt-1 rounded bg-[#222] border border-[#333] px-2 py-1.5 text-[11px] text-[#ddd] outline-none focus:border-purple-500/50"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  return (
    <div
      className={cn(
        'w-[320px] rounded-lg border bg-[#1e1e1e] shadow-xl',
        selected ? 'border-purple-500' : 'border-[#333]',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#333]">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center">
            <Sparkles className="w-3 h-3 text-purple-400" />
          </div>
          <span className="text-[12px] font-semibold text-[#e0e0e0]">
            {(data.title as string) || 'Creative Direction'}
          </span>
        </div>
        <ScoreBadge score={score.total} />
      </div>

      {/* Concept + AI generate */}
      <div className="px-3 py-2">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[9px] uppercase tracking-wider text-[#666] font-semibold">Idea / Concept</label>
          <button
            type="button"
            onClick={handleAutoGenerate}
            className="text-[9px] text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
          >
            <Wand2 className="w-2.5 h-2.5" />
            Auto-fill
          </button>
        </div>
        <textarea
          value={(data.concept as string) || ''}
          onChange={(e) => update('concept', e.target.value)}
          placeholder="Describe your idea... AI will structure the rest"
          rows={2}
          className="w-full rounded bg-[#222] border border-[#333] px-2 py-1.5 text-[11px] text-[#ddd] placeholder-[#555] resize-none outline-none focus:border-purple-500/50"
        />
      </div>

      {/* Sections */}
      <Section id="subject" title="Subject & Styling" icon={Eye}>
        <TextInput label="Subject" field="subject" placeholder="A young woman with short hair..." />
        <TextInput label="Wardrobe / Styling" field="wardrobe" placeholder="Black leather jacket, silver jewelry..." />
      </Section>

      <Section id="environment" title="Environment & Mood" icon={Sun}>
        <TextInput label="Environment" field="environment" placeholder="Modern Tokyo street at night..." />
        <TextInput label="Mood" field="mood" placeholder="Moody, cinematic, urban..." />
        <TextInput label="Lighting" field="lighting" placeholder="Neon reflections, wet surfaces..." />
      </Section>

      <Section id="camera" title="Camera & Composition" icon={Camera}>
        <SelectInput label="Shot Type" field="shotType" options={SHOT_TYPES} />
        <SelectInput label="Camera Angle" field="cameraAngle" options={CAMERA_ANGLES} />
        <SelectInput label="Camera Movement" field="cameraMovement" options={CAMERA_MOVEMENTS} />
        <TextInput label="Composition" field="composition" placeholder="Rule of thirds, centered subject..." />
        <div>
          <label className="text-[9px] uppercase tracking-wider text-[#666] font-semibold">
            Realism: {(data.realismLevel as number) || 8}/10
          </label>
          <input
            type="range"
            min={1}
            max={10}
            value={(data.realismLevel as number) || 8}
            onChange={(e) => update('realismLevel', Number(e.target.value))}
            className="w-full mt-1 accent-purple-500"
          />
        </div>
      </Section>

      <Section id="motion" title="Motion (Video)" icon={Camera}>
        <TextInput label="Subject Motion" field="subjectMotion" placeholder="Walking slowly, turning head..." />
        <TextInput label="Environment Motion" field="envMotion" placeholder="Wind blowing leaves, rain falling..." />
        <TextInput label="Pacing" field="pacing" placeholder="Slow, contemplative, 24fps..." />
      </Section>

      <Section id="continuity" title="Continuity Lock" icon={Eye}>
        <TextInput label="Character Identity" field="lock_character" placeholder="Same person across all shots..." />
        <TextInput label="Face Lock" field="lock_face" placeholder="Round face, brown eyes, freckles..." />
        <TextInput label="Outfit Lock" field="lock_outfit" placeholder="Black leather jacket, white tee..." />
        <TextInput label="Environment Lock" field="lock_environment" placeholder="Same studio, same backdrop..." />
        <TextInput label="Lighting Lock" field="lock_lighting" placeholder="Same golden hour, same direction..." />
        <TextInput label="Color Palette Lock" field="lock_colors" placeholder="Navy, gold, cream..." />
      </Section>

      <Section id="style" title="Style & Brand" icon={Palette}>
        <TextInput label="Artistic Direction" field="artisticDirection" placeholder="Film noir, Wes Anderson palette..." />
        <TextInput label="Brand Tone" field="brandTone" placeholder="Luxury, minimalist, premium..." />
        <TextInput label="Negative Prompt" field="negativePrompt" placeholder="blurry, cartoon, watermark..." />
      </Section>

      {/* Optimized prompt preview */}
      <div className="px-3 py-2 border-t border-[#333]">
        <label className="text-[9px] uppercase tracking-wider text-[#666] font-semibold flex items-center gap-1">
          <Lightbulb className="w-2.5 h-2.5" />
          Optimized Prompt
        </label>
        <p className="mt-1 text-[10px] text-[#888] leading-relaxed line-clamp-4">
          {optimizedPrompt || 'Fill in the fields above to generate an optimized prompt...'}
        </p>
      </div>

      {/* Prompt Tools */}
      {optimizedPrompt && (
        <div className="px-3 py-2 border-t border-[#333]">
          <label className="text-[9px] uppercase tracking-wider text-[#666] font-semibold mb-1.5 block">Enhance</label>
          <div className="flex flex-wrap gap-1">
            {[
              { label: 'Cinematic', fn: enhanceCinematic, color: 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20' },
              { label: 'Realism', fn: enhanceRealism, color: 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' },
              { label: 'Luxury', fn: enhanceLuxury, color: 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20' },
              { label: 'UGC Natural', fn: naturalizeUGC, color: 'bg-pink-500/10 text-pink-400 hover:bg-pink-500/20' },
            ].map((tool) => (
              <button
                key={tool.label}
                type="button"
                onClick={() => {
                  const enhanced = tool.fn(optimizedPrompt);
                  onChange?.({ ...data, text: enhanced, _lastPrompt: enhanced });
                }}
                className={cn('px-2 py-1 rounded-md text-[9px] font-medium transition-colors', tool.color)}
              >
                {tool.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Score details */}
      {score.suggestions.length > 0 && (
        <div className="px-3 py-2 border-t border-[#333]">
          <p className="text-[9px] text-amber-400 font-semibold mb-1">Suggestions:</p>
          {score.suggestions.slice(0, 2).map((s, i) => (
            <p key={i} className="text-[9px] text-[#888] leading-relaxed">• {s}</p>
          ))}
        </div>
      )}

      {/* Handles */}
      <Handle type="source" position={Position.Right} id="prompt" className="!w-2.5 !h-2.5 !bg-purple-500 !border-[#1e1e1e]" />
      <Handle type="source" position={Position.Right} id="negative_prompt" style={{ top: '85%' }} className="!w-2.5 !h-2.5 !bg-red-400 !border-[#1e1e1e]" />
    </div>
  );
}
