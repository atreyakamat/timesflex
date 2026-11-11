import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { api, changeServer } from '../src/api';
import { useStore } from '../src/store';
import { radius, space, useTheme } from '../src/theme';
import { Button, Card, Field, Gradient, Icon, IconButton, Row, Screen, T, type IconName } from '../src/ui';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'grid-outline', title: 'Set up in minutes', text: 'Tap your years and branches, add each subject once, and link who teaches it. No spreadsheets.' },
  { icon: 'flask-outline', title: 'Labs and batches, handled', text: 'Practicals run per batch in parallel, in a lab that seats them, never split by lunch.' },
  { icon: 'git-compare-outline', title: 'Many versions to choose from', text: 'Compact days, fewer teacher days, late starts… compare them side by side and keep the best.' },
  { icon: 'paper-plane-outline', title: 'Nobody gets missed', text: 'Change a class or room, and it works out who is affected, writes their message, and tracks who has been told.' },
  { icon: 'help-buoy-outline', title: 'Explains every choice', text: 'Tap any class to see why it is there, and where else it could go.' },
  { icon: 'swap-horizontal-outline', title: 'Cover in one tap', text: 'Someone is out? Fair substitutes are picked automatically and told on WhatsApp.' },
];

const STEPS = [
  ['Create your institution', 'A name, your e-mail and a password. One minute.'],
  ['Add your classes and subjects', 'Tap your years and branches. Add each subject once, and link who teaches it.'],
  ['Pick your favourite version', 'Three clash-free timetables in under a minute. Compare, approve, share.'],
];

const PREVIEW = [
  ['Maths', 'DBMS', 'OS', 'Maths', 'Data Str.'],
  ['OS', 'Data Str.', 'Maths', 'DBMS', 'OS'],
  ['DBMS', 'Maths', 'DBMS Lab', 'Data Str.', 'Networks'],
  ['Networks', 'OS', 'DBMS Lab', 'Networks', 'DBMS'],
];
const hueFor = (name: string) => [...name].reduce((sum, ch) => sum + ch.charCodeAt(0) * 7, 0) % 360;

/** What the product makes: a real-looking week. */
function Preview() {
  const { c } = useTheme();
  return (
    <Card style={{ width: '100%', maxWidth: 520, gap: 6, padding: space.md }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 6 }}>
        <T v="h3">SY Comp A</T>
        <Row gap={6}>
          <Icon name="checkmark-circle" size={16} color={c.ok} />
          <T v="small">No clashes</T>
        </Row>
      </Row>
      <Row gap={6}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day) => (
          <T key={day} v="small" style={{ flex: 1, textAlign: 'center' }}>
            {day}
          </T>
        ))}
      </Row>
      {PREVIEW.map((row, i) => (
        <Row key={i} gap={6}>
          {row.map((name, j) => (
            <View key={j} style={{ flex: 1, minWidth: 0, paddingVertical: 12, paddingHorizontal: 4, borderRadius: radius.sm, borderLeftWidth: 3, borderLeftColor: `hsl(${hueFor(name)}, ${c.tile.edgeSat}%, ${c.tile.edgeLight}%)`, backgroundColor: `hsla(${hueFor(name)}, ${c.tile.sat}%, ${c.tile.light}%, ${c.tile.alpha * 1.5})` }}>
              <T v="small" numberOfLines={1} style={{ color: c.text, fontSize: 12, textAlign: 'center' }}>
                {name}
              </T>
            </View>
          ))}
        </Row>
      ))}
    </Card>
  );
}

/** Phone app only: which server it talks to. The address changes between networks. */
function ServerAddress() {
  const { c } = useTheme();
  const [address, setAddress] = useState(api.base());
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (Platform.OS === 'web') return null;
  if (!editing) {
    return (
      <Row gap={8} wrap>
        <T v="small">Server: {api.base()}</T>
        <Button label="Change" kind="ghost" size="sm" onPress={() => setEditing(true)} />
      </Row>
    );
  }
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      setAddress(await changeServer(address));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach that server.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card style={{ gap: space.sm }}>
      <Field label="Server address" value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.1.20:8080" />
      {error ? <T color={c.danger}>{error}</T> : null}
      <Row gap={8}>
        <Button label="Save" size="sm" loading={saving} disabled={!address.trim()} onPress={save} />
        <Button label="Cancel" kind="ghost" size="sm" onPress={() => setEditing(false)} />
      </Row>
    </Card>
  );
}

