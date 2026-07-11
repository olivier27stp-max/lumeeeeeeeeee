import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

import { SecureStorageAdapter } from './secureStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy mobile/.env.example to mobile/.env.local and fill in values.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Encrypted keystore (iOS Keychain / Android Keystore), chunked to clear
    // SecureStore's ~2KB/value limit. Never the plaintext AsyncStorage file.
    storage: SecureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // PKCE is required for the mobile OAuth (Google) code-exchange flow.
    flowType: 'pkce',
  },
});

// React Native doesn't run the token auto-refresh timer on its own — drive it
// from the app's foreground/background state so access tokens never go stale
// (a stale token is what caused server calls to fail with "invalid auth token").
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
supabase.auth.startAutoRefresh();
