import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import {
  applyActions,
  batchNames,
  buildSlots,
  nextName,
  parseSubjectList,
  parseTeacherLines,
  seedRooms,
  seedSubjects,
  setupEstimate,
  setupInsights,
  teachableSubjects,
  teachersFor,
  type InstitutionForm,
  type LoadLine,
  type RoomForm,
} from '@core';
import { useStore, type Profile } from '../src/store';
import { radius, space, useTheme } from '../src/theme';
import { Background, Button, Card, Chip, Field, Icon, IconButton, Progress, Row, Segmented, Stepper, T } from '../src/ui';

/**
 * First-run setup, one screen at a time. The institution already exists from sign-up, so it
 * starts with teachers and what they can teach. Classes and the week follow; subjects and rooms
 * are worked out from those answers, and the last screen shows how full the week will be.
 */

/** /onboarding?demo=1 prepares a full sample college with no questions; otherwise the steps. */
export default function Onboarding() {
  const { demo } = useLocalSearchParams<{ demo?: string }>();
  return demo ? <DemoSetup /> : <Wizard />;
}

const DEMO_STEPS = ['Creating a sample engineering department', 'Adding 7 teachers, 116 students, 6 rooms and 8 subjects', 'Building 3 clash-free timetable versions', 'Ready'];

function DemoSetup() {
  const store = useStore();
  const { c } = useTheme();
  const [stage, setStage] = useState(0);
  const [error, setError] = useState('');
  const loaded = useRef(false);
  const started = useRef(false);

  // Fill the sample once the new account's institution is open...
  useEffect(() => {
    if (loaded.current || !store.institutionId) return;
    loaded.current = true;
    store.loadSample();
    setStage(1);
  }, [store.institutionId]);

  // ...then build three versions from it and land on Home.
  useEffect(() => {
    if (started.current || stage !== 1 || !store.profile.subjects.length) return;
    started.current = true;
    setStage(2);
    store
      .generateVariants(['balanced', 'compact', 'teacher_days'])
      .then(() => {
        setStage(3);
        store.finishOnboarding();
        setTimeout(() => router.replace('/home'), 700);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not build the demo.'));
  }, [stage, store.profile.subjects.length]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
      <Background />
      <Card style={{ width: '100%', maxWidth: 460, gap: space.lg, padding: space.xl }}>
        <View style={{ gap: 6 }}>
          <T v="eyebrow">Live demo</T>
          <T v="h1">Preparing your demo college</T>
          <T>About fifteen seconds. Everything you see is real: the timetable is solved live.</T>
        </View>
        <View style={{ gap: space.md }}>
          {DEMO_STEPS.map((label, index) => {
            const done = stage > index || stage === 3;
            const now = stage === index && stage !== 3;
            return (
              <Row key={label} gap={12}>
                {done ? (
                  <Icon name="checkmark-circle" size={22} color={c.ok} />
                ) : now ? (
                  <ActivityIndicator size="small" color={c.text} />
                ) : (
                  <Icon name="ellipse-outline" size={22} color={c.muted} />
                )}
                <T style={{ flex: 1, color: done || now ? c.text : c.muted }}>{label}</T>
              </Row>
            );
          })}
        </View>
        {error ? (
          <>
            <T color={c.danger}>{error}</T>
            <Button label="Go to the app" onPress={() => router.replace('/home')} />
          </>
        ) : null}
      </Card>
    </View>
  );
}

/** Time still ahead when each step opens, shown so nobody wonders how long this will take. */
type Step = 'teachers' | 'classes' | 'week' | 'subjects' | 'rooms' | 'review';
const STEPS: { id: Exclude<Step, 'review'>; minutes: number }[] = [
  { id: 'teachers', minutes: 5 },
  { id: 'classes', minutes: 3 },
  { id: 'week', minutes: 2 },
  { id: 'subjects', minutes: 2 },
  { id: 'rooms', minutes: 1 },
];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDER: Step[] = ['teachers', 'classes', 'week', 'subjects', 'rooms', 'review'];
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Coming back later picks up where the information runs out. */
const firstUnfinished = (profile: Profile): Step => {
  if (!profile.teachers.length) return 'teachers';
  if (!profile.divisions.length) return 'classes';
  if (!profile.subjects.length) return 'week';
  if (!profile.rooms.length) return 'rooms';
  return 'review';
};

function Wizard() {
  const store = useStore();
  const { profile, update } = store;
  const [step, setStep] = useState<Step>(() => firstUnfinished(profile));

  const goTo = (next: Step) => {
    // Subjects and rooms are worked out from what came before, ready to change.
    if (next === 'subjects') update((p) => seedSubjects(p));
    if (next === 'rooms') update((p) => seedRooms(p));
    setStep(next);
  };
  const forward = () => goTo(ORDER[ORDER.indexOf(step) + 1]);
  const back = () => setStep(ORDER[Math.max(0, ORDER.indexOf(step) - 1)]);
  const finish = (to: '/home' | '/timetable') => {
    store.finishOnboarding();
    router.replace(to);
  };
  const useSample = () => {
    store.loadSample();
    setStep('review');
  };

  const index = STEPS.findIndex((item) => item.id === step);
  const minutes = STEPS[index]?.minutes;

  return (
    <View style={{ flex: 1 }}>
      <Background />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: space.lg }}>
        <Row gap={12} style={{ paddingTop: space.xl, paddingBottom: space.md }}>
          {step !== 'teachers' ? <IconButton icon="arrow-back" label="Back" onPress={back} /> : null}
          <View style={{ flex: 1, gap: 6 }}>
            <T v="label">{step === 'review' ? 'Last check' : `Step ${index + 1} of ${STEPS.length} · about ${minutes} minute${minutes === 1 ? '' : 's'} left`}</T>
            <Progress value={step === 'review' ? 1 : index / STEPS.length} />
          </View>
          <Button label="Finish later" kind="ghost" size="sm" onPress={() => finish('/home')} />
        </Row>

        {step === 'teachers' && <TeachersStep key={step} onNext={forward} onSample={useSample} />}
        {step === 'classes' && <ClassesStep key={step} onNext={forward} />}
        {step === 'week' && <WeekStep key={step} onNext={forward} />}
        {step === 'subjects' && <SubjectsStep key={step} onNext={forward} />}
        {step === 'rooms' && <RoomsStep key={step} onNext={forward} />}
        {step === 'review' && <Review key={step} onFinish={finish} onEdit={setStep} />}
      </KeyboardAvoidingView>
    </View>
  );
}

