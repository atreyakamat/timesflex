import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, Share, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { isTold, noticeProgress, whatsappLink, type NoticeRecipient, type NoticeRecord } from '@core';
import { api } from '../../src/api';
import { useStore } from '../../src/store';
import { space, useTheme } from '../../src/theme';
import { Avatar, Button, Card, Empty, Field, Icon, Pill, Progress, Row, Screen, SectionTitle, T, useToast, useWide } from '../../src/ui';

const LOOK: Record<NoticeRecipient['status'], { label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' }> = {
  pending: { label: 'Not sent', tone: 'warn' },
  opened: { label: 'Did you send it?', tone: 'accent' },
  sent: { label: 'Sent', tone: 'ok' },
  delivered: { label: 'Delivered', tone: 'ok' },
  read: { label: 'Read', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

/** One teacher on an update: what they'll get, and whether it has reached them. Details on tap. */
function RecipientRow({ notice, person, onChange }: { notice: NoticeRecord; person: NoticeRecipient; onChange: (notice: NoticeRecord) => void }) {
  const { profile, update } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const teacher = profile.teachers.find((t) => t.id === person.teacherId);
  const needsNumber = !isTold(person.status) && !teacher?.phone;
  const [open, setOpen] = useState(false);
  const look = needsNumber ? ({ label: 'No number', tone: 'warn' } as const) : LOOK[person.status];
  const mark = (status: NoticeRecipient['status']) =>
    api.markRecipient(notice.id, person.teacherId, status).then(onChange).catch((e) => toast.show(e instanceof Error ? e.message : 'Could not save that.'));

  const send = () => {
    if (!teacher?.phone) return;
    Linking.openURL(whatsappLink(teacher.phone, person.text));
    mark('opened');
  };
  const savePhone = () => {
    update((p) => ({ ...p, teachers: p.teachers.map((t) => (t.id === person.teacherId ? { ...t, phone: phone.trim() } : t)) }));
    setPhone('');
  };

  return (
    <View style={{ gap: space.sm, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: c.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${open ? 'Hide' : 'Show'} the message for ${person.name}`} onPress={() => setOpen(!open)}>
        <Row gap={10}>
          <Avatar name={person.name} size={34} />
          <View style={{ flex: 1 }}>
            <T v="h3" numberOfLines={1}>
              {person.name}
            </T>
            <T v="small" numberOfLines={1}>
              {person.error ?? person.headline}
            </T>
          </View>
          <Pill label={look.label} tone={look.tone} />
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.muted} />
        </Row>
      </Pressable>
      {needsNumber ? (
        <Row gap={8} align="flex-end">
          <View style={{ flex: 1 }}>
            <Field label={`${person.name}’s WhatsApp number`} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="e.g. 98765 43210" onSubmitEditing={savePhone} />
          </View>
          <Button label="Save" size="sm" disabled={phone.replace(/\D/g, '').length < 10} onPress={savePhone} />
        </Row>
      ) : null}
      {open ? (
        <View style={{ gap: space.sm }}>
          <Card style={{ padding: space.md }}>
            <T>{person.text}</T>
          </Card>
          {!isTold(person.status) ? (
            <Row gap={8} wrap>
              {teacher?.phone ? <Button label="Send on WhatsApp" icon="logo-whatsapp" size="sm" kind="secondary" onPress={send} /> : null}
              <Button label="Told them another way" kind="ghost" size="sm" onPress={() => mark('sent')} />
              <Button label="Skip" kind="ghost" size="sm" onPress={() => mark('skipped')} />
            </Row>
          ) : (
            <Button label="Mark as not sent" kind="ghost" size="sm" style={{ alignSelf: 'flex-start' }} onPress={() => mark('pending')} />
          )}
        </View>
      ) : null}
    </View>
  );
}

/** Walks through the teachers one at a time, so it's one button however many there are. */
function SendNext({ notice, onChange }: { notice: NoticeRecord; onChange: (notice: NoticeRecord) => void }) {
  const { profile } = useStore();
  const toast = useToast();
  const phoneOf = (person: NoticeRecipient) => profile.teachers.find((t) => t.id === person.teacherId)?.phone;
  const waiting = notice.recipients.find((r) => r.status === 'opened');
  const next = notice.recipients.find((r) => (r.status === 'pending' || r.status === 'failed') && phoneOf(r));
  const mark = (person: NoticeRecipient, status: NoticeRecipient['status']) =>
    api.markRecipient(notice.id, person.teacherId, status).then(onChange).catch((e) => toast.show(e instanceof Error ? e.message : 'Could not save that.'));
  const open = (person: NoticeRecipient) => {
    Linking.openURL(whatsappLink(phoneOf(person)!, person.text));
    return mark(person, 'opened');
  };
  if (waiting) {
    return (
      <Card style={{ gap: space.sm, padding: space.md }}>
        <T v="h3">Did you send it to {waiting.name}?</T>
        <Row gap={8} wrap>
          <Button label="Yes, sent" icon="checkmark" onPress={() => mark(waiting, 'sent')} />
          {phoneOf(waiting) ? <Button label="Open again" kind="secondary" icon="logo-whatsapp" onPress={() => open(waiting)} /> : null}
          <Button label="Not yet" kind="ghost" onPress={() => mark(waiting, 'pending')} />
        </Row>
      </Card>
    );
  }
  if (!next) return null;
  return <Button label={`Send to ${next.name}`} icon="logo-whatsapp" full onPress={() => open(next)} />;
}

function NoticeCard({ notice, whatsappApi, onChange, startOpen }: { notice: NoticeRecord; whatsappApi: boolean; onChange: (notice: NoticeRecord) => void; startOpen: boolean }) {
  const store = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const [open, setOpen] = useState(startOpen);
  const [sending, setSending] = useState(false);
  const { told, total } = noticeProgress(notice);
  const done = told === total;
  const left = total - told;

  const shareToGroup = async () => {
    if (Platform.OS === 'web') await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(notice.groupText)}`);
    else await Share.share({ message: notice.groupText });
    api.markGroup(notice.id, true).then(onChange).catch(() => {});
  };
  const sendAll = async () => {
    setSending(true);
    try {
      await store.saveNow();
      const result = await api.sendNotice(notice.id);
      onChange(result);
      const failed = result.recipients.filter((r) => r.status === 'failed').length;
      toast.show(failed ? `${failed} could not be sent. See who below.` : 'Sent to everyone.');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not send.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Card tone={done ? undefined : 'accent'} style={{ gap: space.md }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${open ? 'Collapse' : 'Expand'} ${notice.title}`} onPress={() => setOpen(!open)}>
        <Row gap={10}>
          <Icon name={done ? 'checkmark-circle' : notice.kind === 'cover' ? 'swap-horizontal' : 'calendar'} size={24} color={done ? c.ok : c.accent} />
          <View style={{ flex: 1 }}>
            <T v="h3">{notice.title}</T>
            <T v="small">
              {new Date(notice.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {told} of {total} told
            </T>
          </View>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} color={c.muted} />
        </Row>
      </Pressable>
      {total > 0 ? <Progress value={told / total} /> : null}
      {open ? (
        <>
          {whatsappApi && left > 0 ? <Button label={sending ? 'Sending…' : `Send to ${left} teacher${left === 1 ? '' : 's'}`} icon="send" full loading={sending} onPress={sendAll} /> : null}
          {!whatsappApi ? <SendNext notice={notice} onChange={onChange} /> : null}
          <View>
            {notice.recipients.map((person) => (
              <RecipientRow key={person.teacherId} notice={notice} person={person} onChange={onChange} />
            ))}
          </View>
          <View style={{ gap: space.sm, borderTopWidth: 1, borderTopColor: c.border, paddingTop: space.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="label">Your WhatsApp group</T>
              {notice.groupShared ? <Pill label="Shared" tone="ok" /> : null}
            </Row>
            <T v="small">Opens WhatsApp with a summary. You choose which group it goes to.</T>
            <Button label={notice.groupShared ? 'Share again' : 'Share to a group'} icon="people-outline" kind="secondary" size="sm" style={{ alignSelf: 'flex-start' }} onPress={shareToGroup} />
          </View>
        </>
      ) : null}
    </Card>
  );
}

export default function Updates() {
  const store = useStore();
  const { institutionId, pendingUpdate, liveSessions, liveVersion } = store;
  const { c } = useTheme();
  const toast = useToast();
  const wide = useWide();
  const [notices, setNotices] = useState<NoticeRecord[] | null>(null);
  const [whatsappApi, setWhatsappApi] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!institutionId) return;
    try {
      const [list, status] = await Promise.all([api.listNotices(institutionId), api.notifyStatus()]);
      setNotices(list);
      setWhatsappApi(status.whatsappApi);
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load updates.');
    }
  }, [institutionId]);
  // Delivery ticks arrive in the background, so look again each time this screen opens.
  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => {
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  const replace = (notice: NoticeRecord) => setNotices((list) => (list ?? []).map((n) => (n.id === notice.id ? notice : n)));
  const prepare = async () => {
    setCreating(true);
    try {
      const notice = await store.publishUpdate();
      if (notice) {
        setFresh(notice.id);
        setNotices((list) => [notice, ...(list ?? [])]);
      }
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not prepare the messages.');
    } finally {
      setCreating(false);
    }
  };

  const unfinished = useMemo(() => (notices ?? []).reduce((sum, n) => sum + n.recipients.filter((r) => !isTold(r.status)).length, 0), [notices]);
  const blockers = store.sessionsNeedingRoom;

  return (
    <Screen bottomSpace={wide ? 0 : 110}>
      <T v="eyebrow">Updates</T>
      <T v="h1">Tell your teachers</T>
      <T style={{ marginTop: 4, marginBottom: space.lg }}>
        {unfinished ? `${unfinished} message${unfinished === 1 ? '' : 's'} still to send.` : 'See who has heard about each change, so nobody is missed.'}
      </T>

      {!liveSessions.length ? (
        <Empty icon="calendar-outline" title="No timetable yet" text="Once you have one, this is where you share it and any changes." action={<Button label="Go to timetable" onPress={() => router.push('/timetable')} />} />
      ) : !liveVersion || liveVersion.status !== 'approved' ? (
        <Card tone="warn" style={{ gap: space.md }}>
          <T v="h3">Approve a timetable first</T>
          <T v="small">Teachers should only hear about a timetable you’re happy with.</T>
          <Button label="Review the timetable" size="sm" style={{ alignSelf: 'flex-start' }} onPress={() => router.push('/timetable')} />
        </Card>
      ) : pendingUpdate.recipients.length > 0 ? (
        <Card tone="accent" style={{ gap: space.md }}>
          <T v="h3">{pendingUpdate.title}</T>
          <T v="small">
            {pendingUpdate.recipients.length === 1 ? '1 teacher needs' : `${pendingUpdate.recipients.length} teachers need`} to hear about this: {pendingUpdate.recipients.map((r) => r.name).join(', ')}.
          </T>
          {blockers.length ? <T color={c.warn}>{blockers.length} class{blockers.length === 1 ? ' has' : 'es have'} no room. Fix that on the timetable first.</T> : null}
          <Button label="Prepare the messages" icon="create-outline" full loading={creating} disabled={blockers.length > 0} onPress={prepare} />
        </Card>
      ) : (
        <Card tone="ok">
          <Row gap={10}>
            <Icon name="checkmark-circle" size={22} color={c.ok} />
            <T style={{ flex: 1 }}>Nothing new to tell anyone. Change a class or room, and it will show up here.</T>
          </Row>
        </Card>
      )}

      {loadError ? (
        <Card tone="danger" style={{ gap: space.sm, marginTop: space.md }}>
          <T color={c.danger}>{loadError}</T>
          <Button label="Try again" kind="secondary" size="sm" style={{ alignSelf: 'flex-start' }} onPress={load} />
        </Card>
      ) : null}

      {notices?.length ? (
        <>
          <SectionTitle title="Your updates" action={<Button label={refreshing ? 'Checking…' : 'Refresh'} kind="ghost" size="sm" onPress={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }} />} />
          <View style={{ gap: space.md }}>
            {notices.map((notice, index) => (
              <NoticeCard key={notice.id} notice={notice} whatsappApi={whatsappApi} onChange={replace} startOpen={notice.id === fresh || (index === 0 && noticeProgress(notice).told < notice.recipients.length)} />
            ))}
          </View>
        </>
      ) : null}
      {!whatsappApi && notices ? (
        <T v="small" style={{ marginTop: space.lg }}>
          Each message opens in WhatsApp for you to send. Automatic sending can be turned on with WhatsApp API keys on the server.
        </T>
      ) : null}
    </Screen>
  );
}
