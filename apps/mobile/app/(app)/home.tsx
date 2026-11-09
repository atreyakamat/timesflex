import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  absentTeacherIds,
  currentSlotIndex,
  divisionSize,
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

/** The single most useful thing to do now. */
function NextStep() {
  const store = useStore();
  const { profile, liveSessions, liveVersion, pendingUpdate, sessionsNeedingRoom, drift } = store;
  const { c } = useTheme();
  const today = toDateKey(new Date());
  const needCover = uncoveredPeriods(profile.operations, today, liveSessions, store.slots).length;
  const step = !profile.teachers.length || !profile.divisions.length || !profile.subjects.length
    ? { icon: 'list-outline', title: 'Finish setting up', text: 'Add your teachers and classes to get your first timetable.', label: 'Continue setup', href: '/onboarding' }
    : !liveSessions.length
      ? { icon: 'sparkles-outline', title: 'Build your timetable', text: 'Three different versions to compare, usually in under a minute.', label: 'Go to timetable', href: '/timetable' }
      : drift.changed
        ? { icon: 'sync-outline', title: 'Your setup has changed', text: 'Update the timetable to match. Everything else stays where it is.', label: 'See what changed', href: '/timetable' }
        : sessionsNeedingRoom.length
        ? { icon: 'business-outline', title: `${sessionsNeedingRoom.length} class${sessionsNeedingRoom.length === 1 ? ' has' : 'es have'} no room`, text: 'A room was deleted. It takes one tap to fix.', label: 'Fix it', href: '/timetable' }
        : needCover
          ? { icon: 'swap-horizontal-outline', title: `${needCover} period${needCover === 1 ? '' : 's'} need cover today`, text: 'Fair substitutes can be picked for you.', label: 'Arrange cover', href: '/cover' }
          : liveVersion?.status !== 'approved'
            ? { icon: 'checkmark-done-outline', title: 'Approve your timetable', text: 'Pick the version you like. Today, Cover and attendance then use it.', label: 'Review it', href: '/timetable' }
            : pendingUpdate.recipients.length
              ? { icon: 'paper-plane-outline', title: `Tell ${pendingUpdate.recipients.length} teacher${pendingUpdate.recipients.length === 1 ? '' : 's'}`, text: pendingUpdate.title === 'New timetable' ? 'They haven’t seen the timetable yet.' : 'Your changes haven’t reached them yet.', label: 'See who', href: '/updates' }
              : null;
  if (!step) {
    return (
      <Card tone="ok" style={{ marginBottom: space.md }}>
        <Row gap={10}>
          <Icon name="checkmark-circle" size={24} color={c.ok} />
          <T v="h3" style={{ flex: 1 }}>
            You’re all caught up
          </T>
        </Row>
      </Card>
    );
  }
  return (
    <Card tone="accent" style={{ gap: space.md, marginBottom: space.md }}>
      <Row gap={12}>
        <Icon name={step.icon as IconName} size={26} color={c.accent} />
        <View style={{ flex: 1 }}>
          <T v="h2">{step.title}</T>
          <T v="small">{step.text}</T>
        </View>
      </Row>
      <Button label={step.label} icon="arrow-forward" style={{ alignSelf: 'flex-start' }} onPress={() => router.push(step.href as never)} />
    </Card>
  );
}

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
  const surname = (index: number) => profile.teachers[index % Math.max(1, profile.teachers.length)]?.name.split(/\s+/).pop() ?? 'Mehta';

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

      <NextStep />

      <Pressable onPress={() => router.push('/assistant')} accessibilityRole="button" accessibilityLabel="Ask TimeFlex">
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: c.borderStrong }}>
          <View style={{ backgroundColor: c.glassStrong, borderRadius: radius.lg - 1, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name="sparkles" size={22} color={c.accent} />
            <View style={{ flex: 1 }}>
              <T v="h3">Ask or tell me anything</T>
              <T v="small" numberOfLines={1}>
                “{surname(0)} is away tomorrow” · “make 3 variations” · “max 3 a day for {surname(1)}”
              </T>
            </View>
            <Icon name="arrow-forward-circle" size={28} color={c.text} />
          </View>
        </View>
      </Pressable>

      {liveSessions.length > 0 && !profile.institution.workingDays.includes(weekday) ? <T style={{ marginTop: space.lg }}>No classes today, as it’s {weekday}.</T> : null}

      {liveSessions.length > 0 && profile.institution.workingDays.includes(weekday) && (
        <>
          <SectionTitle title="Today" action={<Button label="Open today" kind="ghost" size="sm" onPress={() => router.push('/today')} />} />
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

      <SectionTitle title="What I noticed" action={insights.some((i) => i.level === 'blocker') ? <Pill label={`${insights.filter((i) => i.level === 'blocker').length} to fix`} tone="danger" /> : undefined} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {ordered.slice(0, 3).map((insight) => (
          <InsightCard key={insight.id} insight={insight} />
        ))}
      </View>

      <SectionTitle title="Your college" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {(
          [
            [profile.divisions.length, 'Classes', 'people-outline', '/setup/classes'],
            [students, 'Students', 'school-outline', '/setup/classes'],
            [profile.teachers.length, 'Teachers', 'person-outline', '/setup/teachers'],
            [profile.rooms.length, 'Rooms', 'business-outline', '/setup/rooms'],
            [profile.subjects.length, 'Subjects', 'book-outline', '/setup/subjects'],
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
