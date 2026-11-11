import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import {
  applyActions,
  batchNames,
  buildSlots,
  classGroups,
  createId,
  divisionSize,
  hasExpertise,
  nextName,
  subjectDivisions,
  teacherCapacity,
  teacherLoad,
  type DivisionForm,
  type RoomForm,
  type SubjectForm,
} from '@core';
import { useStore, type Profile } from '../../src/store';
import { space, useTheme } from '../../src/theme';
import { Avatar, Button, Card, Chip, Empty, Field, Icon, IconButton, Progress, Row, Screen, Segmented, Sheet, Stepper, T, useToast } from '../../src/ui';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TITLES: Record<string, string> = { basics: 'Basics', teachers: 'Teachers', classes: 'Classes', rooms: 'Rooms & labs', subjects: 'Subjects' };

export default function Setup() {
  const { section = 'basics' } = useLocalSearchParams<{ section: string }>();
  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.lg }}>
        <Row gap={12}>
          <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))} />
          <T v="h1">{TITLES[section] ?? 'Setup'}</T>
        </Row>
        <IconButton icon="sparkles" label="Ask the assistant" onPress={() => router.push('/assistant')} />
      </Row>
      {section === 'basics' && <Basics />}
      {section === 'teachers' && <Teachers />}
      {section === 'classes' && <Classes />}
      {section === 'rooms' && <Rooms />}
      {section === 'subjects' && <Subjects />}
    </Screen>
  );
}

function Basics() {
  const { profile, update } = useStore();
  const inst = profile.institution;
  const set = (patch: Partial<typeof inst>) => update((p) => ({ ...p, institution: { ...p.institution, ...patch } }));
  const slots = buildSlots(inst.startTime, inst.endTime, inst.slotDurationMinutes, inst.breakAfterSlots, inst.breakDurationMinutes);
  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.md }}>
        <Field label="Institution name" value={inst.name} onChangeText={(name) => set({ name })} />
        <Field label="Academic year" placeholder="e.g. 2026-27" value={inst.academicYear ?? ''} onChangeText={(academicYear) => set({ academicYear })} />
      </Card>
      <Card style={{ gap: space.md }}>
        <T v="h3">Working days</T>
        <Row wrap gap={8}>
          {DAYS.map((day) => {
            const on = inst.workingDays.includes(day);
            return <Chip key={day} label={day.slice(0, 3)} active={on} onPress={() => set({ workingDays: on ? inst.workingDays.filter((d) => d !== day) : DAYS.filter((d) => d === day || inst.workingDays.includes(d)) })} />;
          })}
        </Row>
        <Row gap={space.lg} wrap>
          <Stepper label="Day starts (hour)" value={Number(inst.startTime.slice(0, 2))} min={6} max={13} onChange={(h) => set({ startTime: `${String(h).padStart(2, '0')}:00` })} />
          <Stepper label="Day ends (hour)" value={Number(inst.endTime.slice(0, 2))} min={11} max={21} onChange={(h) => set({ endTime: `${String(h).padStart(2, '0')}:00` })} />
        </Row>
        <T v="label">Period length</T>
        <Row wrap gap={8}>
          {[40, 45, 50, 55, 60].map((m) => (
            <Chip key={m} label={`${m} min`} active={inst.slotDurationMinutes === m} onPress={() => set({ slotDurationMinutes: m })} />
          ))}
        </Row>
        <T v="label">Break</T>
        <Row wrap gap={8}>
          <Chip label="None" active={!inst.breakAfterSlots} onPress={() => set({ breakAfterSlots: null, breakDurationMinutes: null })} />
          {[2, 3, 4, 5].map((n) => (
            <Chip key={n} label={`After P${n}`} active={inst.breakAfterSlots === n} onPress={() => set({ breakAfterSlots: n, breakDurationMinutes: inst.breakDurationMinutes || 30 })} />
          ))}
        </Row>
        <T v="small">
          {slots.length} periods a day · {slots.length * inst.workingDays.length} a week
        </T>
      </Card>
    </View>
  );
}

