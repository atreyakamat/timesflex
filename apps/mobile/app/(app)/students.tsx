import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, Share, View } from 'react-native';
import { allStudents, describeEvent, eventStats, eventsAsCsv, needsAttention, searchStudents, toDateKey, type StudentEvent } from '@core';
import { api } from '../../src/api';
import { useStore } from '../../src/store';
import { space, useTheme } from '../../src/theme';
import { Button, Card, Empty, Field, Icon, Pill, Row, Screen, SectionTitle, T, useToast, useWide } from '../../src/ui';

function FlagCard({ event, onDone }: { event: StudentEvent; onDone: (next: StudentEvent) => void }) {
  const { c } = useTheme();
  const toast = useToast();
  const [outcome, setOutcome] = useState('');
  const act = (job: Promise<StudentEvent>) => job.then(onDone).catch((e) => toast.show(e instanceof Error ? e.message : 'Could not save that.'));
  return (
    <Card tone="warn" style={{ gap: space.sm }}>
      <Pressable accessibilityRole="link" onPress={() => router.push(`/student/${event.studentId}`)}>
        <Row gap={8} style={{ justifyContent: 'space-between' }}>
          <T v="h3" style={{ flex: 1 }}>
            {event.studentName}
          </T>
          <T v="small">{event.divisionName}</T>
        </Row>
      </Pressable>
      <T color={c.warn}>{describeEvent(event)}</T>
      {event.note ? <T v="small">“{event.note}”</T> : null}
      <T v="small">
        {event.recordedByName} · {event.date}
        {event.time ? ` ${event.time}` : ''}
      </T>
      <Field placeholder="What was done? (optional)" value={outcome} onChangeText={setOutcome} />
      <Row gap={8} wrap>
        <Button label="Mark reviewed" icon="checkmark" size="sm" onPress={() => act(api.reviewEvent(event.id, { status: 'reviewed', outcome }))} />
        <Button label="Wrong, void it" kind="ghost" size="sm" onPress={() => act(api.voidEvent(event.id, outcome || 'Voided on review'))} />
      </Row>
    </Card>
  );
}

/** The office's view of students: what happened today, what needs review, and who to look out for. */
export default function Students() {
  const { profile, institutionId } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const wide = useWide();
  const [events, setEvents] = useState<StudentEvent[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const today = toDateKey(new Date());

  const load = useCallback(() => {
    if (!institutionId) return;
    api
      .listEvents(institutionId)
      .then((list) => {
        setEvents(list);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load student records.'));
  }, [institutionId]);
  useFocusEffect(load);

  const replace = (next: StudentEvent) => setEvents((list) => (list ?? []).map((e) => (e.id === next.id ? next : e)));
  const list = events ?? [];
  const stats = eventStats(list, today);
  const open = list.filter((e) => e.status === 'open');
  const watch = needsAttention(list, today);
  const recent = list.filter((e) => e.status !== 'void').slice(0, 12);
  const found = searchStudents(profile, query, 12);
  const total = allStudents(profile).length;

  const exportReport = async () => {
    const csv = eventsAsCsv(list);
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `student-records-${today}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      await Share.share({ message: csv });
    }
    toast.show(`Report of ${list.length} records ready.`);
  };

  return (
    <Screen bottomSpace={wide ? 0 : 110}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: space.lg }} wrap gap={12}>
        <View>
          <T v="eyebrow">Students</T>
          <T v="h1">{total ? `${total} students` : 'Students'}</T>
        </View>
        <Button label="Mark a student" icon="create-outline" onPress={() => router.push('/mark')} />
      </Row>

      {!total ? (
        <Empty icon="people-outline" title="No class lists yet" text="Add students to their classes, and teachers can mark them late or flag them from here." action={<Button label="Add class lists" onPress={() => router.push('/setup/classes')} />} />
      ) : (
        <>
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.md }}>
            {(
              [
                [stats.lateToday, 'Late today', 'time-outline', undefined],
                [stats.flagsToday, 'Flagged today', 'walk-outline', undefined],
                [stats.openFlags, 'Waiting for review', 'eye-outline', stats.openFlags ? ('warn' as const) : undefined],
              ] as const
            ).map(([value, label, icon, tone]) => (
              <Card key={label} tone={tone} style={{ flex: 1, gap: 4 }}>
                <Icon name={icon} size={20} color={c.accent} />
                <T v="h1">{String(value)}</T>
                <T v="small">{label}</T>
              </Card>
            ))}
          </View>

          <Card style={{ gap: space.sm, marginTop: space.md }}>
            <Field label="Find a student" placeholder="Name or roll number" value={query} onChangeText={setQuery} autoCorrect={false} />
            {query.trim() && !found.length ? <T v="small">Nobody matches that.</T> : null}
            {found.map((student) => (
              <Pressable key={student.id} accessibilityRole="link" onPress={() => router.push(`/student/${student.id}`)} style={{ paddingVertical: 6 }}>
                <Row style={{ justifyContent: 'space-between' }} gap={8}>
                  <T style={{ flex: 1 }}>{student.name}</T>
                  <T v="small">
                    {student.rollNo} · {student.divisionName}
                  </T>
                </Row>
              </Pressable>
            ))}
          </Card>

          {error ? (
            <Card tone="danger" style={{ gap: space.sm, marginTop: space.md }}>
              <T color={c.danger}>{error}</T>
              <Button label="Try again" kind="secondary" size="sm" style={{ alignSelf: 'flex-start' }} onPress={load} />
            </Card>
          ) : null}

          {open.length ? (
            <>
              <SectionTitle title="Waiting for review" action={<Pill label={String(open.length)} tone="warn" />} />
              <View style={{ gap: space.md }}>
                {open.map((event) => (
                  <FlagCard key={event.id} event={event} onDone={replace} />
                ))}
              </View>
            </>
          ) : null}

          {watch.length ? (
            <>
              <SectionTitle title="Keep an eye on" />
              <View style={{ gap: space.sm }}>
                {watch.slice(0, 10).map((row) => (
                  <Card key={row.studentId} onPress={() => router.push(`/student/${row.studentId}`)} style={{ paddingVertical: space.md }}>
                    <Row gap={10}>
                      <Icon name="alert-circle-outline" size={20} color={c.warn} />
                      <View style={{ flex: 1 }}>
                        <T v="h3">{row.studentName}</T>
                        <T v="small">
                          {row.divisionName} · {row.reason}
                        </T>
                      </View>
                      <Icon name="chevron-forward" size={18} color={c.muted} />
                    </Row>
                  </Card>
                ))}
              </View>
            </>
          ) : null}

          <SectionTitle title="Recent" action={list.length ? <Button label="Download report" kind="ghost" size="sm" icon="download-outline" onPress={exportReport} /> : undefined} />
          {recent.length ? (
            <Card style={{ gap: 2 }}>
              {recent.map((event) => (
                <Pressable key={event.id} accessibilityRole="link" onPress={() => router.push(`/student/${event.studentId}`)} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border }}>
                  <Row gap={8} style={{ justifyContent: 'space-between' }}>
                    <T v="label" style={{ flex: 1, color: c.text }} numberOfLines={1}>
                      {event.studentName}
                    </T>
                    <T v="small">{event.date}</T>
                  </Row>
                  <T v="small" numberOfLines={1}>
                    {describeEvent(event)} · {event.divisionName} · {event.recordedByName}
                  </T>
                </Pressable>
              ))}
            </Card>
          ) : (
            <T v="small">Nothing marked yet. Teachers’ marks appear here as they’re made.</T>
          )}
        </>
      )}
    </Screen>
  );
}
