import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { describeEvent, sessionsOnDay, toDateKey, weekdayOf, type StudentEvent } from '@core';
import { api } from '../../src/api';
import { useStore } from '../../src/store';
import { space, useTheme } from '../../src/theme';
import { Avatar, Button, Card, Field, Icon, Pill, Row, Screen, SectionTitle, T, useToast } from '../../src/ui';

/** A teacher's own home: today's classes, one tap to mark a student, and what they've recorded. */
export default function TeacherHome() {
  const store = useStore();
  const { account, role, teacherId, institutionId, profile, liveSessions, slots, names } = store;
  const { c, toggle } = useTheme();
  const toast = useToast();
  const [events, setEvents] = useState<StudentEvent[]>([]);
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const today = toDateKey(new Date());
  const mine = sessionsOnDay(liveSessions, weekdayOf(today), slots).filter((s) => s.teacher_id === teacherId);

  const load = useCallback(() => {
    if (!institutionId) return;
    api.listEvents(institutionId).then(setEvents).catch(() => {});
  }, [institutionId]);
  useFocusEffect(load);

  if (role === 'admin') return <Redirect href="/home" />;
  return (
    <Screen>
      <Row gap={12} style={{ marginBottom: space.lg, justifyContent: 'space-between' }}>
        <Row gap={12} style={{ flex: 1 }}>
          <Avatar name={account?.name ?? '?'} size={44} />
          <View style={{ flex: 1 }}>
            <T v="h1" numberOfLines={1}>
              {account?.name}
            </T>
            <T v="small" numberOfLines={1}>
              {profile.institution.name}
            </T>
          </View>
        </Row>
        <Button label="Theme" kind="ghost" size="sm" onPress={toggle} />
      </Row>

      <Button label="Mark a student" icon="create-outline" size="lg" full onPress={() => router.push('/mark')} />

      <SectionTitle title="Your classes today" />
      {mine.length ? (
        <View style={{ gap: space.sm }}>
          {mine.map((s) => (
            <Card key={s.id} style={{ paddingVertical: space.md }}>
              <Row gap={12}>
                <T v="mono" style={{ width: 44 }}>
                  {s.slot.split('-')[0]}
                </T>
                <View style={{ flex: 1 }}>
                  <T v="h3">{names[s.subject_id] ?? 'Class'}</T>
                  <T v="small">
                    {names[s.division_id] ?? ''}
                    {s.batch ? ` ${s.batch}` : ''} · {names[s.room_id] ?? ''}
                  </T>
                </View>
              </Row>
            </Card>
          ))}
        </View>
      ) : (
        <T v="small">{liveSessions.length ? 'No classes for you today.' : 'The college hasn’t approved a timetable yet.'}</T>
      )}

      <SectionTitle title="What you’ve recorded" />
      {events.filter((e) => e.status !== 'void').length ? (
        <Card style={{ gap: 2 }}>
          {events
            .filter((e) => e.status !== 'void')
            .slice(0, 15)
            .map((event) => (
              <Pressable key={event.id} accessibilityRole="link" onPress={() => router.push(`/student/${event.studentId}`)} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border }}>
                <Row gap={8} style={{ justifyContent: 'space-between' }}>
                  <T v="label" style={{ flex: 1, color: c.text }} numberOfLines={1}>
                    {event.studentName}
                  </T>
                  {event.status === 'open' ? <Pill label="With the office" tone="warn" /> : null}
                </Row>
                <T v="small" numberOfLines={1}>
                  {describeEvent(event)} · {event.divisionName} · {event.date}
                </T>
              </Pressable>
            ))}
        </Card>
      ) : (
        <T v="small">Nothing yet.</T>
      )}

      <SectionTitle title="Account" />
      <View style={{ gap: space.sm }}>
        {changing ? (
          <Card style={{ gap: space.md }}>
            <Field label="Current password" secureTextEntry value={current} onChangeText={setCurrent} />
            <Field label="New password" secureTextEntry value={next} onChangeText={setNext} hint="At least 8 characters" />
            <Row gap={8}>
              <Button
                label="Save"
                size="sm"
                disabled={!current || next.length < 8}
                onPress={() =>
                  api
                    .changePassword(current, next)
                    .then(() => {
                      setChanging(false);
                      setCurrent('');
                      setNext('');
                      toast.show('Password changed.');
                    })
                    .catch((e) => toast.show(e instanceof Error ? e.message : 'Could not change it.'))
                }
              />
              <Button label="Cancel" kind="ghost" size="sm" onPress={() => setChanging(false)} />
            </Row>
          </Card>
        ) : (
          <Button label="Change password" kind="secondary" icon="key-outline" onPress={() => setChanging(true)} />
        )}
        <Button label="Sign out" kind="secondary" icon="log-out-outline" onPress={() => store.signOut().then(() => router.replace('/welcome'))} />
      </View>
      <Row gap={6} style={{ marginTop: space.lg }}>
        <Icon name="information-circle-outline" size={16} color={c.muted} />
        <T v="small" style={{ flex: 1 }}>
          Your college’s office manages the timetable and sees all student records.
        </T>
      </Row>
    </Screen>
  );
}
