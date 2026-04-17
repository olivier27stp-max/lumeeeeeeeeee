import { useQuery } from '@tanstack/react-query';
import { checkIsPlatformOwner } from '../lib/platformAdminApi';

export function usePlatformOwner() {
  const { data = false } = useQuery({
    queryKey: ['platform-owner-check'],
    queryFn: checkIsPlatformOwner,
    staleTime: 5 * 60 * 1000, // 5 min — cached aggressively, this rarely changes
    retry: false,
  });
  return data;
}
