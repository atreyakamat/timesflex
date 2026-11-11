import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Share, View } from 'react-native';
import { api, joinLink, type InviteRow, type MemberRow } from '../src/api';
import { useStore } from '../src/store';
import { space, useTheme } from '../src/theme';
import { Avatar, Button, Card, Empty, IconButton, Pill, Row, Screen, T, useToast } from '../src/ui';

/** Who at the college can sign in. Each teacher gets their own one-use invite link. */
export default function Access() {
  const { profile, institutionId, saveNow } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    if (!institutionId) return;
    Promise.all([api.listInvites(institutionId), api.listMembers(institutionId)])
      .then(([i, m]) => {
        setInvites(i);
        setMembers(m);
      })
      .catch((e) => toast.show(e instanceof Error ? e.message : 'Could not load.'));
  }, [institutionId, toast]);
  useEffect(load, [load]);

  const invite = async (teacherId: string) => {
    if (!institutionId) return;
    try {
      await saveNow();
      const made = await api.createInvite(institutionId, teacherId);
      setLinks((all) => ({ ...all, [teacherId]: joinLink(made.code) }));
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not make an invite.');
    }
  };
  const send = async (teacherId: string, link: string) => {
    const teacher = profile.teachers.find((t) => t.id === teacherId);
    const message = `Hello ${teacher?.name ?? ''}, please join ${profile.institution.name} on TimeFlex to see your classes and mark students: ${link}`;
    const digits = teacher?.phone?.replace(/\D/g, '') ?? '';
    const number = digits.length === 10 ? `91${digits}` : digits;
    if (Platform.OS === 'web') await Linking.openURL(`https://wa.me/${number}?text=${encodeURIComponent(message)}`);
    else await Share.share({ message });
  };
  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.show('Link copied.');
    } catch {
      toast.show('Select the link above to copy it.');
    }
  };
  const remove = async (accountId: string, name: string) => {
    if (!institutionId) return;
    try {
      await api.removeMember(institutionId, accountId);
      toast.show(`${name} can no longer sign in here. Their marks stay on record.`);
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not remove them.');
    }
  };
  const statusFor = (teacherId: string) => {
    if (members.some((m) => m.teacherId === teacherId)) return 'joined';
    return invites.find((i) => i.teacherId === teacherId && i.status === 'waiting') ? 'waiting' : 'none';
  };
  const joined = profile.teachers.filter((t) => statusFor(t.id) === 'joined').length;

  return (
    <Screen>
      <Row gap={12} style={{ marginBottom: space.lg }}>
        <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))} />
        <View style={{ flex: 1 }}>
          <T v="h1">Teacher access</T>
          <T v="small">
            {joined} of {profile.teachers.length} teachers have joined. They see their classes and can mark students, but can’t change the timetable.
          </T>
        </View>
      </Row>
      {!profile.teachers.length ? (
        <Empty icon="person-outline" title="No teachers yet" action={<Button label="Add teachers" onPress={() => router.push('/onboarding?step=teachers')} />} />
      ) : (
        <View style={{ gap: space.sm }}>
          {profile.teachers.map((teacher) => {
            const status = statusFor(teacher.id);
            const member = members.find((m) => m.teacherId === teacher.id);
            const link = links[teacher.id];
            return (
              <Card key={teacher.id} style={{ gap: space.sm, paddingVertical: space.md }}>
                <Row gap={10}>
                  <Avatar name={teacher.name} size={34} />
                  <View style={{ flex: 1 }}>
                    <T v="h3" numberOfLines={1}>
                      {teacher.name}
                    </T>
                    {member ? <T v="small" numberOfLines={1}>{member.email}</T> : null}
                  </View>
                  <Pill label={status === 'joined' ? 'Joined' : status === 'waiting' ? 'Invited' : 'Not invited'} tone={status === 'joined' ? 'ok' : status === 'waiting' ? 'accent' : 'neutral'} />
                </Row>
                {link ? (
                  <View style={{ gap: space.sm }}>
                    <T v="small" style={{ color: c.text }}>
                      {link}
                    </T>
                    <T v="small">Works once, for 14 days. It’s only shown now, so send it before leaving.</T>
                    <Row gap={8} wrap>
                      <Button label="Send on WhatsApp" icon="logo-whatsapp" size="sm" onPress={() => send(teacher.id, link)} />
                      {Platform.OS === 'web' ? <Button label="Copy link" kind="secondary" size="sm" icon="copy-outline" onPress={() => copy(link)} /> : null}
                    </Row>
                  </View>
                ) : status === 'joined' && member ? (
                  <Button label="Remove access" kind="ghost" size="sm" style={{ alignSelf: 'flex-start' }} onPress={() => remove(member.accountId, teacher.name)} />
                ) : (
                  <Button label={status === 'waiting' ? 'Make a new link' : 'Invite'} kind="secondary" size="sm" icon="person-add-outline" style={{ alignSelf: 'flex-start' }} onPress={() => invite(teacher.id)} />
                )}
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
