import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, View } from 'react-native';
import {
  applyActions,
  batchNames,
  buildSlots,
  createId,
  hasExpertise,
  mergeDraft,
  nextName,
  setupInsights,
  type InstitutionForm,
  type RoomForm,
} from '@core';
import { api } from '../src/api';
import { useStore, type Profile } from '../src/store';
import { radius, space, useTheme } from '../src/theme';
import { ActivityIndicator } from 'react-native';
import { Background, Button, Card, Chip, Field, Gradient, Icon, IconButton, Progress, Row, Segmented, Stepper, T } from '../src/ui';

/**
 * First-run setup as a conversation. The assistant asks one thing at a time, the answer
 * is applied immediately (and autosaved), and the last step checks everything, offers
 * one-tap fixes, and builds a few versions to compare.
 */

type Step = 'start' | 'describe' | 'days' | 'hours' | 'periods' | 'break' | 'department' | 'classes' | 'teachers' | 'rooms' | 'subjects' | 'review';
const FLOW: Step[] = ['days', 'hours', 'periods', 'break', 'department', 'classes', 'teachers', 'rooms', 'subjects', 'review'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Bubble({ from, children }: { from: 'ai' | 'me'; children: ReactNode }) {
  const { c } = useTheme();
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(appear, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
  }, [appear]);
  const style = {
    opacity: appear,
    transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  };
  if (from === 'me') {
    return (
      <Animated.View style={[{ alignSelf: 'flex-end', maxWidth: '85%' }, style]}>
        <View style={{ backgroundColor: c.primary, borderRadius: 18, borderBottomRightRadius: 6, paddingVertical: 10, paddingHorizontal: 14 }}>
          <T color={c.onPrimary} style={{ fontWeight: '600' }}>
            {children}
          </T>
        </View>
      </Animated.View>
    );
  }
  return (
    <Animated.View style={[{ flexDirection: 'row', gap: 10, alignItems: 'flex-end', maxWidth: '92%' }, style]}>
      <Gradient style={{ width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="sparkles" size={16} color="#fff" />
      </Gradient>
      <View style={{ flexShrink: 1, backgroundColor: c.glassStrong, borderRadius: 18, borderBottomLeftRadius: 6, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: c.glassBorder }}>
        {typeof children === 'string' ? <T style={{ color: c.text }}>{children}</T> : children}
      </View>
    </Animated.View>
  );
}

/** /onboarding?demo=1 prepares a full sample college with no questions; otherwise the conversation. */
export default function Onboarding() {
  const { demo } = useLocalSearchParams<{ demo?: string }>();
  return demo ? <DemoSetup /> : <Conversation />;
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

function Conversation() {
  const store = useStore();
  const { profile, update, account } = store;
  const { c } = useTheme();
  const [step, setStep] = useState<Step>('start');
  const [said, setSaid] = useState<{ q: string; a: string }[]>([]);
  const scroll = useRef<ScrollView>(null);
  const first = account?.name.replace(/^(prof|dr|mr|mrs|ms)\.?\s+/i, '').split(' ')[0] ?? 'there';

  const setInst = (patch: Partial<InstitutionForm>) => update((p) => ({ ...p, institution: { ...p.institution, ...patch } }));
  const answer = (question: string, reply: string, next: Step) => {
    setSaid((list) => [...list, { q: question, a: reply }]);
    setStep(next);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 120);
  };
  const nextOf = (current: Step) => FLOW[Math.min(FLOW.length - 1, FLOW.indexOf(current) + 1)];
  const progress = step === 'start' || step === 'describe' ? 0 : (FLOW.indexOf(step) + 1) / FLOW.length;
  const finish = (to: '/home' | '/timetable') => {
    store.finishOnboarding();
    router.replace(to);
  };

  const slotsNoBreak = buildSlots(profile.institution.startTime, profile.institution.endTime, profile.institution.slotDurationMinutes, null, null);

  return (
    <View style={{ flex: 1 }}>
      <Background />
      <View style={{ flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: space.lg }}>
        <Row style={{ justifyContent: 'space-between', paddingTop: space.xl, paddingBottom: space.md }}>
          <View style={{ flex: 1, gap: 6 }}>
            <T v="label">{profile.institution.name || 'Your institution'}</T>
            <Progress value={progress} />
          </View>
          <Button label="Skip for now" kind="ghost" size="sm" onPress={() => finish('/home')} />
        </Row>

        <ScrollView ref={scroll} contentContainerStyle={{ gap: space.md, paddingBottom: space.xxl * 3 }} keyboardShouldPersistTaps="handled">
          <Bubble from="ai">
            <T style={{ color: c.text }}>
              Hi {first}! I’m your timetable assistant. I’ll ask a few quick questions and set things up as we go. Everything saves
              automatically, so you can stop any time.
            </T>
          </Bubble>
          {said.map((item, index) => (
            <View key={index} style={{ gap: space.sm }}>
              <Bubble from="ai">{item.q}</Bubble>
              <Bubble from="me">{item.a}</Bubble>
            </View>
          ))}

          {step === 'start' && (
            <>
              <Bubble from="ai">How would you like to begin?</Bubble>
              <View style={{ gap: space.sm }}>
                <Card onPress={() => answer('How would you like to begin?', 'Ask me step by step', 'days')}>
                  <Row gap={12}>
                    <Icon name="chatbubbles-outline" size={24} color={c.accent} />
                    <View style={{ flex: 1 }}>
                      <T v="h3">Ask me step by step</T>
                      <T v="small">About ten minutes. Recommended.</T>
                    </View>
                    <Icon name="chevron-forward" size={20} color={c.muted} />
                  </Row>
                </Card>
                <Card onPress={() => answer('How would you like to begin?', 'I’ll describe it in my own words', 'describe')}>
                  <Row gap={12}>
                    <Icon name="create-outline" size={24} color={c.accent} />
                    <View style={{ flex: 1 }}>
                      <T v="h3">Let me describe it</T>
                      <T v="small">Write it like an e-mail; I’ll pick out the details.</T>
                    </View>
                    <Icon name="chevron-forward" size={20} color={c.muted} />
                  </Row>
                </Card>
                <Card
                  onPress={() => {
                    store.loadSample();
                    answer('How would you like to begin?', 'Show me with sample data', 'review');
                  }}
                >
                  <Row gap={12}>
                    <Icon name="flask-outline" size={24} color={c.accent} />
                    <View style={{ flex: 1 }}>
                      <T v="h3">Show me with sample data</T>
                      <T v="small">A complete engineering department to explore.</T>
                    </View>
                    <Icon name="chevron-forward" size={20} color={c.muted} />
                  </Row>
                </Card>
              </View>
            </>
          )}

          {step === 'describe' && <Describe onDone={(summary) => answer('Tell me about your department.', summary, 'review')} />}

          {step === 'days' && (
            <Ask question="Which days do you teach?">
              <Row wrap gap={8}>
                {DAYS.map((day) => {
                  const on = profile.institution.workingDays.includes(day);
                  return (
                    <Chip
                      key={day}
                      label={day.slice(0, 3)}
                      active={on}
                      onPress={() => setInst({ workingDays: on ? profile.institution.workingDays.filter((d) => d !== day) : DAYS.filter((d) => d === day || profile.institution.workingDays.includes(d)) })}
                    />
                  );
                })}
              </Row>
              <Button
                label="That’s right"
                disabled={!profile.institution.workingDays.length}
                onPress={() => answer('Which days do you teach?', profile.institution.workingDays.map((d) => d.slice(0, 3)).join(', '), 'hours')}
              />
            </Ask>
          )}

          {step === 'hours' && (
            <Ask question="When does the teaching day start and end?">
              <Row wrap gap={8}>
                {[
                  ['08:00', '14:00'],
                  ['09:00', '16:00'],
                  ['09:00', '17:00'],
                  ['10:00', '17:00'],
                ].map(([start, end]) => (
                  <Chip
                    key={start + end}
                    label={`${start} – ${end}`}
                    active={profile.institution.startTime === start && profile.institution.endTime === end}
                    onPress={() => setInst({ startTime: start, endTime: end })}
                  />
                ))}
              </Row>
              <Row gap={space.lg} wrap>
                <Stepper label="Starts (hour)" value={Number(profile.institution.startTime.slice(0, 2))} min={6} max={13} onChange={(h) => setInst({ startTime: `${String(h).padStart(2, '0')}:00` })} />
                <Stepper label="Ends (hour)" value={Number(profile.institution.endTime.slice(0, 2))} min={11} max={21} onChange={(h) => setInst({ endTime: `${String(h).padStart(2, '0')}:00` })} />
              </Row>
              <Button label="Next" disabled={!slotsNoBreak.length} onPress={() => answer('When does the day start and end?', `${profile.institution.startTime} to ${profile.institution.endTime}`, 'periods')} />
            </Ask>
          )}

          {step === 'periods' && (
            <Ask question="How long is one period?">
              <Row wrap gap={8}>
                {[40, 45, 50, 55, 60].map((m) => (
                  <Chip key={m} label={`${m} min`} active={profile.institution.slotDurationMinutes === m} onPress={() => setInst({ slotDurationMinutes: m })} />
                ))}
              </Row>
              <T v="small">That gives {slotsNoBreak.length} periods a day.</T>
              <Button label="Next" disabled={!slotsNoBreak.length} onPress={() => answer('How long is one period?', `${profile.institution.slotDurationMinutes} minutes`, 'break')} />
            </Ask>
          )}

          {step === 'break' && (
            <Ask question="Is there a lunch or tea break?">
              <Row wrap gap={8}>
                <Chip label="No break" active={!profile.institution.breakAfterSlots} onPress={() => setInst({ breakAfterSlots: null, breakDurationMinutes: null })} />
                {Array.from({ length: Math.max(0, slotsNoBreak.length - 1) }, (_, i) => i + 1)
                  .filter((n) => n >= 2 && n <= 5)
                  .map((n) => (
                    <Chip
                      key={n}
                      label={`After period ${n}`}
                      active={profile.institution.breakAfterSlots === n}
                      onPress={() => setInst({ breakAfterSlots: n, breakDurationMinutes: profile.institution.breakDurationMinutes || 30 })}
                    />
                  ))}
              </Row>
              {profile.institution.breakAfterSlots ? (
                <Row wrap gap={8}>
                  {[15, 20, 30, 45, 60].map((m) => (
                    <Chip key={m} label={`${m} min`} active={profile.institution.breakDurationMinutes === m} onPress={() => setInst({ breakDurationMinutes: m })} />
                  ))}
                </Row>
              ) : null}
              <Button
                label="Next"
                onPress={() =>
                  answer(
                    'Is there a break?',
                    profile.institution.breakAfterSlots ? `${profile.institution.breakDurationMinutes} min after period ${profile.institution.breakAfterSlots}` : 'No break',
                    'department',
                  )
                }
              />
            </Ask>
          )}

          {step === 'department' && <DepartmentStep onDone={(text) => answer('Which department is this for?', text, 'classes')} />}
          {step === 'classes' && <ClassesStep onDone={(text) => answer('Which classes need a timetable?', text, 'teachers')} />}
          {step === 'teachers' && <TeachersStep onDone={(text) => answer('Who teaches?', text, 'rooms')} />}
          {step === 'rooms' && <RoomsStep onDone={(text) => answer('Where do classes happen?', text, 'subjects')} />}
          {step === 'subjects' && <SubjectsStep onDone={(text) => answer('What is taught, and by whom?', text, 'review')} />}
          {step === 'review' && <Review onFinish={finish} />}
        </ScrollView>
      </View>
    </View>
  );
}

function Ask({ question, children }: { question: string; children: ReactNode }) {
  return (
    <>
      <Bubble from="ai">{question}</Bubble>
      <Card style={{ gap: space.md }}>{children}</Card>
    </>
  );
}

function Describe({ onDone }: { onDone: (summary: string) => void }) {
  const { profile, update } = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.parse(text, { teachers: profile.teachers.map((t) => t.name), rooms: profile.rooms.map((r) => r.name) });
      update((p) => mergeDraft(p, result.draft));
      const d = result.draft;
      onDone(`Found ${d.teachers.length} teachers, ${d.divisions.length} classes, ${d.rooms.length} rooms and ${d.subjects.length} subjects.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Ask question="Tell me about your department, the way you’d explain it to a new colleague.">
      <Field
        multiline
        value={text}
        onChangeText={setText}
        placeholder={'e.g. Classes run Monday to Friday, 9 to 4, one-hour periods, break after the 3rd.\nDivisions SE-A and SE-B, 60 students each.\nProf. Mehta teaches DBMS 4 times a week…'}
        style={{ minHeight: 160, textAlignVertical: 'top' }}
      />
      {error ? <T color="#DC2626">{error}</T> : null}
      <Button label="Read it" icon="sparkles" onPress={run} disabled={!text.trim()} loading={busy} />
    </Ask>
  );
}

function DepartmentStep({ onDone }: { onDone: (text: string) => void }) {
  const { profile, update } = useStore();
  const d = profile.department;
  const set = (patch: Partial<typeof d>) => update((p) => ({ ...p, department: { ...p.department, ...patch } }));
  return (
    <Ask question="Which department, year and semester is this for?">
      <Field label="Department" placeholder="e.g. Computer Engineering" value={d.name} onChangeText={(name) => set({ name })} />
      <Row wrap gap={8}>
        {['First year', 'Second year', 'Third year', 'Fourth year'].map((y) => (
          <Chip key={y} label={y} active={d.yearLabel === y} onPress={() => set({ yearLabel: y })} />
        ))}
      </Row>
      <Row wrap gap={8}>
        {Array.from({ length: 8 }, (_, i) => `Semester ${i + 1}`).map((s) => (
          <Chip key={s} label={s.replace('Semester', 'Sem')} active={d.semesterLabel === s} onPress={() => set({ semesterLabel: s })} />
        ))}
      </Row>
      <Button label="Next" disabled={!d.name.trim()} onPress={() => onDone([d.name, d.yearLabel, d.semesterLabel].filter(Boolean).join(', '))} />
    </Ask>
  );
}

/** Shared list of what has been added in an "add one at a time" step. */
function Added({ items, onRemove }: { items: { id: string; name: string; detail: string }[]; onRemove: (id: string) => void }) {
  const { c } = useTheme();
  if (!items.length) return null;
  return (
    <View style={{ gap: 6 }}>
      {items.map((item) => (
        <Row key={item.id} style={{ backgroundColor: c.surface2, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 12, justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T v="h3">{item.name}</T>
            <T v="small">{item.detail}</T>
          </View>
          <Pressable accessibilityLabel={`Remove ${item.name}`} onPress={() => onRemove(item.id)} hitSlop={10}>
            <Icon name="close-circle" size={22} color={c.muted} />
          </Pressable>
        </Row>
      ))}
    </View>
  );
}

function ClassesStep({ onDone }: { onDone: (text: string) => void }) {
  const { profile, update } = useStore();
  const [name, setName] = useState('');
  const [size, setSize] = useState(60);
  const [batches, setBatches] = useState<'0' | '2' | '3'>('2');
  const last = profile.divisions[profile.divisions.length - 1];
  const suggestion = last ? nextName(last.name) : null;
  const add = (value = name) => {
    const clean = value.trim();
    if (!clean || profile.divisions.some((d) => d.name.toLowerCase() === clean.toLowerCase())) return;
    update((p) =>
      applyActions(p, [{ type: 'addClass', name: clean, size, batches: Number(batches) ? batchNames(clean, Number(batches)) : [] }]) as Profile,
    );
    setName('');
  };
  return (
    <Ask question="Add your classes one at a time. Each gets its own timetable.">
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
      <Added
        items={profile.divisions.map((d) => ({ id: d.id, name: d.name, detail: `${d.size ?? '?'} students${d.batches.length ? ` · batches ${d.batches.join(', ')}` : ''}` }))}
        onRemove={(id) => update((p) => ({ ...p, divisions: p.divisions.filter((d) => d.id !== id) }))}
      />
      <Button label="Done with classes" kind="secondary" disabled={!profile.divisions.length} onPress={() => onDone(profile.divisions.map((d) => d.name).join(', '))} />
    </Ask>
  );
}

function TeachersStep({ onDone }: { onDone: (text: string) => void }) {
  const { profile, update } = useStore();
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
    <Ask question="Who teaches? Add each teacher with what they’re good at, so I can suggest them for the right subjects.">
      <Field label="Name" placeholder="e.g. Prof. Anita Mehta" value={name} onChangeText={setName} onSubmitEditing={add} />
      <Field label="Expertise (optional)" placeholder="e.g. Databases, Operating Systems" value={expertise} onChangeText={setExpertise} onSubmitEditing={add} />
      <Button label="Add teacher" icon="person-add-outline" onPress={add} disabled={!name.trim()} />
      <Added
        items={profile.teachers.map((t) => ({ id: t.id, name: t.name, detail: t.expertise?.join(', ') || 'No expertise yet' }))}
        onRemove={(id) => update((p) => ({ ...p, teachers: p.teachers.filter((t) => t.id !== id) }))}
      />
      <Button label="Done with teachers" kind="secondary" disabled={!profile.teachers.length} onPress={() => onDone(`${profile.teachers.length} teacher${profile.teachers.length === 1 ? '' : 's'}`)} />
    </Ask>
  );
}

function RoomsStep({ onDone }: { onDone: (text: string) => void }) {
  const { profile, update } = useStore();
  const [name, setName] = useState('');
  const [type, setType] = useState<RoomForm['type']>('classroom');
  const [seats, setSeats] = useState(60);
  const last = profile.rooms[profile.rooms.length - 1];
  const suggestion = last ? nextName(last.name) : null;
  const add = (value = name) => {
    const clean = value.trim();
    if (!clean || profile.rooms.some((r) => r.name.toLowerCase() === clean.toLowerCase())) return;
    update((p) => applyActions(p, [{ type: 'addRoom', name: clean, roomType: type, capacity: seats }]) as Profile);
    setName('');
  };
  return (
    <Ask question="Where do classes happen? Add classrooms and labs; I’ll pick one that fits each class.">
      <Segmented
        options={[
          { value: 'classroom', label: 'Classroom' },
          { value: 'lab', label: 'Lab' },
          { value: 'seminar-hall', label: 'Hall' },
        ]}
        value={type}
        onChange={(value) => {
          setType(value);
          setSeats(value === 'lab' ? 30 : value === 'seminar-hall' ? 120 : 60);
        }}
      />
      <Field label="Name" placeholder={suggestion ?? 'e.g. Room 101'} value={name} onChangeText={setName} onSubmitEditing={() => add()} />
      <Stepper label="Seats" value={seats} min={1} max={500} step={5} onChange={setSeats} />
      <Row gap={8} wrap>
        <Button label="Add room" icon="add" onPress={() => add()} disabled={!name.trim()} />
        {suggestion && !name ? <Chip label={`+ ${suggestion}`} onPress={() => add(suggestion)} /> : null}
      </Row>
      <Added
        items={profile.rooms.map((r) => ({ id: r.id, name: r.name, detail: `${r.type === 'seminar-hall' ? 'hall' : r.type} · ${r.capacity} seats` }))}
        onRemove={(id) => update((p) => ({ ...p, rooms: p.rooms.filter((r) => r.id !== id) }))}
      />
      <Button label="Done with rooms" kind="secondary" disabled={!profile.rooms.length} onPress={() => onDone(`${profile.rooms.length} room${profile.rooms.length === 1 ? '' : 's'}`)} />
    </Ask>
  );
}

function SubjectsStep({ onDone }: { onDone: (text: string) => void }) {
  const { profile, update } = useStore();
  const { c } = useTheme();
  const [name, setName] = useState('');
  const [isLab, setIsLab] = useState(false);
  const [perWeek, setPerWeek] = useState(3);
  const [teacherId, setTeacherId] = useState('');
  const ordered = [...profile.teachers].sort((a, b) => Number(hasExpertise(b, name)) - Number(hasExpertise(a, name)));
  const add = () => {
    if (!name.trim() || !teacherId) return;
    update((p) => ({
      ...p,
      subjects: [
        ...p.subjects,
        { id: createId(), name: name.trim(), isLab, sessionsPerWeek: perWeek, durationSlots: isLab ? 2 : 1, teacherId, roomId: '', divisionIds: [], teacherOverrides: {} },
      ],
    }));
    setName('');
    setTeacherId('');
  };
  return (
    <Ask question="Last one: what is taught, and by whom? Teachers with matching expertise are starred.">
      <Field label="Subject" placeholder="e.g. Operating Systems" value={name} onChangeText={setName} />
      <Row gap={space.lg} wrap align="flex-end">
        <View style={{ gap: 6, minWidth: 200 }}>
          <T v="label">Kind</T>
          <Segmented
            options={[
              { value: 'lecture', label: 'Lecture' },
              { value: 'lab', label: 'Lab' },
            ]}
            value={isLab ? 'lab' : 'lecture'}
            onChange={(value) => {
              setIsLab(value === 'lab');
              setPerWeek(value === 'lab' ? 1 : 3);
            }}
          />
        </View>
        <Stepper label="Times a week" value={perWeek} min={1} max={10} onChange={setPerWeek} />
      </Row>
      <T v="label">Taught by</T>
      <Row wrap gap={8}>
        {ordered.map((t) => (
          <Chip key={t.id} label={t.name} icon={name && hasExpertise(t, name) ? 'star' : undefined} active={teacherId === t.id} onPress={() => setTeacherId(t.id)} />
        ))}
      </Row>
      <Button label="Add subject" icon="add" onPress={add} disabled={!name.trim() || !teacherId} />
      <Added
        items={profile.subjects.map((s) => ({
          id: s.id,
          name: s.name,
          detail: `${s.isLab ? 'Lab' : 'Lecture'} · ${s.sessionsPerWeek}× a week · ${profile.teachers.find((t) => t.id === s.teacherId)?.name ?? 'no teacher'}`,
        }))}
        onRemove={(id) => update((p) => ({ ...p, subjects: p.subjects.filter((s) => s.id !== id) }))}
      />
      <T v="small" color={c.muted}>
        Every subject is taught to all classes. You can change that later.
      </T>
      <Button label="Done with subjects" kind="secondary" disabled={!profile.subjects.length} onPress={() => onDone(`${profile.subjects.length} subjects`)} />
    </Ask>
  );
}

function Review({ onFinish }: { onFinish: (to: '/home' | '/timetable') => void }) {
  const store = useStore();
  const { c } = useTheme();
  const insights = setupInsights(store.profile);
  const blockers = insights.filter((i) => i.level === 'blocker');
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
  return (
    <>
      <Bubble from="ai">
        {blockers.length
          ? `Nearly there. I found ${blockers.length} thing${blockers.length === 1 ? '' : 's'} to sort out first. Tap a fix and I’ll do it.`
          : 'Everything looks good. Shall I build three different versions so you can pick your favourite?'}
      </Bubble>
      {insights
        .filter((i) => i.level !== 'good')
        .slice(0, 6)
        .map((insight) => (
          <Card key={insight.id} tone={insight.level === 'blocker' ? 'warn' : undefined} style={{ gap: 6 }}>
            <T v="h3">{insight.title}</T>
            <T v="small">{insight.detail}</T>
            {insight.fix && insight.fix.actions.every((a) => a.type !== 'generate' && a.type !== 'generateVariants') ? (
              <Button label={insight.fix.label} size="sm" kind="secondary" icon="flash-outline" onPress={() => store.applyAgent(insight.fix!.actions)} style={{ alignSelf: 'flex-start' }} />
            ) : null}
          </Card>
        ))}
      {result ? (
        <>
          <Bubble from="ai">{`${result} Have a look, pick the one you like best, and I’ll learn from it.`}</Bubble>
          <Button label="See my timetable" icon="arrow-forward" size="lg" onPress={() => onFinish('/timetable')} />
        </>
      ) : (
        <Card style={{ gap: space.md }}>
          {error ? <T color={c.danger}>{error}</T> : null}
          <Button label={store.busy ?? 'Build 3 versions'} icon="sparkles" size="lg" onPress={build} disabled={blockers.length > 0} loading={!!store.busy} />
          <Button label="I’ll look around first" kind="ghost" onPress={() => onFinish('/home')} />
        </Card>
      )}
    </>
  );
}
