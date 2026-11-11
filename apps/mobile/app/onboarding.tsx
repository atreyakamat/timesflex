import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import {
  DEFAULT_BRANCHES,
  DEFAULT_YEARS,
  addMissingRooms,
  addSubjects,
  applyActions,
  applyStructure,
  buildSlots,
  classGroups,
  copySubjects,
  emptyStructure,
  linkDivisionTeacher,
  linkTeacher,
  linkTeachersFromList,
  renameInStructure,
  structureImpact,
  seedRooms,
  setupEstimate,
  setupInsights,
  structureBoxes,
  structureTotals,
  subjectDivisions,
  subjectsInGroup,
  subjectsNeedingTeacher,
  teacherFor,
  teachersFor,
  type InstituteStructure,
  type InstitutionForm,
  type LoadLine,
  type RoomForm,
  type SubjectForm,
} from '@core';
import { useStore, type Profile } from '../src/store';
import { radius, space, useTheme } from '../src/theme';
import { Background, Button, Card, Chip, Field, Icon, IconButton, Progress, Row, Segmented, Sheet, Stepper, T, useToast } from '../src/ui';

/**
 * First-run setup, in the order a college thinks. The institution exists from sign-up. Tap the
 * years and branches to make the classes, add each subject once per year and branch, link
 * teachers to subjects, check the rooms and week, then see an estimate before building.
 */

/** /onboarding?demo=1 prepares a full sample college with no questions; otherwise the steps. */
export default function Onboarding() {
  const { demo, step } = useLocalSearchParams<{ demo?: string; step?: string }>();
  return demo ? <DemoSetup /> : <Wizard start={ORDER.includes(step as Step) ? (step as Step) : undefined} />;
}

const DEMO_STEPS = ['Creating a sample engineering college', 'Adding 7 classes, 12 teachers, 11 rooms and 23 subjects', 'Building 3 clash-free timetable versions', 'Ready'];

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
          <T>About half a minute. Everything you see is real: the timetable is solved live.</T>
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
type Step = 'classes' | 'subjects' | 'teachers' | 'rooms' | 'review';
const STEPS: { id: Exclude<Step, 'review'>; minutes: number }[] = [
  { id: 'classes', minutes: 10 },
  { id: 'subjects', minutes: 8 },
  { id: 'teachers', minutes: 5 },
  { id: 'rooms', minutes: 1 },
];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDER: Step[] = ['classes', 'subjects', 'teachers', 'rooms', 'review'];
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Coming back later picks up where the information runs out. */
const firstUnfinished = (profile: Profile): Step => {
  if (!profile.divisions.length) return 'classes';
  if (!profile.subjects.length) return 'subjects';
  if (subjectsNeedingTeacher(profile).length) return 'teachers';
  if (!profile.rooms.length) return 'rooms';
  return 'review';
};

