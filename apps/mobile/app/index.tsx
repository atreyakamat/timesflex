import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useStore } from '../src/store';
import { useTheme } from '../src/theme';
import { Background, Button, T } from '../src/ui';

/** Entry: the landing page when signed out, onboarding for a brand-new account, else home. */
export default function Index() {
  const { ready, account, isNew, profile, role, paused, institutionId, signOut } = useStore();
  const { c } = useTheme();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Background />
        <ActivityIndicator color={c.accent} size="large" />
      </View>
    );
  }
  if (!account) return <Redirect href="/welcome" />;
  if (paused) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
        <Background />
        <T v="h2" style={{ textAlign: 'center' }}>
          This college’s access is paused
        </T>
        <T style={{ textAlign: 'center', maxWidth: 420 }}>Nothing has been lost. Please contact whoever runs this service.</T>
        <Button label="Sign out" kind="secondary" onPress={() => signOut()} />
      </View>
    );
  }
  if (!institutionId && account.platformAdmin) return <Redirect href="/admin" />;
  if (role === 'teacher') return <Redirect href="/teacher" />;
  if (isNew || (!profile.teachers.length && !profile.subjects.length)) return <Redirect href="/onboarding" />;
  return <Redirect href="/home" />;
}
