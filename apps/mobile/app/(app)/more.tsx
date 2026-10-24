import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { describePreferences, divisionSize } from '@core';
import { api } from '../../src/api';
import { useStore } from '../../src/store';
import { space, useTheme } from '../../src/theme';
import { Avatar, Button, Card, Field, Icon, Row, Screen, SectionTitle, Segmented, T, useWide, type IconName } from '../../src/ui';

export default function More() {
  const store = useStore();
  const { profile, account } = store;
  const { c, choice, setChoice } = useTheme();
  const wide = useWide();
  const [ai, setAi] = useState<string>('Checking…');
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .aiStatus()
      .then((s) => setAi(s.reachable && s.modelAvailable ? `Local AI ready · ${s.model}` : 'Local AI offline · built-in rules are used'))
      .catch(() => setAi('Local AI offline · built-in rules are used'));
  }, []);

  const rows: [string, string, IconName, string][] = [
    ['Basics', `${profile.institution.workingDays.length} days · ${profile.institution.startTime}–${profile.institution.endTime}`, 'calendar-outline', '/setup/basics'],
    ['Teachers', `${profile.teachers.length} profiles`, 'person-outline', '/setup/teachers'],
    ['Classes', `${profile.divisions.length} classes · ${profile.divisions.reduce((s, d) => s + divisionSize(d), 0)} students`, 'people-outline', '/setup/classes'],
    ['Rooms & labs', `${profile.rooms.length} rooms`, 'business-outline', '/setup/rooms'],
    ['Subjects', `${profile.subjects.length} subjects`, 'book-outline', '/setup/subjects'],
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

      <SectionTitle title="Your department" />
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
        <Card onPress={() => router.push('/onboarding')} style={{ paddingVertical: space.md }}>
          <Row gap={12}>
            <Icon name="chatbubbles-outline" size={22} color={c.accent} />
            <View style={{ flex: 1 }}>
              <T v="h3">Guided setup again</T>
              <T v="small">The assistant walks you through everything, one question at a time.</T>
            </View>
            <Icon name="chevron-forward" size={20} color={c.muted} />
          </Row>
        </Card>
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
        <T v="small">Learned from {profile.learning.observations} choice(s) and move(s).</T>
      </Card>

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
