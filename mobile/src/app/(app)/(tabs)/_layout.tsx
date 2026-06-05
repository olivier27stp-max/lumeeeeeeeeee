import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { isFieldSalesEnabled } from '@/lib/api/fieldSales';
import { usePermissions } from '@/lib/usePermissions';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{label}</Text>
  );
}

export default function TabsLayout() {
  const { can, orgId } = usePermissions();

  // Role-aware tabs: hide a tab (href: null) when the user lacks the permission.
  // Same permission keys as the desktop app, so visibility matches per role.
  const showJobs = can('jobs.read');
  const showClients = can('clients.read');
  const showTime = can('timesheets.update');

  // D2D tab only when the user has the permission AND the org enabled the module.
  const { data: d2dEnabled } = useQuery({
    queryKey: ['field-settings', 'enabled', orgId],
    queryFn: () => isFieldSalesEnabled(orgId ?? ''),
    enabled: !!orgId && can('door_to_door.access'),
  });
  const showD2D = can('door_to_door.access') && d2dEnabled === true;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#208AEF',
        tabBarInactiveTintColor: '#64748B',
        tabBarStyle: {
          borderTopColor: '#E2E8F0',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          href: showJobs ? undefined : null,
          tabBarIcon: ({ focused }) => <TabIcon label="🗓️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: 'Clients',
          href: showClients ? undefined : null,
          tabBarIcon: ({ focused }) => <TabIcon label="👥" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="time"
        options={{
          title: 'Time',
          href: showTime ? undefined : null,
          tabBarIcon: ({ focused }) => <TabIcon label="⏱️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="d2d"
        options={{
          title: 'Map',
          href: showD2D ? undefined : null,
          tabBarIcon: ({ focused }) => <TabIcon label="🗺️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon label="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
