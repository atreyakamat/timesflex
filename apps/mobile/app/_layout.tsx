import { Stack, router, usePathname, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StoreProvider, useStore } from '../src/store';
import { ThemeProvider, space, useTheme } from '../src/theme';
import { Background, Button, Icon, T, ToastProvider } from '../src/ui';

/** If a screen ever crashes, offer a way back instead of a blank page. Saved work is on the server. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Oops retry={retry} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Oops({ retry }: { retry: () => Promise<void> }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md }}>
      <Icon name="refresh-circle-outline" size={48} color={c.accent} />
      <T v="h2" style={{ textAlign: 'center' }}>
        Something went wrong on this screen
      </T>
      <T style={{ textAlign: 'center', maxWidth: 420 }}>Your saved work is safe. Try again, and if it keeps happening, restart the app.</T>
      <Button label="Try again" onPress={retry} />
    </View>
  );
}

const PUBLIC = ['/', '/welcome', '/auth', '/privacy', '/join', '/checkin'];

/** Screens that need an account go to the start page without one. */
function SignedOutGuard() {
  const { account } = useStore();
  const path = usePathname();
  useEffect(() => {
    if (!account && !PUBLIC.includes(path)) router.replace('/welcome');
  }, [account, path]);
  return null;
}

/** Shown instead of the app while loading, and if the server can't be reached. The login is kept. */
function Loading() {
  const { loadError, retryLoad, dismissLoadError } = useStore();
  const { c } = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md }]}>
      <Background />
      {loadError ? (
        <>
          <Icon name="cloud-offline-outline" size={44} color={c.accent} />
          <T v="h2" style={{ textAlign: 'center' }}>
            Can’t reach the server
          </T>
          <T style={{ textAlign: 'center', maxWidth: 420 }}>You’re still signed in and nothing is lost. Check your connection and try again.</T>
          <Button label="Try again" icon="refresh" onPress={retryLoad} />
          <Button label="Go to the start page" kind="ghost" onPress={dismissLoadError} />
        </>
      ) : (
        <ActivityIndicator color={c.accent} size="large" />
      )}
    </View>
  );
}

function Shell() {
  const { c } = useTheme();
  const { ready, loadError } = useStore();
  // Screens choose their defaults as they start, from saved data, so they must not start until
  // it's here. Otherwise Attendance picks no class, and setup reopens at the first step.
  if (!ready || loadError) return <Loading />;
  return (
    <>
      <StatusBar style={c.name === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'fade' }}>
        <Stack.Screen name="assistant" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
      <SignedOutGuard />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StoreProvider>
          <ToastProvider>
            <Shell />
          </ToastProvider>
        </StoreProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
