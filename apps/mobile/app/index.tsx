import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useStore } from '../src/store';
import { useTheme } from '../src/theme';
import { Background } from '../src/ui';

/** Entry: the landing page when signed out, onboarding for a brand-new account, else home. */
export default function Index() {
  const { ready, account, isNew, profile } = useStore();
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
  if (isNew || (!profile.teachers.length && !profile.subjects.length)) return <Redirect href="/onboarding" />;
  return <Redirect href="/home" />;
}