function Wizard({ start }: { start?: Step }) {
  const store = useStore();
  const { profile, update } = store;
  const [step, setStep] = useState<Step>(() => start ?? firstUnfinished(profile));

  const goTo = (next: Step) => {
    // Rooms are worked out from the classes and subjects, ready to change.
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
          {step !== 'classes' ? <IconButton icon="arrow-back" label="Back" onPress={back} /> : null}
          <View style={{ flex: 1, gap: 6 }}>
            <T v="label">{step === 'review' ? 'Last check' : `Step ${index + 1} of ${STEPS.length} · about ${plural(minutes, 'minute')} left`}</T>
            <Progress value={step === 'review' ? 1 : index / STEPS.length} />
          </View>
          <Button label={store.liveSessions.length || !store.isNew ? 'Done' : 'Finish later'} kind="ghost" size="sm" onPress={() => finish('/home')} />
        </Row>

        {step === 'classes' && <ClassesStep key={step} onNext={forward} onSample={useSample} />}
        {step === 'subjects' && <SubjectsStep key={step} onNext={forward} />}
        {step === 'teachers' && <TeachersStep key={step} onNext={forward} />}
        {step === 'rooms' && <RoomsWeekStep key={step} onNext={forward} />}
        {step === 'review' && <Review key={step} onFinish={finish} onEdit={goTo} />}
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

/** A row in a list, with a remove button. */
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

/* ---------- Step 1: classes ---------- */

/** A small − n + for the grid, where a full stepper would be too big. */
function Mini({ value, unit, min, max, step = 1, onChange, label }: { value: number; unit: string; min: number; max: number; step?: number; onChange: (value: number) => void; label: string }) {
  const { c } = useTheme();
  const button = (icon: 'remove' | 'add', next: number, name: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={name} disabled={next < min || next > max} hitSlop={6} onPress={() => onChange(next)} style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface3, opacity: next < min || next > max ? 0.4 : 1 }}>
      <Icon name={icon} size={16} color={c.text} />
    </Pressable>
  );
  return (
    <Row gap={6}>
      {button('remove', value - step, `Fewer ${label}`)}
      <T v="label" style={{ minWidth: 62, textAlign: 'center' }}>
        {value} {unit}
      </T>
      {button('add', value + step, `More ${label}`)}
    </Row>
  );
}

