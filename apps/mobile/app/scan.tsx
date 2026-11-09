import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform, type TextInput, View } from 'react-native';
import { api } from '../src/api';
import { useStore } from '../src/store';
import { radius, space, useTheme } from '../src/theme';
import { Button, Card, Field, Icon, IconButton, Row, Screen, Segmented, T, useToast } from '../src/ui';

interface Line {
  key: string;
  ok: boolean;
  title: string;
  detail: string;
}
const SAME_CODE_MS = 4000;
const KEEP_LINES = 30;
// A browser only opens the camera on a secure address (https, or this computer).
const cameraBlocked = Platform.OS === 'web' && globalThis.isSecureContext === false;

/** Scan student cards with the camera or a handheld scanner, or type a roll number. */
export default function Scan() {
  const { institutionId } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  const [purpose, setPurpose] = useState<'class' | 'gate'>('class');
  const [cameraOn, setCameraOn] = useState(false);
  const [typed, setTyped] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const input = useRef<TextInput>(null);
  // The camera reports the same code many times a second while it's in view.
  const lastRead = useRef({ code: '', at: 0 });

  // Only one camera preview can be live, so it stops when this screen isn't showing.
  useFocusEffect(useCallback(() => () => setCameraOn(false), []));

  const submit = async (identifier: string) => {
    const value = identifier.trim();
    if (!value || !institutionId) return;
    try {
      const result = await api.scan(institutionId, value, purpose);
      const line: Line = result.matched
        ? { key: `${Date.now()}${value}`, ok: true, title: result.student.name, detail: `${result.student.rollNo} · ${result.student.divisionName}${result.duplicate ? ' · already scanned' : ''}` }
        : { key: `${Date.now()}${value}`, ok: false, title: 'Not recognised', detail: 'This card isn’t valid here, or no student has that roll number.' };
      setLines((list) => [line, ...list].slice(0, KEEP_LINES));
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not record that.');
    }
  };
  const fromCamera = (code: string) => {
    const now = Date.now();
    if (lastRead.current.code === code && now - lastRead.current.at < SAME_CODE_MS) return;
    lastRead.current = { code, at: now };
    submit(code);
  };
  const startCamera = async () => {
    const allowed = permission?.granted || (await requestPermission()).granted;
    if (allowed) setCameraOn(true);
    else toast.show('TimeFlex needs the camera to scan cards. You can allow it in your phone’s settings.');
  };

  return (
    <Screen>
      <Row gap={12} style={{ marginBottom: space.lg }}>
        <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flex: 1 }}>
          <T v="h1">Scan cards</T>
          <T v="small">{purpose === 'gate' ? 'Arriving after the first class has started is marked late automatically.' : 'Shows who’s here when you take attendance.'}</T>
        </View>
      </Row>
      <Segmented
        options={[
          { value: 'class', label: 'In class' },
          { value: 'gate', label: 'At the gate' },
        ]}
        value={purpose}
        onChange={setPurpose}
      />

      <Card style={{ marginTop: space.md, gap: space.md }}>
        {cameraBlocked ? (
          <Row gap={8}>
            <Icon name="information-circle-outline" size={18} color={c.muted} />
            <T v="small" style={{ flex: 1 }}>
              Browsers only allow the camera on a secure (https) address. Use the phone app, a handheld scanner, or type below.
            </T>
          </Row>
        ) : cameraOn ? (
          <>
            <View style={{ height: 300, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' }}>
              <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(result) => fromCamera(result.data)} />
            </View>
            <Button label="Stop camera" kind="secondary" icon="stop-circle-outline" onPress={() => setCameraOn(false)} />
          </>
        ) : (
          <Button label="Start camera" icon="camera-outline" size="lg" full onPress={startCamera} />
        )}
        <Field
          ref={input}
          label="Handheld scanner, or type a roll number"
          placeholder="e.g. SYA01"
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          blurOnSubmit={false}
          onSubmitEditing={() => {
            const value = typed;
            setTyped('');
            submit(value);
            input.current?.focus();
          }}
        />
      </Card>

      {lines.length ? (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          {lines.map((line) => (
            <Card key={line.key} tone={line.ok ? undefined : 'danger'} style={{ paddingVertical: space.md }}>
              <Row gap={10}>
                <Icon name={line.ok ? 'checkmark-circle' : 'close-circle'} size={22} color={line.ok ? c.ok : c.danger} />
                <View style={{ flex: 1 }}>
                  <T v="h3">{line.title}</T>
                  <T v="small">{line.detail}</T>
                </View>
              </Row>
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
