import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Avatar } from './d2d/avatar';

export const HEADER_AVATAR_QUERY_KEY = 'header-user-avatar';

interface Props {
  userId: string;
  orgId: string | null;
  /** Fallback label when the profile has no name (usually the email) */
  fallbackName?: string | null;
  language: 'fr' | 'en';
}

/**
 * Current user's photo in the top bar. Same source precedence as the profile
 * page (team_members for this org, then profiles) and the same Dicebear
 * fallback, so the header always matches what the user sees in Settings.
 */
export default function HeaderUserAvatar({ userId, orgId, fallbackName, language }: Props) {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: [HEADER_AVATAR_QUERY_KEY, userId, orgId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [profileRes, memberRes] = await Promise.all([
        supabase.from('profiles').select('full_name, avatar_url').eq('id', userId).maybeSingle(),
        orgId
          ? supabase.from('team_members').select('first_name, last_name, avatar_url').eq('user_id', userId).eq('org_id', orgId).maybeSingle()
          : Promise.resolve({ data: null } as { data: { first_name: string | null; last_name: string | null; avatar_url: string | null } | null }),
      ]);
      const p = profileRes.data;
      const m = memberRes.data;
      const memberName = [m?.first_name, m?.last_name].filter(Boolean).join(' ').trim();
      return {
        avatarUrl: m?.avatar_url || p?.avatar_url || null,
        name: memberName || p?.full_name || '',
      };
    },
  });

  const name = data?.name || fallbackName || '';
  const src = data?.avatarUrl
    || `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(userId || name)}&backgroundColor=f5f5f5&radius=50`;
  const label = language === 'fr' ? 'Mon profil' : 'My profile';

  return (
    <button
      type="button"
      onClick={() => navigate('/settings/profile')}
      title={name ? `${name} · ${label}` : label}
      aria-label={label}
      className="ml-1.5 rounded-full shrink-0 ring-1 ring-border hover:ring-2 hover:ring-text-tertiary/40 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Avatar src={src} name={name || label} size="sm" />
    </button>
  );
}