/** Tappable names with a way to add your own, for years and for branches. */
function Picker({ title, hint, defaults, chosen, onChange, placeholder }: { title: string; hint: string; defaults: string[]; chosen: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const [custom, setCustom] = useState('');
  const options = [...defaults, ...chosen.filter((item) => !defaults.includes(item))];
  const add = () => {
    const name = custom.trim();
    if (name && !chosen.some((item) => item.toLowerCase() === name.toLowerCase())) onChange([...chosen, name]);
    setCustom('');
  };
  return (
    <View style={{ gap: space.sm }}>
      <T v="h3">{title}</T>
      <T v="small">{hint}</T>
      <Row wrap gap={8}>
        {options.map((item) => (
          <Chip key={item} label={item} active={chosen.includes(item)} onPress={() => onChange(chosen.includes(item) ? chosen.filter((x) => x !== item) : options.filter((x) => x === item || chosen.includes(x)))} />
        ))}
      </Row>
      <Row gap={8} align="flex-end">
        <View style={{ flex: 1 }}>
          <Field placeholder={placeholder} value={custom} onChangeText={setCustom} onSubmitEditing={add} returnKeyType="done" />
        </View>
        <Button label="Add" kind="secondary" size="sm" disabled={!custom.trim()} onPress={add} />
      </Row>
    </View>
  );
}

/** Rename a year or branch: every class and subject stays attached. */
function RenameRow({ kind, name }: { kind: 'year' | 'branch'; name: string }) {
  const { profile, update } = useStore();
  const [value, setValue] = useState(name);
  const list = kind === 'year' ? profile.structure?.years : profile.structure?.branches;
  const clash = list?.some((item) => item !== name && item.toLowerCase() === value.trim().toLowerCase());
  return (
    <Row gap={8} align="flex-end">
      <View style={{ flex: 1 }}>
        <Field label={name} value={value} onChangeText={setValue} hint={clash ? 'That name is already used.' : undefined} />
      </View>
      <Button label="Save" size="sm" disabled={!value.trim() || value.trim() === name || !!clash} onPress={() => update((p) => renameInStructure(p, kind, name, value))} />
    </Row>
  );
}

function ClassesStep({ onNext, onSample }: { onNext: () => void; onSample: () => void }) {
  const { profile, update } = useStore();
  const toast = useToast();
  const structure: InstituteStructure = profile.structure ?? emptyStructure();
  const [pending, setPending] = useState<InstituteStructure | null>(null);
  const [renaming, setRenaming] = useState(false);
  const impact = pending ? structureImpact(profile, pending) : null;
  /** Anything that would remove classes with work attached gets confirmed first. */
  const set = (patch: Partial<InstituteStructure>) => {
    const next = { ...structure, ...patch };
    const { subjects } = structureImpact(profile, next);
    if (subjects.length) setPending(next);
    else update((p) => applyStructure(p, next));
  };
  const confirm = () => {
    if (!pending) return;
    const before = profile;
    update((p) => applyStructure(p, pending));
    setPending(null);
    toast.show('Removed.', { label: 'Undo', onPress: () => update(() => before) });
  };
  const boxes = structureBoxes(structure);
  const totals = structureTotals(structure);
  const handMade = profile.divisions.filter((d) => !d.group);
  const setCell = (key: string, patch: Partial<{ divisions: number; students: number }>, box: { divisions: number; students: number }) =>
    set({ cells: { ...structure.cells, [key]: { divisions: box.divisions, students: box.students, ...patch } } });

  return (
    <Page
      footer={
        <>
          <Button label="Continue" icon="arrow-forward" size="lg" full disabled={!profile.divisions.length} onPress={onNext} />
          {!profile.divisions.length ? <Button label="Use sample data instead" kind="ghost" onPress={onSample} /> : null}
        </>
      }
    >
      <Heading title={`Which classes at ${profile.institution.name || 'your institute'}?`} help="Tap your years and branches. Starting with just your own branch is fine; you can add the rest later." />
      <Sheet visible={!!pending} onClose={() => setPending(null)} title="Remove these?">
        {impact ? (
          <>
            <T>
              This removes {plural(impact.classes.length, 'class', 'classes')} ({impact.classes.map((d) => d.name).join(', ')}) and {plural(impact.subjects.length, 'subject')} with who teaches them ({impact.subjects.slice(0, 6).map((s) => s.name).join(', ')}{impact.subjects.length > 6 ? ', …' : ''}).
            </T>
            <Button label="Yes, remove them" kind="danger" onPress={confirm} />
            <Button label="Keep them" kind="ghost" onPress={() => setPending(null)} />
          </>
        ) : null}
      </Sheet>
      <Sheet visible={renaming} onClose={() => setRenaming(false)} title="Rename years and branches">
        <T v="small">Every class and subject stays attached.</T>
        {structure.years.map((year) => (
          <RenameRow key={`y${year}`} kind="year" name={year} />
        ))}
        {structure.branches.map((branch) => (
          <RenameRow key={`b${branch}`} kind="branch" name={branch} />
        ))}
        <Button label="Done" kind="secondary" onPress={() => setRenaming(false)} />
      </Sheet>
      <Card style={{ gap: space.lg }}>
        <Picker title="Years" hint="Add your own if you use other names." defaults={DEFAULT_YEARS} chosen={structure.years} placeholder="e.g. Final Year" onChange={(years) => set({ years })} />
        <Picker title="Branches" hint="Leave these empty if you don’t have branches." defaults={DEFAULT_BRANCHES} chosen={structure.branches} placeholder="e.g. Civil" onChange={(branches) => set({ branches })} />
      </Card>

      {boxes.length ? (
        <Card style={{ gap: space.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T v="h3" style={{ flex: 1 }}>
              How many divisions and students?
            </T>
            <Button label="Rename" kind="ghost" size="sm" onPress={() => setRenaming(true)} />
          </Row>
          <T v="small">Student counts are for room sizes and lab batches. Names can come later.</T>
          {structure.years.map((year) => {
            const rows = boxes.filter((box) => box.year === year);
            const common = structure.commonYears.includes(year);
            return (
              <View key={year} style={{ gap: space.sm }}>
                {structure.branches.length > 0 ? (
                  <Chip
                    label={`${year}: same for all branches`}
                    icon={common ? 'checkmark' : undefined}
                    active={common}
                    onPress={() => set({ commonYears: common ? structure.commonYears.filter((y) => y !== year) : [...structure.commonYears, year] })}
                  />
                ) : null}
                {rows.map((box) => (
                  <Row key={box.key} wrap gap={10} style={{ justifyContent: 'space-between' }}>
                    <T v="h3" style={{ minWidth: 90 }}>
                      {box.label}
                    </T>
                    <Row gap={12} wrap>
                      <Mini value={box.divisions} unit={box.divisions === 1 ? 'div' : 'divs'} min={1} max={12} label={`divisions for ${box.label}`} onChange={(divisions) => setCell(box.key, { divisions }, box)} />
                      <Mini value={box.students} unit="each" min={5} max={300} step={5} label={`students for ${box.label}`} onChange={(students) => setCell(box.key, { students }, box)} />
                    </Row>
                  </Row>
                ))}
              </View>
            );
          })}
          <View style={{ gap: 6 }}>
            <T v="label">Lab batches in each division</T>
            <Segmented options={[{ value: '0', label: 'None' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }]} value={String(structure.batches) as '0' | '2' | '3' | '4'} onChange={(value) => set({ batches: Number(value) })} />
          </View>
          <T v="label">
            {plural(totals.classes, 'class', 'classes')}, {plural(totals.students, 'student')}
          </T>
        </Card>
      ) : null}

      {handMade.length ? (
        <View style={{ gap: space.sm }}>
          <T v="label">Classes you already have</T>
          <Added items={handMade.map((d) => ({ id: d.id, name: d.name, detail: `${d.size ?? '?'} students` }))} onRemove={(id) => update((p) => ({ ...p, divisions: p.divisions.filter((d) => d.id !== id) }))} />
        </View>
      ) : null}
    </Page>
  );
}

/* ---------- Step 2: subjects ---------- */

function SubjectRow({ subject, onChange, onRemove }: { subject: SubjectForm; onChange: (patch: Partial<SubjectForm>) => void; onRemove: () => void }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.sm, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: c.border }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="h3" style={{ flex: 1 }}>
          {subject.name}
        </T>
        <Pressable accessibilityLabel={`Remove ${subject.name}`} hitSlop={10} onPress={onRemove}>
          <Icon name="close-circle" size={22} color={c.muted} />
        </Pressable>
      </Row>
      <Row gap={space.md} wrap>
        <View style={{ minWidth: 170 }}>
          <Segmented
            options={[{ value: 'lecture', label: 'Lecture' }, { value: 'lab', label: 'Lab' }]}
            value={subject.isLab ? 'lab' : 'lecture'}
            onChange={(value) => onChange(value === 'lab' ? { isLab: true, durationSlots: 2, sessionsPerWeek: 1 } : { isLab: false, durationSlots: 1, sessionsPerWeek: 3 })}
          />
        </View>
        <Mini value={subject.sessionsPerWeek} unit="a week" min={1} max={10} label={`times a week for ${subject.name}`} onChange={(sessionsPerWeek) => onChange({ sessionsPerWeek })} />
      </Row>
    </View>
  );
}

function SubjectsStep({ onNext }: { onNext: () => void }) {
  const { profile, update } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const groups = classGroups(profile);
  const [key, setKey] = useState(() => (groups.find((g) => !subjectsInGroup(profile, g.key).length) ?? groups[0])?.key ?? '');
  const group = groups.find((g) => g.key === key) ?? groups[0];
  const [text, setText] = useState('');
  const subjects = group ? subjectsInGroup(profile, group.key) : [];
  const sources = groups.filter((g) => g.key !== group?.key && subjectsInGroup(profile, g.key).length);
  const empty = groups.filter((g) => !subjectsInGroup(profile, g.key).length);
  const add = () => {
    if (!text.trim() || !group) return;
    update((p) => addSubjects(p, group.key, text));
    setText('');
  };
  const change = (id: string, patch: Partial<SubjectForm>) => update((p) => ({ ...p, subjects: p.subjects.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  return (
    <Page footer={<Button label="Continue" icon="arrow-forward" size="lg" full disabled={!profile.subjects.length} onPress={onNext} />}>
      <Heading title="What does each class study?" help="Add each subject once. Every division of that year and branch gets it." />
      {groups.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {groups.map((g) => (
            <Chip key={g.key} label={g.label} active={g.key === group?.key} onPress={() => setKey(g.key)} />
          ))}
        </ScrollView>
      ) : null}
      {group ? (
        <Card style={{ gap: space.md }}>
          <T v="h3">Subjects for {group.label}</T>
          <Field label="Separate with commas. Add “Lab” for practicals." placeholder="e.g. DBMS, Operating Systems, DBMS Lab" value={text} onChangeText={setText} onSubmitEditing={add} returnKeyType="done" />
          <Row gap={8} wrap>
            <Button label="Add subjects" icon="add" disabled={!text.trim()} onPress={add} />
            {!subjects.length ? sources.slice(0, 3).map((g) => <Button key={g.key} label={`Copy from ${g.label}`} kind="secondary" icon="copy-outline" onPress={() => update((p) => copySubjects(p, g.key, group.key))} />) : null}
          </Row>
          {subjects.length ? (
            <View>
              <T v="label">{plural(subjects.length, 'subject')}</T>
              {subjects.map((subject) => (
                <SubjectRow
                  key={subject.id}
                  subject={subject}
                  onChange={(patch) => change(subject.id, patch)}
                  onRemove={() => {
                    const before = profile;
                    update((p) => ({ ...p, subjects: p.subjects.filter((s) => s.id !== subject.id) }));
                    toast.show(`${subject.name} removed.`, { label: 'Undo', onPress: () => update(() => before) });
                  }}
                />
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}
      {empty.length && profile.subjects.length ? (
        <T v="small" color={c.warn}>
          {empty.map((g) => g.label).join(', ')} {empty.length === 1 ? 'has' : 'have'} no subjects yet, so {empty.length === 1 ? 'it' : 'they'} won’t get a timetable. You can add them later.
        </T>
      ) : null}
    </Page>
  );
}

/* ---------- Step 3: teachers ---------- */

/** Who could take this: those who already teach it first, then everyone else, shortened if long. */
function TeacherChips({ subject, chosen, onPick, labelFor }: { subject: SubjectForm; chosen: string; onPick: (teacherId: string) => void; labelFor: (name: string) => string }) {
  const { profile } = useStore();
  const [all, setAll] = useState(false);
  const able = teachersFor(subject.name, profile);
  const ordered = [...able, ...profile.teachers.filter((t) => !able.includes(t))];
  const shown = all ? ordered : ordered.filter((t, i) => i < 8 || t.id === chosen);
  return (
    <Row wrap gap={8}>
      {shown.map((teacher) => (
        <Chip key={teacher.id} label={teacher.name} a11yLabel={labelFor(teacher.name)} active={teacher.id === chosen} onPress={() => onPick(teacher.id)} />
      ))}
      {!all && ordered.length > shown.length ? <Chip label={`+ ${ordered.length - shown.length} more`} onPress={() => setAll(true)} /> : null}
    </Row>
  );
}

function SubjectLink({ subject, groupLabel }: { subject: SubjectForm; groupLabel: string }) {
  const { profile, update } = useStore();
  const { c } = useTheme();
  const divisions = subjectDivisions(subject, profile.divisions);
  const overrides = Object.keys(subject.teacherOverrides ?? {}).length > 0;
  const [split, setSplit] = useState(overrides);
  const [changing, setChanging] = useState(false);
  const estimate = setupEstimate(profile);
  const teacher = profile.teachers.find((t) => t.id === subject.teacherId);
  const needs = divisions.some((d) => !profile.teachers.some((t) => t.id === teacherFor(subject, d.id)));

  if (!needs && !split && !changing) {
    const line = estimate.teachers.find((l) => l.id === teacher?.id);
    return (
      <Row gap={10} style={{ paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: c.border }}>
        <Icon name="checkmark-circle" size={20} color={c.ok} />
        <View style={{ flex: 1 }}>
          <T v="h3" numberOfLines={1}>
            {subject.name}
          </T>
          <T v="small" color={line && !line.fits ? c.danger : undefined}>
            {teacher?.name}
            {line ? ` · ${line.load} of ${line.capacity} periods a week` : ''}
          </T>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Change teacher for ${subject.name} in ${groupLabel}`} hitSlop={8} onPress={() => setChanging(true)}>
          <T v="label">Change</T>
        </Pressable>
      </Row>
    );
  }
  return (
    <View style={{ gap: space.sm, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: c.border }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="h3" style={{ flex: 1 }}>
          {subject.name}
        </T>
        {divisions.length > 1 ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${split ? 'One teacher for' : 'Split'} ${subject.name} for ${groupLabel}${split ? '' : ' by division'}`} hitSlop={8} onPress={() => { if (split) update((p) => (subject.teacherId ? linkTeacher(p, subject.id, subject.teacherId) : { ...p, subjects: p.subjects.map((s) => (s.id === subject.id ? { ...s, teacherOverrides: {} } : s)) })); setSplit(!split); }}>
            <T v="small" color={c.accent}>
              {split ? 'One teacher for all' : 'Split by division'}
            </T>
          </Pressable>
        ) : null}
      </Row>
      {split ? (
        divisions.map((division) => (
          <View key={division.id} style={{ gap: 6 }}>
            <T v="label">{division.name}</T>
            <TeacherChips subject={subject} chosen={teacherFor(subject, division.id)} labelFor={(name) => `${name} for ${subject.name} in ${division.name}`} onPick={(id) => update((p) => linkDivisionTeacher(p, subject.id, division.id, id))} />
          </View>
        ))
      ) : (
        <TeacherChips
          subject={subject}
          chosen={subject.teacherId}
          labelFor={(name) => `${name} for ${subject.name} in ${groupLabel}`}
          onPick={(id) => {
            update((p) => linkTeacher(p, subject.id, id));
            setChanging(false);
          }}
        />
      )}
      {!profile.teachers.length ? <T v="small">Add a teacher above first.</T> : null}
    </View>
  );
}

function TeachersStep({ onNext }: { onNext: () => void }) {
  const { profile, update } = useStore();
  const { c } = useTheme();
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [name, setName] = useState('');
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const left = subjectsNeedingTeacher(profile).length;
  const addOne = () => {
    if (!name.trim()) return;
    update((p) => applyActions(p, [{ type: 'addTeacher', name: name.trim() }]) as Profile);
    setName('');
  };
  const addPasted = () => {
    const result = linkTeachersFromList(profile, pasted);
    update(() => result.profile as Profile);
    setUnmatched(result.unmatched);
    setPasted('');
    setPasting(false);
  };
  return (
    <Page
      footer={
        <>
          {left ? (
            <T v="small" color={c.warn} style={{ textAlign: 'center' }}>
              {plural(left, 'subject')} still {left === 1 ? 'needs' : 'need'} a teacher. You can sort that out in the next steps too.
            </T>
          ) : null}
          <Button label="Continue" icon="arrow-forward" size="lg" full disabled={!profile.teachers.length} onPress={onNext} />
        </>
      }
    >
      <Heading title="Who teaches each subject?" help="Add your teachers, then pick one for each subject." />
      {pasting ? (
        <Card style={{ gap: space.md }}>
          <Field label="One teacher a line" multiline value={pasted} onChangeText={setPasted} placeholder={'Prof. Mehta: DBMS, Operating Systems\nDr. Rao: Maths\nProf. Iyer: Networks, Networks Lab'} style={{ minHeight: 130, textAlignVertical: 'top' }} />
          <Row gap={8}>
            <Button label="Add them all" icon="people-outline" disabled={!pasted.trim()} onPress={addPasted} />
            <Button label="Cancel" kind="ghost" onPress={() => setPasting(false)} />
          </Row>
        </Card>
      ) : (
        <Card style={{ gap: space.md }}>
          <Field label="New teacher" placeholder="e.g. Prof. Anita Mehta" value={name} onChangeText={setName} onSubmitEditing={addOne} returnKeyType="done" />
          <Row gap={8} wrap>
            <Button label="Add teacher" icon="person-add-outline" disabled={!name.trim()} onPress={addOne} />
            <Button label="Paste a list instead" kind="ghost" onPress={() => setPasting(true)} />
          </Row>
        </Card>
      )}
      {profile.teachers.length ? (
        <View style={{ gap: 4 }}>
          <T v="label">{plural(profile.teachers.length, 'teacher')}</T>
          <T v="small">{profile.teachers.map((t) => t.name).join(', ')}</T>
        </View>
      ) : null}
      {unmatched.length ? (
        <Card tone="warn" style={{ padding: space.md }}>
          <T v="small">These aren’t subjects yet, so they weren’t linked. Check the spelling, or go back a step and add them: {unmatched.join(', ')}.</T>
        </Card>
      ) : null}
      {!left && profile.subjects.length ? (
        <Row gap={8}>
          <Icon name="checkmark-circle" size={20} color={c.ok} />
          <T>All subjects have a teacher.</T>
        </Row>
      ) : null}
      {classGroups(profile)
        .filter((group) => subjectsInGroup(profile, group.key).length)
        .map((group) => (
          <Card key={group.key} style={{ gap: 4 }}>
            <T v="eyebrow">{group.label}</T>
            {subjectsInGroup(profile, group.key).map((subject) => (
              <SubjectLink key={subject.id} subject={subject} groupLabel={group.label} />
            ))}
          </Card>
        ))}
    </Page>
  );
}

/* ---------- Step 4: rooms and the week ---------- */

function RoomsWeekStep({ onNext }: { onNext: () => void }) {
  const { profile, update } = useStore();
  const i = profile.institution;
  const set = (patch: Partial<InstitutionForm>) => update((p) => ({ ...p, institution: { ...p.institution, ...patch } }));
  const slots = buildSlots(i.startTime, i.endTime, i.slotDurationMinutes, i.breakAfterSlots, i.breakDurationMinutes);
  const breakOptions = Array.from({ length: Math.max(0, slots.length - 1) }, (_, n) => n + 1).filter((n) => n >= 2 && n <= 5);
  const [name, setName] = useState('');
  const [type, setType] = useState<RoomForm['type']>('classroom');
  const [seats, setSeats] = useState(60);
  const roomsFull = setupEstimate(profile).rooms.some((line) => !line.fits);
  const add = () => {
    const clean = name.trim();
    if (!clean || profile.rooms.some((r) => r.name.toLowerCase() === clean.toLowerCase())) return;
    update((p) => applyActions(p, [{ type: 'addRoom', name: clean, roomType: type, capacity: seats }]) as Profile);
    setName('');
  };
  return (
    <Page footer={<Button label="Looks right" icon="arrow-forward" size="lg" full disabled={!slots.length || !i.workingDays.length || !profile.rooms.length} onPress={onNext} />}>
      <Heading title="A quick check of rooms and the week" help="We suggested enough rooms for your classes. Rename them later, or change anything that’s different." />
      <Card style={{ gap: space.md }}>
        <T v="h3">Rooms</T>
        <Added
          items={profile.rooms.map((r) => ({ id: r.id, name: r.name, detail: `${r.type === 'seminar-hall' ? 'Hall' : r.type === 'lab' ? 'Lab' : 'Classroom'} · ${r.capacity} seats` }))}
          onRemove={(id) => update((p) => ({ ...p, rooms: p.rooms.filter((r) => r.id !== id) }))}
        />
        {roomsFull ? <Button label="Suggest more rooms" icon="add" kind="secondary" size="sm" style={{ alignSelf: 'flex-start' }} onPress={() => update((p) => addMissingRooms(p))} /> : null}
        <Segmented
          options={[{ value: 'classroom', label: 'Classroom' }, { value: 'lab', label: 'Lab' }, { value: 'seminar-hall', label: 'Hall' }]}
          value={type}
          onChange={(value) => {
            setType(value);
            setSeats(value === 'lab' ? 30 : value === 'seminar-hall' ? 120 : 60);
          }}
        />
        <Field label="Add a room" placeholder="e.g. Room 201" value={name} onChangeText={setName} onSubmitEditing={add} />
        <Stepper label="Seats" value={seats} min={1} max={500} step={5} onChange={setSeats} />
        <Button label="Add room" kind="secondary" icon="add" onPress={add} disabled={!name.trim()} />
      </Card>
      <Card style={{ gap: space.md }}>
        <T v="h3">The week</T>
        <Row wrap gap={8}>
          {DAYS.map((day) => {
            const on = i.workingDays.includes(day);
            return <Chip key={day} label={day.slice(0, 3)} active={on} onPress={() => set({ workingDays: on ? i.workingDays.filter((d) => d !== day) : DAYS.filter((d) => d === day || i.workingDays.includes(d)) })} />;
          })}
        </Row>
        <T v="label">Hours</T>
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

/* ---------- Estimate, then build ---------- */

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
  const adding = store.liveSessions.length > 0 && store.drift.changed;
  const addToTimetable = async () => {
    setError('');
    try {
      setResult(await store.fillTimetable());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the timetable.');
    }
  };
  const build = async () => {
    setError('');
    try {
      setResult(await store.generateVariants(['balanced', 'compact', 'teacher_days']));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the timetable.');
    }
  };
  const areaStep: Partial<Record<string, Step>> = { basics: 'rooms', teachers: 'teachers', classes: 'classes', rooms: 'rooms', subjects: 'subjects' };

  if (result) {
    return (
      <Page footer={<Button label="See my timetable" icon="arrow-forward" size="lg" full onPress={() => onFinish('/timetable')} />}>
        <Heading title={adding || /updated|Added/.test(result) ? 'Your timetable is updated' : 'Your timetables are ready'} help={/updated|Added/.test(result) ? result : `${result} Pick the one you like best, and TimeFlex learns from your choice.`} />
      </Page>
    );
  }
  return (
    <Page
      footer={
        <>
          {error ? <T color={c.danger}>{error}</T> : null}
          {adding ? (
            <>
              <Button label={store.busy ?? 'Add to my timetable'} icon="sync" size="lg" full onPress={addToTimetable} disabled={blockers.length > 0} loading={!!store.busy} />
              <T v="small" style={{ textAlign: 'center' }}>
                Classes already placed stay exactly where they are.
              </T>
              <Button label="Build 3 new versions instead (classes may move)" kind="ghost" onPress={build} disabled={blockers.length > 0 || !!store.busy} />
            </>
          ) : (
            <>
              <Button label={store.busy ?? (store.liveSessions.length ? 'Build 3 new versions' : 'Build 3 versions')} icon="sparkles" size="lg" full onPress={build} disabled={blockers.length > 0} loading={!!store.busy} />
              <T v="small" style={{ textAlign: 'center' }}>
                Usually takes under {Math.ceil(estimate.buildSeconds(3) / 10) * 10} seconds.
              </T>
            </>
          )}
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
      <Button label="Add another branch or year" icon="add" kind="secondary" style={{ alignSelf: 'flex-start' }} onPress={() => onEdit('classes')} />
    </Page>
  );
}