function Teachers() {
  const { profile, update } = useStore();
  const { c } = useTheme();
  const [name, setName] = useState('');
  const [expertise, setExpertise] = useState('');
  const add = () => {
    if (!name.trim()) return;
    const tags = expertise.split(',').map((s) => s.trim()).filter(Boolean);
    update((p) => applyActions(p, [{ type: 'addTeacher', name: name.trim(), ...(tags.length ? { expertise: tags } : {}) }]) as Profile);
    setName('');
    setExpertise('');
  };
  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.md }}>
        <T v="h3">Add a teacher</T>
        <Field placeholder="Name, e.g. Prof. Anita Mehta" value={name} onChangeText={setName} onSubmitEditing={add} />
        <Field placeholder="Expertise, e.g. Databases, SQL (optional)" value={expertise} onChangeText={setExpertise} onSubmitEditing={add} />
        <Button label="Add teacher" icon="person-add-outline" onPress={add} disabled={!name.trim()} />
      </Card>
      {!profile.teachers.length && <Empty icon="person-outline" title="No teachers yet" text="Add them one by one; each gets a profile." />}
      {profile.teachers.map((t) => {
        const load = teacherLoad(t, profile);
        const cap = teacherCapacity(t, profile.institution.workingDays);
        return (
          <Card key={t.id} onPress={() => router.push({ pathname: '/teacher/[id]', params: { id: t.id } })} tone={load > cap ? 'warn' : undefined}>
            <Row gap={12}>
              <Avatar name={t.name} />
              <View style={{ flex: 1, gap: 4 }}>
                <T v="h3">{t.name}</T>
                <T v="small" numberOfLines={1}>
                  {[t.designation, t.expertise?.join(', ')].filter(Boolean).join(' · ') || 'Tap to add expertise and limits'}
                </T>
                <Progress value={cap ? load / cap : 0} tone={load > cap ? 'danger' : undefined} />
                <T v="small" color={load > cap ? c.danger : undefined}>
                  {load} of {cap} periods a week
                </T>
              </View>
              <Icon name="chevron-forward" size={20} color={c.muted} />
            </Row>
          </Card>
        );
      })}
    </View>
  );
}

/** Deleting takes one tap, so taking it back should too. */
const useRemoval = () => {
  const { profile, update } = useStore();
  const toast = useToast();
  return (what: string, change: (p: Profile) => Profile) => {
    const before = profile;
    update(change);
    toast.show(`${what} removed.`, { label: 'Undo', onPress: () => update(() => before) });
  };
};

function Classes() {
  const { profile, update } = useStore();
  const remove = useRemoval();
  const [editing, setEditing] = useState<DivisionForm | null>(null);
  const last = profile.divisions[profile.divisions.length - 1];
  const save = (division: DivisionForm) => {
    update((p) => ({ ...p, divisions: p.divisions.some((d) => d.id === division.id) ? p.divisions.map((d) => (d.id === division.id ? division : d)) : [...p.divisions, division] }));
    setEditing(null);
  };
  return (
    <View style={{ gap: space.md }}>
      <Row gap={8} wrap>
        <Button label="Change years and branches" icon="grid-outline" onPress={() => router.push('/onboarding?step=classes')} />
        <Button label="Add one class" kind="ghost" icon="add" onPress={() => setEditing({ id: createId(), name: (last && nextName(last.name)) || '', size: 60, batches: [] })} />
      </Row>
      {!profile.divisions.length && <Empty icon="people-outline" title="No classes yet" />}
      {profile.divisions.map((d) => (
        <Card key={d.id} onPress={() => setEditing(d)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ gap: 2 }}>
              <T v="h3">{d.name}</T>
              <T v="small">
                {divisionSize(d) || '?'} students{d.batches.length ? ` · batches ${d.batches.join(', ')}` : ''}
                {d.classTeacherId ? ` · class teacher ${profile.teachers.find((t) => t.id === d.classTeacherId)?.name ?? ''}` : ''}
              </T>
            </View>
            <Icon name="create-outline" size={20} />
          </Row>
        </Card>
      ))}
      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing && profile.divisions.some((d) => d.id === editing.id) ? `Edit ${editing.name}` : 'New class'}>
        {editing && (
          <>
            <Field label="Name" value={editing.name} onChangeText={(name) => setEditing({ ...editing, name })} placeholder="e.g. SE-A" />
            <Stepper label="Students" value={editing.size ?? 60} min={1} max={400} step={5} onChange={(size) => setEditing({ ...editing, size })} />
            <T v="label">Lab batches</T>
            <Segmented
              options={[
                { value: '0', label: 'None' },
                { value: '2', label: '2' },
                { value: '3', label: '3' },
                { value: '4', label: '4' },
              ]}
              value={String(editing.batches.length) as '0'}
              onChange={(n) => setEditing({ ...editing, batches: Number(n) ? batchNames(editing.name, Number(n)) : [] })}
            />
            <T v="label">Class teacher</T>
            <Row wrap gap={8}>
              {profile.teachers.map((t) => (
                <Chip key={t.id} label={t.name} active={editing.classTeacherId === t.id} onPress={() => setEditing({ ...editing, classTeacherId: editing.classTeacherId === t.id ? undefined : t.id })} />
              ))}
            </Row>
            <Button label="Save" onPress={() => save(editing)} disabled={!editing.name.trim()} />
            {profile.divisions.some((d) => d.id === editing.id) && (
              <Button
                label="Delete class"
                kind="ghost"
                onPress={() => {
                  remove(editing.name, (p) => ({ ...p, divisions: p.divisions.filter((d) => d.id !== editing.id) }));
                  setEditing(null);
                }}
              />
            )}
          </>
        )}
      </Sheet>
    </View>
  );
}

