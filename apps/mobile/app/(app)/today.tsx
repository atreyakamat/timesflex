import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import {
  absentTeacherIds,
  breaksAfter,
  coveredSlots,
  currentSlotIndex,
  effectiveTeacher,
  findAttendance,
  formatDateKey,
  sessionsOnDay,
  studentsFor,
  toDateKey,
  weekdayOf,
} from '@core';
import { useStore } from '../../src/store';
import { space, useTheme } from '../../src/theme';
import { Button, Card, Empty, Icon, IconButton, Pill, Row, Screen, T, useWide } from '../../src/ui';

const shift = (key: string, by: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + by));
};

export default function Today() {
  const { profile, liveSessions, slots, names } = useStore();
  const { c } = useTheme();
  const wide = useWide();
  const [date, setDate] = useState(() => toDateKey(new Date()));
  const days = profile.institution.workingDays;
  const weekday = weekdayOf(date);
  const isToday = date === toDateKey(new Date());
  const nowIndex = isToday ? currentSlotIndex(slots, new Date()) : -1;
  const list = sessionsOnDay(liveSessions, weekday, slots);
  const absent = absentTeacherIds(profile.operations, date);
  const breaks = breaksAfter(slots);
  const step = (dir: 1 | -1) => {
    let next = shift(date, dir);
    for (let i = 0; i < 7 && !days.includes(weekdayOf(next)); i += 1) next = shift(next, dir);
    setDate(next);
  };

  return (
    <Screen bottomSpace={wide ? 0 : 110}>
      <T v="eyebrow">Run your week</T>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.lg }}>
        <T v="h1">{isToday ? 'Today' : formatDateKey(date)}</T>
        <Row gap={8}>
          <IconButton icon="chevron-back" label="Previous day" onPress={() => step(-1)} />
          {!isToday && <Button label="Today" size="sm" kind="secondary" onPress={() => setDate(toDateKey(new Date()))} />}
          <IconButton icon="chevron-forward" label="Next day" onPress={() => step(1)} />
        </Row>
      </Row>

      {!liveSessions.length ? (
        <Empty icon="calendar-outline" title="No timetable yet" text="Build one first; then today’s classes show up here." action={<Button label="Go to timetable" onPress={() => router.push('/timetable')} />} />
      ) : !days.includes(weekday) ? (
        <Empty icon="sunny-outline" title={`No classes on ${weekday}`} action={<Button label="Next working day" onPress={() => step(1)} />} />
      ) : (
        <View style={{ gap: space.sm }}>
          {absent.size > 0 && (
            <Card tone="warn" onPress={() => router.push('/cover')}>
              <Row gap={10}>
                <Icon name="person-remove-outline" size={20} color={c.warn} />
                <T style={{ flex: 1 }}>Away: {[...absent].map((id) => names[id]).join(', ')}. Tap to arrange cover.</T>
              </Row>
            </Card>
          )}
          {slots.map((slot, index) => {
            const here = list.filter((s) => s.slot === slot);
            const now = index === nowIndex;
            return (
              <View key={slot}>
                <Card style={[{ padding: space.md }, now && { borderColor: c.accent, borderWidth: 2 }]}>
                  <Row align="flex-start" gap={12}>
                    <View style={{ width: 56 }}>
                      <T v="h3">P{index + 1}</T>
                      <T v="mono">{slot.split('-')[0]}</T>
                      {now && <Pill label="Now" tone="accent" />}
                    </View>
                    <View style={{ flex: 1, gap: 8 }}>
                      {!here.length && <T v="small">No class starts</T>}
                      {here.map((s) => {
                        const teacher = effectiveTeacher(s, date, profile.operations.substitutions);
                        const substituted = teacher !== s.teacher_id;
                        const needsCover = absent.has(s.teacher_id) && !substituted;
                        const roster = studentsFor(profile.divisions.find((d) => d.id === s.division_id), s.batch).length;
                        const taken = findAttendance(profile.operations.attendance, date, s.id);
                        const end = coveredSlots(s, slots).at(-1)?.split('-')[1];
                        return (
                          <View key={s.id} style={{ gap: 2 }}>
                            <T v="h3">
                              {names[s.subject_id]} <T v="small">· {names[s.division_id]}{s.batch ? ` ${s.batch}` : ''}</T>
                            </T>
                            <T v="small" color={needsCover ? c.danger : undefined}>
                              {needsCover ? `${names[s.teacher_id]} away · needs cover` : substituted ? (teacher ? `${names[teacher]} (for ${names[s.teacher_id]})` : 'Free period') : names[s.teacher_id]} · {names[s.room_id]}
                              {s.duration_slots > 1 ? ` · until ${end}` : ''}
                            </T>
                            {roster > 0 && (
                              <Button
                                label={taken ? `Attendance ✓ ${taken.absentStudentIds.length} absent` : 'Take attendance'}
                                kind="ghost"
                                size="sm"
                                icon="checkbox-outline"
                                onPress={() => router.push({ pathname: '/attendance', params: { date, session: s.id } })}
                                style={{ alignSelf: 'flex-start', marginLeft: -12 }}
                              />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </Row>
                </Card>
                {breaks.has(index) && (
                  <T v="small" style={{ textAlign: 'center', fontStyle: 'italic', paddingVertical: 6 }}>
                    Break
                  </T>
                )}
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
