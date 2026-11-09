import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { describePreferences, divisionSize } from '@core';
import { api } from '../../src/api';
import { useStore } from '../../src/store';
import { space, useTheme } from '../../src/theme';
import { Avatar, Button, Card, Field, Icon, Row, Screen, SectionTitle, Segmented, Sheet, T, useToast, useWide, type IconName } from '../../src/ui';

export default function More() {
  const store = useStore();
  const { profile, account } = store;
  const { c, choice, setChoice } = useTheme();
  const wide = useWide();
  const [ai, setAi] = useState<string>('Checking…');
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [passwordNote, setPasswordNote] = useState('');
  const [wiping, setWiping] = useState<'sample' | 'empty' | null>(null);
  const [wipeBusy, setWipeBusy] = useState(false);
  const toast = useToast();
  const hasData = profile.divisions.length + profile.teachers.length + profile.subjects.length > 0;
  const wipe = async (sample: boolean) => {
    setWipeBusy(true);
    try {
      await store.startOver(sample);
      setWiping(null);
      router.replace(sample ? '/onboarding?step=review' : '/onboarding?step=classes');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not do that.');
    } finally {
      setWipeBusy(false);
    }
  };
  const changePassword = async () => {
    setPasswordNote('');
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setChanging(false);
      setPasswordNote('Password changed. Other devices have been signed out.');
    } catch (e) {
      setPasswordNote(e instanceof Error ? e.message : 'Could not change the password.');
    }
  };

  useEffect(() => {
    api
      .aiStatus()
      .then((s) =>
        setAi(
          s.reachable && s.modelAvailable
            ? s.provider === 'anthropic'
              ? 'Smart understanding is on (Claude)'
              : 'Smart understanding is on'
            : 'Understands common phrases. Smart understanding is off right now.',
        ),
      )
      .catch(() => setAi('Understands common phrases. Smart understanding is off right now.'));
  }, []);

  const rows: [string, string, IconName, string][] = [
    ['Basics', `${profile.institution.workingDays.length} days · ${profile.institution.startTime}–${profile.institution.endTime}`, 'calendar-outline', '/setup/basics'],
    ['Years, branches and classes', `${profile.divisions.length} classes · ${profile.divisions.reduce((s, d) => s + divisionSize(d), 0)} students`, 'people-outline', '/onboarding?step=classes'],
    ['Subjects', `${profile.subjects.length} subjects`, 'book-outline', '/onboarding?step=subjects'],
    ['Who teaches what', `${profile.teachers.length} teachers`, 'git-network-outline', '/onboarding?step=teachers'],
    ['Teacher profiles', 'Numbers, days off and limits', 'person-outline', '/setup/teachers'],
    ['Rooms & labs', `${profile.rooms.length} rooms`, 'business-outline', '/setup/rooms'],
    ['Class lists', 'Students, batches and class teachers', 'list-outline', '/setup/classes'],
    ['Teacher access', 'Invite teachers to sign in', 'key-outline', '/access'],
    ['Cover', 'Substitutions when someone is away', 'swap-horizontal-outline', '/cover'],
  ];

  return (
    <Screen bottomSpace={wide ? 0 : 110}>
      <Card style={{ gap: space.md }}>
        <Row gap={12}>
          <Avatar name={account?.name ?? '?'} size={52} />
          <View style={{ flex: 1 }}>
            <T v="h2">{account?.name}</T>
            <T v="small">{account?.email}</T>
          </View>
        </Row>
        <T v="small">{profile.institution.name}</T>
      </Card>

      {account?.platformAdmin ? (
        <Card onPress={() => router.push('/admin')} style={{ marginTop: space.md, paddingVertical: space.md }}>
          <Row gap={12}>
            <Icon name="business" size={22} color={c.accent} />
            <View style={{ flex: 1 }}>
              <T v="h3">Central admin</T>
              <T v="small">All colleges, onboarding and progress.</T>
            </View>
            <Icon name="chevron-forward" size={20} color={c.muted} />
          </Row>
        </Card>
      ) : null}

      <SectionTitle title="Your college" />
      <View style={{ gap: space.sm }}>
        {rows.map(([title, detail, icon, href]) => (
          <Card key={title} onPress={() => router.push(href as never)} style={{ paddingVertical: space.md }}>
            <Row gap={12}>
              <Icon name={icon} size={22} color={c.accent} />
              <View style={{ flex: 1 }}>
                <T v="h3">{title}</T>
                <T v="small">{detail}</T>
              </View>
              <Icon name="chevron-forward" size={20} color={c.muted} />
            </Row>
          </Card>
        ))}
        <Card onPress={() => router.push('/attendance')} style={{ paddingVertical: space.md }}>
          <Row gap={12}>
            <Icon name="checkbox-outline" size={22} color={c.accent} />
            <View style={{ flex: 1 }}>
              <T v="h3">Attendance</T>
              <T v="small">Every period is a register.</T>
            </View>
            <Icon name="chevron-forward" size={20} color={c.muted} />
          </Row>
        </Card>
      </View>

      <SectionTitle title="Assistant" />
      <Card style={{ gap: 8 }}>
        <Row gap={10}>
          <Icon name="hardware-chip-outline" size={20} color={c.accent} />
          <T style={{ flex: 1 }}>{ai}</T>
        </Row>
        <T v="small">{describePreferences(profile.learning)}</T>
      </Card>

      <SectionTitle title="Try things out" />
      <View style={{ gap: space.sm }}>
        <Card onPress={() => (hasData ? setWiping('sample') : wipe(true))} style={{ paddingVertical: space.md }}>
          <Row gap={12}>
            <Icon name="flask-outline" size={22} color={c.accent} />
            <View style={{ flex: 1 }}>
              <T v="h3">Load the sample college</T>
              <T v="small">7 classes, 12 teachers, class lists and 23 subjects to explore.</T>
            </View>
            <Icon name="chevron-forward" size={20} color={c.muted} />
          </Row>
        </Card>
        {hasData ? (
          <Card onPress={() => setWiping('empty')} style={{ paddingVertical: space.md }}>
            <Row gap={12}>
              <Icon name="refresh-outline" size={22} color={c.muted} />
              <View style={{ flex: 1 }}>
                <T v="h3">Start over</T>
                <T v="small">Clear everything and set up from the beginning.</T>
              </View>
              <Icon name="chevron-forward" size={20} color={c.muted} />
            </Row>
          </Card>
        ) : null}
      </View>

      <Sheet visible={!!wiping} onClose={() => setWiping(null)} title={wiping === 'sample' ? 'Replace everything with the sample?' : 'Start over?'}>
        <T>
          This permanently removes {profile.divisions.length} classes, {profile.subjects.length} subjects, {profile.teachers.length} teachers, {profile.rooms.length} rooms, and every timetable, update and attendance record. Your account stays. This can’t be undone.
        </T>
        <Button label={wiping === 'sample' ? 'Yes, replace it all' : 'Yes, clear everything'} kind="danger" loading={wipeBusy} onPress={() => wipe(wiping === 'sample')} />
        <Button label="Keep what I have" kind="ghost" onPress={() => setWiping(null)} />
      </Sheet>

      <SectionTitle title="Appearance" />
      <Segmented
        options={[
          { value: 'system', label: 'Automatic' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        value={choice}
        onChange={setChoice}
      />

      <SectionTitle title="Account" />
      <View style={{ gap: space.sm }}>
        <Button label="Your data" kind="ghost" icon="shield-checkmark-outline" onPress={() => router.push('/privacy')} />
        {!changing ? (
          <Button label="Change password" kind="secondary" icon="key-outline" onPress={() => setChanging(true)} />
        ) : (
          <Card style={{ gap: space.md }}>
            <Field label="Current password" secureTextEntry value={current} onChangeText={setCurrent} autoComplete="current-password" />
            <Field label="New password" secureTextEntry value={next} onChangeText={setNext} autoComplete="new-password" hint="At least 8 characters" />
            <Row gap={8}>
              <Button label="Save" size="sm" disabled={!current || next.length < 8} onPress={changePassword} />
              <Button label="Cancel" kind="ghost" size="sm" onPress={() => setChanging(false)} />
            </Row>
          </Card>
        )}
        {passwordNote ? <T v="small">{passwordNote}</T> : null}
        <Button label="Sign out" kind="secondary" icon="log-out-outline" onPress={() => store.signOut().then(() => router.replace('/welcome'))} />
        {!deleting ? (
          <Button label="Delete account…" kind="ghost" onPress={() => setDeleting(true)} />
        ) : (
          <Card tone="danger" style={{ gap: space.md }}>
            <T>This deletes {profile.institution.name} and all its data for good. Enter your password to confirm.</T>
            <Field secureTextEntry value={password} onChangeText={setPassword} placeholder="Password" />
            {error ? <T color={c.danger}>{error}</T> : null}
            <Row gap={8}>
              <Button
                label="Delete forever"
                kind="danger"
                disabled={!password}
                onPress={async () => {
                  try {
                    await api.deleteAccount(password);
                    await store.signOut();
                    router.replace('/welcome');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not delete.');
                  }
                }}
              />
              <Button label="Cancel" kind="ghost" onPress={() => setDeleting(false)} />
            </Row>
          </Card>
        )}
      </View>
    </Screen>
  );
}