function Rooms() {
  const { profile, update, liveSessions } = useStore();
  const remove = useRemoval();
  const [editing, setEditing] = useState<RoomForm | null>(null);
  const last = profile.rooms[profile.rooms.length - 1];
  const save = (room: RoomForm) => {
    update((p) => ({ ...p, rooms: p.rooms.some((r) => r.id === room.id) ? p.rooms.map((r) => (r.id === room.id ? room : r)) : [...p.rooms, room] }));
    setEditing(null);
  };
  return (
    <View style={{ gap: space.md }}>
      <Button label="Add a room or lab" icon="add" onPress={() => setEditing({ id: createId(), name: (last && nextName(last.name)) || '', type: last?.type ?? 'classroom', capacity: last?.capacity ?? 60 })} />
      {!profile.rooms.length && <Empty icon="business-outline" title="No rooms yet" />}
      {profile.rooms.map((r) => (
        <Card key={r.id} onPress={() => setEditing(r)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <T v="h3">{r.name}</T>
              <T v="small">
                {r.type === 'seminar-hall' ? 'Hall' : r.type === 'lab' ? 'Lab' : 'Classroom'} · {r.capacity} seats{r.equipment ? ` · ${r.equipment}` : ''}
              </T>
            </View>
            <Icon name="create-outline" size={20} />
          </Row>
        </Card>
      ))}
      <Sheet visible={!!editing} onClose={() => setEditing(null)} title="Room">
        {editing && (
          <>
            <Field label="Name" value={editing.name} onChangeText={(name) => setEditing({ ...editing, name })} />
            <Segmented
              options={[
                { value: 'classroom', label: 'Classroom' },
                { value: 'lab', label: 'Lab' },
                { value: 'seminar-hall', label: 'Hall' },
              ]}
              value={editing.type}
              onChange={(type) => setEditing({ ...editing, type })}
            />
            <Stepper label="Seats" value={editing.capacity} min={1} max={500} step={5} onChange={(capacity) => setEditing({ ...editing, capacity })} />
            {editing.type === 'lab' && <Field label="Equipment / software" value={editing.equipment ?? ''} onChangeText={(equipment) => setEditing({ ...editing, equipment })} placeholder="e.g. 30 PCs, MySQL" />}
            <Button label="Save" onPress={() => save(editing)} disabled={!editing.name.trim()} />
            {liveSessions.some((s) => s.room_id === editing.id) && (
              <T v="small">
                {liveSessions.filter((s) => s.room_id === editing.id).length} classes are in this room. If you delete it, the timetable will offer to move them to free rooms.
              </T>
            )}
            {profile.rooms.some((r) => r.id === editing.id) && (
              <Button
                label="Delete room"
                kind="ghost"
                onPress={() => {
                  remove(editing.name, (p) => ({ ...p, rooms: p.rooms.filter((r) => r.id !== editing.id) }));
                  setEditing(null);
                }}
              />
            )}
          </>
        )}
      </Sheet>
    </View>
  );
}

function Subjects() {
  const { profile, update } = useStore();
  const remove = useRemoval();
  const { c } = useTheme();
  const [editing, setEditing] = useState<SubjectForm | null>(null);
  const save = (subject: SubjectForm) => {
    update((p) => ({ ...p, subjects: p.subjects.some((s) => s.id === subject.id) ? p.subjects.map((s) => (s.id === subject.id ? subject : s)) : [...p.subjects, subject] }));
    setEditing(null);
  };
  const teacherName = (id: string) => profile.teachers.find((t) => t.id === id)?.name;
  return (
    <View style={{ gap: space.md }}>
      <Button label="Add subjects by year and branch" icon="grid-outline" onPress={() => router.push('/onboarding?step=subjects')} />
      <Button
        label="Add one subject"
        kind="ghost"
        icon="add"
        onPress={() => setEditing({ id: createId(), name: '', isLab: false, sessionsPerWeek: 3, durationSlots: 1, teacherId: '', roomId: '', divisionIds: [], teacherOverrides: {} })}
      />
      {!profile.subjects.length && <Empty icon="book-outline" title="No subjects yet" />}
      {profile.subjects.map((s, index) => (
        <View key={s.id} style={{ gap: space.sm }}>
        {index === 0 || (profile.subjects[index - 1].group ?? '') !== (s.group ?? '') ? <T v="eyebrow" style={{ marginTop: index ? space.md : 0 }}>{classGroups(profile).find((g) => g.key === (s.group ?? ''))?.label ?? 'Other subjects'}</T> : null}
        <Card onPress={() => setEditing(s)} tone={!teacherName(s.teacherId) && !Object.keys(s.teacherOverrides ?? {}).length ? 'warn' : undefined}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <T v="h3">
                {s.code ? `${s.code} · ` : ''}
                {s.name}
              </T>
              <T v="small">
                {s.isLab ? `Lab, ${s.durationSlots} periods` : 'Lecture'} · {s.sessionsPerWeek}× a week · {teacherName(s.teacherId) ?? 'needs a teacher'} ·{' '}
                {subjectDivisions(s, profile.divisions).map((d) => d.name).join(', ') || 'no classes'}
              </T>
            </View>
            <Icon name="create-outline" size={20} />
          </Row>
        </Card>
        </View>
      ))}
      <Sheet visible={!!editing} onClose={() => setEditing(null)} title="Subject">
        {editing && (
          <>
            <Field label="Name" value={editing.name} onChangeText={(name) => setEditing({ ...editing, name })} placeholder="e.g. Operating Systems" />
            <Field label="Code (optional)" value={editing.code ?? ''} onChangeText={(code) => setEditing({ ...editing, code })} placeholder="e.g. CS302" />
            <Segmented
              options={[
                { value: 'lecture', label: 'Lecture' },
                { value: 'lab', label: 'Lab' },
              ]}
              value={editing.isLab ? 'lab' : 'lecture'}
              onChange={(v) => setEditing({ ...editing, isLab: v === 'lab', durationSlots: v === 'lab' ? 2 : 1, sessionsPerWeek: v === 'lab' ? 1 : editing.sessionsPerWeek })}
            />
            <Row gap={space.lg} wrap>
              <Stepper label="Times a week" value={editing.sessionsPerWeek} min={1} max={12} onChange={(n) => setEditing({ ...editing, sessionsPerWeek: n })} />
              {editing.isLab && <Stepper label="Periods each" value={editing.durationSlots} min={1} max={4} onChange={(n) => setEditing({ ...editing, durationSlots: n })} />}
            </Row>
            <T v="label">Taught by (★ = matching expertise)</T>
            <Row wrap gap={8}>
              {[...profile.teachers]
                .sort((a, b) => Number(hasExpertise(b, editing.name)) - Number(hasExpertise(a, editing.name)))
                .map((t) => (
                  <Chip key={t.id} label={t.name} icon={editing.name && hasExpertise(t, editing.name) ? 'star' : undefined} active={editing.teacherId === t.id} onPress={() => setEditing({ ...editing, teacherId: t.id })} />
                ))}
            </Row>
            <T v="label">For classes</T>
            <Row wrap gap={8}>
              {profile.divisions.map((d) => {
                const chosen = editing.divisionIds?.length ? editing.divisionIds : profile.divisions.map((x) => x.id);
                const on = chosen.includes(d.id);
                return (
                  <Chip
                    key={d.id}
                    label={d.name}
                    active={on}
                    onPress={() => {
                      const next = on ? chosen.filter((id) => id !== d.id) : [...chosen, d.id];
                      setEditing({ ...editing, divisionIds: next.length === profile.divisions.length || !next.length ? [] : next });
                    }}
                  />
                );
              })}
            </Row>
            <Button label="Save" onPress={() => save(editing)} disabled={!editing.name.trim() || !editing.teacherId} />
            {!editing.teacherId && <T v="small" color={c.warn}>Pick who teaches it.</T>}
            {profile.subjects.some((s) => s.id === editing.id) && (
              <Button
                label="Delete subject"
                kind="ghost"
                onPress={() => {
                  remove(editing.name, (p) => ({ ...p, subjects: p.subjects.filter((s) => s.id !== editing.id) }));
                  setEditing(null);
                }}
              />
            )}
          </>
        )}
      </Sheet>
    </View>
  );
}
