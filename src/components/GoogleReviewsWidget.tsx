import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Star, MessageSquare } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTranslation } from '../i18n';

interface Props {
  orgId?: string;
  theme?: 'light' | 'dark';
  filter?: 'all' | 'latest' | 'highest' | 'featured' | '4_stars_above';
  layout?: 'cards' | 'carousel';
  maxDisplay?: number;
}

interface ReviewItem {
  id: string;
  client_first_name: string;
  rating: number;
  feedback: string;
  submitted_at: string;
}

async function fetchReviews(orgId?: string): Promise<ReviewItem[]> {
  let query = supabase
    .from('satisfaction_surveys')
    .select('id, client_first_name, rating, feedback, submitted_at')
    .eq('status', 'submitted')
    .gte('rating', 4)
    .order('submitted_at', { ascending: false });

  if (orgId) {
    query = query.eq('org_id', orgId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ReviewItem[];
}

function StarRating({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={size}
          className={
            star <= rating
              ? 'fill-amber-400 text-amber-400'
              : 'fill-transparent text-text-tertiary/30'
          }
        />
      ))}
    </div>
  );
}

function formatReviewDate(dateStr: string, tr: { today: string; yesterday: string; daysAgo: string; weekAgo: string; weeksAgo: string; monthsAgo: string }, language: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return tr.today;
  if (diffDays === 1) return tr.yesterday;
  if (diffDays < 7) return `${diffDays} ${tr.daysAgo}`;
  const weeks = Math.floor(diffDays / 7);
  if (diffDays < 30) return `${weeks} ${weeks > 1 ? tr.weeksAgo : tr.weekAgo}`;
  const months = Math.floor(diffDays / 30);
  if (diffDays < 365) return `${months} ${tr.monthsAgo}`;
  return date.toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-US', { month: 'short', year: 'numeric' });
}

