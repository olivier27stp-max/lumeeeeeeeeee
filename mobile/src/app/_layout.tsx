import '../global.css';

import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider } from '@/lib/auth';
import { MembershipProvider } from '@/lib/membership-context';
import { LanguageProvider } from '@/lib/i18n';
import { asyncPersister, queryClient } from '@/lib/queryClient';
import { installerGestionnaireGlobal } from '@/lib/erreurs';

// Les plantages non rattrapés partent aussi au serveur.
installerGestionnaireGlobal();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LanguageProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: asyncPersister, maxAge: 24 * 60 * 60_000 }}
        onSuccess={() => {
          // Resume any writes that were queued while offline in a previous run.
          queryClient.resumePausedMutations();
        }}
      >
        <AuthProvider>
          <MembershipProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(app)" />
            </Stack>
          </MembershipProvider>
        </AuthProvider>
      </PersistQueryClientProvider>
      </LanguageProvider>
    </GestureHandlerRootView>
  );
}
