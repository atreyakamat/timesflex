import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, useTheme, type Palette } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export const Icon = Ionicons;

const tap = () => {
  if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
};

export const useWide = () => useWindowDimensions().width >= 900;

/* ---------- Background ---------- */

/** Soft colour blobs drifting behind glass surfaces. */
export function Background() {
  const { c } = useTheme();
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 14000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 14000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);
  const move = (x: number, y: number) => ({
    transform: [
      { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, x] }) },
      { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, y] }) },
    ],
  });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, overflow: 'hidden' }]}>
      <Animated.View style={[styles.blob, { backgroundColor: c.blob[0], opacity: c.blobOpacity, top: -320, left: '15%' }, move(50, 20)]} />
      <Animated.View style={[styles.blob, { backgroundColor: c.blob[1], opacity: c.blobOpacity * 0.6, top: -300, right: '-10%' }, move(-40, 30)]} />
      {Platform.OS !== 'web' && <BlurView intensity={60} tint={c.name} style={StyleSheet.absoluteFill} />}
      {Platform.OS === 'web' && <View style={[StyleSheet.absoluteFill, { backdropFilter: 'blur(110px)' } as ViewStyle]} />}
    </View>
  );
}

/* ---------- Layout ---------- */

export function Screen({
  children,
  scroll = true,
  padded = true,
  edges = ['top'],
  bottomSpace = 0,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: ('top' | 'bottom')[];
  bottomSpace?: number;
}) {
  const wide = useWide();
  const body = (
    <View style={[{ width: '100%', maxWidth: 1120, alignSelf: 'center' }, padded && { padding: wide ? space.xxl : space.lg }, { paddingBottom: (padded ? space.xl : 0) + bottomSpace }]}>
      {children}
    </View>
  );
  return (
    <View style={{ flex: 1 }}>
      <Background />
      <SafeAreaView edges={edges} style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          {scroll ? (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
              {body}
            </ScrollView>
          ) : (
            body
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

export function Row({ children, gap = space.sm, wrap = false, align = 'center', style }: { children: ReactNode; gap?: number; wrap?: boolean; align?: ViewStyle['alignItems']; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: align, gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

export function Gap({ size = space.md }: { size?: number }) {
  return <View style={{ height: size, width: size }} />;
}

/* ---------- Text ---------- */

type Variant = 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'eyebrow' | 'label' | 'mono';

const textStyle = (variant: Variant, c: Palette): TextStyle => {
  switch (variant) {
    case 'display':
      return { fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: -1.2, color: c.text };
    case 'h1':
      return { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, color: c.text };
    case 'h2':
      return { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.3, color: c.text };
    case 'h3':
      return { fontSize: 16, lineHeight: 22, fontWeight: '700', color: c.text };
    case 'small':
      return { fontSize: 13, lineHeight: 18, color: c.muted };
    case 'eyebrow':
      return { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: c.accent };
    case 'label':
      return { fontSize: 13, fontWeight: '600', color: c.text2 };
    case 'mono':
      return { fontSize: 12, color: c.muted, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) };
    default:
      return { fontSize: 15, lineHeight: 22, color: c.text2 };
  }
};

export function T({ children, v = 'body', style, numberOfLines, color }: { children: ReactNode; v?: Variant; style?: StyleProp<TextStyle>; numberOfLines?: number; color?: string }) {
  const { c } = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[textStyle(v, c), color ? { color } : null, style]}>
      {children}
    </Text>
  );
}

/* ---------- Surfaces ---------- */

export function Card({ children, style, onPress, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: 'warn' | 'danger' | 'ok' | 'accent' }) {
  const { c } = useTheme();
  const tint = tone === 'warn' ? c.warnSoft : tone === 'danger' ? c.dangerSoft : tone === 'ok' ? c.okSoft : tone === 'accent' ? c.accentSoft : c.glass;
  const border = tone === 'warn' ? c.warn : tone === 'danger' ? c.danger : tone === 'ok' ? c.ok : c.glassBorder;
  const card = [
    styles.card,
    {
      backgroundColor: tint,
      borderColor: tone ? `${border}55` : border,
      shadowColor: c.shadow,
    },
    style,
  ];
  if (!onPress) return <View style={card}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [card, pressed && { transform: [{ scale: 0.985 }], opacity: 0.95 }]}
    >
      {children}
    </Pressable>
  );
}

export function Gradient({ children, style, colors }: { children?: ReactNode; style?: StyleProp<ViewStyle>; colors?: [string, string, ...string[]] }) {
  const { c } = useTheme();
  return (
    <LinearGradient colors={colors ?? c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={style}>
      {children}
    </LinearGradient>
  );
}

/* ---------- Buttons ---------- */

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  size = 'md',
  disabled,
  loading,
  style,
  full,
}: {
  label: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  full?: boolean;
}) {
  const { c } = useTheme();
  const pad = size === 'sm' ? { paddingVertical: 8, paddingHorizontal: 12 } : size === 'lg' ? { paddingVertical: 16, paddingHorizontal: 24 } : { paddingVertical: 12, paddingHorizontal: 18 };
  const fontSize = size === 'sm' ? 13 : size === 'lg' ? 17 : 15;
  const fg = kind === 'primary' ? c.onPrimary : kind === 'danger' ? '#FFFFFF' : kind === 'ghost' ? c.text2 : c.text;
  const content = (
    <Row gap={8} style={{ justifyContent: 'center' }}>
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon ? <Icon name={icon} size={fontSize + 3} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize }}>{label}</Text>
    </Row>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled || loading}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        { borderRadius: radius.md, overflow: 'hidden', opacity: disabled ? 0.45 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        full && { alignSelf: 'stretch' },
        style,
      ]}
    >
      {kind === 'primary' ? (
        <View style={[pad, { backgroundColor: c.primary, borderRadius: radius.md }]}>{content}</View>
      ) : (
        <View
          style={[
            pad,
            kind === 'secondary' && { backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md },
            kind === 'danger' && { backgroundColor: c.danger },
          ]}
        >
          {content}
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, size = 22, color }: { icon: IconName; onPress: () => void; label: string; size?: number; color?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.glassBorder },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon name={icon} size={size} color={color ?? c.text} />
    </Pressable>
  );
}

