import { useLocalSearchParams } from 'expo-router';

import { RepProfileView } from '@/components/RepProfileView';

export default function RepProfile() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return <RepProfileView userId={String(id)} name={typeof name === 'string' ? name : undefined} />;
}
