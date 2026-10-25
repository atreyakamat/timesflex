import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { InstitutionType } from '@core';
import { useStore } from '../src/store';
import { radius, space, useTheme } from '../src/theme';
import { Button, Card, Field, Icon, IconButton, Row, Screen, Segmented, T, type IconName } from '../src/ui';

const TYPES: { value: InstitutionType; label: string; icon: IconName }[] = [
  { value: 'school', label: 'School', icon: 'pencil-outline' },
  { value: 'college', label: 'College', icon: 'business-outline' },
  { value: 'university', label: 'University', icon: 'school-outline' },
];

export default function Auth() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const { signIn, signUp } = useStore();
  const { c } = useTheme();
  const [mode, setMode] = useState<'signup' | 'signin'>(params.mode === 'signin' ? 'signin' : 'signup');
  const [institutionName, setInstitutionName] = useState('');
  const [institutionType, setInstitutionType] = useState<InstitutionType>('college');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signup = mode === 'signup';
  const ok = signup ? institutionName.trim() && name.trim() && email.trim() && password.length >= 8 : email.trim() && password;

  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError('');
    try {
      if (signup) {
        await signUp({ institutionName: institutionName.trim(), institutionType, name: name.trim(), email: email.trim(), password });
        router.replace('/onboarding');
      } else {
        await signIn(email.trim(), password);
        router.replace('/');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.xl }}>
        <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))} />
      </Row>
      <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center', gap: space.lg }}>
        <View style={{ gap: 6 }}>
          <T v="eyebrow">{signup ? 'Institution account' : 'Welcome back'}</T>
          <T v="h1">{signup ? 'Let’s set up your department' : 'Sign in to TimeFlex'}</T>
          <T>{signup ? 'One account for your department. Takes a minute; the assistant does the rest.' : 'Your timetables are where you left them.'}</T>
        </View>
        <Card style={{ gap: space.lg }}>
          <Segmented
            options={[
              { value: 'signup', label: 'Create account' },
              { value: 'signin', label: 'Sign in' },
            ]}
            value={mode}
            onChange={(value) => {
              setMode(value);
              setError('');
            }}
          />
          {signup && (
            <>
              <Field label="Institution name" placeholder="e.g. Goa College of Engineering" value={institutionName} onChangeText={setInstitutionName} autoComplete="organization" />
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                {TYPES.map((type) => {
                  const on = institutionType === type.value;
                  return (
                    <Pressable
                      key={type.value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      onPress={() => setInstitutionType(type.value)}
                      style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? c.accent : c.borderStrong, backgroundColor: on ? c.accentSoft : c.glassStrong }}
                    >
                      <Icon name={type.icon} size={20} color={on ? c.accent : c.text2} />
                      <T v="label" color={on ? c.accentText : c.text2}>
                        {type.label}
                      </T>
                    </Pressable>
                  );
                })}
              </View>
              <Field label="Your name" placeholder="e.g. Prof. Anita Mehta" value={name} onChangeText={setName} autoComplete="name" />
            </>
          )}
          <Field label="E-mail" placeholder="you@college.edu" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <View>
            <Field
              label="Password"
              placeholder={signup ? 'At least 8 characters' : ''}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!show}
              autoComplete={signup ? 'new-password' : 'current-password'}
              onSubmitEditing={submit}
              hint={signup && password && password.length < 8 ? `${8 - password.length} more characters` : undefined}
            />
            <Pressable onPress={() => setShow(!show)} style={{ position: 'absolute', right: 12, top: 36 }} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
              <Icon name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={c.muted} />
            </Pressable>
          </View>
          {error ? (
            <Card tone="danger" style={{ padding: space.md }}>
              <T color={c.danger}>{error}</T>
            </Card>
          ) : null}
          <Button label={signup ? 'Create account' : 'Sign in'} size="lg" onPress={submit} disabled={!ok} loading={busy} full />
        </Card>
      </View>
    </Screen>
  );
}
