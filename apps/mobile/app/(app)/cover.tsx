import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import {
  absentTeacherIds,
  assignSubstitute,
  autoAssignSubstitutes,
  formatDateKey,
  recentCoverCounts,
  sessionsOnDay,
  setAbsent,
  substituteCandidates,
  toDateKey,
  uncoveredPeriods,
  weekdayOf,
  whatsappLink,
} from '@core';
import { useStore } from '../../src/store';
import { space, useTheme } from '../../src/theme';
import { Avatar, Button, Card, Chip, Empty, Icon, IconButton, Pill, Progress, Row, Screen, SectionTitle, T, useWide } from '../../src/ui';

const shift = (key: string, by: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + by));
};

export default function Cover() {
  const { profile, liveSessions, slots, names, updateOperations } = useStore();
  const { c } = useTheme();
  const wide = useWide();
  const days = profile.institution.workingDays;
  const [date, setDate] = useState(() => {
    let key = toDateKey(new Date());
    for (let i = 0; i < 7 && days.length && !days.includes(weekdayOf(key)); i += 1) key = shift(key, 1);
    return key;
  });
  const [message, setMessage] = useState('');
  const ops = profile.operations;
  const weekday = weekdayOf(date);
  const absent = absentTeacherIds(ops, date);
  const dayList = sessionsOnDay(liveSessions, weekday, slots);
  const open = uncoveredPeriods(ops, date, liveSessions, slots);
  const subs = ops.substitutions.filter((s) => s.date === date);
  const total = dayList.filter((s) => absent.has(s.teacher_id)).length;
  const context = { date, slots, sessions: liveSessions, teachers: profile.teachers, subjects: profile.subjects };
  const counts = recentCoverCounts(ops, date);
  const leaders = profile.teachers.map((t) => ({ t, n: counts.get(t.id) ?? 0 })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  const step = (dir: 1 | -1) => {
    let next = shift(date, dir);
    for (let i = 0; i < 7 && !days.includes(weekdayOf(next)); i += 1) next = shift(next, dir);
    setDate(next);
    setMessage('');
  };

  const notice = `Substitutions for ${formatDateKey(date)}\n\n${dayList
    .filter((s) => absent.has(s.teacher_id))
    .map((s) => {
      const sub = subs.find((x) => x.sessionId === s.id);
      const who = !sub ? 'NOT COVERED' : sub.substituteTeacherId ? names[sub.substituteTeacherId] : 'free period';
      return `${s.slot.split('-')[0]} ${names[s.subject_id]} · ${names[s.division_id]} · ${names[s.room_id]}: ${names[s.teacher_id]} → ${who}`;
    })
    .join('\n')}`;

  if (!liveSessions.length) {
    return (
      <Screen bottomSpace={wide ? 0 : 110}>
        <T v="h1" style={{ marginBottom: space.lg }}>
          Cover
        </T>
        <Empty icon="swap-horizontal-outline" title="No timetable yet" text="Once a timetable exists, marking someone away finds fair substitutes automatically." action={<Button label="Go to timetable" onPress={() => router.push('/timetable')} />} />
      </Screen>
    );
  }

  return (
    <Screen bottomSpace={wide ? 0 : 110}>
      <T v="eyebrow">Substitutions</T>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.lg }} wrap gap={8}>
        <T v="h1">{formatDateKey(date)}</T>
        <Row gap={8}>
          <IconButton icon="chevron-back" label="Previous day" onPress={() => step(-1)} />
          <IconButton icon="chevron-forward" label="Next day" onPress={() => step(1)} />
        </Row>
      </Row>

      <Card style={{ gap: space.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="h3">Who is away?</T>
          {total > 0 && <Pill label={`${total - open.length}/${total} covered`} tone={open.length ? 'warn' : 'ok'} />}
        </Row>
        <Row wrap gap={8}>
          {profile.teachers.map((t) => {
            const away = absent.has(t.id);
            return (
              <Chip
                key={t.id}
                label={t.name}
                icon={away ? 'close-circle' : undefined}
                active={away}
                tone="danger"
                onPress={() => {
                  setMessage('');
                  updateOperations((o) => setAbsent(o, date, t.id, !away));
                }}
              />
            );
          })}
        </Row>
        {open.length > 0 && (
          <Button
            label={`Auto-assign ${open.length} period${open.length === 1 ? '' : 's'}`}
            icon="sparkles"
            size="lg"
            onPress={() => {
              const result = autoAssignSubstitutes(ops, context);
              updateOperations(() => result.operations);
              setMessage(result.unfilled.length ? `Covered ${result.assigned}. ${result.unfilled.length} could not be covered: nobody is free then.` : `Covered all ${result.assigned}, shared fairly.`);
            }}
          />
        )}
        {message ? <T color={c.ok}>{message}</T> : null}
      </Card>

      {[...absent].map((teacherId) => {
        const periods = dayList.filter((s) => s.teacher_id === teacherId);
        return (
          <View key={teacherId}>
            <SectionTitle title={`${names[teacherId]}’s periods`} />
            {!periods.length && <T>No classes on {weekday}.</T>}
            <View style={{ gap: space.md }}>
              {periods.map((s) => {
                const sub = subs.find((x) => x.sessionId === s.id);
                const picks = substituteCandidates({ ...context, session: s, ops }).slice(0, 3);
                return (
                  <Card key={s.id} tone={sub ? undefined : 'warn'} style={{ gap: 10 }}>
                    <Row style={{ justifyContent: 'space-between' }} align="flex-start">
                      <View style={{ flex: 1 }}>
                        <T v="h3">
                          {s.slot.split('-')[0]} · {names[s.subject_id]}
                        </T>
                        <T v="small">
                          {names[s.division_id]}
                          {s.batch ? ` ${s.batch}` : ''} · {names[s.room_id]}
                        </T>
                      </View>
                      <Pill label={!sub ? 'Needs cover' : sub.substituteTeacherId ? names[sub.substituteTeacherId] : 'Free period'} tone={sub ? 'ok' : 'warn'} />
                    </Row>
                    {picks.map((p, i) => {
                      const chosen = sub?.substituteTeacherId === p.teacher.id;
                      return (
                        <Card
                          key={p.teacher.id}
                          onPress={() => updateOperations((o) => assignSubstitute(o, { date, session: s, substituteTeacherId: chosen ? null : p.teacher.id }))}
                          style={{ padding: space.md, borderColor: chosen ? c.ok : c.glassBorder, borderWidth: chosen ? 2 : 1 }}
                        >
                          <Row gap={10}>
                            <Avatar name={p.teacher.name} size={34} />
                            <View style={{ flex: 1 }}>
                              <T v="label">
                                {i === 0 ? '★ ' : ''}
                                {p.teacher.name}
                              </T>
                              <T v="small">{p.reasons.join(' · ')}</T>
                            </View>
                            {chosen && <Icon name="checkmark-circle" size={22} color={c.ok} />}
                          </Row>
                        </Card>
                      );
                    })}
                    {!picks.length && <T color={c.warn}>Nobody is free then.</T>}
                    <Button label="Leave as free period" kind="ghost" size="sm" onPress={() => updateOperations((o) => assignSubstitute(o, { date, session: s, substituteTeacherId: '' }))} style={{ alignSelf: 'flex-start' }} />
                  </Card>
                );
              })}
            </View>
          </View>
        );
      })}

      {total > 0 && (
        <>
          <SectionTitle title="Share" />
          <Card style={{ gap: space.md }}>
            <T v="mono">{notice}</T>
            <Row gap={8} wrap>
              <Button label="Share on WhatsApp" icon="logo-whatsapp" onPress={() => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(notice)}`)} />
              {[...new Set(subs.map((x) => x.substituteTeacherId).filter(Boolean))].map((id) => {
                const t = profile.teachers.find((x) => x.id === id);
                if (!t?.phone) return null;
                return <Button key={id} label={`Tell ${t.name}`} kind="secondary" size="sm" icon="chatbubble-outline" onPress={() => Linking.openURL(whatsappLink(t.phone!, notice))} />;
              })}
            </Row>
          </Card>
        </>
      )}

      {leaders.length > 0 && (
        <>
          <SectionTitle title="Cover shared (30 days)" />
          <Card style={{ gap: 10 }}>
            {leaders.map(({ t, n }) => (
              <Row key={t.id} gap={10}>
                <T v="label" style={{ width: 120 }} numberOfLines={1}>
                  {t.name}
                </T>
                <View style={{ flex: 1 }}>
                  <Progress value={n / leaders[0].n} />
                </View>
                <T v="label">{String(n)}</T>
              </Row>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
