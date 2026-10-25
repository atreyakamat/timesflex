import { Redirect, Tabs, router, usePathname } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../../src/store';
import { radius, space, useTheme } from '../../src/theme';
import { Avatar, Gradient, Icon, T, useWide, type IconName } from '../../src/ui';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'home', title: 'Home', icon: 'sparkles-outline' },
  { name: 'timetable', title: 'Timetable', icon: 'grid-outline' },
  { name: 'today', title: 'Today', icon: 'time-outline' },
  { name: 'cover', title: 'Cover', icon: 'swap-horizontal-outline' },
  { name: 'more', title: 'More', icon: 'apps-outline' },
];

/** Bottom tabs on phones, a side rail on wide screens; the assistant button floats above both. */
function TabBar({ state, navigation }: { state: { index: number; routes: { name: string; key: string }[] }; navigation: { navigate: (name: string) => void } }) {
  const { c } = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const { account, profile, saveState } = useStore();
  const active = state.routes[state.index]?.name;

  if (wide) {
    return (
      <View style={[styles.rail, { backgroundColor: c.glassStrong, borderRightColor: c.glassBorder, paddingTop: insets.top + space.lg }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.md, marginBottom: space.xl }}>
          <Gradient style={styles.logo}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>TF</Text>
          </Gradient>
          <View style={{ flex: 1 }}>
            <T v="h3">TimeFlex</T>
            <T v="small" numberOfLines={1}>
              {profile.institution.name}
            </T>
          </View>
        </View>
        {TABS.map((tab) => {
          const on = active === tab.name;
          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => navigation.navigate(tab.name)}
              style={({ pressed }) => [styles.railItem, on && { backgroundColor: c.surface3 }, pressed && { opacity: 0.7 }]}
            >
              <Icon name={on ? (tab.icon.replace('-outline', '') as IconName) : tab.icon} size={20} color={on ? c.text : c.muted} />
              <Text style={{ color: on ? c.text : c.text2, fontWeight: '600', fontSize: 15 }}>{tab.title}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => router.push('/assistant')} style={{ marginTop: space.lg, marginHorizontal: space.sm }}>
          <View style={[styles.railItem, { borderRadius: radius.md, backgroundColor: c.primary }]}>
            <Icon name="sparkles" size={18} color={c.onPrimary} />
            <Text style={{ color: c.onPrimary, fontWeight: '700', fontSize: 15 }}>Ask TimeFlex</Text>
          </View>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => navigation.navigate('more')} style={[styles.railItem, { marginBottom: insets.bottom + space.md }]}>
          <Avatar name={account?.name ?? '?'} size={32} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontWeight: '700' }} numberOfLines={1}>
              {account?.name}
            </Text>
            <T v="small">{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'All saved'}</T>
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={[styles.barWrap, { paddingBottom: insets.bottom + 8 }]}>
      <Pressable accessibilityLabel="Ask TimeFlex" onPress={() => router.push('/assistant')} style={styles.fab}>
        <View style={[styles.fabInner, { backgroundColor: c.primary }]}>
          <Icon name="sparkles" size={22} color={c.onPrimary} />
        </View>
      </Pressable>
      <View style={[styles.bar, { borderColor: c.glassBorder, backgroundColor: Platform.OS === 'web' ? (c.name === 'dark' ? 'rgba(18,23,36,0.97)' : 'rgba(255,255,255,0.97)') : 'transparent' }]}>
        {Platform.OS !== 'web' && <BlurView intensity={70} tint={c.name} style={StyleSheet.absoluteFill} />}
        {TABS.map((tab) => {
          const on = active === tab.name;
          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityLabel={tab.title}
              accessibilityState={{ selected: on }}
              onPress={() => navigation.navigate(tab.name)}
              style={styles.barItem}
            >
              <View style={[styles.barIcon, on && { backgroundColor: c.surface3 }]}>
                <Icon name={on ? (tab.icon.replace('-outline', '') as IconName) : tab.icon} size={21} color={on ? c.text : c.muted} />
              </View>
              <Text style={{ fontSize: 11, fontWeight: '700', color: on ? c.text : c.muted }}>{tab.title}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function AppLayout() {
  const { account, ready } = useStore();
  const wide = useWide();
  usePathname();
  if (ready && !account) return <Redirect href="/welcome" />;
  return (
    <Tabs
      tabBar={(props) => <TabBar {...(props as any)} />}
      screenOptions={{ headerShown: false, tabBarPosition: wide ? 'left' : 'bottom', sceneStyle: { backgroundColor: 'transparent' } }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title }} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  rail: { width: 248, borderRightWidth: 1, paddingHorizontal: space.sm },
  logo: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  railItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: space.md, borderRadius: radius.md, marginBottom: 2 },
  barWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, alignItems: 'center' },
  bar: { flexDirection: 'row', width: '100%', maxWidth: 560, borderRadius: 24, borderWidth: 1, overflow: 'hidden', paddingVertical: 6 },
  barItem: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 2 },
  barIcon: { width: 44, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', right: 18, top: -66, zIndex: 2, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  fabInner: { width: 56, height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