/* ---------- Inputs ---------- */

export function Chip({ label, active, onPress, icon, tone }: { label: string; active?: boolean; onPress?: () => void; icon?: IconName; tone?: 'danger' | 'ok' }) {
  const { c } = useTheme();
  const bg = active ? (tone === 'danger' ? c.dangerSoft : tone === 'ok' ? c.okSoft : c.primary) : c.glassStrong;
  const fg = active ? (tone === 'danger' ? c.danger : tone === 'ok' ? c.ok : c.onPrimary) : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: bg, borderColor: active ? (tone === 'danger' ? c.danger : tone === 'ok' ? c.ok : c.primary) : c.border },
        pressed && { opacity: 0.8 },
      ]}
    >
      {icon && <Icon name={icon} size={15} color={fg} />}
      <Text style={{ color: fg, fontWeight: '600', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' }) {
  const { c } = useTheme();
  const map = {
    neutral: [c.surface3, c.text2],
    ok: [c.okSoft, c.ok],
    warn: [c.warnSoft, c.warn],
    danger: [c.dangerSoft, c.danger],
    accent: [c.accentSoft, c.accentText],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function Field({ label, hint, style, ...props }: TextInputProps & { label?: string; hint?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label && <T v="label">{label}</T>}
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        style={[
          {
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.glassStrong,
            borderRadius: radius.md,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 16,
            color: c.text,
          },
          style,
        ]}
      />
      {hint && <T v="small">{hint}</T>}
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.surface3, borderRadius: radius.md, padding: 3 }}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap();
              onChange(option.value);
            }}
            style={[{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center' }, on && { backgroundColor: c.surface, shadowColor: c.shadow, shadowOpacity: 0.1, shadowRadius: 6, elevation: 2 }]}
          >
            <Text style={{ fontWeight: '700', color: on ? c.text : c.muted, fontSize: 14 }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ value, onChange, min = 0, max = 999, step = 1, label, unit }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label?: string; unit?: string }) {
  const { c } = useTheme();
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  const btn = (text: string, next: number, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text === '+' ? 'Increase' : 'Decrease'} ${label ?? ''}`}
      disabled={disabled}
      onPress={() => {
        tap();
        set(next);
      }}
      style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : pressed ? 0.6 : 1 })}
    >
      <Text style={{ fontSize: 24, color: c.accent, fontWeight: '600' }}>{text}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 6 }}>
      {label && <T v="label">{label}</T>}
      <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, backgroundColor: c.glassStrong }}>
        {btn('−', value - step, value <= min)}
        <Text style={{ minWidth: 70, textAlign: 'center', fontSize: 20, fontWeight: '700', color: c.text }}>
          {value}
          {unit ? <Text style={{ fontSize: 13, color: c.muted, fontWeight: '500' }}> {unit}</Text> : null}
        </Text>
        {btn('+', value + step, value >= max)}
      </View>
    </View>
  );
}

/* ---------- Bits ---------- */

const hueOf = (name: string) => [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
export const initialsOf = (name: string) =>
  name
    .replace(/^(prof|dr|mr|mrs|ms)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const hue = hueOf(name);
  return (
    <LinearGradient
      colors={[`hsl(${hue}, 22%, 34%)`, `hsl(${(hue + 30) % 360}, 20%, 26%)`]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size * 0.32, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.36 }}>{initialsOf(name)}</Text>
    </LinearGradient>
  );
}

export function Progress({ value, tone }: { value: number; tone?: 'danger' }) {
  const { c } = useTheme();
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surface3, overflow: 'hidden' }}>
      {tone === 'danger' ? (
        <View style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, height: '100%', backgroundColor: c.danger }} />
      ) : (
        <View style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, height: '100%', backgroundColor: c.accent }} />
      )}
    </View>
  );
}

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  const { c } = useTheme();
  return (
    <Card style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, borderStyle: 'dashed' }}>
      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={26} color={c.accent} />
      </View>
      <T v="h3" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {text && <T style={{ textAlign: 'center', maxWidth: 420 }}>{text}</T>}
      {action}
    </Card>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.md }}>
      <T v="h2">{title}</T>
      {action}
    </Row>
  );
}

/** Bottom sheet on phones, centred panel on wide screens. */
export function Sheet({ visible, onClose, children, title }: { visible: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  const { c } = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8,10,20,0.45)' }]} onPress={onClose} />
      <View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, { justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? space.xl : 0 }]}
      >
        <View
          style={{
            width: '100%',
            maxWidth: wide ? 560 : undefined,
            maxHeight: '90%',
            backgroundColor: c.glassStrong,
            borderRadius: radius.xl,
            borderBottomLeftRadius: wide ? radius.xl : 0,
            borderBottomRightRadius: wide ? radius.xl : 0,
            borderWidth: 1,
            borderColor: c.glassBorder,
            overflow: 'hidden',
          }}
        >
          {Platform.OS !== 'web' && <BlurView intensity={80} tint={c.name} style={StyleSheet.absoluteFill} />}
          <View style={{ backgroundColor: c.name === 'dark' ? 'rgba(20,26,40,0.7)' : 'rgba(255,255,255,0.75)' }}>
            {!wide && <View style={{ alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: c.borderStrong, marginTop: 10 }} />}
            <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.md }}>
              <T v="h2" style={{ flex: 1 }}>
                {title ?? ''}
              </T>
              <IconButton icon="close" label="Close" onPress={onClose} />
            </Row>
            <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.lg + insets.bottom, gap: space.md }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  blob: { position: 'absolute', width: 640, height: 520, borderRadius: 320 },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1 },
});