/** A screen's content scrolls; its main button always stays in reach. */
function Page({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  const { c } = useTheme();
  return (
    <>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space.lg, paddingBottom: space.lg }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      <View style={{ gap: space.sm, paddingVertical: space.md }}>
        {footer}
        <T v="small" color={c.muted} style={{ textAlign: 'center' }}>
          Everything saves as you go.
        </T>
      </View>
    </>
  );
}

function Heading({ title, help }: { title: string; help: string }) {
  return (
    <View style={{ gap: 6 }}>
      <T v="h1">{title}</T>
      <T>{help}</T>
    </View>
  );
}

function WeekStep({ onNext }: { onNext: () => void }) {
  const { profile, update } = useStore();
  const i = profile.institution;
  const set = (patch: Partial<InstitutionForm>) => update((p) => ({ ...p, institution: { ...p.institution, ...patch } }));
  const slots = buildSlots(i.startTime, i.endTime, i.slotDurationMinutes, i.breakAfterSlots, i.breakDurationMinutes);
  const breakOptions = Array.from({ length: Math.max(0, slots.length - 1) }, (_, n) => n + 1).filter((n) => n >= 2 && n <= 5);
  return (
    <Page footer={<Button label="Looks right" icon="arrow-forward" size="lg" full disabled={!slots.length || !i.workingDays.length} onPress={onNext} />}>
      <Heading title={`Your week at ${i.name || 'your institution'}`} help="The usual week is filled in. Change anything that’s different." />
      <Card style={{ gap: space.md }}>
        <T v="label">Teaching days</T>
        <Row wrap gap={8}>
          {DAYS.map((day) => {
            const on = i.workingDays.includes(day);
            return <Chip key={day} label={day.slice(0, 3)} active={on} onPress={() => set({ workingDays: on ? i.workingDays.filter((d) => d !== day) : DAYS.filter((d) => d === day || i.workingDays.includes(d)) })} />;
          })}
        </Row>
        <T v="label">Hours</T>
        <Row wrap gap={8}>
          {[
            ['08:00', '14:00'],
            ['09:00', '16:00'],
            ['09:00', '17:00'],
            ['10:00', '17:00'],
          ].map(([start, end]) => (
            <Chip key={start + end} label={`${start} – ${end}`} active={i.startTime === start && i.endTime === end} onPress={() => set({ startTime: start, endTime: end })} />
          ))}
        </Row>
        <Row gap={space.lg} wrap>
          <Stepper label="Starts (hour)" value={Number(i.startTime.slice(0, 2))} min={6} max={13} onChange={(h) => set({ startTime: `${String(h).padStart(2, '0')}:00` })} />
          <Stepper label="Ends (hour)" value={Number(i.endTime.slice(0, 2))} min={11} max={21} onChange={(h) => set({ endTime: `${String(h).padStart(2, '0')}:00` })} />
        </Row>
        <T v="label">One period is</T>
        <Row wrap gap={8}>
          {[40, 45, 50, 55, 60].map((m) => (
            <Chip key={m} label={`${m} min`} active={i.slotDurationMinutes === m} onPress={() => set({ slotDurationMinutes: m })} />
          ))}
        </Row>
        <T v="label">Lunch break</T>
        <Row wrap gap={8}>
          <Chip label="None" active={!i.breakAfterSlots} onPress={() => set({ breakAfterSlots: null, breakDurationMinutes: null })} />
          {breakOptions.map((n) => (
            <Chip key={n} label={`After period ${n}`} active={i.breakAfterSlots === n} onPress={() => set({ breakAfterSlots: n, breakDurationMinutes: i.breakDurationMinutes || 30 })} />
          ))}
        </Row>
        <T v="small">
          That’s {slots.length} periods a day, {slots.length * i.workingDays.length} a week.
        </T>
      </Card>
    </Page>
  );
}

