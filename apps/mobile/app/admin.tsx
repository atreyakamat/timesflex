import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Share, View } from 'react-native';
import { api, joinLink, type CollegeRow } from '../src/api';
import { useStore } from '../src/store';
import { radius, space, useTheme } from '../src/theme';
import { Button, Card, Empty, Field, Icon, IconButton, Pill, Row, Screen, SectionTitle, T, useToast, useWide } from '../src/ui';

const STAGES: { id: CollegeRow['stage']; label: string }[] = [
  { id: 'invited', label: 'Invited' },
  { id: 'setting_up', label: 'Setting up' },
  { id: 'ready', label: 'Ready to build' },
  { id: 'built', label: 'Timetable built' },
  { id: 'approved', label: 'Approved' },
  { id: 'live', label: 'Live' },
];

function Pipeline({ stage }: { stage: CollegeRow['stage'] }) {
  const { c } = useTheme();
  const index = STAGES.findIndex((s) => s.id === stage);
  return (
    <View style={{ gap: 6 }}>
      <Row gap={4}>
        {STAGES.map((s, i) => (
          <View key={s.id} style={{ flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: i <= index ? (stage === 'live' ? c.ok : c.accent) : c.surface3 }} />
        ))}
      </Row>
      <T v="small">
        {STAGES[index]?.label}
        {index < STAGES.length - 1 ? ` · next: ${STAGES[index + 1].label.toLowerCase()}` : ''}
      </T>
    </View>
  );
}

function InviteBox({ link, name }: { link: string; name: string }) {
  const toast = useToast();
  const send = async () => {
    const message = `You're invited to set up ${name} on TimeFlex: ${link}`;
    if (Platform.OS === 'web') await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
    else await Share.share({ message });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.show('Link copied.');
    } catch {
      toast.show('Select the link to copy it.');
    }
  };
  return (
    <Card tone="accent" style={{ gap: space.sm, padding: space.md }}>
      <T v="label">Send this to the college’s admin. It works once, for 14 days, and is only shown now.</T>
      <T v="small">{link}</T>
      <Row gap={8} wrap>
        <Button label="Send on WhatsApp" icon="logo-whatsapp" size="sm" onPress={send} />
        {Platform.OS === 'web' ? <Button label="Copy link" kind="secondary" size="sm" icon="copy-outline" onPress={copy} /> : null}
      </Row>
    </Card>
  );
}

