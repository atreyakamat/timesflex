import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { sessionsOnDay, subjectDivisions, teacherCapacity, teacherFor, teacherLoad, weekAsText, whatsappLink, type TeacherForm } from '@core';
import { useStore } from '../../src/store';
import { space, useTheme } from '../../src/theme';
import { Avatar, Button, Card, Chip, Empty, Field, IconButton, Progress, Row, Screen, SectionTitle, Stepper, T } from '../../src/ui';

/** One professor's profile: who they are, what they know, what they teach, and their week. */
export default function TeacherProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, update, liveSessions, slots, names } = useStore();
  const { c } = useTheme();
  const teacher = profile.teachers.find((t) => t.id === id);
  const [tag, setTag] = useState('');
  if (!teacher) {
    return (
      <Screen>
        <Empty icon="person-outline" title="Teacher not found" action={<Button label="Back" onPress={() => router.back()} />} />
      </Screen>
    );
  }
  const set = (patch: Partial<TeacherForm>) => update((p) => ({ ...p, teachers: p.teachers.map((t) => (t.id === teacher.id ? { ...t, ...patch } : t)) }));
  const load = teacherLoad(teacher, profile);
  const cap = teacherCapacity(teacher, profile.institution.workingDays);
  const teaches = profile.subjects
    .map((s) => ({ s, classes: subjectDivisions(s, profile.divisions).filter((d) => teacherFor(s, d.id) === teacher.id) }))
    .filter((x) => x.classes.length);
  const mine = liveSessions.filter((s) => s.teacher_id === teacher.id);
  const addTag = () => {
    const clean = tag.trim();
    if (clean && !teacher.expertise?.some((e) => e.toLowerCase() === clean.toLowerCase())) set({ expertise: [...(teacher.expertise ?? []), clean] });
    setTag('');
  };
  const text = weekAsText({ title: teacher.name, sessions: mine, days: profile.institution.workingDays, slots, names, perspective: 'teacher' });

  return (
    <Screen>
      <Row style={{ marginBottom: space.lg }}>
        <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/setup/teachers'))} />
      </Row>
      <Card style={{ gap: space.md }}>
        <Row gap={16}>
          <Avatar name={teacher.name} size={72} />
          <View style={{ flex: 1, gap: 4 }}>
            <T v="h1">{teacher.name}</T>
            <T>{teacher.designation || 'Teacher'}{profile.department.name ? ` · ${profile.department.name}` : ''}</T>
          </View>
        </Row>
        <Progress value={cap ? load / cap : 0} tone={load > cap ? 'danger' : undefined} />
        <T v="small" color={load > cap ? c.danger : undefined}>
          {load} of {cap} periods a week{load > cap ? ' — more than their limits allow' : ''}
        </T>
      </Card>

      <SectionTitle title="Expertise" />
      <Card style={{ gap: space.md }}>
        <Row wrap gap={8}>
          {(teacher.expertise ?? []).map((e) => (
            <Chip key={e} label={e} active icon="close" onPress={() => set({ expertise: teacher.expertise!.filter((x) => x !== e) })} />
          ))}
          {!teacher.expertise?.length && <T v="small">No expertise yet. It helps suggest the right teacher for each subject.</T>}
        </Row>
        <Field placeholder="Add expertise, e.g. Machine Learning" value={tag} onChangeText={setTag} onSubmitEditing={addTag} returnKeyType="done" />
      </Card>

      <SectionTitle title="Teaches" />
      <Card style={{ gap: 6 }}>
        {teaches.length ? (
          teaches.map(({ s, classes }) => (
            <Row key={s.id} style={{ justifyContent: 'space-between' }}>
              <T v="label">{s.name}</T>
              <T v="small">{classes.map((d) => d.name).join(', ')}</T>
            </Row>
          ))
        ) : (
          <T v="small">Nothing assigned yet.</T>
        )}
      </Card>

      <SectionTitle title="Limits and days" />
      <Card style={{ gap: space.md }}>
        <Row gap={space.lg} wrap>
          <Stepper label="Max a day" value={teacher.maxLecturesPerDay} min={1} max={10} onChange={(n) => set({ maxLecturesPerDay: n })} />
          <Stepper label="Max a week" value={teacher.maxLecturesPerWeek} min={1} max={50} onChange={(n) => set({ maxLecturesPerWeek: n })} />
        </Row>
        <T v="label">Never teaches on</T>
        <Row wrap gap={8}>
          {profile.institution.workingDays.map((day) => {
            const off = teacher.unavailableDays?.includes(day);
            return (
              <Chip
                key={day}
                label={day.slice(0, 3)}
                active={off}
                tone="danger"
                onPress={() => set({ unavailableDays: off ? teacher.unavailableDays!.filter((d) => d !== day) : [...(teacher.unavailableDays ?? []), day] })}
              />
            );
          })}
        </Row>
        <Chip label={teacher.canTeachLabs === false ? 'Does not take labs' : 'Takes labs'} active={teacher.canTeachLabs !== false} onPress={() => set({ canTeachLabs: teacher.canTeachLabs === false })} />
      </Card>

      <SectionTitle title="About" />
      <Card style={{ gap: space.md }}>
        <Field label="Designation" value={teacher.designation ?? ''} onChangeText={(designation) => set({ designation })} placeholder="e.g. Associate Professor" />
        <Field label="Qualification" value={teacher.qualification ?? ''} onChangeText={(qualification) => set({ qualification })} placeholder="e.g. M.Tech, PhD" />
        <Field label="E-mail" value={teacher.email ?? ''} onChangeText={(email) => set({ email })} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Phone / WhatsApp" value={teacher.phone ?? ''} onChangeText={(phone) => set({ phone })} keyboardType="phone-pad" />
      </Card>

      <SectionTitle title="Their week" />
      <Card style={{ gap: 8 }}>
        {!mine.length && <T v="small">No timetable yet.</T>}
        {profile.institution.workingDays.map((day) => {
          const list = sessionsOnDay(mine, day, slots);
          if (!list.length) return null;
          return (
            <View key={day} style={{ gap: 2 }}>
              <T v="label">{day}</T>
              {list.map((s) => (
                <T key={s.id} v="small">
                  {s.slot.split('-')[0]} · {names[s.subject_id]} · {names[s.division_id]}
                  {s.batch ? ` ${s.batch}` : ''} · {names[s.room_id]}
                </T>
              ))}
            </View>
          );
        })}
        {mine.length > 0 && teacher.phone ? <Button label="Send on WhatsApp" icon="logo-whatsapp" size="sm" onPress={() => Linking.openURL(whatsappLink(teacher.phone!, text))} /> : null}
      </Card>

      <Button
        label="Remove teacher"
        kind="ghost"
        style={{ marginTop: space.xl }}
        onPress={() => {
          update((p) => ({ ...p, teachers: p.teachers.filter((t) => t.id !== teacher.id) }));
          router.back();
        }}
      />
    </Screen>
  );
}
