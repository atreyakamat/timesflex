import { Redirect, Tabs, router, usePathname } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../../src/store';
import { radius, space, useTheme } from '../../src/theme';
import { Avatar, Gradient, Icon, T, useWide, type IconName } from '../../src/ui';

const TABS: { name: string; title: string; icon: IconName; wideOnly?: boolean }[] = [
  { name: 'home', title: 'Home', icon: 'home-outline' },
  { name: 'timetable', title: 'Timetable', icon: 'grid-outline' },
  { name: 'today', title: 'Today', icon: 'time-outline', wideOnly: true },
  { name: 'cover', title: 'Cover', icon: 'swap-horizontal-outline', wideOnly: true },
  { name: 'students', title: 'Students', icon: 'people-outline' },
  { name: 'updates', title: 'Updates', icon: 'paper-plane-outline' },
  { name: 'more', title: 'More', icon: 'apps-outline' },
];

function Badge({ count }: { count: number }) {
  const { c } = useTheme();
  if (!count) return null;
  return (
    <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: c.danger }}>
      <Text accessibilityLabel={`${count} waiting`} style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  );
}

/** Always visible when work isn't reaching the server, on phones too. */
function SaveWarning() {
  const { saveState } = useStore();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  if (saveState !== 'error') return null;
  return (
    <View style={{ position: 'absolute', top: insets.top + 8, alignSelf: 'center', zIndex: 10, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: c.danger, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 14 }}>
      <Icon name="cloud-offline-outline" size={16} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Not saved yet. Trying again…</Text>
    </View>
  );
}

/** Bottom tabs on phones, a side rail on wide screens; the assistant button floats above both. */
function TabBar({ state, navigation }: { state: { index: number; routes: { name: string; key: string }[] }; navigation: { navigate: (name: string) => void } }) {
  const { c } = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const { account, profile, saveState, pendingUpdate, liveVersion } = useStore();
  const active = state.routes[state.index]?.name;
  const waiting = liveVersion?.status === 'approved' ? pendingUpdate.recipients.length : 0;

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
              <Text style={{ color: on ? c.text : c.text2, fontWeight: '600', fontSize: 15, flex: 1 }}>{tab.title}</Text>
              {tab.name === 'updates' ? <Badge count={waiting} /> : null}
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
        {TABS.filter((tab) => !tab.wideOnly).map((tab) => {
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
                {tab.name === 'updates' && waiting ? (
                  <View style={{ position: 'absolute', top: -4, right: 0 }}>
                    <Badge count={waiting} />
                  </View>
                ) : null}
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
  const { account, ready, role, paused } = useStore();
  const wide = useWide();
  usePathname();
  if (ready && !account) return <Redirect href="/welcome" />;
  if (role === 'teacher' || paused) return <Redirect href="/" />;
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <TabBar {...(props as any)} />}
        screenOptions={{ headerShown: false, tabBarPosition: wide ? 'left' : 'bottom', sceneStyle: { backgroundColor: 'transparent' }, animation: 'fade', lazy: true }}
      >
        {TABS.map((tab) => (
          <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title }} />
        ))}
      </Tabs>
      <SaveWarning />
    </View>
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