export default function GoogleReviewsWidget({
  orgId,
  theme = 'light',
  filter = 'all',
  layout = 'cards',
  maxDisplay = 6,
}: Props) {
  const { t, language } = useTranslation();
  const [carouselIndex, setCarouselIndex] = useState(0);

  const { data: allReviews = [], isLoading } = useQuery({
    queryKey: ['googleReviews', orgId],
    queryFn: () => fetchReviews(orgId),
  });

  const reviews = useMemo(() => {
    let filtered = [...allReviews];

    switch (filter) {
      case 'latest':
        filtered.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
        break;
      case 'highest':
        filtered.sort((a, b) => b.rating - a.rating);
        break;
      case 'featured':
        // Featured = highest rated with longest feedback
        filtered.sort((a, b) => {
          if (b.rating !== a.rating) return b.rating - a.rating;
          return (b.feedback?.length || 0) - (a.feedback?.length || 0);
        });
        break;
      case '4_stars_above':
        filtered = filtered.filter((r) => r.rating >= 4);
        break;
      default:
        break;
    }

    return filtered.slice(0, maxDisplay);
  }, [allReviews, filter, maxDisplay]);

  // Reset carousel when reviews change
  useEffect(() => {
    setCarouselIndex(0);
  }, [reviews.length]);

  const isDark = theme === 'dark';

  const containerClass = isDark
    ? 'bg-gray-900 text-gray-100'
    : 'bg-white text-gray-900';

  const cardClass = isDark
    ? 'bg-gray-800 border-gray-700'
    : 'bg-surface border-outline';

  const subtextClass = isDark
    ? 'text-gray-400'
    : 'text-text-secondary';

  const tertiaryClass = isDark
    ? 'text-gray-500'
    : 'text-text-tertiary';

  if (isLoading) {
    return (
      <div className={`rounded-2xl p-8 text-center ${containerClass}`}>
        <Loader2 size={24} className={`animate-spin mx-auto ${tertiaryClass}`} />
        <p className={`text-sm mt-2 ${subtextClass}`}>{t.reviews.loadingReviews}</p>
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className={`rounded-2xl p-10 text-center ${containerClass}`}>
        <MessageSquare size={32} className={`mx-auto mb-3 opacity-30 ${tertiaryClass}`} />
        <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-text-primary'}`}>
          {t.reviews.noReviewsYet}
        </p>
        <p className={`text-xs mt-1 ${subtextClass}`}>
          {t.reviews.noReviewsYetDesc}
        </p>
      </div>
    );
  }

  // Average rating
  const avgRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;

  if (layout === 'carousel') {
    const currentReview = reviews[carouselIndex];
    const canPrev = carouselIndex > 0;
    const canNext = carouselIndex < reviews.length - 1;

    return (
      <div className={`rounded-2xl p-6 ${containerClass}`}>
        {/* Summary */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <StarRating rating={Math.round(avgRating)} />
            <span className={`text-sm font-semibold ${subtextClass}`}>
              {avgRating.toFixed(1)} ({reviews.length} review{reviews.length !== 1 ? 's' : ''})
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCarouselIndex((i) => Math.max(0, i - 1))}
              disabled={!canPrev}
              className={`p-1.5 rounded-lg transition-colors ${
                canPrev
                  ? `hover:bg-surface-secondary ${isDark ? 'hover:bg-gray-700' : ''}`
                  : 'opacity-30 cursor-not-allowed'
              }`}
            >
              <ChevronLeft size={16} />
            </button>
            <span className={`text-xs tabular-nums ${tertiaryClass}`}>
              {carouselIndex + 1} / {reviews.length}
            </span>
            <button
              type="button"
              onClick={() => setCarouselIndex((i) => Math.min(reviews.length - 1, i + 1))}
              disabled={!canNext}
              className={`p-1.5 rounded-lg transition-colors ${
                canNext
                  ? `hover:bg-surface-secondary ${isDark ? 'hover:bg-gray-700' : ''}`
                  : 'opacity-30 cursor-not-allowed'
              }`}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Current review */}
        {currentReview && (
          <div className={`rounded-xl border p-5 ${cardClass}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                    isDark ? 'bg-gray-700 text-gray-200' : 'bg-primary/10 text-primary'
                  }`}
                >
                  {currentReview.client_first_name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div>
                  <p className="text-sm font-semibold">{currentReview.client_first_name}</p>
                  <p className={`text-[11px] ${tertiaryClass}`}>
                    {formatReviewDate(currentReview.submitted_at, t.reviews, language)}
                  </p>
                </div>
              </div>
              <StarRating rating={currentReview.rating} size={12} />
            </div>
            {currentReview.feedback && (
              <p className={`text-sm leading-relaxed ${subtextClass}`}>
                &ldquo;{currentReview.feedback}&rdquo;
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // Cards layout
  return (
    <div className={`rounded-2xl p-6 ${containerClass}`}>
      {/* Summary */}
      <div className="flex items-center gap-2 mb-4">
        <StarRating rating={Math.round(avgRating)} />
        <span className={`text-sm font-semibold ${subtextClass}`}>
          {avgRating.toFixed(1)} ({reviews.length} review{reviews.length !== 1 ? 's' : ''})
        </span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {reviews.map((review) => (
          <div
            key={review.id}
            className={`rounded-xl border p-4 transition-shadow hover:shadow-md ${cardClass}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    isDark ? 'bg-gray-700 text-gray-200' : 'bg-primary/10 text-primary'
                  }`}
                >
                  {review.client_first_name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <p className="text-sm font-semibold">{review.client_first_name}</p>
              </div>
              <StarRating rating={review.rating} size={11} />
            </div>
            {review.feedback && (
              <p className={`text-xs leading-relaxed line-clamp-3 ${subtextClass}`}>
                &ldquo;{review.feedback}&rdquo;
              </p>
            )}
            <p className={`text-[10px] mt-2 ${tertiaryClass}`}>
              {formatReviewDate(review.submitted_at, t.reviews, language)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
