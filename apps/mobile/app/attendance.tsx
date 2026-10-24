import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { attendanceSummary, findAttendance, formatDateKey, saveAttendance, sessionsOnDay, studentsFor, toDateKey, weekdayOf } from '@core';
import { useStore } from '../src/store';
import { radius, space, useTheme } from '../src/theme';
import { Button, Card, Chip, Empty, IconButton, Pill, Row, Screen, Segmented, T } from '../src/ui';

/** Every period is a register: tap the students who are absent, save, move on. */
export default function Attendance() {
  const params = useLocalSearchParams<{ date?: string; session?: string }>();
  const { profile, liveSessions, slots, names, updateOperations } = useStore();
  const { c } = useTheme();
  const [date] = useState(params.date ?? toDateKey(new Date()));
  const today = sessionsOnDay(liveSessions, weekdayOf(date), slots);
  const initial = today.find((s) => s.id === params.session);
  const [divisionId, setDivisionId] = useState(initial?.division_id ?? profile.divisions.find((d) => d.students?.length)?.id ?? profile.divisions[0]?.id ?? '');
  const classSessions = today.filter((s) => s.division_id === divisionId);
  const [sessionId, setSessionId] = useState(initial?.id ?? classSessions[0]?.id ?? '');
  const session = classSessions.find((s) => s.id === sessionId) ?? classSessions[0];
  const division = profile.divisions.find((d) => d.id === divisionId);
  const students = studentsFor(division, session?.batch);
  const [absent, setAbsent] = useState<string[]>([]);
  const [tab, setTab] = useState<'take' | 'report'>('take');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setAbsent(session ? findAttendance(profile.operations.attendance, date, session.id)?.absentStudentIds ?? [] : []);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  const summary = division ? attendanceSummary(division, profile.operations.attendance) : [];

  return (
    <Screen>
      <Row gap={12} style={{ marginBottom: space.lg }}>
        <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/today'))} />
        <View>
          <T v="h1">Attendance</T>
          <T v="small">{formatDateKey(date)}</T>
        </View>
      </Row>
      <Segmented
        options={[
          { value: 'take', label: 'Take' },
          { value: 'report', label: 'Report' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <Row wrap gap={8} style={{ marginTop: space.md }}>
        {profile.divisions.map((d) => (
          <Chip key={d.id} label={d.name} active={d.id === divisionId} onPress={() => setDivisionId(d.id)} />
        ))}
      </Row>

      {!division?.students?.length ? (
        <View style={{ marginTop: space.lg }}>
          <Empty icon="list-outline" title="No class list yet" text="Add the students to this class (roll number and name) and every period becomes a register." />
        </View>
      ) : tab === 'take' ? (
        <View style={{ marginTop: space.lg, gap: space.md }}>
          {!classSessions.length ? (
            <Empty icon="calendar-outline" title={`${division.name} has no classes on this day`} />
          ) : (
            <>
              <Row wrap gap={8}>
                {classSessions.map((s) => (
                  <Chip
                    key={s.id}
                    label={`${s.slot.split('-')[0]} ${names[s.subject_id]}${s.batch ? ` (${s.batch})` : ''}`}
                    active={s.id === session?.id}
                    icon={findAttendance(profile.operations.attendance, date, s.id) ? 'checkmark-circle' : undefined}
                    onPress={() => setSessionId(s.id)}
                  />
                ))}
              </Row>
              <Row style={{ justifyContent: 'space-between' }}>
                <T v="h3">Tap the students who are absent</T>
                <Pill label={`${students.length - absent.length}/${students.length} present`} tone="ok" />
              </Row>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {students.map((student) => {
                  const off = absent.includes(student.id);
                  return (
                    <Pressable
                      key={student.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: off }}
                      accessibilityLabel={`${student.name}, ${off ? 'absent' : 'present'}`}
                      onPress={() => {
                        setSaved(false);
                        setAbsent((list) => (off ? list.filter((x) => x !== student.id) : [...list, student.id]));
                      }}
                      style={{ width: 150, flexGrow: 1, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: off ? c.danger : c.border, backgroundColor: off ? c.dangerSoft : c.okSoft }}
                    >
                      <T v="mono">{student.rollNo}</T>
                      <T v="label" color={off ? c.danger : c.text} style={off ? { textDecorationLine: 'line-through' } : undefined}>
                        {student.name}
                      </T>
                    </Pressable>
                  );
                })}
              </View>
              <Button
                label={saved ? 'Saved ✓' : `Save · ${absent.length} absent`}
                size="lg"
                onPress={() => {
                  if (!session) return;
                  updateOperations((o) => saveAttendance(o, { date, session, absentStudentIds: absent }));
                  setSaved(true);
                }}
              />
            </>
          )}
        </View>
      ) : (
        <Card style={{ marginTop: space.lg, gap: 6 }}>
          {summary.map((row) => (
            <Row key={row.student.id} style={{ justifyContent: 'space-between' }}>
              <T v="label" style={{ flex: 1 }} numberOfLines={1}>
                {row.student.rollNo} · {row.student.name}
              </T>
              <T v="label" color={row.percent !== null && row.percent < 75 ? c.danger : c.text}>
                {row.percent === null ? '—' : `${row.percent}% (${row.attended}/${row.total})`}
              </T>
            </Row>
          ))}
        </Card>
      )}
    </Screen>
  );
}
