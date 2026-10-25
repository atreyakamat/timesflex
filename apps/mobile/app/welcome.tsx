import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, useWindowDimensions } from 'react-native';
import { useStore } from '../src/store';
import { radius, space, useTheme } from '../src/theme';
import { Button, Card, Gradient, Icon, IconButton, Row, Screen, T, type IconName } from '../src/ui';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'chatbubble-ellipses-outline', title: 'An assistant that sets it up', text: 'Answer a few friendly questions or just type “Mehta is away Friday”. It shows the change and you approve.' },
  { icon: 'flask-outline', title: 'Labs and batches, handled', text: 'Practicals run per batch in parallel, in a lab that seats them, never split by lunch.' },
  { icon: 'git-compare-outline', title: 'Many versions to choose from', text: 'Compact days, fewer teacher days, late starts… compare them side by side and keep the best.' },
  { icon: 'bulb-outline', title: 'It learns your taste', text: 'Every version you pick and class you move teaches it what you like. The next week fits you better.' },
  { icon: 'help-buoy-outline', title: 'Explains every choice', text: 'Tap any class to see why it is there, and where else it could go.' },
  { icon: 'swap-horizontal-outline', title: 'Cover in one tap', text: 'Someone is out? Fair substitutes are picked automatically and told on WhatsApp.' },
];

const STEPS = [
  ['Create your account', 'One account for your department. A minute.'],
  ['Answer a few questions', 'Days, classes, teachers, rooms, subjects. The assistant fills the rest.'],
  ['Pick your favourite version', 'Generate several, compare, approve, share.'],
];

/** A stack of tilted glass timetable cards that slowly turn, with school icons orbiting. */
function Stage({ size }: { size: number }) {
  const { c } = useTheme();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 12000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t]);
  const sway = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-12deg', '12deg', '-12deg'] });
  const bob = (phase: number, amp: number) =>
    t.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, amp * Math.sin(phase + 1.5), 0, -amp * Math.sin(phase + 1.5), 0] });
  const tones = [230, 35, 160, 270, 350].map((h) => `hsla(${h}, ${c.tile.sat + 10}%, ${c.tile.light}%, ${c.tile.alpha * 3})`);
  const card = (depth: number, opacity: number) => (
    <Animated.View
      key={depth}
      style={{
        position: 'absolute',
        width: size * 0.78,
        height: size * 0.56,
        borderRadius: radius.xl,
        backgroundColor: c.glassStrong,
        borderWidth: 1,
        borderColor: c.glassBorder,
        opacity,
        padding: 14,
        shadowColor: c.shadow,
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 16 },
        elevation: 6,
        transform: [{ perspective: 900 }, { translateY: depth * -26 }, { translateX: depth * 18 }, { rotateX: '28deg' }, { rotateZ: '-8deg' }, { rotateY: sway }],
      }}
    >
      <Row gap={6} style={{ marginBottom: 8 }}>
        {['M', 'T', 'W', 'T', 'F'].map((d, i) => (
          <T key={i} v="small" style={{ flex: 1, textAlign: 'center', fontWeight: '700' }}>
            {d}
          </T>
        ))}
      </Row>
      {[0, 1, 2, 3].map((row) => (
        <Row key={row} gap={6} style={{ marginBottom: 6 }}>
          {[0, 1, 2, 3, 4].map((col) => (
            <View
              key={col}
              style={{ flex: 1, height: size * 0.07, borderRadius: 8, backgroundColor: (row * 2 + col + depth) % 4 === 0 ? c.surface3 : tones[(row + col * 2 + depth) % 5], opacity: 0.85 }}
            />
          ))}
        </Row>
      ))}
    </Animated.View>
  );
  const badge = (icon: IconName, x: number, y: number, phase: number) => (
    <Animated.View
      key={icon}
      style={{ position: 'absolute', left: x * size, top: y * size, transform: [{ translateY: bob(phase, 12) }] }}
    >
      <Gradient style={{ width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={26} color="#fff" />
      </Gradient>
    </Animated.View>
  );
  return (
    <View style={{ width: size, height: size * 0.9, alignItems: 'center', justifyContent: 'center' }}>
      {[2, 1, 0].map((depth) => card(depth, depth === 0 ? 1 : 0.6 - depth * 0.15))}
      {badge('school', 0.02, 0.08, 0)}
      {badge('book', 0.82, 0.12, 2)}
      {badge('calculator', 0.86, 0.66, 4)}
      {badge('flask', 0.04, 0.7, 1)}
      <Animated.View style={{ position: 'absolute', bottom: 0, transform: [{ translateY: bob(3, 6) }] }}>
        <Card style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
          <Row gap={8}>
            <Icon name="checkmark-circle" size={18} color={c.ok} />
            <T v="label">48 classes placed · 0 clashes</T>
          </Row>
        </Card>
      </Animated.View>
    </View>
  );
}

export default function Welcome() {
  const { account, ready, signUp } = useStore();
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState('');

  /** One tap for a pitch: a throwaway account, a full sample college, three versions. */
  const startDemo = async () => {
    setDemoBusy(true);
    setDemoError('');
    try {
      const id = Math.random().toString(36).slice(2, 10);
      await signUp({
        institutionName: 'Demo College of Engineering',
        institutionType: 'college',
        name: 'Prof. Demo',
        email: `demo-${id}@demo.timeflex.app`,
        password: `demo-${id}-${Math.random().toString(36).slice(2)}`,
      });
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
  const stage = Math.min(wide ? 520 : width - 32, 560);

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
            Your department’s timetable,{'\n'}
            <T v="display" color={c.accent} style={{ fontSize: wide ? 56 : 40, lineHeight: wide ? 60 : 44 }}>
              planned with you.
            </T>
          </T>
          <T style={{ fontSize: 17, lineHeight: 26, maxWidth: 520 }}>
            Tell TimeFlex about your teachers, classes and rooms in plain words. It builds clash-free versions, explains every
            choice, and learns how you like your week.
          </T>
          <Row gap={12} wrap>
            <Button label="Try the live demo" icon="play" size="lg" onPress={startDemo} loading={demoBusy} />
            <Button label="Create your account" kind="secondary" size="lg" onPress={() => router.push('/auth?mode=signup')} />
          </Row>
          {demoError ? <T color={c.danger}>{demoError}</T> : null}
          <Row gap={16} wrap>
            {['No clashes, ever', 'Labs in batches', 'Explains every choice'].map((item) => (
              <Row key={item} gap={6}>
                <Icon name="checkmark-circle" size={16} color={c.ok} />
                <T v="small">{item}</T>
              </Row>
            ))}
          </Row>
        </View>
        <Stage size={stage} />
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
          Runs on your own server. Your data never leaves the college.
        </T>
        <Button label="Create your account" kind="secondary" size="lg" onPress={() => router.push('/auth?mode=signup')} />
      </Gradient>
    </Screen>
  );
}