/** A row in an "add one at a time" list. Tapping it edits, when that is on offer. */
function Added({ items, onRemove, onEdit }: { items: { id: string; name: string; detail: string }[]; onRemove: (id: string) => void; onEdit?: (id: string) => void }) {
  const { c } = useTheme();
  if (!items.length) return null;
  return (
    <View style={{ gap: 6 }}>
      {items.map((item) => (
        <Row key={item.id} style={{ backgroundColor: c.surface2, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 12, justifyContent: 'space-between' }}>
          <Pressable style={{ flex: 1 }} disabled={!onEdit} accessibilityLabel={onEdit ? `Edit ${item.name}` : undefined} onPress={() => onEdit?.(item.id)}>
            <T v="h3">{item.name}</T>
            <T v="small">{item.detail}</T>
          </Pressable>
          <Pressable accessibilityLabel={`Remove ${item.name}`} onPress={() => onRemove(item.id)} hitSlop={10}>
            <Icon name="close-circle" size={22} color={c.muted} />
          </Pressable>
        </Row>
      ))}
    </View>
  );
}

const counted = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : one.endsWith('s') ? 'es' : 's'} added`;

function TeachersStep({ onNext, onSample }: { onNext: () => void; onSample: () => void }) {
  const { profile, update } = useStore();
  const { c } = useTheme();
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [name, setName] = useState('');
  const [subjects, setSubjects] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const nameInput = useRef<TextInput>(null);
  const typed = parseSubjectList(subjects);
  const known = teachableSubjects(profile).filter((item) => !typed.some((other) => other.toLowerCase() === item.toLowerCase()));

  const save = () => {
    const clean = name.trim();
    if (!clean) return;
    if (editing) update((p) => ({ ...p, teachers: p.teachers.map((t) => (t.id === editing ? { ...t, name: clean, expertise: typed } : t)) }));
    else update((p) => applyActions(p, [{ type: 'addTeacher', name: clean, ...(typed.length ? { expertise: typed } : {}) }]) as Profile);
    setName('');
    setSubjects('');
    setEditing(null);
    nameInput.current?.focus();
  };
  const addPasted = () => {
    const actions = parseTeacherLines(pasted).map((person) => ({ type: 'addTeacher' as const, name: person.name, ...(person.canTeach.length ? { expertise: person.canTeach } : {}) }));
    if (actions.length) update((p) => applyActions(p, actions) as Profile);
    setPasted('');
    setPasting(false);
  };
  const edit = (id: string) => {
    const teacher = profile.teachers.find((t) => t.id === id);
    if (!teacher) return;
    setEditing(id);
    setName(teacher.name);
    setSubjects((teacher.expertise ?? []).join(', '));
    setPasting(false);
  };
  const missing = profile.teachers.filter((t) => !t.expertise?.length).length;
  const ready = profile.teachers.some((t) => t.expertise?.length);

  return (
    <Page
      footer={
        <>
          <Button label="Continue" icon="arrow-forward" size="lg" full disabled={!ready} onPress={onNext} />
          {!profile.teachers.length ? <Button label="Use sample data instead" kind="ghost" onPress={onSample} /> : null}
        </>
      }
    >
      <Heading title={`Who teaches at ${profile.institution.name || 'your institution'}?`} help="Add each teacher and what they can teach. Subjects are worked out from this, so you only type them once." />
      {pasting ? (
        <Card style={{ gap: space.md }}>
          <Field
            label="One teacher a line"
            multiline
            value={pasted}
            onChangeText={setPasted}
            placeholder={'Prof. Mehta: DBMS, Operating Systems\nDr. Rao: Maths\nProf. Iyer: Networks, Networks Lab'}
            style={{ minHeight: 140, textAlignVertical: 'top' }}
          />
          <Row gap={8}>
            <Button label="Add them all" icon="people-outline" disabled={!pasted.trim()} onPress={addPasted} />
            <Button label="Cancel" kind="ghost" onPress={() => setPasting(false)} />
          </Row>
        </Card>
      ) : (
        <Card style={{ gap: space.md }}>
          <Field ref={nameInput} label="Teacher’s name" placeholder="e.g. Prof. Anita Mehta" value={name} onChangeText={setName} autoFocus returnKeyType="next" />
          <Field label="Can teach" placeholder="e.g. DBMS, Operating Systems, DBMS Lab" value={subjects} onChangeText={setSubjects} onSubmitEditing={save} returnKeyType="done" hint="Separate subjects with commas. Add “Lab” for practicals." />
          {known.length ? (
            <Row wrap gap={8}>
              {known.slice(0, 12).map((item) => (
                <Chip key={item} label={`+ ${item}`} onPress={() => setSubjects([...typed, item].join(', '))} />
              ))}
            </Row>
          ) : null}
          <Row gap={8} wrap>
            <Button label={editing ? 'Save changes' : 'Add teacher'} icon={editing ? 'checkmark' : 'person-add-outline'} onPress={save} disabled={!name.trim()} />
            {editing ? <Button label="Cancel" kind="ghost" onPress={() => { setEditing(null); setName(''); setSubjects(''); }} /> : <Button label="Paste a list instead" kind="ghost" onPress={() => setPasting(true)} />}
          </Row>
        </Card>
      )}
      {profile.teachers.length ? (
        <View style={{ gap: space.sm }}>
          <T v="label">{counted(profile.teachers.length, 'teacher')}. Tap one to change it.</T>
          <Added
            items={profile.teachers.map((t) => ({ id: t.id, name: t.name, detail: t.expertise?.join(', ') || 'Nothing to teach yet' }))}
            onEdit={edit}
            onRemove={(id) => update((p) => ({ ...p, teachers: p.teachers.filter((t) => t.id !== id) }))}
          />
        </View>
      ) : null}
      {missing ? (
        <T v="small" color={c.warn}>
          {missing} teacher{missing === 1 ? ' has' : 's have'} no subjects yet. They’ll be kept free for substitutions.
        </T>
      ) : null}
    </Page>
  );
}

function ClassesStep({ onNext }: { onNext: () => void }) {
  const { profile, update } = useStore();
  const [name, setName] = useState('');
  const [size, setSize] = useState(60);
  const [batches, setBatches] = useState<'0' | '2' | '3'>('2');
  const last = profile.divisions[profile.divisions.length - 1];
  const suggestion = last ? nextName(last.name) : null;
  const add = (value = name) => {
    const clean = value.trim();
    if (!clean || profile.divisions.some((d) => d.name.toLowerCase() === clean.toLowerCase())) return;
    update((p) => applyActions(p, [{ type: 'addClass', name: clean, size, batches: Number(batches) ? batchNames(clean, Number(batches)) : [] }]) as Profile);
    setName('');
  };
  return (
    <Page footer={<Button label="Continue" icon="arrow-forward" size="lg" full disabled={!profile.divisions.length} onPress={onNext} />}>
      <Heading title="Which classes need a timetable?" help="Each class gets its own. Batches are how a class splits up for labs." />
      <Card style={{ gap: space.md }}>
        <Field label="Class name" placeholder={suggestion ?? 'e.g. SE-A'} value={name} onChangeText={setName} onSubmitEditing={() => add()} returnKeyType="done" />
        <Row gap={space.lg} wrap align="flex-end">
          <Stepper label="Students" value={size} min={1} max={400} step={5} onChange={setSize} />
          <View style={{ gap: 6, minWidth: 200 }}>
            <T v="label">Lab batches</T>
            <Segmented options={[{ value: '0', label: 'None' }, { value: '2', label: '2' }, { value: '3', label: '3' }]} value={batches} onChange={setBatches} />
          </View>
        </Row>
        <Row gap={8} wrap>
          <Button label="Add class" icon="add" onPress={() => add()} disabled={!name.trim()} />
          {suggestion && !name ? <Chip label={`+ ${suggestion}`} onPress={() => add(suggestion)} /> : null}
        </Row>
      </Card>
      {profile.divisions.length ? (
        <View style={{ gap: space.sm }}>
          <T v="label">{counted(profile.divisions.length, 'class')}</T>
          <Added
            items={profile.divisions.map((d) => ({ id: d.id, name: d.name, detail: `${d.size ?? '?'} students${d.batches.length ? ` · batches ${d.batches.join(', ')}` : ''}` }))}
            onRemove={(id) => update((p) => ({ ...p, divisions: p.divisions.filter((d) => d.id !== id) }))}
          />
        </View>
      ) : null}
    </Page>
  );
}

function SubjectsStep({ onNext }: { onNext: () => void }) {
  const { profile, update } = useStore();
  const { c } = useTheme();
  const estimate = setupEstimate(profile);
  const change = (id: string, patch: Partial<Profile['subjects'][number]>) => update((p) => ({ ...p, subjects: p.subjects.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  return (
    <Page footer={<Button label="Continue" icon="arrow-forward" size="lg" full disabled={!profile.subjects.length} onPress={onNext} />}>
      <Heading title="How often is each subject taught?" help="These came from what your teachers can teach. Check who takes each one and how many times a week." />
      {profile.subjects.map((subject) => {
        const able = teachersFor(subject.name, profile);
        const options = able.length ? able : profile.teachers;
        const line = estimate.teachers.find((t) => t.id === subject.teacherId);
        const chosen = subject.divisionIds?.length ? subject.divisionIds : profile.divisions.map((d) => d.id);
        return (
          <Card key={subject.id} style={{ gap: space.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="h3" style={{ flex: 1 }}>
                {subject.name}
              </T>
              <Pressable accessibilityLabel={`Remove ${subject.name}`} hitSlop={10} onPress={() => update((p) => ({ ...p, subjects: p.subjects.filter((s) => s.id !== subject.id) }))}>
                <Icon name="close-circle" size={22} color={c.muted} />
              </Pressable>
            </Row>
            <Row gap={space.lg} wrap align="flex-end">
              <View style={{ gap: 6, minWidth: 180 }}>
                <T v="label">Kind</T>
                <Segmented
                  options={[{ value: 'lecture', label: 'Lecture' }, { value: 'lab', label: 'Lab' }]}
                  value={subject.isLab ? 'lab' : 'lecture'}
                  onChange={(value) => change(subject.id, value === 'lab' ? { isLab: true, durationSlots: 2, sessionsPerWeek: 1 } : { isLab: false, durationSlots: 1, sessionsPerWeek: 3 })}
                />
              </View>
              <Stepper label="Times a week" value={subject.sessionsPerWeek} min={1} max={10} onChange={(sessionsPerWeek) => change(subject.id, { sessionsPerWeek })} />
            </Row>
            <T v="label">Taught by</T>
            <Row wrap gap={8}>
              {options.map((t) => (
                <Chip key={t.id} label={t.name} active={subject.teacherId === t.id} onPress={() => change(subject.id, { teacherId: t.id })} />
              ))}
            </Row>
            {line ? (
              <T v="small" color={line.fits ? c.muted : c.danger}>
                {line.name} would teach {line.load} of {line.capacity} periods a week{line.fits ? '.' : '. That’s too many.'}
              </T>
            ) : null}
            {profile.divisions.length > 1 ? (
              <>
                <T v="label">For</T>
                <Row wrap gap={8}>
                  {profile.divisions.map((d) => {
                    const on = chosen.includes(d.id);
                    return (
                      <Chip
                        key={d.id}
                        label={d.name}
                        active={on}
                        onPress={() => {
                          const next = on ? chosen.filter((id) => id !== d.id) : [...chosen, d.id];
                          if (next.length) change(subject.id, { divisionIds: next.length === profile.divisions.length ? [] : next });
                        }}
                      />
                    );
                  })}
                </Row>
              </>
            ) : null}
          </Card>
        );
      })}
    </Page>
  );
}

function RoomsStep({ onNext }: { onNext: () => void }) {
  const { profile, update } = useStore();
  const [name, setName] = useState('');
  const [type, setType] = useState<RoomForm['type']>('classroom');
  const [seats, setSeats] = useState(60);
  const add = () => {
    const clean = name.trim();
    if (!clean || profile.rooms.some((r) => r.name.toLowerCase() === clean.toLowerCase())) return;
    update((p) => applyActions(p, [{ type: 'addRoom', name: clean, roomType: type, capacity: seats }]) as Profile);
    setName('');
  };
  return (
    <Page footer={<Button label="Continue" icon="arrow-forward" size="lg" full disabled={!profile.rooms.length} onPress={onNext} />}>
      <Heading title="Are these your rooms?" help="We suggested enough for your classes and labs. Rename them later if you like, or add your own." />
      <Added
        items={profile.rooms.map((r) => ({ id: r.id, name: r.name, detail: `${r.type === 'seminar-hall' ? 'Hall' : r.type === 'lab' ? 'Lab' : 'Classroom'} · ${r.capacity} seats` }))}
        onRemove={(id) => update((p) => ({ ...p, rooms: p.rooms.filter((r) => r.id !== id) }))}
      />
      <Card style={{ gap: space.md }}>
        <Segmented
          options={[{ value: 'classroom', label: 'Classroom' }, { value: 'lab', label: 'Lab' }, { value: 'seminar-hall', label: 'Hall' }]}
          value={type}
          onChange={(value) => {
            setType(value);
            setSeats(value === 'lab' ? 30 : value === 'seminar-hall' ? 120 : 60);
          }}
        />
        <Field label="Room name" placeholder="e.g. Room 201" value={name} onChangeText={setName} onSubmitEditing={add} />
        <Stepper label="Seats" value={seats} min={1} max={500} step={5} onChange={setSeats} />
        <Button label="Add room" kind="secondary" icon="add" onPress={add} disabled={!name.trim()} />
      </Card>
    </Page>
  );
}

function LoadBar({ line }: { line: LoadLine }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Row style={{ justifyContent: 'space-between' }} gap={8}>
        <T style={{ flex: 1 }}>{line.name}</T>
        <T v="small" color={line.fits ? c.muted : c.danger}>
          {line.load} of {line.capacity} periods a week
        </T>
      </Row>
      <Progress value={line.capacity ? Math.min(1, line.load / line.capacity) : 1} />
    </View>
  );
}

function Review({ onFinish, onEdit }: { onFinish: (to: '/home' | '/timetable') => void; onEdit: (step: Step) => void }) {
  const store = useStore();
  const { profile } = store;
  const { c } = useTheme();
  const insights = setupInsights(profile);
  const blockers = insights.filter((i) => i.level === 'blocker');
  const estimate = setupEstimate(profile);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const build = async () => {
    setError('');
    try {
      setResult(await store.generateVariants(['balanced', 'compact', 'teacher_days']));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the timetable.');
    }
  };
  const areaStep: Partial<Record<string, Step>> = { basics: 'week', teachers: 'teachers', classes: 'classes', rooms: 'rooms', subjects: 'subjects' };

  if (result) {
    return (
      <Page footer={<Button label="See my timetable" icon="arrow-forward" size="lg" full onPress={() => onFinish('/timetable')} />}>
        <Heading title="Your timetables are ready" help={`${result} Pick the one you like best, and TimeFlex learns from your choice.`} />
      </Page>
    );
  }
  return (
    <Page
      footer={
        <>
          {error ? <T color={c.danger}>{error}</T> : null}
          <Button label={store.busy ?? 'Build 3 versions'} icon="sparkles" size="lg" full onPress={build} disabled={blockers.length > 0} loading={!!store.busy} />
          <T v="small" style={{ textAlign: 'center' }}>
            Usually takes under {Math.ceil(estimate.buildSeconds(3) / 10) * 10} seconds.
          </T>
          <Button label="I’ll look around first" kind="ghost" onPress={() => onFinish('/home')} />
        </>
      }
    >
      <Heading
        title={blockers.length ? 'Nearly there' : estimate.fits ? 'Everything fits' : 'This looks too full'}
        help={
          blockers.length
            ? `${blockers.length} thing${blockers.length === 1 ? '' : 's'} to sort out first. Most take one tap.`
            : !estimate.fits
              ? 'The numbers in red won’t fit, so some classes would be left out. Add rooms or reduce periods first.'
              : `${plural(profile.teachers.length, 'teacher')}, ${plural(profile.divisions.length, 'class', 'classes')}, ${plural(profile.subjects.length, 'subject')} and ${plural(profile.rooms.length, 'room')}.`
        }
      />
      {insights
        .filter((i) => i.level === 'blocker' || i.level === 'warning')
        .slice(0, 6)
        .map((insight) => (
          <Card key={insight.id} tone={insight.level === 'blocker' ? 'warn' : undefined} style={{ gap: 6 }}>
            <T v="h3">{insight.title}</T>
            <T v="small">{insight.detail}</T>
            <Row gap={8} wrap>
              {insight.fix && insight.fix.actions.every((a) => a.type !== 'generate' && a.type !== 'generateVariants') ? (
                <Button label={insight.fix.label} size="sm" kind="secondary" icon="flash-outline" onPress={() => store.applyAgent(insight.fix!.actions)} />
              ) : null}
              {areaStep[insight.area] ? <Button label="Change it" size="sm" kind="ghost" onPress={() => onEdit(areaStep[insight.area]!)} /> : null}
            </Row>
          </Card>
        ))}
      <Card style={{ gap: space.md }}>
        <T v="label">How full each class’s week will be</T>
        {estimate.classes.map((line) => (
          <LoadBar key={line.id} line={line} />
        ))}
        <T v="label">How busy each teacher will be</T>
        {estimate.teachers.map((line) => (
          <LoadBar key={line.id} line={line} />
        ))}
        <T v="label">How much of your rooms it needs</T>
        {estimate.rooms.map((line) => (
          <LoadBar key={line.id} line={line} />
        ))}
      </Card>
    </Page>
  );
}