/** Across all colleges: onboard one, follow it to live, pause it. Counts only, never people. */
export default function CentralAdmin() {
  const { account, signOut, institutionId } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const wide = useWide();
  const [colleges, setColleges] = useState<CollegeRow[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [creating, setCreating] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api
      .listColleges()
      .then((list) => {
        setColleges(list);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load colleges.'));
  }, []);
  useEffect(load, [load]);

  if (!account?.platformAdmin) return <Redirect href="/" />;

  const create = async () => {
    setCreating(true);
    try {
      const made = await api.createCollege({ name: name.trim(), type: 'college', ...(contact.trim() ? { contact: contact.trim() } : {}) });
      setLinks((all) => ({ ...all, [made.id]: joinLink(made.code) }));
      setName('');
      setContact('');
      setAdding(false);
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not create the college.');
    } finally {
      setCreating(false);
    }
  };
  const newInvite = (id: string) =>
    api
      .inviteCollegeAdmin(id)
      .then((made) => setLinks((all) => ({ ...all, [id]: joinLink(made.code) })))
      .catch((e) => toast.show(e instanceof Error ? e.message : 'Could not make an invite.'));
  const setStatus = (college: CollegeRow, status: 'active' | 'paused') =>
    api
      .setCollegeStatus(college.id, status)
      .then(() => {
        toast.show(status === 'paused' ? `${college.name} is paused. Its data is kept.` : `${college.name} is active again.`);
        load();
      })
      .catch((e) => toast.show(e instanceof Error ? e.message : 'Could not change that.'));

  const list = colleges ?? [];
  const totals = {
    colleges: list.length,
    live: list.filter((x) => x.stage === 'live').length,
    students: list.reduce((sum, x) => sum + x.counts.students, 0),
    teachers: list.reduce((sum, x) => sum + x.counts.teachers, 0),
  };

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.lg }} gap={12}>
        <Row gap={12} style={{ flex: 1 }}>
          {institutionId ? <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} /> : null}
          <View style={{ flex: 1 }}>
            <T v="eyebrow">Central admin</T>
            <T v="h1">All colleges</T>
          </View>
        </Row>
        <Row gap={8}>
          {!institutionId ? <Button label="Sign out" kind="ghost" size="sm" onPress={() => signOut().then(() => router.replace('/welcome'))} /> : null}
          <Button label="Add a college" icon="add" onPress={() => setAdding(!adding)} />
        </Row>
      </Row>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {(
          [
            [totals.colleges, 'Colleges'],
            [totals.live, 'Live'],
            [totals.teachers, 'Teachers'],
            [totals.students, 'Students'],
          ] as const
        ).map(([value, label]) => (
          <Card key={label} style={{ flexGrow: 1, flexBasis: wide ? 150 : 140, gap: 2 }}>
            <T v="h1">{String(value)}</T>
            <T v="small">{label}</T>
          </Card>
        ))}
      </View>

      {adding ? (
        <Card style={{ gap: space.md, marginTop: space.md }}>
          <T v="h3">Onboard a college</T>
          <Field label="College name" placeholder="e.g. Agnel Institute of Technology" value={name} onChangeText={setName} />
          <Field label="Contact (optional, only you see this)" placeholder="e.g. Principal, 98xxxxxxxx" value={contact} onChangeText={setContact} />
          <Row gap={8}>
            <Button label="Create and get invite" icon="checkmark" loading={creating} disabled={!name.trim()} onPress={create} />
            <Button label="Cancel" kind="ghost" onPress={() => setAdding(false)} />
          </Row>
        </Card>
      ) : null}

      {error ? (
        <Card tone="danger" style={{ gap: space.sm, marginTop: space.md }}>
          <T color={c.danger}>{error}</T>
          <Button label="Try again" kind="secondary" size="sm" style={{ alignSelf: 'flex-start' }} onPress={load} />
        </Card>
      ) : null}

      <SectionTitle title="Colleges" />
      {colleges && !list.length ? <Empty icon="school-outline" title="No colleges yet" text="Add one, and send its admin the invite." /> : null}
      <View style={{ gap: space.md }}>
        {list.map((college) => (
          <Card key={college.id} style={{ gap: space.md }}>
            <Row style={{ justifyContent: 'space-between' }} gap={8} align="flex-start">
              <View style={{ flex: 1 }}>
                <T v="h2">{college.name}</T>
                <T v="small">{college.adminEmail ?? 'Admin hasn’t joined yet'}{college.contact ? ` · ${college.contact}` : ''}</T>
              </View>
              {college.status === 'paused' ? <Pill label="Paused" tone="danger" /> : college.stage === 'live' ? <Pill label="Live" tone="ok" /> : null}
            </Row>
            <Pipeline stage={college.stage} />
            <T v="small">
              {college.counts.classes} classes · {college.counts.teachers} teachers · {college.counts.students} students · {college.counts.subjects} subjects · {college.counts.members} signed in
            </T>
            {links[college.id] ? <InviteBox link={links[college.id]} name={college.name} /> : null}
            <Row gap={8} wrap>
              {!college.adminEmail ? <Button label="New invite link" kind="secondary" size="sm" icon="mail-outline" onPress={() => newInvite(college.id)} /> : null}
              {college.status === 'paused' ? (
                <Button label="Resume" kind="secondary" size="sm" icon="play-outline" onPress={() => setStatus(college, 'active')} />
              ) : (
                <Button label="Pause" kind="ghost" size="sm" icon="pause-outline" onPress={() => setStatus(college, 'paused')} />
              )}
            </Row>
          </Card>
        ))}
      </View>
      <Row gap={6} style={{ marginTop: space.lg }}>
        <Icon name="shield-checkmark-outline" size={16} color={c.muted} />
        <T v="small" style={{ flex: 1 }}>
          This panel shows counts and progress. Teachers’ and students’ details stay with each college.
        </T>
      </Row>
    </Screen>
  );
}
