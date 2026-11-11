import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { studentApi, type StudentHome } from '../src/api';
import { space, useTheme } from '../src/theme';
import { Button, Card, Icon, Screen, T } from '../src/ui';

/** A student's own page. No password: a one-use link from the office ties it to their phone. */
export default function CheckIn() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { c } = useTheme();
  const [invite, setInvite] = useState<{ name: string; rollNo: string; className: string; college: string } | null>(null);
  const [home, setHome] = useState<StudentHome | null>(null);
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      if (!(await studentApi.hasPhone())) {
        setHome(null);
        return;
      }
      setHome(await studentApi.me());
      setProblem('');
    } catch (e) {
      if (!(await studentApi.hasPhone())) setHome(null);
      setProblem(e instanceof Error ? e.message : 'Could not reach TimeFlex.');
    } finally {
      setLoaded(true);
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  useEffect(() => {
    if (!code) return;
    setProblem('');
    studentApi.peek(code).then(setInvite, (e) => setProblem(e instanceof Error ? e.message : 'This link didn’t work.'));
  }, [code]);

  const setUp = async () => {
    if (!code) return;
    setBusy(true);
    try {
      await studentApi.claim(code);
      setInvite(null);
      router.replace('/checkin');
      await load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'This link didn’t work.');
    } finally {
      setBusy(false);
    }
  };
  const tap = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await studentApi.tap();
      setNote({ ok: true, text: result.status === 'already' ? `You’re already marked here for ${result.subject}.` : `Done. You’re marked here for ${result.subject}.` });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'That didn’t work. Try again.' });
    }
    setBusy(false);
    load();
  };

  if (invite) {
    return (
      <Screen>
        <Card style={{ gap: space.md }}>
          <T v="h1">Is this you?</T>
          <T v="h2">{invite.name}</T>
          <T v="small">
            {invite.rollNo} · {invite.className} · {invite.college}
          </T>
          <T>This link works once and ties your attendance to this phone. Don’t share it, and only continue if this is you.</T>
          <Button label="Yes, use this phone" icon="phone-portrait-outline" size="lg" full loading={busy} onPress={setUp} />
          {problem ? <T color={c.danger}>{problem}</T> : null}
        </Card>
      </Screen>
    );
  }
  if (!home) {
    return (
      <Screen>
        <Card style={{ gap: space.sm }}>
          <T v="h1">Mark your attendance</T>
          <T>{problem || (loaded || code ? 'This phone isn’t set up yet. Ask your college office for your personal link or QR slip, and open it on this phone.' : 'Loading…')}</T>
        </Card>
      </Screen>
    );
  }

  const session = home.session;
  const ready = home.enabled && home.onNetwork && session && !session.checkedIn;
  const line = (ok: boolean, text: string) => (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <Icon name={ok ? 'checkmark-circle' : 'close-circle-outline'} size={20} color={ok ? c.ok : c.muted} />
      <T style={{ flex: 1 }}>{text}</T>
    </View>
  );
  return (
    <Screen>
      <View style={{ marginBottom: space.lg }}>
        <T v="h1">{home.name}</T>
        <T v="small">
          {home.rollNo} · {home.className} · {home.college}
        </T>
      </View>
      {!home.enabled ? (
        <Card>
          <T>Your college has turned phone check-in off.</T>
        </Card>
      ) : (
        <Card style={{ gap: space.md }}>
          {line(Boolean(session), session ? `${session.subject}, ${session.slot}` : 'No class right now')}
          {line(home.onNetwork, home.onNetwork ? 'On your department’s Wi-Fi' : 'Not on your department’s Wi-Fi. Connect to it and turn off mobile data and any VPN.')}
          {session?.checkedIn ? (
            line(true, 'You’re marked here for this class')
          ) : (
            <Button label="I’m here" icon="hand-left-outline" size="lg" full disabled={!ready} loading={busy} onPress={tap} />
          )}
          <Button label="Check again" kind="ghost" size="sm" onPress={load} style={{ alignSelf: 'center' }} />
        </Card>
      )}
      {note ? (
        <Card tone={note.ok ? 'ok' : 'danger'} style={{ marginTop: space.md }}>
          <T>{note.text}</T>
        </Card>
      ) : null}
      {problem ? <T v="small" color={c.danger} style={{ marginTop: space.md }}>{problem}</T> : null}
      <T v="small" style={{ marginTop: space.lg }}>
        Your teacher confirms the register. Only tap in if you’re in class.
      </T>
    </Screen>
  );
}
