import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { attendanceSummary, describeEvent, findStudent, studentHistory, type StudentEvent } from '@core';
import { api } from '../../src/api';
import { useStore } from '../../src/store';
import { space, useTheme } from '../../src/theme';
import { Avatar, Button, Card, Empty, IconButton, Pill, Row, Screen, SectionTitle, T, useToast } from '../../src/ui';

/** One student's record. Teachers see what they recorded; the office sees everything. */
export default function StudentPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, institutionId, role } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const [events, setEvents] = useState<StudentEvent[] | null>(null);
  const student = findStudent(profile, id);
  const division = profile.divisions.find((d) => d.id === student?.divisionId);

  const load = useCallback(() => {
    if (!institutionId || !id) return;
    api.listEvents(institutionId, { studentId: id }).then(setEvents).catch((e) => toast.show(e instanceof Error ? e.message : 'Could not load the record.'));
  }, [institutionId, id, toast]);
  useFocusEffect(load);

  if (!student) {
    return (
      <Screen>
        <Empty icon="person-outline" title="Student not found" action={<Button label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />} />
      </Screen>
    );
  }
  const history = studentHistory(events ?? [], student.id);
  const attendance = role === 'admin' && division ? attendanceSummary(division, profile.operations.attendance).find((row) => row.student.id === student.id) : undefined;
  const undo = (event: StudentEvent) =>
    api
      .voidEvent(event.id, 'Corrected')
      .then((next) => setEvents((list) => (list ?? []).map((e) => (e.id === next.id ? next : e))))
      .catch((e) => toast.show(e instanceof Error ? e.message : 'Could not change that.'));

  return (
    <Screen>
      <Row gap={12} style={{ marginBottom: space.lg }}>
        <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <Avatar name={student.name} size={48} />
        <View style={{ flex: 1 }}>
          <T v="h1">{student.name}</T>
          <T v="small">
            {student.rollNo} · {student.divisionName}
            {student.batch ? ` · batch ${student.batch}` : ''}
          </T>
        </View>
      </Row>

      <Button label="Mark this student" icon="create-outline" onPress={() => router.push(`/mark?student=${student.id}`)} style={{ alignSelf: 'flex-start' }} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.lg }}>
        {(
          [
            ...(attendance ? ([[attendance.percent === null ? '–' : `${attendance.percent}%`, 'Attendance']] as const) : []),
            [String(history.counts.late), 'Times late'],
            [String(history.counts.outside + history.counts.bunked), 'Flags'],
            [String(history.counts.other), 'Remarks'],
          ] as const
        ).map(([value, label]) => (
          <Card key={label} style={{ flexGrow: 1, flexBasis: 130, gap: 2 }}>
            <T v="h1">{value}</T>
            <T v="small">{label}</T>
          </Card>
        ))}
      </View>

      <SectionTitle title="History" />
      {role !== 'admin' ? <T v="small" style={{ marginBottom: space.sm }}>Showing what you recorded.</T> : null}
      {!history.events.length ? (
        <T v="small">Nothing recorded.</T>
      ) : (
        <View style={{ gap: space.sm }}>
          {history.events.map((event) => (
            <Card key={event.id} style={{ gap: 4, paddingVertical: space.md }}>
              <Row style={{ justifyContent: 'space-between' }} gap={8}>
                <T v="h3" style={{ flex: 1 }}>
                  {describeEvent(event)}
                </T>
                {event.status === 'open' ? <Pill label="Waiting for review" tone="warn" /> : null}
              </Row>
              {event.note && event.kind !== 'other' ? <T>“{event.note}”</T> : null}
              <T v="small">
                {event.date}
                {event.time ? ` ${event.time}` : ''} · {event.recordedByName}
              </T>
              {event.outcome ? <T v="small" color={c.ok}>Outcome: {event.outcome}</T> : null}
              {role === 'admin' || !event.reviewedAt ? <Button label="Wrong, void it" kind="ghost" size="sm" style={{ alignSelf: 'flex-start' }} onPress={() => undo(event)} /> : null}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
