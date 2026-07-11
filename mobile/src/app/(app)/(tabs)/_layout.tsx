import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import { SymbolView, SymbolViewProps } from 'expo-symbols';
import { ColorValue } from 'react-native';

import { isFieldSalesEnabled } from '@/lib/api/fieldSales';
import { usePermissions } from '@/lib/usePermissions';
import { usePlanFeature } from '@/lib/usePlanFeature';
import { useViewMode } from '@/lib/view-mode';

// Monochrome SF Symbols — they take the tab tint (black active / grey inactive).
function TabIcon({ name, color }: { name: SymbolViewProps['name']; color: ColorValue }) {
  return <SymbolView name={name} tintColor={color} size={26} resizeMode="scaleAspectFit" />;
}

export default function TabsLayout() {
  const { can, orgId } = usePermissions();
  const { mode } = useViewMode();
  const sales = mode === 'sales';

  // Role-aware tabs: hide a tab (href: null) when the user lacks the permission.
  const showJobs = can('jobs.read');
  const showTime = can('timesheets.update');

  const { data: d2dEnabled } = useQuery({
    queryKey: ['field-settings', 'enabled', orgId],
    queryFn: () => isFieldSalesEnabled(orgId ?? ''),
    enabled: !!orgId && can('door_to_door.access'),
  });

  // Plan gating (parity with the web): D2D is an Autopilot feature, training
  // courses are Scale+. Without the plan flag the tab is hidden, same as web.
  const hasD2D = usePlanFeature('includes_d2d').hasFeature;
  const hasCourses = usePlanFeature('includes_courses').hasFeature;

  const showD2D = can('door_to_door.access') && d2dEnabled === true && hasD2D;
  // The Map tab: tech mode needs the D2D module + permission + plan; sales mode
  // is the D2D persona, so it just needs the plan.
  const showMap = sales ? hasD2D : showD2D;

  // Sales mode bottom tabs (Enzy-style): Classement · Map · Profil · More.
  return (
    <Tabs
      initialRouteName={sales ? 'sales-leaderboard' : 'index'}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#171717',
        tabBarInactiveTintColor: '#A3A3A3',
        tabBarStyle: { borderTopColor: '#E5E5E5' },
      }}
    >
      {/* ── Sales-mode: Classement (landing) ── */}
      <Tabs.Screen
        name="sales-leaderboard"
        options={{
          title: 'Classement',
          href: sales ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="trophy" color={color} />,
        }}
      />

      {/* ── Tech-mode tabs ── */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          href: sales ? null : showJobs ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="house" color={color} />,
        }}
      />
      <Tabs.Screen
        name="sales-stats"
        options={{ href: null /* replaced by Classement + Profil in sales mode */ }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: sales ? 'Horaire' : 'Schedule',
          // Visible in sales mode (reps' appointments) and in tech mode (with jobs).
          href: sales || showJobs ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen name="clients" options={{ href: null }} />
      <Tabs.Screen
        name="time"
        options={{
          title: 'Time',
          href: !sales && showTime ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="clock" color={color} />,
        }}
      />
      <Tabs.Screen
        name="formations"
        options={{
          title: 'Learn',
          href: !sales && hasCourses ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="graduationcap" color={color} />,
        }}
      />

      {/* ── Map (both modes) ── */}
      <Tabs.Screen
        name="d2d"
        options={{
          title: 'Map',
          href: showMap ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="map" color={color} />,
        }}
      />

      {/* ── Sales-mode: Profil ── */}
      <Tabs.Screen
        name="sales-profile"
        options={{
          title: 'Profil',
          href: sales ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="person.crop.circle" color={color} />,
        }}
      />

      {/* ── More (both modes) — the "3 bars" menu ── */}
      <Tabs.Screen
        name="profile"
        options={{
          title: 'More',
          tabBarIcon: ({ color }) => <TabIcon name="line.3.horizontal" color={color} />,
        }}
      />
    </Tabs>
  );
}
