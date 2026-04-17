import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Circle, PlayCircle, Clock, BookOpen, Check,
  FileText, Download, ChevronDown, ChevronRight, GraduationCap, Pencil,
  Share2, Bookmark, ExternalLink, FileIcon, Image as ImageIcon, Link2, Users,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import {
  getCourse, getCourseProgress, updateProgress, getCurrentUserRole, getTeamCourseProgress,
  type CourseFull, type CourseLesson, type LessonProgress, type TeamMemberProgress,
} from '../lib/coursesApi';

function formatDuration(min: number, t: any) {
  if (!min) return '';
  if (min < 60) return `${min} ${t.courses.min}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} ${t.courses.hr} ${m} ${t.courses.min}` : `${h} ${t.courses.hr}`;
}

function getEmbedUrl(url: string): string | null {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const loom = url.match(/loom\.com\/share\/([\w-]+)/);
  if (loom) return `https://www.loom.com/embed/${loom[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return url;
}

const CONTENT_ICON: Record<string, React.ElementType> = {
  video: PlayCircle,
  embed: PlayCircle,
  text: FileText,
  pdf: FileIcon,
  link: Link2,
};

export default function CourseView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const fr = language === 'fr';

  const [course, setCourse] = useState<CourseFull | null>(null);
  const [progress, setProgress] = useState<LessonProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeLesson, setActiveLesson] = useState<CourseLesson | null>(null);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [markingComplete, setMarkingComplete] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [teamProgress, setTeamProgress] = useState<TeamMemberProgress[]>([]);
  const [showTeamProgress, setShowTeamProgress] = useState(false);
  const canEdit = course?.can_edit ?? false;

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [courseData, progressData] = await Promise.all([
        getCourse(id),
        getCourseProgress(id).catch(() => [] as LessonProgress[]),
      ]);
      setCourse(courseData);
      setProgress(progressData);

      const allLessons = courseData.modules.flatMap((m) => m.lessons);
      const completedIds = new Set(progressData.filter((p) => p.completed).map((p) => p.lesson_id));
      const firstIncomplete = allLessons.find((l) => !completedIds.has(l.id));
      setActiveLesson(firstIncomplete || allLessons[0] || null);
      setExpandedModules(new Set(courseData.modules.map((m) => m.id)));

      // Load role + team progress for admins
      const role = await getCurrentUserRole().catch(() => null);
      setUserRole(role);
      if (role === 'owner' || role === 'admin') {
        const tp = await getTeamCourseProgress(id).catch(() => []);
        setTeamProgress(tp);
      }
    } catch (err: any) {
      setError(err?.message || t.courses.failedLoad);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadData(); }, [loadData]);

  const completedSet = useMemo(() => new Set(progress.filter((p) => p.completed).map((p) => p.lesson_id)), [progress]);
  const totalLessons = useMemo(() => course?.modules.reduce((s, m) => s + m.lessons.length, 0) || 0, [course]);
  const completedCount = completedSet.size;
  const progressPct = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

  const toggleModule = (mid: string) => {
    setExpandedModules((prev) => { const n = new Set(prev); n.has(mid) ? n.delete(mid) : n.add(mid); return n; });
  };

  const selectLesson = async (lesson: CourseLesson) => {
    setActiveLesson(lesson);
    if (id && !completedSet.has(lesson.id)) {
      try { await updateProgress(id, lesson.id, false); } catch { /* silent */ }
    }
  };

  const handleMarkComplete = async () => {
    if (!id || !activeLesson || markingComplete) return;
    setMarkingComplete(true);
    try {
      await updateProgress(id, activeLesson.id, !completedSet.has(activeLesson.id));
      const fresh = await getCourseProgress(id);
      setProgress(fresh);
    } catch (err: any) { toast.error(err?.message || t.courses.failedUpdate); }
    finally { setMarkingComplete(false); }
  };

  // Navigate to next incomplete lesson
  const goToNextLesson = () => {
    if (!course || !activeLesson) return;
    const allLessons = course.modules.flatMap(m => m.lessons);
    const currentIdx = allLessons.findIndex(l => l.id === activeLesson.id);
    if (currentIdx >= 0 && currentIdx < allLessons.length - 1) {
      selectLesson(allLessons[currentIdx + 1]);
    }
  };

  if (loading) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8 animate-pulse space-y-5">
        <div className="h-5 bg-surface-tertiary rounded w-40" />
        <div className="h-7 bg-surface-tertiary rounded w-64" />
        <div className="flex gap-6">
          <div className="flex-1 aspect-video bg-surface-tertiary rounded-2xl" />
          <div className="w-[380px] shrink-0 space-y-3">
            <div className="h-4 bg-surface-tertiary rounded w-40" />
            <div className="h-3 bg-surface-tertiary rounded w-full" />
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 bg-surface-tertiary rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
        <button onClick={() => navigate('/courses')} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-6">
          <ArrowLeft size={16} /> {t.courses.backToCourses}
        </button>
        <div className="bg-danger-light border border-danger/20 rounded-2xl p-8 text-center">
          <GraduationCap size={40} className="text-danger/40 mx-auto mb-3" />
          <p className="text-[14px] text-danger font-semibold mb-1">{fr ? 'Cours non trouvé' : 'Course not found'}</p>
          <p className="text-[12px] text-danger/60">{error || (fr ? 'Ce cours n\'existe pas ou n\'est plus disponible.' : 'This course doesn\'t exist or is no longer available.')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
      {/* ── Top nav ── */}
      <div className="flex items-center justify-between mb-5">
        <button onClick={() => navigate('/courses')} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
          <ArrowLeft size={16} /> {t.courses.backToCourses}
        </button>
        {canEdit && (
          <button onClick={() => navigate(`/courses/${id}/edit`)} className="glass-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px]">
            <Pencil size={13} /> {t.courses.editCourse}
          </button>
        )}
      </div>

      {/* ── Title ── */}
      <h1 className="text-[22px] font-bold text-text-primary mb-6 tracking-tight">{course.title}</h1>

      {/* ── 2-Column Layout ── */}
      <div className="flex gap-6 items-start">

        {/* ─── LEFT: Video + Content ─── */}
        <div className="flex-1 min-w-0">
          {/* Player / Content Area */}
          {activeLesson?.content_type === 'text' ? (
            /* ── Text lesson: no video wrapper ── */
            <div className="bg-surface-card rounded-2xl border border-outline/30 p-8 mb-5 min-h-[200px]">
              {activeLesson.text_content ? (
                <div className="prose prose-sm dark:prose-invert max-w-none text-text-primary leading-relaxed whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: activeLesson.text_content }} />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-text-muted gap-2">
                  <FileText size={36} className="opacity-30" />
                  <p className="text-sm">{fr ? 'Aucun contenu texte' : 'No text content yet'}</p>
                </div>
              )}
            </div>
          ) : activeLesson?.content_type === 'link' ? (
            /* ── Link lesson: card with open button ── */
            <div className="bg-surface-card rounded-2xl border border-outline/30 p-8 mb-5">
              {activeLesson.embed_url ? (
                <div className="flex flex-col items-center justify-center gap-5 py-8">
                  <div className="w-16 h-16 rounded-2xl bg-surface-tertiary flex items-center justify-center">
                    <ExternalLink size={28} className="text-text-muted" />
                  </div>
                  <div className="text-center">
                    <p className="text-[14px] font-semibold text-text-primary mb-1">{activeLesson.title}</p>
                    <p className="text-[12px] text-text-muted truncate max-w-md">{activeLesson.embed_url}</p>
                  </div>
                  <a href={activeLesson.embed_url} target="_blank" rel="noopener noreferrer"
                    className="glass-button-primary px-6 py-2.5 rounded-xl text-[13px] font-semibold flex items-center gap-2">
                    <ExternalLink size={14} /> {fr ? 'Ouvrir le lien' : 'Open Link'}
                  </a>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-text-muted gap-2">
                  <Link2 size={36} className="opacity-30" />
                  <p className="text-sm">{fr ? 'Aucun lien configuré' : 'No link configured'}</p>
                </div>
              )}
            </div>
          ) : (
            /* ── Video / Embed / PDF: aspect-video container ── */
            <div className="aspect-video bg-black rounded-2xl overflow-hidden mb-5 shadow-lg relative">
              {activeLesson?.content_type === 'video' && activeLesson.video_url ? (
                <video key={activeLesson.id} src={activeLesson.video_url} controls className="w-full h-full object-contain" />
              ) : activeLesson?.content_type === 'embed' && activeLesson.embed_url ? (
                <iframe key={activeLesson.id} src={getEmbedUrl(activeLesson.embed_url) || ''} className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              ) : activeLesson?.content_type === 'pdf' && activeLesson.video_url ? (
                <iframe key={activeLesson.id} src={activeLesson.video_url} className="w-full h-full bg-white" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-text-muted gap-3">
                  {activeLesson ? (
                    <>
                      {(() => { const Icon = CONTENT_ICON[activeLesson.content_type] || PlayCircle; return <Icon size={52} className="opacity-30" />; })()}
                      <span className="text-sm">{fr ? 'Aucun contenu ajouté' : 'No content added yet'}</span>
                    </>
                  ) : (
                    <>
                      <PlayCircle size={52} className="opacity-30" />
                      <span className="text-sm">{t.courses.selectLesson}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Lesson title row */}
          {activeLesson && (
            <div className="mb-3">
              <h2 className="text-lg font-semibold text-text-primary">{activeLesson.title}</h2>
              {activeLesson.duration_min > 0 && (
                <p className="text-[12px] text-text-muted flex items-center gap-1 mt-1">
                  <Clock size={12} /> {formatDuration(activeLesson.duration_min, t)}
                </p>
              )}
            </div>
          )}

          {/* ── Mark as complete checkbox + next lesson ── */}
          {activeLesson && (
            <div className={cn(
              'flex items-center justify-between rounded-xl border px-5 py-3.5 mb-5 transition-all duration-200',
              completedSet.has(activeLesson.id)
                ? 'bg-success/8 border-success/25'
                : 'bg-surface-card border-outline/30'
            )}>
              <button
                onClick={handleMarkComplete}
                disabled={markingComplete}
                className="flex items-center gap-3 group"
              >
                <div className={cn(
                  'w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all duration-200 shrink-0',
                  completedSet.has(activeLesson.id)
                    ? 'bg-success border-success'
                    : 'border-outline-strong group-hover:border-text-primary'
                )}>
                  {completedSet.has(activeLesson.id) && <Check size={14} className="text-white" strokeWidth={3} />}
                </div>
                <span className={cn(
                  'text-[13px] font-medium transition-colors',
                  completedSet.has(activeLesson.id) ? 'text-success' : 'text-text-secondary group-hover:text-text-primary'
                )}>
                  {completedSet.has(activeLesson.id)
                    ? (fr ? 'Leçon complétée' : 'Lesson completed')
                    : (fr ? 'Marquer comme terminée' : 'Mark as complete')
                  }
                </span>
              </button>
              {completedSet.has(activeLesson.id) && (() => {
                const allLessons = course.modules.flatMap(m => m.lessons);
                const currentIdx = allLessons.findIndex(l => l.id === activeLesson.id);
                const hasNext = currentIdx >= 0 && currentIdx < allLessons.length - 1;
                return hasNext ? (
                  <button
                    onClick={goToNextLesson}
                    className="flex items-center gap-1.5 text-[12px] font-semibold text-text-primary hover:text-text-secondary transition-colors"
                  >
                    {fr ? 'Leçon suivante' : 'Next lesson'} <ChevronRight size={14} />
                  </button>
                ) : null;
              })()}
            </div>
          )}

          {/* About This Course */}
          {course.description && (
            <div className="bg-surface-card rounded-2xl border border-outline/30 p-6 mb-5">
              <h3 className="text-sm font-bold text-text-primary mb-3">{t.courses.aboutThisCourse}</h3>
              <div className={cn('text-[13px] text-text-secondary leading-relaxed', !showMore && 'line-clamp-3')}>
                {course.description}
              </div>
              {course.description.length > 200 && (
                <button onClick={() => setShowMore(!showMore)} className="flex items-center gap-1 text-[12px] text-text-tertiary hover:text-text-primary mt-2 font-medium transition-colors">
                  {showMore ? (fr ? 'Moins' : 'Show less') : (fr ? 'Voir plus' : 'Show more')}
                  <ChevronDown size={12} className={cn('transition-transform', showMore && 'rotate-180')} />
                </button>
              )}
            </div>
          )}

          {/* Attachments */}
          {activeLesson && activeLesson.attachments.length > 0 && (
            <div className="bg-surface-card rounded-2xl border border-outline/30 p-5">
              <h3 className="text-sm font-bold text-text-primary mb-3">{t.courses.attachments}</h3>
              <div className="space-y-1.5">
                {activeLesson.attachments.map((att, i) => (
                  <a key={i} href={att.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-secondary transition-colors group">
                    <div className="w-9 h-9 rounded-lg bg-info-light flex items-center justify-center shrink-0">
                      <FileText size={14} className="text-info" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-text-primary truncate">{att.name}</p>
                      <p className="text-[11px] text-text-muted uppercase">{att.type}</p>
                    </div>
                    <Download size={14} className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── RIGHT SIDEBAR: Progress + Module tree ─── */}
        <div className="w-[380px] shrink-0 space-y-5 sticky top-8">

          {/* ── Progress Card ── */}
          <div className="bg-surface-card rounded-2xl border border-outline/30 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-text-primary">{t.courses.yourProgress}</h3>
              <span className={cn(
                'text-[13px] font-bold px-2.5 py-0.5 rounded-lg',
                progressPct >= 100 ? 'bg-success/15 text-success' : 'bg-surface-tertiary text-text-primary'
              )}>
                {progressPct}%
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-2.5 bg-surface-tertiary rounded-full overflow-hidden mb-4">
              <motion.div
                className={cn('h-full rounded-full', progressPct >= 100 ? 'bg-success' : 'bg-text-primary')}
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>

            {/* Milestones */}
            <div className="flex items-center justify-between mb-4">
              {[25, 50, 75, 100].map((mark) => (
                <div
                  key={mark}
                  className={cn(
                    'w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold transition-all duration-300',
                    progressPct >= mark
                      ? 'bg-text-primary text-surface shadow-sm'
                      : 'bg-surface-tertiary text-text-muted'
                  )}
                >
                  {mark}
                </div>
              ))}
            </div>

            {progressPct > 0 && (
              <p className="text-[12px] text-text-secondary leading-relaxed">
                {fr
                  ? `${completedCount}/${totalLessons} leçons complétées. ${progressPct >= 100 ? 'Félicitations !' : 'Continuez !'}`
                  : `${completedCount}/${totalLessons} lessons completed. ${progressPct >= 100 ? 'Congratulations!' : 'Keep going!'}`
                }
              </p>
            )}
          </div>

          {/* ── Course Completion List ── */}
          <div className="bg-surface-card rounded-2xl border border-outline/30 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline/20">
              <h3 className="text-sm font-bold text-text-primary">{t.courses.courseCompletion}</h3>
              <span className="text-[12px] text-text-muted font-medium">{completedCount}/{totalLessons}</span>
            </div>

            <div className="max-h-[calc(100vh-520px)] overflow-y-auto">
              {course.modules.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <BookOpen size={24} className="text-text-muted/30 mx-auto mb-2" />
                  <p className="text-[12px] text-text-muted">{t.courses.noModules}</p>
                </div>
              ) : (
                course.modules.map((mod) => {
                  const isExpanded = expandedModules.has(mod.id);
                  const modCompleted = mod.lessons.filter((l) => completedSet.has(l.id)).length;
                  const allDone = modCompleted === mod.lessons.length && mod.lessons.length > 0;
                  const modDuration = mod.lessons.reduce((s, l) => s + (l.duration_min || 0), 0);

                  return (
                    <div key={mod.id}>
                      <button
                        onClick={() => toggleModule(mod.id)}
                        className={cn(
                          'w-full flex items-center gap-3 px-5 py-3.5 hover:bg-surface-secondary/60 transition-colors text-left',
                          isExpanded && 'bg-surface-secondary/30'
                        )}
                      >
                        {allDone ? (
                          <CheckCircle2 size={18} className="text-success shrink-0" />
                        ) : activeLesson && mod.lessons.some((l) => l.id === activeLesson.id) ? (
                          <div className="w-[18px] h-[18px] rounded-full border-2 border-text-primary flex items-center justify-center shrink-0">
                            <div className="w-2 h-2 rounded-full bg-text-primary" />
                          </div>
                        ) : (
                          <PlayCircle size={18} className="text-text-muted shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-text-primary truncate">{mod.title}</p>
                          <p className="text-[11px] text-text-muted mt-0.5">
                            {modDuration > 0 ? formatDuration(modDuration, t) : `${mod.lessons.length} ${t.courses.lessons}`}
                          </p>
                        </div>
                        {isExpanded
                          ? <ChevronDown size={14} className="text-text-muted shrink-0" />
                          : <ChevronRight size={14} className="text-text-muted shrink-0" />
                        }
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden"
                          >
                            {mod.lessons.length === 0 ? (
                              <p className="pl-12 pr-5 py-3 text-[11px] text-text-muted italic">{t.courses.noLessons}</p>
                            ) : (
                              mod.lessons.map((lesson) => {
                                const isActive = activeLesson?.id === lesson.id;
                                const isDone = completedSet.has(lesson.id);
                                const Icon = CONTENT_ICON[lesson.content_type] || Circle;

                                return (
                                  <button
                                    key={lesson.id}
                                    onClick={() => selectLesson(lesson)}
                                    className={cn(
                                      'w-full flex items-center gap-3 pl-12 pr-5 py-2.5 text-left transition-all duration-150',
                                      isActive
                                        ? 'bg-primary/8 border-l-2 border-primary'
                                        : 'hover:bg-surface-secondary/40 border-l-2 border-transparent'
                                    )}
                                  >
                                    {isDone ? (
                                      <CheckCircle2 size={15} className="text-success shrink-0" />
                                    ) : isActive ? (
                                      <Icon size={15} className="text-primary shrink-0" />
                                    ) : (
                                      <Icon size={15} className="text-text-muted/50 shrink-0" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <p className={cn(
                                        'text-[13px] truncate',
                                        isActive ? 'font-semibold text-text-primary' : 'text-text-secondary'
                                      )}>
                                        {lesson.title}
                                      </p>
                                    </div>
                                    {lesson.duration_min > 0 && (
                                      <span className="text-[11px] text-text-muted shrink-0">{formatDuration(lesson.duration_min, t)}</span>
                                    )}
                                  </button>
                                );
                              })
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Team Progress (admin/boss only) ── */}
          {(userRole === 'owner' || userRole === 'admin') && teamProgress.length > 0 && (
            <div className="bg-surface-card rounded-2xl border border-outline/30 overflow-hidden">
              <button
                onClick={() => setShowTeamProgress(!showTeamProgress)}
                className="w-full flex items-center justify-between px-5 py-3.5 border-b border-outline/20 hover:bg-surface-secondary/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-text-muted" />
                  <h3 className="text-sm font-bold text-text-primary">
                    {fr ? 'Progression de l\'équipe' : 'Team Progress'}
                  </h3>
                </div>
                <ChevronDown size={14} className={cn('text-text-muted transition-transform', showTeamProgress && 'rotate-180')} />
              </button>

              <AnimatePresence>
                {showTeamProgress && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div className="max-h-[300px] overflow-y-auto divide-y divide-outline/10">
                      {teamProgress.map((member) => (
                        <div key={member.user_id} className="flex items-center gap-3 px-5 py-3">
                          {/* Avatar */}
                          <div className="w-8 h-8 rounded-full bg-surface-tertiary flex items-center justify-center shrink-0 overflow-hidden">
                            {member.avatar_url ? (
                              <img src={member.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-[11px] font-bold text-text-muted">
                                {member.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                              </span>
                            )}
                          </div>
                          {/* Name + progress */}
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold text-text-primary truncate">{member.full_name}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-1.5 bg-surface-tertiary rounded-full overflow-hidden">
                                <div
                                  className={cn('h-full rounded-full transition-all', member.percentage >= 100 ? 'bg-success' : 'bg-text-primary')}
                                  style={{ width: `${member.percentage}%` }}
                                />
                              </div>
                              <span className={cn(
                                'text-[10px] font-bold shrink-0',
                                member.percentage >= 100 ? 'text-success' : 'text-text-muted'
                              )}>
                                {member.percentage}%
                              </span>
                            </div>
                          </div>
                          {/* Completion badge */}
                          {member.percentage >= 100 && (
                            <CheckCircle2 size={14} className="text-success shrink-0" />
                          )}
                        </div>
                      ))}
                    </div>
                    {/* Summary footer */}
                    <div className="px-5 py-3 border-t border-outline/20 bg-surface-secondary/30">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-text-muted">
                          {fr ? 'Complété' : 'Completed'}: {teamProgress.filter(m => m.percentage >= 100).length}/{teamProgress.length}
                        </span>
                        <span className="text-text-muted">
                          {fr ? 'Moy.' : 'Avg.'}: {Math.round(teamProgress.reduce((s, m) => s + m.percentage, 0) / teamProgress.length)}%
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
