import { Redirect } from 'expo-router';

// The canonical Schedule lives in the tabs group (Day/Week/Month + team filter).
// This stale stack route is kept only so existing deep-links to `/schedule`
// resolve to the real screen instead of a dead duplicate.
export default function ScheduleRedirect() {
  return <Redirect href="/(app)/(tabs)/schedule" />;
}
