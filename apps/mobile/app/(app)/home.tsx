import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  absentTeacherIds,
  currentSlotIndex,
  describePreferences,
  divisionSize,
  hasLearned,
  isRunAction,
  nextSlotIndex,
  sessionsOnDay,
  setupInsights,
  timetableInsights,
  toDateKey,
  uncoveredPeriods,
  weekdayOf,
  type Insight,
} from '@core';
import { useStore } from '../../src/store';
import { radius, space, useTheme } from '../../src/theme';
import { Button, Card, Gradient, Icon, Pill, Row, Screen, SectionTitle, T, useWide, type IconName } from '../../src/ui';

const LEVEL: Record<Insight['level'], { icon: IconName; tone: 'danger' | 'warn' | 'accent' | 'ok' }> = {
  blocker: { icon: 'alert-circle', tone: 'danger' },
  warning: { icon: 'warning', tone: 'warn' },
  tip: { icon: 'bulb', tone: 'accent' },
  good: { icon: 'checkmark-circle', tone: 'ok' },
};

function InsightCard({ insight }: { insight: Insight }) {
  const { c } = useTheme();
  const store = useStore();
  const [done, setDone] = useState('');
  const look = LEVEL[insight.level];
  const color = { danger: c.danger, warn: c.warn, accent: c.accent, ok: c.ok }[look.tone];
  const fix = async () => {
    if (!insight.fix) return;
    try {
      const message = await store.applyAgent(insight.fix.actions);
      setDone(message ?? 'Done.');
      if (insight.fix.actions.some(isRunAction)) router.push('/timetable');
    } catch (e) {
      setDone(e instanceof Error ? e.message : 'That did not work.');
    }
  };
  return (
    <Card style={{ gap: 8, flexGrow: 1, flexBasis: 300 }}>
      <Row gap={10} align="flex-start">
        <Icon name={look.icon} size={22} color={color} />
        <View style={{ flex: 1, gap: 4 }}>
          <T v="h3">{insight.title}</T>
          <T v="small">{insight.detail}</T>
        </View>
      </Row>
      {done ? (
        <T v="small" color={c.ok}>
          {done}
        </T>
      ) : insight.fix ? (
        <Button label={insight.fix.label} size="sm" kind="secondary" icon="flash-outline" onPress={fix} loading={!!store.busy && insight.fix.actions.some(isRunAction)} style={{ alignSelf: 'flex-start' }} />
      ) : null}
    </Card>
  );
}

