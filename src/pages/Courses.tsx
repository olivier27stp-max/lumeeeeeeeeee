import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, BookOpen, Clock, MoreHorizontal, Copy, Trash2, Pencil, Eye,
  GraduationCap, Filter, Layers, ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import {
  getCourses, deleteCourse, duplicateCourse,
  getProgressSummary, getCurrentUserRole,
  type Course, type ProgressSummary,
} from '../lib/coursesApi';
import { EmptyState } from '../components/ui';

function formatDuration(min: number, t: any) {
  if (!min) return '';
  if (min < 60) return `${min} ${t.courses.min}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}${t.courses.hr} ${m}${t.courses.min}` : `${h}${t.courses.hr}`;
}

export default function Courses() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const fr = language === 'fr';

  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [progressSummary, setProgressSummary] = useState<ProgressSummary>({});
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const isAdminOrOwner = userRole === 'owner' || userRole === 'admin';

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadCourses = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCourses({ status: statusFilter !== 'all' ? statusFilter : undefined, q: debouncedQuery || undefined });
      setCourses(data);
    } catch (err: any) {
      setError(err?.message || t.courses.failedLoad);
    } finally {
      setLoading(false);
    }
    try {
      const progress = await getProgressSummary();
      setProgressSummary(progress);
    } catch { /* silent */ }
  };

  useEffect(() => { void loadCourses(); }, [debouncedQuery, statusFilter]);
  useEffect(() => { getCurrentUserRole().then(setUserRole).catch(() => {}); }, []);

  const handleDelete = async () => {
    if (!courseToDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteCourse(courseToDelete.id);
      toast.success(t.courses.courseDeleted);
      setCourseToDelete(null);
      await loadCourses();
    } catch (err: any) {
      toast.error(err?.message || t.courses.failedDelete);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDuplicate = async (course: Course) => {
    try {
      await duplicateCourse(course.id);
      toast.success(t.courses.courseDuplicated);
      await loadCourses();
    } catch (err: any) {
      toast.error(err?.message || t.courses.failedCreate);
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menuOpen]);

  // Derive categories from courses
  const categories = Array.from(new Set(courses.map(c => c.category).filter(Boolean)));
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filteredCourses = activeCategory
    ? courses.filter(c => c.category === activeCategory)
    : courses;

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-bold text-text-primary tracking-tight">
            {t.courses.title}
          </h1>
          <p className="text-[13px] text-text-tertiary mt-1">
            {fr ? `${courses.length} formation${courses.length !== 1 ? 's' : ''} disponible${courses.length !== 1 ? 's' : ''}`
              : `${courses.length} course${courses.length !== 1 ? 's' : ''} available`}
          </p>
        </div>
        {isAdminOrOwner && (
          <button
            onClick={() => navigate('/courses/new')}
            className="glass-button-primary flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold"
          >
            <Plus size={16} strokeWidth={2.5} />
            {t.courses.createCourse}
          </button>
        )}
      </div>

      {/* ─── Search + Filters bar ─── */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder={t.courses.searchCourses}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="glass-input w-full pl-10 pr-4 py-2.5 rounded-xl text-sm"
          />
        </div>

        {/* Status filter pills */}
        <div className="flex items-center gap-1.5">
          {['all', 'published', 'draft'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3.5 py-[7px] rounded-lg text-[12px] font-medium transition-colors',
                statusFilter === s
                  ? 'bg-surface-tertiary text-text-primary font-semibold'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-secondary'
              )}
            >
              {s === 'all' ? t.courses.allStatuses : s === 'published' ? t.courses.published : t.courses.draft}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Category tags ─── */}
      {categories.length > 0 && (
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveCategory(null)}
            className={cn(
              'shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors border',
              !activeCategory
                ? 'border-outline-strong bg-surface-tertiary text-text-primary'
                : 'border-transparent text-text-tertiary hover:text-text-secondary hover:bg-surface-secondary'
            )}
          >
            {fr ? 'Tout' : 'All'}
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className={cn(
                'shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors border',
                activeCategory === cat
                  ? 'border-outline-strong bg-surface-tertiary text-text-primary'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary hover:bg-surface-secondary'
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* ─── Error state ─── */}
      {error && !loading && (
        <div className="bg-danger-light border border-danger/20 rounded-2xl p-6 mb-6">
          <p className="text-[13px] text-danger font-medium mb-2">{fr ? 'Erreur de chargement' : 'Failed to load'}</p>
          <p className="text-[12px] text-danger/70 mb-3">{error}</p>
          <button onClick={loadCourses} className="glass-button px-3 py-1.5 rounded-lg text-[12px] font-medium">
            {fr ? 'Réessayer' : 'Retry'}
          </button>
        </div>
      )}

      {/* ─── Grid ─── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-surface-card rounded-2xl border border-outline/30 overflow-hidden animate-pulse">
              <div className="aspect-[16/10] bg-surface-tertiary" />
              <div className="p-4 space-y-2.5">
                <div className="h-4 bg-surface-tertiary rounded-lg w-3/4" />
                <div className="h-3 bg-surface-tertiary rounded-lg w-full" />
                <div className="h-3 bg-surface-tertiary rounded-lg w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : !error && filteredCourses.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={t.courses.noCourses}
          description={t.courses.noCoursesDesc}
          action={
            <button onClick={() => navigate('/courses/new')}
              className="glass-button-primary flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold">
              <Plus size={16} /> {t.courses.createCourse}
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredCourses.map((course, idx) => {
            const progressPct = progressSummary[course.id] || 0;

            return (
              <motion.div
                key={course.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: idx * 0.03 }}
                className="group bg-surface-card rounded-2xl border border-outline/30 overflow-hidden cursor-pointer
                           hover:shadow-card-hover hover:border-outline-strong transition-all duration-200"
                onClick={() => navigate(`/courses/${course.id}`)}
              >
                {/* Cover */}
                <div className="aspect-[16/10] bg-surface-tertiary relative overflow-hidden">
                  {course.cover_image ? (
                    <img src={course.cover_image} alt={course.title}
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-surface-tertiary to-surface-secondary">
                      <GraduationCap size={40} className="text-text-muted/30" />
                    </div>
                  )}

                  {/* Status badge */}
                  <div className={cn(
                    'absolute top-3 left-3 px-2.5 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider backdrop-blur-md',
                    course.status === 'published' ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'
                  )}>
                    {course.status === 'published' ? t.courses.published : t.courses.draft}
                  </div>

                  {/* Progress overlay if started */}
                  {progressPct > 0 && progressPct < 100 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
                      <div className="h-full bg-success" style={{ width: `${progressPct}%` }} />
                    </div>
                  )}
                  {progressPct >= 100 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-success" />
                  )}

                  {/* Menu */}
                  <div className="absolute top-3 right-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === course.id ? null : course.id); }}
                      className="w-7 h-7 rounded-lg bg-black/40 backdrop-blur-sm flex items-center justify-center
                                 text-white/80 hover:text-white hover:bg-black/60 transition-all
                                 opacity-0 group-hover:opacity-100"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    <AnimatePresence>
                      {menuOpen === course.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -4 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -4 }}
                          transition={{ duration: 0.1 }}
                          className="absolute right-0 top-9 w-48 bg-surface-elevated border border-outline/40 rounded-xl shadow-dropdown py-1.5 z-50"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isAdminOrOwner && (
                            <button onClick={() => { navigate(`/courses/${course.id}/edit`); setMenuOpen(null); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-text-primary hover:bg-surface-secondary transition-colors">
                              <Pencil size={13} className="text-text-muted" /> {t.courses.editCourse}
                            </button>
                          )}
                          <button onClick={() => { navigate(`/courses/${course.id}`); setMenuOpen(null); }}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-text-primary hover:bg-surface-secondary transition-colors">
                            <Eye size={13} className="text-text-muted" /> {fr ? 'Voir' : 'View'}
                          </button>
                          {isAdminOrOwner && (
                            <>
                              <button onClick={() => { handleDuplicate(course); setMenuOpen(null); }}
                                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-text-primary hover:bg-surface-secondary transition-colors">
                                <Copy size={13} className="text-text-muted" /> {t.courses.duplicateCourse}
                              </button>
                              <div className="border-t border-outline/20 my-1" />
                              <button onClick={() => { setCourseToDelete(course); setMenuOpen(null); }}
                                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-danger hover:bg-danger-light transition-colors">
                                <Trash2 size={13} /> {t.courses.deleteCourse}
                              </button>
                            </>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Content */}
                <div className="p-4">
                  <h3 className="text-[14px] font-bold text-text-primary truncate leading-tight mb-1.5">
                    {course.title || (fr ? 'Sans titre' : 'Untitled')}
                  </h3>
                  <p className="text-[12px] text-text-tertiary line-clamp-2 leading-relaxed mb-3 min-h-[2.4em]">
                    {course.description || '—'}
                  </p>

                  {/* Meta row */}
                  <div className="flex items-center gap-3 text-[11px] text-text-muted">
                    <span className="flex items-center gap-1">
                      <Layers size={11} />
                      {course.module_count || 0} {t.courses.chapters}
                    </span>
                    <span className="text-text-muted/30">·</span>
                    <span className="flex items-center gap-1">
                      <BookOpen size={11} />
                      {course.lesson_count || 0} {t.courses.lessons}
                    </span>
                    {(course.total_duration_min || 0) > 0 && (
                      <>
                        <span className="text-text-muted/30">·</span>
                        <span className="flex items-center gap-1">
                          <Clock size={11} />
                          {formatDuration(course.total_duration_min || 0, t)}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Progress bar */}
                  {progressPct > 0 && (
                    <div className="mt-3 pt-3 border-t border-outline/20">
                      <div className="flex items-center justify-between text-[11px] mb-1.5">
                        <span className="text-text-secondary font-medium">{t.courses.progress}</span>
                        <span className={cn(
                          'font-bold',
                          progressPct >= 100 ? 'text-success' : 'text-text-primary'
                        )}>{progressPct}%</span>
                      </div>
                      <div className="h-1.5 bg-surface-tertiary rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all duration-500',
                            progressPct >= 100 ? 'bg-success' : 'bg-text-primary'
                          )}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ─── Delete Modal ─── */}
      <AnimatePresence>
        {courseToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => !isDeleting && setCourseToDelete(null)}>
            <motion.div
              className="bg-surface-card rounded-2xl border border-outline/40 shadow-modal max-w-sm w-full mx-4 p-6"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-danger-light flex items-center justify-center">
                  <Trash2 size={18} className="text-danger" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">{t.courses.deleteCourse}</h3>
                  <p className="text-[12px] text-text-muted mt-0.5">{courseToDelete.title}</p>
                </div>
              </div>
              <p className="text-[13px] text-text-secondary mb-6 leading-relaxed">{t.courses.deleteConfirmDesc}</p>
              <div className="flex justify-end gap-2.5">
                <button onClick={() => setCourseToDelete(null)} disabled={isDeleting}
                  className="glass-button px-4 py-2 rounded-xl text-[13px] font-medium">
                  {t.common.cancel}
                </button>
                <button onClick={handleDelete} disabled={isDeleting}
                  className="glass-button-danger px-4 py-2 rounded-xl text-[13px] font-semibold">
                  {isDeleting ? t.common.deleting : t.common.delete}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
