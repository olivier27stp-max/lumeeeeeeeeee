import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Trash2, GripVertical, Save, Eye, Upload, Link2, FileText,
  ChevronDown, ChevronRight, MoreHorizontal, Copy, Pencil, X, Image,
  Video, Globe, Type, GraduationCap, Clock, Check, Users, CheckCircle2,
  ExternalLink, BookOpen, Layers,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import {
  getCourse, createCourse, updateCourse, deleteCourse,
  createModule, updateModule, deleteModule, reorderModules,
  createLesson, updateLesson, deleteLesson, duplicateLesson, reorderLessons,
  type CourseFull, type CourseModule, type CourseLesson,
} from '../lib/coursesApi';
import { uploadFile, STORAGE_BUCKETS } from '../lib/storage';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/* ── Sortable Module (Chapter) Row ── */
function SortableModuleRow({ mod, children, ...props }: { mod: CourseModule; children: React.ReactNode; [k: string]: any }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: mod.id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined, opacity: isDragging ? 0.5 : 1 };
  return <div ref={setNodeRef} style={style} {...props}>{React.Children.map(children, child => React.isValidElement(child) ? React.cloneElement(child as any, { dragHandleProps: { ...attributes, ...listeners } }) : child)}</div>;
}

/* ── Sortable Lesson Card ── */
function SortableLessonCard({
  lesson, isActive, onSelect, onDelete, onDuplicate,
}: {
  lesson: CourseLesson; isActive: boolean;
  onSelect: () => void; onDelete: () => void; onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lesson.id });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined };

  const icons: Record<string, React.ElementType> = { video: Video, embed: Globe, text: Type, pdf: FileText, link: Link2 };
  const TypeIcon = icons[lesson.content_type] || Video;

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.right - 160 });
    }
    setMenuOpen(!menuOpen);
  };

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  return (
    <div
      ref={setNodeRef} style={style}
      className={cn(
        'group flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150 relative',
        isActive ? 'bg-surface-elevated border border-outline-strong shadow-card' : 'hover:bg-surface-secondary/60 border border-transparent',
        isDragging && 'opacity-40',
      )}
      onClick={onSelect}
    >
      <div {...attributes} {...listeners} className="cursor-grab text-text-muted/40 hover:text-text-secondary shrink-0" onClick={e => e.stopPropagation()}>
        <GripVertical size={13} />
      </div>
      <div className="w-8 h-8 rounded-md bg-surface-tertiary flex items-center justify-center shrink-0">
        <TypeIcon size={13} className="text-text-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-text-primary truncate">{lesson.title || 'Untitled'}</p>
        {lesson.duration_min > 0 && <p className="text-[10px] text-text-muted">{lesson.duration_min} min</p>}
      </div>
      <div className="shrink-0">
        <button ref={menuBtnRef} onClick={openMenu} className="p-1 rounded-md hover:bg-surface-tertiary text-text-muted">
          <MoreHorizontal size={13} />
        </button>
        {menuOpen && (
          <div className="fixed w-40 bg-surface-elevated border border-outline/40 rounded-xl shadow-dropdown py-1 z-[200]"
            style={{ top: menuPos.top, left: menuPos.left }} onClick={e => e.stopPropagation()}>
            <button onClick={() => { onDuplicate(); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary hover:bg-surface-secondary"><Copy size={12} /> Duplicate</button>
            <div className="border-t border-outline/20 my-0.5" />
            <button onClick={() => { onDelete(); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-danger hover:bg-danger-light"><Trash2 size={12} /> Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   Main CourseBuilder
   ================================================================ */
export default function CourseBuilder() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const fr = language === 'fr';

  // Core state
  const [courseId, setCourseId] = useState<string | null>(id || null);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Course fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [courseStatus, setCourseStatus] = useState<'draft' | 'published'>('draft');

  // Structure
  const [modules, setModules] = useState<CourseModule[]>([]);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  // Lesson editor
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonContentType, setLessonContentType] = useState<CourseLesson['content_type']>('video');
  const [lessonVideoUrl, setLessonVideoUrl] = useState('');
  const [lessonEmbedUrl, setLessonEmbedUrl] = useState('');
  const [lessonTextContent, setLessonTextContent] = useState('');
  const [lessonDuration, setLessonDuration] = useState(0);
  const [lessonAttachments, setLessonAttachments] = useState<any[]>([]);
  const [lessonSaving, setLessonSaving] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);

  // Inline rename
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [editingModuleTitle, setEditingModuleTitle] = useState('');
  const moduleInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Computed
  const totalLessons = modules.reduce((s, m) => s + m.lessons.length, 0);
  const activeLesson = modules.flatMap(m => m.lessons).find(l => l.id === activeLessonId) || null;

  // ── Load ──
  useEffect(() => {
    if (!id) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      try {
        const data = await getCourse(id);
        setCourseId(data.id);
        setTitle(data.title);
        setDescription(data.description);
        setCoverImage(data.cover_image || '');
        setCourseStatus(data.status);
        setModules(data.modules);
        setExpandedModules(new Set(data.modules.map(m => m.id)));
      } catch (err: any) { toast.error(err?.message || t.courses.failedLoad); }
      finally { setLoading(false); }
    })();
  }, [id]);

  // Sync lesson editor when active lesson changes
  useEffect(() => {
    if (!activeLesson) return;
    setLessonTitle(activeLesson.title);
    setLessonContentType(activeLesson.content_type);
    setLessonVideoUrl(activeLesson.video_url || '');
    setLessonEmbedUrl(activeLesson.embed_url || '');
    setLessonTextContent(activeLesson.text_content || '');
    setLessonDuration(activeLesson.duration_min);
    setLessonAttachments(activeLesson.attachments || []);
  }, [activeLessonId]);

  useEffect(() => { if (editingModuleId) moduleInputRef.current?.focus(); }, [editingModuleId]);

  // ── Auto-save course meta (debounce 2s) ──
  useEffect(() => {
    if (!courseId) return; // Don't auto-save if not created yet
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try {
        await updateCourse(courseId, { title, description, cover_image: coverImage || null, status: courseStatus });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch { /* silent auto-save */ }
    }, 2000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [title, description, coverImage, courseId]);

  // ── Ensure course exists ──
  const ensureCourseId = async (): Promise<string | null> => {
    if (courseId) return courseId;
    setSaving(true);
    try {
      const created = await createCourse({ title: title || (fr ? 'Sans titre' : 'Untitled'), description, cover_image: coverImage || null, status: courseStatus });
      setCourseId(created.id);
      toast.success(t.courses.courseCreated);
      window.history.replaceState(null, '', `/courses/${created.id}/edit`);
      return created.id;
    } catch (err: any) { toast.error(err?.message || t.courses.failedCreate); return null; }
    finally { setSaving(false); }
  };

  // ── Save course meta (manual) ──
  const saveCourse = async () => {
    setSaving(true);
    try {
      if (!courseId) { await ensureCourseId(); }
      else { await updateCourse(courseId, { title, description, cover_image: coverImage || null, status: courseStatus }); }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) { toast.error(err?.message || t.courses.failedUpdate); }
    finally { setSaving(false); }
  };

  // ── Publish / Unpublish ──
  const togglePublish = async () => {
    const newStatus = courseStatus === 'draft' ? 'published' : 'draft';
    setCourseStatus(newStatus);
    if (!courseId) return;
    try {
      await updateCourse(courseId, { status: newStatus });
      toast.success(newStatus === 'published' ? (fr ? 'Cours publié !' : 'Course published!') : (fr ? 'Brouillon' : 'Set to draft'));
    } catch (err: any) { setCourseStatus(courseStatus); toast.error(err?.message || t.courses.failedUpdate); }
  };

  // ── Cover upload ──
  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const result = await uploadFile(STORAGE_BUCKETS.ATTACHMENTS, `courses/${Date.now()}.${ext}`, file);
      setCoverImage(result.url);
    } catch (err: any) { toast.error(err?.message || 'Upload failed'); }
    finally { setCoverUploading(false); }
  };

  // ════════════════════════════════════════════
  // MODULES
  // ════════════════════════════════════════════
  const handleAddModule = async () => {
    const cId = await ensureCourseId();
    if (!cId) return;
    try {
      const mod = await createModule(cId, fr ? 'Nouveau chapitre' : 'New Chapter');
      setModules(prev => [...prev, { ...mod, lessons: [] as CourseLesson[] }]);
      setExpandedModules(prev => new Set([...prev, mod.id]));
      // Auto-start rename
      setEditingModuleId(mod.id);
      setEditingModuleTitle(mod.title);
    } catch (err: any) { toast.error(err?.message || t.courses.failedCreate); }
  };

  const handleRenameModule = async (modId: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    try {
      await updateModule(modId, { title: newTitle });
      setModules(prev => prev.map(m => m.id === modId ? { ...m, title: newTitle } : m));
    } catch (err: any) { toast.error(err?.message || t.courses.failedUpdate); }
  };

  const handleDeleteModule = async (modId: string) => {
    try {
      await deleteModule(modId);
      const mod = modules.find(m => m.id === modId);
      if (mod && mod.lessons.some(l => l.id === activeLessonId)) setActiveLessonId(null);
      setModules(prev => prev.filter(m => m.id !== modId));
      toast.success(t.courses.moduleDeleted);
    } catch (err: any) { toast.error(err?.message || t.courses.failedDelete); }
  };

  const handleModuleDragEnd = async (event: DragEndEvent) => {
    if (!courseId) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = modules.findIndex(m => m.id === active.id);
    const newIdx = modules.findIndex(m => m.id === over.id);
    const reordered = arrayMove(modules, oldIdx, newIdx);
    setModules(reordered);
    try { await reorderModules(courseId, reordered.map(m => m.id)); } catch { /* silent */ }
  };

  // ════════════════════════════════════════════
  // LESSONS
  // ════════════════════════════════════════════
  const [addLessonMenuFor, setAddLessonMenuFor] = useState<string | null>(null);
  const addLessonBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [addLessonMenuPos, setAddLessonMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Close add-lesson menu on outside click
  useEffect(() => {
    if (!addLessonMenuFor) return;
    const close = () => setAddLessonMenuFor(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [addLessonMenuFor]);

  const openAddLessonMenu = (moduleId: string) => {
    const btn = addLessonBtnRefs.current[moduleId];
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setAddLessonMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setAddLessonMenuFor(addLessonMenuFor === moduleId ? null : moduleId);
  };

  const LESSON_TYPES: { key: CourseLesson['content_type']; icon: React.ElementType; label: string; labelFr: string; desc: string; descFr: string }[] = [
    { key: 'video', icon: Video, label: 'Video', labelFr: 'Vidéo', desc: 'Upload or link a video', descFr: 'Télécharger ou lier une vidéo' },
    { key: 'embed', icon: Globe, label: 'Embed', labelFr: 'Intégrer', desc: 'YouTube, Loom, Vimeo', descFr: 'YouTube, Loom, Vimeo' },
    { key: 'text', icon: Type, label: 'Text', labelFr: 'Texte', desc: 'Written content', descFr: 'Contenu écrit' },
    { key: 'pdf', icon: FileText, label: 'PDF', labelFr: 'PDF', desc: 'Upload a document', descFr: 'Télécharger un document' },
    { key: 'link', icon: Link2, label: 'Link', labelFr: 'Lien', desc: 'External resource', descFr: 'Ressource externe' },
  ];

  const handleAddLesson = async (moduleId: string, contentType: CourseLesson['content_type'] = 'video') => {
    setAddLessonMenuFor(null);
    try {
      const lesson = await createLesson(moduleId, { title: fr ? 'Nouvelle leçon' : 'New Lesson', content_type: contentType });
      setModules(prev => prev.map(m => m.id === moduleId ? { ...m, lessons: [...m.lessons, lesson] } : m));
      setActiveLessonId(lesson.id);
      setExpandedModules(prev => new Set([...prev, moduleId]));
    } catch (err: any) { toast.error(err?.message || t.courses.failedCreate); }
  };

  const handleSaveLesson = async () => {
    if (!activeLessonId) return;
    setLessonSaving(true);
    try {
      await updateLesson(activeLessonId, {
        title: lessonTitle, content_type: lessonContentType,
        video_url: lessonVideoUrl || null, embed_url: lessonEmbedUrl || null,
        text_content: lessonTextContent || null, duration_min: lessonDuration, attachments: lessonAttachments,
      });
      setModules(prev => prev.map(m => ({
        ...m, lessons: m.lessons.map(l => l.id === activeLessonId
          ? { ...l, title: lessonTitle, content_type: lessonContentType, video_url: lessonVideoUrl || null, embed_url: lessonEmbedUrl || null, text_content: lessonTextContent || null, duration_min: lessonDuration, attachments: lessonAttachments }
          : l),
      })));
      toast.success(t.courses.lessonSaved);
    } catch (err: any) { toast.error(err?.message || t.courses.failedUpdate); }
    finally { setLessonSaving(false); }
  };

  const handleDeleteLesson = async (lessonId: string) => {
    try {
      await deleteLesson(lessonId);
      setModules(prev => prev.map(m => ({ ...m, lessons: m.lessons.filter(l => l.id !== lessonId) })));
      if (activeLessonId === lessonId) setActiveLessonId(null);
      toast.success(t.courses.lessonDeleted);
    } catch (err: any) { toast.error(err?.message || t.courses.failedDelete); }
  };

  const handleDuplicateLesson = async (lessonId: string) => {
    try {
      const dup = await duplicateLesson(lessonId);
      setModules(prev => prev.map(m => {
        const idx = m.lessons.findIndex(l => l.id === lessonId);
        if (idx === -1) return m;
        const nl = [...m.lessons]; nl.splice(idx + 1, 0, dup); return { ...m, lessons: nl };
      }));
      toast.success(t.courses.lessonDuplicated);
    } catch (err: any) { toast.error(err?.message || t.courses.failedCreate); }
  };

  const handleLessonDragEnd = (moduleId: string) => async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const mod = modules.find(m => m.id === moduleId);
    if (!mod) return;
    const oldIdx = mod.lessons.findIndex(l => l.id === active.id);
    const newIdx = mod.lessons.findIndex(l => l.id === over.id);
    const reordered = arrayMove(mod.lessons, oldIdx, newIdx);
    setModules(prev => prev.map(m => m.id === moduleId ? { ...m, lessons: reordered } : m));
    try { await reorderLessons(moduleId, reordered.map(l => l.id)); } catch { /* silent */ }
  };

  // ── Uploads ──
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const ext = file.name.split('.').pop();
      const result = await uploadFile(STORAGE_BUCKETS.ATTACHMENTS, `courses/videos/${Date.now()}.${ext}`, file);
      setLessonVideoUrl(result.url);
      // PDF uploads also use this handler — set type based on extension
      if (ext === 'pdf') setLessonContentType('pdf');
      else setLessonContentType('video');
    } catch (err: any) { toast.error(err?.message || 'Upload failed'); }
  };

  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const ext = file.name.split('.').pop();
      const result = await uploadFile(STORAGE_BUCKETS.ATTACHMENTS, `courses/attachments/${Date.now()}.${ext}`, file);
      setLessonAttachments(prev => [...prev, { name: file.name, url: result.url, type: ext || 'file' }]);
    } catch (err: any) { toast.error(err?.message || 'Upload failed'); }
  };

  // ── Auto-save lesson (debounce 2s) ──
  const lessonAutoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeLessonId) return;
    if (lessonAutoSaveTimer.current) clearTimeout(lessonAutoSaveTimer.current);
    lessonAutoSaveTimer.current = setTimeout(async () => {
      try {
        await updateLesson(activeLessonId, {
          title: lessonTitle, content_type: lessonContentType,
          video_url: lessonVideoUrl || null, embed_url: lessonEmbedUrl || null,
          text_content: lessonTextContent || null, duration_min: lessonDuration, attachments: lessonAttachments,
        });
        // Update local state silently
        setModules(prev => prev.map(m => ({
          ...m, lessons: m.lessons.map(l => l.id === activeLessonId
            ? { ...l, title: lessonTitle, content_type: lessonContentType, video_url: lessonVideoUrl || null, embed_url: lessonEmbedUrl || null, text_content: lessonTextContent || null, duration_min: lessonDuration, attachments: lessonAttachments }
            : l),
        })));
      } catch { /* silent auto-save */ }
    }, 2000);
    return () => { if (lessonAutoSaveTimer.current) clearTimeout(lessonAutoSaveTimer.current); };
  }, [lessonTitle, lessonContentType, lessonVideoUrl, lessonEmbedUrl, lessonTextContent, lessonDuration, lessonAttachments, activeLessonId]);

  // ── Save lesson when switching away ──
  const prevLessonRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = prevLessonRef.current;
    if (prevId && prevId !== activeLessonId) {
      // Fire-and-forget save of previous lesson
      const prevLesson = modules.flatMap(m => m.lessons).find(l => l.id === prevId);
      if (prevLesson) {
        updateLesson(prevId, {
          title: prevLesson.title, content_type: prevLesson.content_type,
          video_url: prevLesson.video_url, embed_url: prevLesson.embed_url,
          text_content: prevLesson.text_content, duration_min: prevLesson.duration_min, attachments: prevLesson.attachments,
        }).catch(() => {});
      }
    }
    prevLessonRef.current = activeLessonId;
  }, [activeLessonId]);

  const toggleModule = (mid: string) => setExpandedModules(prev => { const n = new Set(prev); n.has(mid) ? n.delete(mid) : n.add(mid); return n; });

  // ════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════
  if (loading) return (
    <div className="h-[calc(100vh-64px)] flex items-center justify-center">
      <div className="animate-pulse text-text-muted text-sm">{t.common.loading}</div>
    </div>
  );

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col bg-surface">

      {/* ════ TOP BAR ════ */}
      <div className="flex items-center justify-between px-5 h-12 border-b border-outline/30 shrink-0 bg-surface">
        <button onClick={() => navigate('/courses')} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
          <ArrowLeft size={16} /> {t.courses.backToCourses}
        </button>
        <div className="flex items-center gap-2">
          {/* Save indicator */}
          <AnimatePresence>
            {saved && (
              <motion.span initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
                className="flex items-center gap-1 text-[12px] text-success font-medium">
                <CheckCircle2 size={13} /> {t.courses.saved}
              </motion.span>
            )}
          </AnimatePresence>

          {/* Publish toggle */}
          <button onClick={togglePublish} className={cn(
            'px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors',
            courseStatus === 'published' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning',
          )}>
            {courseStatus === 'published' ? t.courses.published : t.courses.draft}
          </button>

          {courseId && (
            <button onClick={() => window.open(`/courses/${courseId}`, '_blank')} className="glass-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]">
              <ExternalLink size={13} /> {t.courses.preview}
            </button>
          )}
          <button onClick={saveCourse} disabled={saving} className="glass-button-primary flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold">
            {saving ? <span className="animate-pulse">{t.courses.saving}</span> : <><Save size={13} /> {t.courses.save}</>}
          </button>
        </div>
      </div>

      {/* ════ MAIN LAYOUT ════ */}
      <div className="flex-1 flex overflow-hidden">

        {/* ─── LEFT: Chapter / Lesson Tree ─── */}
        <div className="w-[360px] shrink-0 border-r border-outline/30 flex flex-col overflow-hidden bg-surface-card/50">

          {/* Header with stats */}
          <div className="px-4 py-3.5 border-b border-outline/20">
            <h2 className="text-[15px] font-bold text-text-primary truncate mb-1">
              {title || (fr ? 'Sans titre' : 'Untitled')}
            </h2>
            <div className="flex items-center gap-3 text-[11px] text-text-muted">
              <span className="flex items-center gap-1"><Layers size={11} /> {modules.length} {fr ? 'chapitres' : 'chapters'}</span>
              <span className="flex items-center gap-1"><BookOpen size={11} /> {totalLessons} {fr ? 'leçons' : 'lessons'}</span>
            </div>
          </div>

          {/* Module list */}
          <div className="flex-1 overflow-y-auto">
            {modules.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <div className="w-14 h-14 rounded-2xl bg-surface-tertiary flex items-center justify-center mx-auto mb-4">
                  <GraduationCap size={24} className="text-text-muted/40" />
                </div>
                <p className="text-[13px] text-text-secondary font-medium mb-1">{t.courses.noModules}</p>
                <p className="text-[11px] text-text-muted mb-5">{fr ? 'Ajoutez un chapitre pour structurer votre cours' : 'Add a chapter to structure your course'}</p>
                <button onClick={handleAddModule} disabled={saving} className="glass-button-primary px-4 py-2 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5">
                  <Plus size={13} /> {t.courses.addModule}
                </button>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleModuleDragEnd}>
                <SortableContext items={modules.map(m => m.id)} strategy={verticalListSortingStrategy}>
                  {modules.map(mod => {
                    const isExpanded = expandedModules.has(mod.id);
                    const isEditingThis = editingModuleId === mod.id;
                    const lessonCount = mod.lessons.length;

                    return (
                      <SortableModuleRow key={mod.id} mod={mod}>
                        <div className="border-b border-outline/15">
                          {/* Module header */}
                          <div className="flex items-center gap-1 px-2.5 py-2 group">
                            <ModuleDragHandle />
                            <button onClick={() => toggleModule(mod.id)} className="shrink-0 text-text-muted p-0.5">
                              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>

                            {isEditingThis ? (
                              <input ref={moduleInputRef} value={editingModuleTitle} onChange={e => setEditingModuleTitle(e.target.value)}
                                onBlur={() => { handleRenameModule(mod.id, editingModuleTitle); setEditingModuleId(null); }}
                                onKeyDown={e => { if (e.key === 'Enter') { handleRenameModule(mod.id, editingModuleTitle); setEditingModuleId(null); } if (e.key === 'Escape') setEditingModuleId(null); }}
                                className="flex-1 bg-transparent text-[13px] font-semibold text-text-primary outline-none border-b border-primary" />
                            ) : (
                              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleModule(mod.id)}>
                                <p className="text-[13px] font-semibold text-text-primary truncate">{mod.title || 'Untitled'}</p>
                                <p className="text-[10px] text-text-muted">{lessonCount} {lessonCount === 1 ? (fr ? 'leçon' : 'lesson') : (fr ? 'leçons' : 'lessons')}</p>
                              </div>
                            )}

                            {/* Actions — always visible */}
                            <button onClick={() => { setEditingModuleId(mod.id); setEditingModuleTitle(mod.title); }} className="p-1 rounded-md hover:bg-surface-secondary text-text-muted hover:text-text-secondary transition-colors" title={fr ? 'Renommer' : 'Rename'}>
                              <Pencil size={12} />
                            </button>
                            <button ref={el => { addLessonBtnRefs.current[mod.id] = el; }} onClick={(e) => { e.stopPropagation(); openAddLessonMenu(mod.id); }} className="p-1 rounded-md hover:bg-surface-secondary text-text-muted hover:text-text-secondary transition-colors" title={t.courses.addLesson}>
                              <Plus size={13} />
                            </button>
                            <button onClick={() => { if (confirm(fr ? 'Supprimer ce chapitre ?' : 'Delete this chapter?')) handleDeleteModule(mod.id); }} className="p-1 rounded-md hover:bg-danger-light text-text-muted hover:text-danger transition-colors">
                              <Trash2 size={12} />
                            </button>
                          </div>

                          {/* Lessons */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
                                <div className="pl-5 pr-2 pb-2 space-y-0.5">
                                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleLessonDragEnd(mod.id)}>
                                    <SortableContext items={mod.lessons.map(l => l.id)} strategy={verticalListSortingStrategy}>
                                      {mod.lessons.map(lesson => (
                                        <SortableLessonCard key={lesson.id} lesson={lesson} isActive={lesson.id === activeLessonId}
                                          onSelect={() => setActiveLessonId(lesson.id)} onDelete={() => handleDeleteLesson(lesson.id)} onDuplicate={() => handleDuplicateLesson(lesson.id)} />
                                      ))}
                                    </SortableContext>
                                  </DndContext>
                                  {lessonCount === 0 && (
                                    <button onClick={(e) => { e.stopPropagation(); openAddLessonMenu(mod.id); }}
                                      ref={el => { if (lessonCount === 0) addLessonBtnRefs.current[mod.id] = el; }}
                                      className="w-full flex items-center justify-center gap-1.5 py-2.5 text-[11px] text-text-muted hover:text-text-secondary border border-dashed border-outline/40 rounded-lg hover:border-outline-strong transition-colors">
                                      <Plus size={12} /> {t.courses.addLesson}
                                    </button>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </SortableModuleRow>
                    );
                  })}
                </SortableContext>
              </DndContext>
            )}

            {modules.length > 0 && (
              <button onClick={handleAddModule} disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-3.5 text-[12px] font-medium text-text-muted hover:text-text-secondary hover:bg-surface-secondary/50 transition-colors">
                <Plus size={14} /> {t.courses.addModule}
              </button>
            )}
          </div>

          {/* ── Add Lesson Type Picker (Whop-style) ── */}
          <AnimatePresence>
            {addLessonMenuFor && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.12 }}
                className="fixed z-[200] w-56 bg-surface-elevated border border-outline/40 rounded-xl shadow-dropdown py-1.5"
                style={{ top: addLessonMenuPos.top, left: addLessonMenuPos.left }}
                onClick={(e) => e.stopPropagation()}
              >
                <p className="px-3.5 py-1.5 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                  {fr ? 'Type de leçon' : 'Lesson Type'}
                </p>
                {LESSON_TYPES.map(({ key, icon: Icon, label, labelFr, desc, descFr }) => (
                  <button
                    key={key}
                    onClick={() => handleAddLesson(addLessonMenuFor, key)}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-surface-secondary transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-surface-tertiary flex items-center justify-center shrink-0">
                      <Icon size={14} className="text-text-secondary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-text-primary">{fr ? labelFr : label}</p>
                      <p className="text-[10px] text-text-muted truncate">{fr ? descFr : desc}</p>
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ─── RIGHT: Editor Panel ─── */}
        <div className="flex-1 overflow-y-auto">
          {!activeLessonId ? (
            /* ── Course Meta Form ── */
            <div className="max-w-2xl mx-auto w-full px-8 py-8 space-y-6">
              {/* Preview card */}
              {(title || coverImage) && (
                <div className="bg-surface-card rounded-2xl border border-outline/30 overflow-hidden mb-2">
                  <div className="aspect-[16/6] bg-surface-tertiary relative">
                    {coverImage ? <img src={coverImage} alt="" className="w-full h-full object-cover" /> : (
                      <div className="w-full h-full flex items-center justify-center"><GraduationCap size={32} className="text-text-muted/20" /></div>
                    )}
                    <div className={cn('absolute top-3 left-3 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider backdrop-blur-md', courseStatus === 'published' ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning')}>
                      {courseStatus === 'published' ? t.courses.published : t.courses.draft}
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="text-[14px] font-bold text-text-primary truncate">{title || (fr ? 'Sans titre' : 'Untitled')}</h3>
                    {description && <p className="text-[11px] text-text-tertiary line-clamp-2 mt-1">{description}</p>}
                    <div className="flex items-center gap-3 text-[10px] text-text-muted mt-2">
                      <span>{modules.length} {fr ? 'chapitres' : 'chapters'}</span>
                      <span>·</span>
                      <span>{totalLessons} {fr ? 'leçons' : 'lessons'}</span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5 block">{t.courses.courseTitle}</label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder={fr ? 'Titre de la formation' : 'Course Title'}
                  className="glass-input w-full px-4 py-2.5 rounded-xl text-sm" />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5 block">{t.courses.courseDescription}</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description" rows={4}
                  className="glass-input w-full px-4 py-2.5 rounded-xl text-sm resize-none" />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5 block">{t.courses.coverImage}</label>
                {coverImage ? (
                  <div className="relative group rounded-xl overflow-hidden">
                    <img src={coverImage} alt="" className="w-full h-40 object-cover" />
                    <button onClick={() => setCoverImage('')} className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"><X size={13} /></button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 h-28 rounded-xl border-2 border-dashed border-outline/40 hover:border-outline-strong cursor-pointer transition-colors text-text-muted hover:text-text-secondary text-sm">
                    <input type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />
                    {coverUploading ? <span className="animate-pulse">{t.common.loading}</span> : <><Image size={18} /> {t.courses.coverImage}</>}
                  </label>
                )}
              </div>

              {/* Status */}
              <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-surface-card border border-outline/30">
                <span className="text-sm text-text-secondary">{t.common.status}</span>
                <button onClick={togglePublish} className={cn('px-3 py-1 rounded-lg text-[12px] font-semibold uppercase tracking-wide transition-colors', courseStatus === 'published' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
                  {courseStatus === 'published' ? t.courses.published : t.courses.draft}
                </button>
              </div>

              {/* Delete */}
              {courseId && (
                <div className="pt-4 border-t border-outline/20">
                  <button onClick={async () => {
                    if (!confirm(fr ? 'Supprimer ce cours définitivement ?' : 'Delete this course permanently?')) return;
                    try { await deleteCourse(courseId); toast.success(t.courses.courseDeleted); navigate('/courses'); }
                    catch (err: any) { toast.error(err?.message || t.courses.failedDelete); }
                  }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium text-danger hover:bg-danger-light transition-colors">
                    <Trash2 size={14} /> {t.courses.deleteCourse}
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* ── Lesson Editor ── */
            <div className="max-w-2xl mx-auto w-full px-8 py-8">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex-1 min-w-0">
                  <button onClick={() => setActiveLessonId(null)} className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary mb-1 transition-colors">
                    <ArrowLeft size={11} /> {fr ? 'Retour aux détails du cours' : 'Back to course details'}
                  </button>
                  <p className="text-[11px] text-text-tertiary uppercase tracking-wide">{modules.find(m => m.lessons.some(l => l.id === activeLessonId))?.title}</p>
                  <h2 className="text-lg font-bold text-text-primary truncate">{lessonTitle || 'Untitled'}</h2>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => { if (activeLessonId && confirm(fr ? 'Supprimer cette leçon ?' : 'Delete this lesson?')) handleDeleteLesson(activeLessonId); }}
                    className="glass-button px-2.5 py-1.5 rounded-lg text-danger hover:bg-danger-light"><Trash2 size={13} /></button>
                  <button onClick={handleSaveLesson} disabled={lessonSaving} className="glass-button-primary flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold">
                    {lessonSaving ? <span className="animate-pulse">{t.courses.saving}</span> : <><Save size={13} /> {t.courses.save}</>}
                  </button>
                </div>
              </div>

              {/* Title + Duration */}
              <div className="flex gap-4 mb-6">
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5 block">{t.courses.lessonTitle}</label>
                  <input value={lessonTitle} onChange={e => setLessonTitle(e.target.value)} className="glass-input w-full px-4 py-2.5 rounded-xl text-sm" />
                </div>
                <div className="w-32">
                  <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5 block">{t.courses.duration}</label>
                  <div className="relative">
                    <input type="number" min={0} value={lessonDuration} onChange={e => setLessonDuration(Number(e.target.value))} className="glass-input w-full px-4 py-2.5 rounded-xl text-sm pr-10" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">min</span>
                  </div>
                </div>
              </div>

              {/* ── Content Type ── */}
              <div className="mb-6">
                <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2.5 block">{t.courses.lessonContent}</label>
                <div className="flex gap-1 mb-4 p-1 bg-surface-secondary rounded-xl">
                  {([
                    { key: 'video', icon: Video, label: 'Video' },
                    { key: 'embed', icon: Globe, label: 'Embed' },
                    { key: 'text', icon: Type, label: fr ? 'Texte' : 'Text' },
                    { key: 'pdf', icon: FileText, label: 'PDF' },
                    { key: 'link', icon: Link2, label: fr ? 'Lien' : 'Link' },
                  ] as const).map(({ key, icon: Icon, label }) => (
                    <button key={key} onClick={() => setLessonContentType(key)}
                      className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium transition-all',
                        lessonContentType === key ? 'bg-surface-elevated shadow-sm text-text-primary font-semibold' : 'text-text-muted hover:text-text-secondary')}>
                      <Icon size={12} /> {label}
                    </button>
                  ))}
                </div>

                <div className="bg-surface-card rounded-2xl border border-outline/30 p-5">
                  {lessonContentType === 'video' && (<>
                    {lessonVideoUrl ? (
                      <div><video src={lessonVideoUrl} controls className="w-full rounded-xl max-h-[280px] bg-black mb-2" /><button onClick={() => setLessonVideoUrl('')} className="text-xs text-danger hover:underline">{fr ? 'Supprimer' : 'Remove'}</button></div>
                    ) : (
                      <label className="flex flex-col items-center justify-center gap-3 py-10 rounded-xl border-2 border-dashed border-outline/40 hover:border-outline-strong cursor-pointer transition-colors">
                        <input type="file" accept="video/*" onChange={handleVideoUpload} className="hidden" />
                        <Upload size={24} className="text-text-muted" />
                        <p className="text-[13px] font-semibold text-text-primary">{t.courses.uploadYourVideo}</p>
                        <p className="text-[11px] text-text-muted">{t.courses.supportedFormats}</p>
                      </label>
                    )}
                  </>)}
                  {lessonContentType === 'embed' && (
                    <div className="space-y-3">
                      <p className="text-[12px] text-text-secondary">{fr ? 'YouTube, Loom ou Vimeo' : 'YouTube, Loom or Vimeo link'}</p>
                      <input value={lessonEmbedUrl} onChange={e => setLessonEmbedUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." className="glass-input w-full px-4 py-2.5 rounded-xl text-sm" />
                      {lessonEmbedUrl && <div className="aspect-video rounded-xl overflow-hidden border border-outline/20">
                        <iframe src={(() => { const yt = lessonEmbedUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/); if (yt) return `https://www.youtube.com/embed/${yt[1]}`; const lo = lessonEmbedUrl.match(/loom\.com\/share\/([\w-]+)/); if (lo) return `https://www.loom.com/embed/${lo[1]}`; return lessonEmbedUrl; })()} className="w-full h-full" allowFullScreen />
                      </div>}
                    </div>
                  )}
                  {lessonContentType === 'text' && <textarea value={lessonTextContent} onChange={e => setLessonTextContent(e.target.value)} rows={10} placeholder={fr ? 'Contenu...' : 'Content...'} className="glass-input w-full px-4 py-3 rounded-xl text-sm resize-none leading-relaxed" />}
                  {lessonContentType === 'pdf' && (<>
                    {lessonVideoUrl ? (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-secondary"><FileText size={20} className="text-info shrink-0" /><span className="flex-1 text-[13px] text-text-primary truncate">{lessonVideoUrl.split('/').pop()}</span><button onClick={() => setLessonVideoUrl('')} className="text-text-muted hover:text-danger"><X size={14} /></button></div>
                    ) : (
                      <label className="flex flex-col items-center justify-center gap-3 py-10 rounded-xl border-2 border-dashed border-outline/40 hover:border-outline-strong cursor-pointer transition-colors">
                        <input type="file" accept=".pdf" onChange={handleVideoUpload} className="hidden" />
                        <FileText size={24} className="text-text-muted" /><p className="text-[13px] font-semibold text-text-primary">{fr ? 'Télécharger un PDF' : 'Upload PDF'}</p>
                      </label>
                    )}
                  </>)}
                  {lessonContentType === 'link' && (
                    <div className="space-y-3">
                      <p className="text-[12px] text-text-secondary">{fr ? 'Quiz, site web ou ressource externe' : 'Quiz, website or external resource'}</p>
                      <input value={lessonEmbedUrl} onChange={e => setLessonEmbedUrl(e.target.value)} placeholder="https://..." className="glass-input w-full px-4 py-2.5 rounded-xl text-sm" />
                    </div>
                  )}
                </div>
              </div>

              {/* ── Attachments ── */}
              <div>
                <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">{t.courses.attachments}</h3>
                {lessonAttachments.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {lessonAttachments.map((att, i) => (
                      <div key={i} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-surface-card border border-outline/30 group">
                        <FileText size={14} className="text-text-muted shrink-0" />
                        <span className="flex-1 text-[12px] text-text-primary truncate">{att.name}</span>
                        <span className="text-[10px] text-text-muted uppercase">{att.type}</span>
                        <button onClick={() => setLessonAttachments(p => p.filter((_, j) => j !== i))} className="p-0.5 rounded hover:bg-danger-light text-text-muted hover:text-danger transition-colors"><Trash2 size={11} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-outline/40 hover:border-outline-strong cursor-pointer transition-colors text-text-muted hover:text-text-secondary text-[12px]">
                  <input type="file" onChange={handleAttachmentUpload} className="hidden" />
                  <Upload size={13} /> {fr ? 'Ajouter une pièce jointe' : 'Add attachment'}
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Module drag handle (receives props from SortableModuleRow) ── */
function ModuleDragHandle(props: any) {
  return <div {...(props.dragHandleProps || {})} className="cursor-grab text-text-muted/40 hover:text-text-secondary shrink-0 p-0.5"><GripVertical size={13} /></div>;
}