export default function Home() {
  const store = useStore();
  const { profile, account, liveSessions, slots, names, unplaced } = store;
  const { c } = useTheme();
  const wide = useWide();
  const now = new Date();
  const today = toDateKey(now);
  const weekday = weekdayOf(today);
  const todays = sessionsOnDay(liveSessions, weekday, slots);
  const nowIndex = currentSlotIndex(slots, now);
  const runningNow = nowIndex >= 0 ? todays.filter((s) => slots.indexOf(s.slot) <= nowIndex && nowIndex < slots.indexOf(s.slot) + s.duration_slots) : [];
  // After the last period nothing is "coming up"; before the first, everything is.
  const upcomingFrom = nextSlotIndex(slots, now);
  const nextUp = upcomingFrom === -1 ? [] : todays.filter((s) => slots.indexOf(s.slot) >= upcomingFrom).slice(0, 3);
  const needCover = uncoveredPeriods(profile.operations, today, liveSessions, slots);
  const absent = absentTeacherIds(profile.operations, today);
  // "Ready to generate" only matters before the first timetable exists.
  const insights = [...setupInsights(profile).filter((i) => !(i.id === 'ready' && liveSessions.length)), ...timetableInsights(profile, liveSessions, unplaced.length)];
  const ordered = [...insights].sort((a, b) => ['blocker', 'warning', 'tip', 'good'].indexOf(a.level) - ['blocker', 'warning', 'tip', 'good'].indexOf(b.level));
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = account?.name.replace(/^(prof|dr|mr|mrs|ms)\.?\s+/i, '').split(' ')[0] ?? '';
  const students = profile.divisions.reduce((sum, d) => sum + divisionSize(d), 0);

  return (
    <Screen bottomSpace={wide ? 0 : 110}>
      <View style={{ gap: 4, marginBottom: space.lg }}>
        <T v="eyebrow">
          {weekday} · {profile.institution.name}
        </T>
        <T v="h1">
          {greeting}, {first}
        </T>
      </View>

      <Pressable onPress={() => router.push('/assistant')} accessibilityRole="button" accessibilityLabel="Ask TimeFlex">
        <Gradient style={{ borderRadius: radius.lg, padding: 2 }}>
          <View style={{ backgroundColor: c.glassStrong, borderRadius: radius.lg - 2, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name="sparkles" size={22} color={c.accent} />
            <View style={{ flex: 1 }}>
              <T v="h3">Ask or tell me anything</T>
              <T v="small" numberOfLines={1}>
                “Mehta is away tomorrow” · “make 3 variations” · “max 3 a day for Rao”
              </T>
            </View>
            <Icon name="arrow-forward-circle" size={28} color={c.accent} />
          </View>
        </Gradient>
      </Pressable>

      {liveSessions.length > 0 && (
        <>
          <SectionTitle title={profile.institution.workingDays.includes(weekday) ? 'Today' : `No classes on ${weekday}`} action={<Button label="Open today" kind="ghost" size="sm" onPress={() => router.push('/today')} />} />
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.md }}>
            <Card style={{ flex: 1, gap: 6 }}>
              <T v="small">Right now</T>
              <T v="h1">{runningNow.length}</T>
              <T v="small">{runningNow.length === 1 ? 'class in progress' : 'classes in progress'}</T>
            </Card>
            <Card style={{ flex: 1, gap: 6 }}>
              <T v="small">Coming up</T>
              {nextUp.length ? (
                nextUp.map((s) => (
                  <Row key={s.id} gap={8}>
                    <T v="mono">{s.slot.split('-')[0]}</T>
                    <T v="label" numberOfLines={1} style={{ flex: 1 }}>
                      {names[s.subject_id]} · {names[s.division_id]}
                    </T>
                  </Row>
                ))
              ) : (
                <T>Nothing else today.</T>
              )}
            </Card>
            <Card style={{ flex: 1, gap: 6 }} tone={needCover.length ? 'warn' : undefined} onPress={() => router.push('/cover')}>
              <T v="small">Cover</T>
              <T v="h1">{needCover.length}</T>
              <T v="small">{needCover.length ? `period(s) need a substitute · ${absent.size} away` : absent.size ? 'All absences covered' : 'Everyone is in'}</T>
            </Card>
          </View>
        </>
      )}

      <SectionTitle title="What I noticed" action={<Pill label={`${insights.filter((i) => i.level === 'blocker').length} to fix`} tone={insights.some((i) => i.level === 'blocker') ? 'danger' : 'ok'} />} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {ordered.slice(0, 6).map((insight) => (
          <InsightCard key={insight.id} insight={insight} />
        ))}
      </View>

      <SectionTitle title="Your taste" />
      <Card style={{ gap: 8 }}>
        <Row gap={10}>
          <Icon name="bulb-outline" size={22} color={c.accent2} />
          <T v="h3" style={{ flex: 1 }}>
            {describePreferences(profile.learning)}
          </T>
        </Row>
        {profile.learning.history.slice(0, 3).map((line, i) => (
          <T key={i} v="small">
            • {line}
          </T>
        ))}
        {hasLearned(profile.learning) && (
          <Button label="Build a timetable in your style" icon="sparkles" size="sm" onPress={() => store.generate('yours').then(() => router.push('/timetable'))} loading={!!store.busy} style={{ alignSelf: 'flex-start' }} />
        )}
      </Card>

      <SectionTitle title="Your department" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {(
          [
            [profile.divisions.length, 'Classes', 'people-outline', '/setup/classes'],
            [students, 'Students', 'school-outline', '/setup/classes'],
            [profile.teachers.length, 'Teachers', 'person-outline', '/setup/teachers'],
            [profile.rooms.length, 'Rooms', 'business-outline', '/setup/rooms'],
            [profile.subjects.length, 'Subjects', 'book-outline', '/setup/subjects'],
            [liveSessions.length, 'Sessions / week', 'grid-outline', '/timetable'],
          ] as [number, string, IconName, string][]
        ).map(([value, label, icon, href]) => (
          <Card key={label} style={{ flexGrow: 1, flexBasis: wide ? 150 : 140, gap: 4 }} onPress={() => router.push(href as never)}>
            <Icon name={icon} size={20} color={c.accent} />
            <T v="h1">{String(value)}</T>
            <T v="small">{label}</T>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
