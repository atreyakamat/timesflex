import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { StoreProvider } from '../src/store';
import { ThemeProvider, space, useTheme } from '../src/theme';
import { Button, Icon, T, ToastProvider } from '../src/ui';

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

function Shell() {
  const { c } = useTheme();
  return (
    <>
      <StatusBar style={c.name === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'fade' }}>
        <Stack.Screen name="assistant" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
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
