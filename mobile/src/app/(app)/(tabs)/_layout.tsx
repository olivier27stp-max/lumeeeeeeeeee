import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { usePermissions } from '@/lib/usePermissions';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{label}</Text>
  );
}

export default function TabsLayout() {
  const { can } = usePermissions();

  // Role-aware tabs: hide a tab (href: null) when the user lacks the permission.
  // Same permission keys as the desktop app, so visibility matches per role.
  const showJobs = can('jobs.read');
  const showClients = can('clients.read');

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
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon label="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