export default function Welcome() {
  const { account, ready, startDemo: openDemo } = useStore();
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState('');

  /** One tap for a pitch: a throwaway account made by the server, a full sample college, three versions. */
  const startDemo = async () => {
    setDemoBusy(true);
    setDemoError('');
    try {
      await openDemo();
      router.replace('/onboarding?demo=1');
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : 'Could not start the demo.');
      setDemoBusy(false);
    }
  };
  const { c, toggle } = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  // While the demo is being prepared, its own screen takes over instead of the usual redirect.
  if (ready && account && !demoBusy) return <Redirect href="/" />;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.xl }}>
        <Row gap={10}>
          <Gradient style={{ width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
            <T v="h3" color="#fff">
              TF
            </T>
          </Gradient>
          <T v="h2">TimeFlex</T>
        </Row>
        <Row gap={8}>
          <IconButton icon={c.name === 'dark' ? 'sunny-outline' : 'moon-outline'} label="Switch theme" onPress={toggle} />
          {wide && <Button label="Sign in" kind="ghost" onPress={() => router.push('/auth?mode=signin')} />}
        </Row>
      </Row>

      <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: 'center', gap: space.xxl }}>
        <View style={{ flex: wide ? 1 : undefined, gap: space.lg }}>
          <View style={{ alignSelf: 'flex-start', backgroundColor: c.glassStrong, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: c.glassBorder }}>
            <T v="label">For the faculty member who plans it all</T>
          </View>
          <T v="display" style={{ fontSize: wide ? 56 : 40, lineHeight: wide ? 60 : 44 }}>
            Your college’s timetable,{'\n'}
            <T v="display" color={c.accent} style={{ fontSize: wide ? 56 : 40, lineHeight: wide ? 60 : 44 }}>
              planned with you.
            </T>
          </T>
          <T style={{ fontSize: 17, lineHeight: 26, maxWidth: 520 }}>
            Add your classes, subjects and teachers. TimeFlex builds clash-free timetables to choose from, and tells the right
            teachers when something changes.
          </T>
          <Row gap={12} wrap>
            <Button label="Try the live demo" icon="play" size="lg" onPress={startDemo} loading={demoBusy} />
            <Button label="Create your account" kind="secondary" size="lg" onPress={() => router.push('/auth?mode=signup')} />
          </Row>
          {demoError ? <T color={c.danger}>{demoError}</T> : null}
          <ServerAddress />
          <Row gap={16} wrap>
            {['No clashes, ever', 'Labs in batches', 'Explains every choice'].map((item) => (
              <Row key={item} gap={6}>
                <Icon name="checkmark-circle" size={16} color={c.ok} />
                <T v="small">{item}</T>
              </Row>
            ))}
          </Row>
        </View>
        <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%', alignItems: 'center' }}>
          <Preview />
        </View>
      </View>

      <View style={{ marginTop: space.xxl * 2, gap: space.lg }}>
        <T v="eyebrow">Why coordinators like it</T>
        <T v="h1">Less juggling. More time for teaching.</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {FEATURES.map((feature) => (
            <Card key={feature.title} style={{ width: wide ? '32%' : '100%', flexGrow: 1, gap: space.sm }}>
              <Gradient style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={feature.icon} size={22} color="#fff" />
              </Gradient>
              <T v="h3">{feature.title}</T>
              <T>{feature.text}</T>
            </Card>
          ))}
        </View>
      </View>

      <View style={{ marginTop: space.xxl * 2, gap: space.lg }}>
        <T v="eyebrow">How it works</T>
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.md }}>
          {STEPS.map(([title, text], index) => (
            <Card key={title} style={{ flex: 1, gap: space.sm }}>
              <Gradient style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
                <T v="h3" color="#fff">
                  {String(index + 1)}
                </T>
              </Gradient>
              <T v="h3">{title}</T>
              <T>{text}</T>
            </Card>
          ))}
        </View>
      </View>

      <Gradient style={{ marginTop: space.xxl * 2, borderRadius: radius.xl, padding: space.xxl, alignItems: 'center', gap: space.md }}>
        <T v="h1" color="#fff" style={{ textAlign: 'center' }}>
          Plan this semester in one sitting.
        </T>
        <T color="rgba(255,255,255,0.85)" style={{ textAlign: 'center' }}>
          Add your teachers, and get three clash-free timetables to choose from.
        </T>
        <Button label="Create your account" kind="secondary" size="lg" onPress={() => router.push('/auth?mode=signup')} />
      </Gradient>
      <Pressable accessibilityRole="link" onPress={() => router.push('/privacy')} style={{ alignSelf: 'center', marginTop: space.lg, padding: space.sm }}>
        <T v="small">Your data</T>
      </Pressable>
    </Screen>
  );
}
