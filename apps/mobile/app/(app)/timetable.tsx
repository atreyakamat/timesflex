import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import {
  VARIANT_STYLES,
  bestBy,
  breaksAfter,
  buildGrid,
  explainSession,
  hasLearned,
  matchesView,
  timetableInsights,
  timetableMetrics,
  type ScheduledSession,
  type TimetableMetrics,
} from '@core';
import { useStore, type GenerateStyle } from '../../src/store';
import { radius, space, useTheme } from '../../src/theme';
import { Button, Card, Chip, Empty, Icon, Pill, Row, Screen, SectionTitle, Segmented, Sheet, T, useWide } from '../../src/ui';

type Kind = 'all' | 'division' | 'teacher' | 'room';

const hue = (id: string) => [...id].reduce((sum, ch) => sum + ch.charCodeAt(0) * 7, 0) % 360;

function SessionTile({ session, view, onPress, compact }: { session: ScheduledSession; view: string; onPress: () => void; compact?: boolean }) {
  const { c } = useTheme();
  const { names, conflicts } = useStore();
  const clash = conflicts.some((x) => x.sessionIds.includes(session.id));
  const h = hue(session.subject_id);
  const dark = c.name === 'dark';
  const bg = clash ? c.dangerSoft : `hsla(${h}, ${c.tile.sat}%, ${c.tile.light}%, ${c.tile.alpha})`;
  const edge = clash ? c.danger : `hsl(${h}, ${c.tile.edgeSat}%, ${c.tile.edgeLight}%)`;
  const [kind] = view.split(':');
  const detail = [
    kind !== 'division' ? `${names[session.division_id]}${session.batch ? ` ${session.batch}` : ''}` : session.batch,
    kind !== 'teacher' ? names[session.teacher_id] : null,
    kind !== 'room' ? names[session.room_id] : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${names[session.subject_id]}, ${detail}. Tap for details`}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: bg,
        borderLeftWidth: 3,
        borderLeftColor: edge,
        borderRadius: 10,
        paddingVertical: compact ? 6 : 10,
        paddingHorizontal: 10,
        opacity: pressed ? 0.75 : 1,
        marginBottom: 4,
      })}
    >
      <Row gap={4}>
        {session.locked && <Icon name="lock-closed" size={11} color={c.text2} />}
        {clash && <Icon name="alert-circle" size={12} color={c.danger} />}
        <T v="label" numberOfLines={compact ? 2 : 1} style={{ color: c.text, flex: 1, fontSize: compact ? 12 : 14 }}>
          {names[session.subject_id]}
        </T>
      </Row>
      <T v="small" numberOfLines={compact ? 2 : 1} style={{ fontSize: compact ? 11 : 13 }}>
        {detail}
        {session.duration_slots > 1 && !compact ? ` · ${session.duration_slots} periods` : ''}
      </T>
    </Pressable>
  );
}

function Compare({ onChoose }: { onChoose: (id: string, shown: string[]) => void }) {
  const { versions, current, profile, slots } = useStore();
  const { c } = useTheme();
  const shown = versions.filter((v) => v.generatedSessions?.length).slice(0, 5);
  if (shown.length < 2) return null;
  const rows = shown.map((v) => ({ id: v.id, version: v, metrics: timetableMetrics(v.generatedSessions, { days: profile.institution.workingDays, slots }) }));
  const best = bestBy(rows);
  const lines: [keyof TimetableMetrics, string][] = [
    ['teacherDays', 'Days teachers come in'],
    ['teacherGaps', 'Teacher waiting gaps'],
    ['classGaps', 'Class free gaps'],
    ['lastPeriod', 'Classes in last period'],
    ['averageFinish', 'Day ends (period)'],
  ];
  return (
    <>
      <SectionTitle title="Compare versions" />
      <T v="small" style={{ marginTop: -space.sm, marginBottom: space.md }}>
        Lower is better on every row; ★ marks the best. Choosing one teaches me what you like.
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md }}>
        {rows.map(({ id, version, metrics }) => {
          const on = current?.id === id;
          return (
            <Card key={id} style={{ width: 230, gap: 8, borderColor: on ? c.primary : c.glassBorder, borderWidth: on ? 1.5 : 1 }}>
              <T v="h3" numberOfLines={1}>
                {version.label.split('·')[1]?.trim() ?? version.label}
              </T>
              <T v="small">{version.label.split('·')[0]}</T>
              {lines.map(([key, label]) => (
                <Row key={key} style={{ justifyContent: 'space-between' }}>
                  <T v="small">{label}</T>
                  <T v="label" color={best[key] === id ? c.ok : c.text}>
                    {String(metrics[key])}
                    {best[key] === id ? ' ★' : ''}
                  </T>
                </Row>
              ))}
              {on ? <Pill label={version.status === 'approved' ? 'Approved' : 'Showing'} tone="ok" /> : <Button label="Choose this" size="sm" onPress={() => onChoose(id, rows.map((r) => r.id))} />}
            </Card>
          );
        })}
      </ScrollView>
    </>
  );
}

export default function Timetable() {
  const store = useStore();
  const { profile, sessions, slots, names, current, versions, problems, conflicts, unplaced, diagnostics } = store;
  const { c } = useTheme();
  const wide = useWide();
  const days = profile.institution.workingDays;
  const [kind, setKind] = useState<Kind>('division');
  const [target, setTarget] = useState<string>('');
  const [day, setDay] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [style, setStyle] = useState<GenerateStyle>('balanced');
  const [picking, setPicking] = useState(false);
  const [variantStyles, setVariantStyles] = useState<GenerateStyle[]>(['balanced', 'compact', 'teacher_days']);

  const options = kind === 'division' ? profile.divisions : kind === 'teacher' ? profile.teachers : kind === 'room' ? profile.rooms : [];
  const targetId = options.find((o) => o.id === target)?.id ?? options[0]?.id ?? '';
  const view = kind === 'all' ? 'all' : `${kind}:${targetId}`;
  const visible = useMemo(() => sessions.filter((s) => matchesView(s, view)), [sessions, view]);
  const grid = useMemo(() => buildGrid(days, slots, visible), [days, slots, visible]);
  const breaks = breaksAfter(slots);
  const opened = sessions.find((s) => s.id === open);
  const insights = timetableInsights(profile, sessions, unplaced.length).filter((i) => i.level !== 'good');
  const styles: { id: GenerateStyle; label: string }[] = [...VARIANT_STYLES.map((s) => ({ id: s.id as GenerateStyle, label: s.label })), ...(hasLearned(profile.learning) ? [{ id: 'yours' as GenerateStyle, label: 'Your style' }] : [])];

  const run = async (job: () => Promise<string>) => {
    setMessage('');
    try {
      setMessage(await job());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  if (!sessions.length) {
    return (
      <Screen bottomSpace={wide ? 0 : 110}>
        <T v="eyebrow">Timetable</T>
        <T v="h1" style={{ marginBottom: space.lg }}>
          Build your week
        </T>
        {problems.length ? (
          <Empty
            icon="construct-outline"
            title="A few things are missing"
            text={problems.slice(0, 3).map((p) => p.replace(/ \([^)]*\)\.?$/, '.')).join(' ')}
            action={<Button label="Let the assistant help" icon="sparkles" onPress={() => router.push('/assistant')} />}
          />
        ) : (
          <Empty
            icon="sparkles-outline"
            title="Ready when you are"
            text="I’ll build three different versions so you can compare and pick the one you like."
            action={<Button label={store.busy ?? 'Build 3 versions'} icon="sparkles" loading={!!store.busy} onPress={() => run(() => store.generateVariants(['balanced', 'compact', 'teacher_days']))} />}
          />
        )}
        {message ? <T style={{ marginTop: space.md }}>{message}</T> : null}
      </Screen>
    );
  }

  const tile = (session: ScheduledSession, compact = false) => <SessionTile key={session.id} session={session} view={view} compact={compact} onPress={() => setOpen(session.id)} />;

  return (
    <Screen bottomSpace={wide ? 0 : 110}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }} wrap gap={12}>
        <View style={{ gap: 4 }}>
          <T v="eyebrow">Timetable</T>
          <T v="h1">{current?.label.split('·')[1]?.trim() ?? 'Your week'}</T>
          <Row gap={8}>
            <Pill label={current?.status === 'approved' ? 'Approved' : 'Draft'} tone={current?.status === 'approved' ? 'ok' : 'neutral'} />
            <Pill label={conflicts.length ? `${conflicts.length} clash${conflicts.length === 1 ? '' : 'es'}` : 'No clashes'} tone={conflicts.length ? 'danger' : 'ok'} />
            {unplaced.length ? <Pill label={`${unplaced.length} not placed`} tone="warn" /> : null}
          </Row>
        </View>
        <Row gap={8} wrap>
          <Button label="New version" icon="refresh" kind="secondary" onPress={() => setPicking(true)} />
          <Button
            label={current?.status === 'approved' ? 'Approved' : 'Approve'}
            icon={current?.status === 'approved' ? 'checkmark-done' : 'checkmark'}
            kind={current?.status === 'approved' ? 'secondary' : 'primary'}
            disabled={!!conflicts.length}
            onPress={() => run(async () => (await store.setApproved(current?.status !== 'approved'), current?.status === 'approved' ? 'Reopened for edits.' : 'Approved. Today, Cover and attendance now use this version.'))}
          />
        </Row>
      </Row>

      {store.busy || message ? (
        <Card tone="accent" style={{ marginTop: space.md, padding: space.md }}>
          <T>{store.busy ?? message}</T>
        </Card>
      ) : null}

      {insights.length > 0 && (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          {insights.slice(0, 2).map((insight) => (
            <Card key={insight.id} style={{ padding: space.md }}>
              <Row gap={10}>
                <Icon name="bulb" size={18} color={c.accent} />
                <View style={{ flex: 1 }}>
                  <T v="label">{insight.title}</T>
                  <T v="small">{insight.detail}</T>
                </View>
                {insight.fix ? <Button label={insight.fix.label} size="sm" kind="secondary" onPress={() => run(async () => (await store.applyAgent(insight.fix!.actions)) ?? 'Done.')} /> : null}
              </Row>
            </Card>
          ))}
        </View>
      )}

      <View style={{ marginTop: space.lg, gap: space.md }}>
        <Segmented
          options={[
            { value: 'division', label: 'Class' },
            { value: 'teacher', label: 'Teacher' },
            { value: 'room', label: 'Room' },
            { value: 'all', label: 'All' },
          ]}
          value={kind}
          onChange={(value) => {
            setKind(value);
            setTarget('');
          }}
        />
        {kind !== 'all' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {options.map((option) => (
              <Chip key={option.id} label={option.name} active={option.id === targetId} onPress={() => setTarget(option.id)} />
            ))}
          </ScrollView>
        )}
      </View>

      {wide ? (
        <Card style={{ marginTop: space.lg, padding: space.sm }}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: 70 }} />
            {days.map((d) => (
              <T key={d} v="label" style={{ flex: 1, textAlign: 'center', paddingVertical: 8 }}>
                {d.slice(0, 3)}
              </T>
            ))}
          </View>
          {slots.map((slot, index) => (
            <View key={slot}>
              <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.border, minHeight: 64 }}>
                <View style={{ width: 70, paddingTop: 8 }}>
                  <T v="label">P{index + 1}</T>
                  <T v="mono">{slot.split('-')[0]}</T>
                </View>
                {days.map((d) => (
                  <View key={d} style={{ flex: 1, padding: 3 }}>
                    {(grid[d]?.[slot] ?? []).map((s) => (s.slot === slot ? tile(s, true) : <View key={s.id} style={{ height: 18, borderRadius: 6, backgroundColor: `hsla(${hue(s.subject_id)},${c.tile.sat}%,${c.tile.light}%,${c.tile.alpha * 0.6})`, marginBottom: 4 }} />))}
                  </View>
                ))}
              </View>
              {breaks.has(index) && (
                <View style={{ backgroundColor: c.surface2, paddingVertical: 4, borderRadius: 8 }}>
                  <T v="small" style={{ textAlign: 'center', fontStyle: 'italic' }}>
                    Break
                  </T>
                </View>
              )}
            </View>
          ))}
        </Card>
      ) : (
        <View style={{ marginTop: space.lg, gap: space.md }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {days.map((d, i) => (
              <Chip key={d} label={d.slice(0, 3)} active={day === i} onPress={() => setDay(i)} />
            ))}
          </ScrollView>
          <Card style={{ gap: 0, padding: space.md }}>
            {slots.map((slot, index) => {
              const d = days[Math.min(day, days.length - 1)];
              const here = (grid[d]?.[slot] ?? []).filter((s) => s.slot === slot);
              return (
                <View key={slot}>
                  <Row align="flex-start" gap={12} style={{ paddingVertical: 8, borderTopWidth: index ? 1 : 0, borderTopColor: c.border }}>
                    <View style={{ width: 48 }}>
                      <T v="label">P{index + 1}</T>
                      <T v="mono">{slot.split('-')[0]}</T>
                    </View>
                    <View style={{ flex: 1 }}>{here.length ? here.map((s) => tile(s)) : <T v="small">Free</T>}</View>
                  </Row>
                  {breaks.has(index) && (
                    <T v="small" style={{ textAlign: 'center', fontStyle: 'italic', paddingVertical: 4 }}>
                      Break
                    </T>
                  )}
                </View>
              );
            })}
          </Card>
        </View>
      )}

      {(unplaced.length > 0 || diagnostics.length > 0) && (
        <Card tone="warn" style={{ marginTop: space.lg, gap: 6 }}>
          <T v="h3">Why some sessions are missing</T>
          {diagnostics.map((d) => (
            <T key={d} v="small">
              • {d}
            </T>
          ))}
        </Card>
      )}

      <Compare onChoose={(id, shown) => store.chooseVersion(id, shown)} />

      {versions.length > 0 && (
        <>
          <SectionTitle title="All versions" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {versions.map((v) => (
              <Chip key={v.id} label={v.label} active={v.id === current?.id} icon={v.status === 'approved' ? 'checkmark-circle' : undefined} onPress={() => store.selectVersion(v.id)} />
            ))}
          </ScrollView>
        </>
      )}

      <Sheet visible={picking} onClose={() => setPicking(false)} title="Build a new version">
        <T>Pick what matters most. The hard rules (no clashes, limits, breaks) are the same for every style.</T>
        {styles.map((s) => {
          const info = VARIANT_STYLES.find((v) => v.id === s.id);
          const on = variantStyles.includes(s.id);
          return (
            <Card key={s.id} onPress={() => setVariantStyles(on ? variantStyles.filter((x) => x !== s.id) : [...variantStyles, s.id])} style={{ borderColor: on ? c.accent : c.glassBorder, borderWidth: on ? 2 : 1 }}>
              <Row gap={10}>
                <Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? c.accent : c.muted} />
                <View style={{ flex: 1 }}>
                  <T v="h3">{s.label}</T>
                  <T v="small">{s.id === 'yours' ? 'Built from what you have picked and moved so far.' : info?.description}</T>
                </View>
              </Row>
            </Card>
          );
        })}
        <Button
          label={variantStyles.length > 1 ? `Build ${variantStyles.length} versions to compare` : 'Build it'}
          icon="sparkles"
          size="lg"
          disabled={!variantStyles.length || problems.length > 0}
          onPress={() => {
            setPicking(false);
            run(() => (variantStyles.length > 1 ? store.generateVariants(variantStyles) : store.generate(variantStyles[0])));
          }}
        />
        <Button
          label="Same style, different week"
          kind="secondary"
          onPress={() => {
            setPicking(false);
            run(() => store.generate(style, true));
          }}
        />
        <Row wrap gap={8}>
          {styles.map((s) => (
            <Chip key={s.id} label={s.label} active={style === s.id} onPress={() => setStyle(s.id)} />
          ))}
        </Row>
      </Sheet>

      <Sheet visible={!!opened} onClose={() => setOpen(null)} title={opened ? names[opened.subject_id] : ''}>
        {opened && <Explain session={opened} onMove={(patch) => store.moveSession(opened.id, patch)} />}
      </Sheet>
    </Screen>
  );
}

function Explain({ session, onMove }: { session: ScheduledSession; onMove: (patch: Partial<ScheduledSession>) => void }) {
  const { profile, sessions, slots, names, conflicts } = useStore();
  const { c } = useTheme();
  const explanation = explainSession(session, {
    days: profile.institution.workingDays,
    slots,
    sessions,
    teachers: profile.teachers,
    rooms: profile.rooms,
    divisions: profile.divisions,
    names,
  });
  const clashes = conflicts.filter((x) => x.sessionIds.includes(session.id));
  return (
    <>
      <T v="h3">{explanation.summary}</T>
      {clashes.map((x, i) => (
        <Card key={i} tone="danger" style={{ padding: space.md }}>
          <T color={c.danger}>{x.message}</T>
        </Card>
      ))}
      <View style={{ gap: 6 }}>
        <T v="label">Why it is here</T>
        {explanation.reasons.map((reason, i) => (
          <Row key={i} gap={8} align="flex-start">
            <Icon name="information-circle-outline" size={18} color={c.accent} />
            <T style={{ flex: 1 }}>{reason}</T>
          </Row>
        ))}
      </View>
      <View style={{ gap: 8 }}>
        <T v="label">{explanation.alternatives.length ? 'Move it to a free time (no clashes)' : 'No other free time fits this session'}</T>
        <Row wrap gap={8}>
          {explanation.alternatives.slice(0, 12).map((alt) => (
            <Chip key={`${alt.day}${alt.slot}`} label={`${alt.day.slice(0, 3)} ${alt.slot.split('-')[0]}`} onPress={() => onMove({ day: alt.day, slot: alt.slot })} />
          ))}
        </Row>
      </View>
      <Button
        label={session.locked ? 'Unlock' : 'Lock in place'}
        icon={session.locked ? 'lock-open-outline' : 'lock-closed-outline'}
        kind="secondary"
        onPress={() => onMove({ locked: !session.locked })}
      />
      <View style={{ borderRadius: radius.md }} />
    </>
  );
}
