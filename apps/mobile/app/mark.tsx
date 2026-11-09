import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EVENT_KINDS, allStudents, classNow, findStudent, searchStudents, toDateKey, type EventKind, type StudentRef } from '@core';
import { api } from '../src/api';
import { useStore } from '../src/store';
import { radius, space, useTheme } from '../src/theme';
import { Background, Button, Card, Chip, Empty, Field, Icon, IconButton, Row, T, useToast } from '../src/ui';

const MINUTES = [5, 10, 15, 20, 30];

function StudentTile({ student, on, onPress }: { student: StudentRef; on: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${student.name}, ${student.rollNo}`}
      onPress={onPress}
      style={({ pressed }) => ({ flexGrow: 1, flexBasis: 150, padding: space.sm + 2, borderRadius: radius.md, borderWidth: 1, borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accentSoft : c.surface2, opacity: pressed ? 0.8 : 1 })}
    >
      <T v="mono">{student.rollNo}</T>
      <T v="label" numberOfLines={1} style={{ color: c.text }}>
        {student.name}
      </T>
    </Pressable>
  );
}

/** Pick one or several students, say what happened, and save. Stays open for the next one. */
export default function Mark() {
  const params = useLocalSearchParams<{ student?: string; kind?: string }>();
  const { profile, institutionId, liveSessions, slots, teacherId } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const now = new Date();

  // Start on the class this teacher has right now, if there is one.
  const startClass = useMemo(() => {
    const given = params.student ? findStudent(profile, params.student)?.divisionId : undefined;
    if (given) return given;
    const mine = teacherId ? profile.divisions.find((d) => liveSessions.some((s) => s.teacher_id === teacherId && s.division_id === d.id && classNow({ divisionId: d.id }, [s], slots, now))) : undefined;
    return (mine ?? profile.divisions.find((d) => d.students?.length))?.id ?? '';
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [divisionId, setDivisionId] = useState(startClass);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>(params.student ? [params.student] : []);
  const [kind, setKind] = useState<EventKind>((params.kind as EventKind) || 'late');
  const [minutes, setMinutes] = useState<number | null>(10);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const everyone = useMemo(() => allStudents(profile), [profile]);
  const shown = query.trim() ? searchStudents(profile, query) : everyone.filter((s) => s.divisionId === divisionId);
  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const needsNote = kind === 'other' && !note.trim();

  const save = async () => {
    if (!institutionId) return;
    setSaving(true);
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const made: string[] = [];
    let failure = '';
    for (const id of picked) {
      const student = findStudent(profile, id);
      const session = student ? classNow(student, liveSessions, slots) : null;
      try {
        const event = await api.createEvent(institutionId, {
          studentId: id,
          kind,
          date: toDateKey(new Date()),
          time,
          ...(session ? { slot: session.slot } : {}),
          ...(kind === 'late' && minutes ? { minutesLate: minutes } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        made.push(event.id);
      } catch (e) {
        failure = e instanceof Error ? e.message : 'Could not save that.';
      }
    }
    setSaving(false);
    if (failure) {
      toast.show(failure);
      return;
    }
    const label = EVENT_KINDS.find((k) => k.id === kind)?.label ?? 'Marked';
    toast.show(`${label}: ${made.length} student${made.length === 1 ? '' : 's'} saved.`, {
      label: 'Undo',
      onPress: () => {
        Promise.all(made.map((id) => api.voidEvent(id, 'Undone straight away')))
          .then(() => toast.show('Undone.'))
          .catch((e) => toast.show(e instanceof Error ? e.message : 'Could not undo.'));
      },
    });
    setPicked([]);
    setNote('');
    setQuery('');
  };

  return (
    <View style={{ flex: 1 }}>
      <Background />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, width: '100%', maxWidth: 1000, alignSelf: 'center' }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
            <Row gap={12}>
              <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
              <View style={{ flex: 1 }}>
                <T v="h1">Mark a student</T>
                <T v="small">Choose what happened, tap the students, and save.</T>
              </View>
            </Row>

            {!everyone.length ? (
              <Empty icon="people-outline" title="No class lists yet" text="Students need to be added to their classes before they can be marked." />
            ) : (
              <>
                <Card style={{ gap: space.md }}>
                  <Row wrap gap={8}>
                    {EVENT_KINDS.map((option) => (
                      <Chip key={option.id} label={option.label} active={kind === option.id} tone={option.flag && kind === option.id ? 'danger' : undefined} onPress={() => setKind(option.id)} />
                    ))}
                  </Row>
                  {kind === 'late' ? (
                    <Row wrap gap={8}>
                      {MINUTES.map((m) => (
                        <Chip key={m} label={`${m} min`} active={minutes === m} onPress={() => setMinutes(minutes === m ? null : m)} />
                      ))}
                    </Row>
                  ) : null}
                  <Field label={kind === 'other' ? 'Remark' : 'Remark (optional)'} placeholder={kind === 'late' ? 'e.g. Bus was late' : 'e.g. Near the canteen during period 3'} value={note} onChangeText={setNote} />
                  {kind === 'outside' || kind === 'bunked' ? (
                    <Row gap={8}>
                      <Icon name="eye-outline" size={16} color={c.muted} />
                      <T v="small" style={{ flex: 1 }}>
                        This goes to the college office to review.
                      </T>
                    </Row>
                  ) : null}
                </Card>

                <Card style={{ gap: space.md }}>
                  <Field placeholder="Name or roll number, in any class" value={query} onChangeText={setQuery} autoCorrect={false} />
                  {!query.trim() ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {profile.divisions
                        .filter((d) => d.students?.length)
                        .map((d) => (
                          <Chip key={d.id} label={d.name} active={d.id === divisionId} onPress={() => setDivisionId(d.id)} />
                        ))}
                    </ScrollView>
                  ) : null}
                  {shown.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {shown.map((student) => (
                        <StudentTile key={student.id} student={student} on={picked.includes(student.id)} onPress={() => toggle(student.id)} />
                      ))}
                    </View>
                  ) : (
                    <T v="small">Nobody matches that.</T>
                  )}
                </Card>
              </>
            )}
          </ScrollView>
          {everyone.length ? (
            <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bg }}>
              <Button label={picked.length ? `Save for ${picked.length} student${picked.length === 1 ? '' : 's'}` : 'Tap the students above'} icon="checkmark" size="lg" full disabled={!picked.length || needsNote} loading={saving} onPress={save} />
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
