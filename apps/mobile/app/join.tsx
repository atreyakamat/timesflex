import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api } from '../src/api';
import { useStore } from '../src/store';
import { space, useTheme } from '../src/theme';
import { Button, Card, Field, Icon, Row, Screen, T } from '../src/ui';

/** Where an invite link lands: for a teacher joining their college, or an admin taking theirs on. */
export default function Join() {
  const params = useLocalSearchParams<{ code?: string }>();
  const { joinCollege } = useStore();
  const { c } = useTheme();
  const [code, setCode] = useState(params.code ?? '');
  const [info, setInfo] = useState<{ college: string; teacher: string | null; role: string } | null>(null);
  const [checking, setChecking] = useState(!!params.code);
  const [invalid, setInvalid] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const check = (value: string) => {
    setChecking(true);
    setInvalid(false);
    api
      .peekInvite(value.trim())
      .then((found) => {
        setInfo(found);
        if (found.teacher) setName(found.teacher);
      })
      .catch(() => setInvalid(true))
      .finally(() => setChecking(false));
  };
  useEffect(() => {
    if (params.code) check(params.code);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await joinCollege({ code: code.trim(), name: name.trim(), email: email.trim(), password });
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center', gap: space.lg, paddingTop: space.xl }}>
        {checking ? (
          <ActivityIndicator color={c.accent} size="large" />
        ) : !info ? (
          <>
            <T v="h1">Join your college</T>
            {invalid ? (
              <Card tone="danger" style={{ padding: space.md }}>
                <T color={c.danger}>This invite is no longer valid. Invites work once and last 14 days. Ask for a new one.</T>
              </Card>
            ) : null}
            <Card style={{ gap: space.md }}>
              <Field label="Invite code" placeholder="From your invite link" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} />
              <Button label="Continue" disabled={!code.trim()} onPress={() => check(code)} full />
            </Card>
          </>
        ) : (
          <>
            <View style={{ gap: 6 }}>
              <T v="eyebrow">{info.role === 'admin' ? 'Set up your college' : 'Teacher access'}</T>
              <T v="h1">{info.college}</T>
              <T>{info.role === 'admin' ? 'You’ve been invited to run this college on TimeFlex.' : `Join as ${info.teacher ?? 'a teacher'} to see your classes and mark students.`}</T>
            </View>
            <Card style={{ gap: space.md }}>
              <Field label="Your name" value={name} onChangeText={setName} placeholder="e.g. Prof. Anita Mehta" />
              <Field label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="you@college.edu" />
              <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 8 characters" hint="Already have an account? Use your e-mail and password." />
              {error ? (
                <Row gap={8} align="flex-start">
                  <Icon name="alert-circle-outline" size={18} color={c.danger} />
                  <T color={c.danger} style={{ flex: 1 }}>
                    {error}
                  </T>
                </Row>
              ) : null}
              <Button label="Join" size="lg" full loading={busy} disabled={!email.trim() || !password} onPress={submit} />
            </Card>
          </>
        )}
      </View>
    </Screen>
  );
}
