import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { api, type DeviceRow } from '../src/api';
import { useStore } from '../src/store';
import { space, useTheme } from '../src/theme';
import { Button, Card, Chip, Field, Icon, IconButton, Pill, Row, Screen, SectionTitle, Segmented, Sheet, T, useToast } from '../src/ui';

type Kind = DeviceRow['kind'];
const KIND_TEXT: Record<Kind, { label: string; detail: string }> = {
  gate: { label: 'Gate', detail: 'A reader where students arrive. Arriving after the first class has started is marked late.' },
  classroom: { label: 'Classroom', detail: 'A reader in a room. Shows who’s here, without marking anyone late.' },
  integration: { label: 'Other software', detail: 'Lets your ERP or another system read students, attendance and the timetable. It can’t change anything.' },
};
const GRACE = [5, 10, 15, 20];

const serverAddress = () => {
  const base = api.base();
  return Platform.OS === 'web' && !base.startsWith('http') ? (globalThis.location?.origin ?? '') : base;
};

/** Fingerprint machines, scanners and other software connected to this college. */
export default function Devices() {
  const { institutionId, profile, update } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('gate');
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);
  const [removing, setRemoving] = useState<DeviceRow | null>(null);
  const grace = profile.institution.lateAfterMinutes ?? 10;

  const load = useCallback(() => {
    if (!institutionId) return;
    api.listDevices(institutionId).then(setDevices).catch((e) => toast.show(e instanceof Error ? e.message : 'Could not load devices.'));
  }, [institutionId, toast]);
  useEffect(load, [load]);

  const add = async () => {
    if (!institutionId) return;
    try {
      const made = await api.createDevice(institutionId, { name: name.trim(), kind });
      setFresh({ name: made.name, key: made.key });
      setName('');
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not add that.');
    }
  };
  const remove = async () => {
    if (!institutionId || !removing) return;
    try {
      await api.deleteDevice(institutionId, removing.id);
      toast.show(`${removing.name} has stopped working.`);
      setRemoving(null);
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not remove that.');
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show('Copied.');
    } catch {
      toast.show('Select the key above to copy it.');
    }
  };

  return (
    <Screen>
      <Row gap={12} style={{ marginBottom: space.lg }}>
        <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flex: 1 }}>
          <T v="h1">Devices</T>
          <T v="small">Fingerprint machines, scanners, and other software.</T>
        </View>
      </Row>

      {fresh ? (
        <Card tone="warn" style={{ gap: space.sm, marginBottom: space.md }}>
          <T v="h3">Key for {fresh.name}</T>
          <Field value={fresh.key} editable={false} selectTextOnFocus accessibilityLabel="Device key" />
          <T v="small">Copy it now. It won’t be shown again. Anyone with this key can act as this device, so keep it out of chat.</T>
          <T v="small">Server address: {serverAddress()}</T>
          <Row gap={8}>
            {Platform.OS === 'web' ? <Button label="Copy key" size="sm" icon="copy-outline" onPress={() => copy(fresh.key)} /> : null}
            <Button label="I’ve saved it" kind="ghost" size="sm" onPress={() => setFresh(null)} />
          </Row>
        </Card>
      ) : null}

      <Card style={{ gap: space.md }}>
        <T v="h3">Add a device</T>
        <Segmented options={(Object.keys(KIND_TEXT) as Kind[]).map((value) => ({ value, label: KIND_TEXT[value].label }))} value={kind} onChange={setKind} />
        <T v="small">{KIND_TEXT[kind].detail}</T>
        <Field label="Name" placeholder={kind === 'integration' ? 'e.g. College ERP' : 'e.g. Main gate'} value={name} onChangeText={setName} maxLength={80} />
        <Button label="Add and show its key" icon="add" disabled={!name.trim()} onPress={add} style={{ alignSelf: 'flex-start' }} />
      </Card>

      <SectionTitle title="Connected" />
      {devices.length ? (
        <View style={{ gap: space.sm }}>
          {devices.map((device) => (
            <Card key={device.id} style={{ gap: 6, paddingVertical: space.md }}>
              <Row gap={8} style={{ justifyContent: 'space-between' }}>
                <T v="h3" style={{ flex: 1 }} numberOfLines={1}>
                  {device.name}
                </T>
                <Pill label={KIND_TEXT[device.kind].label} />
              </Row>
              <T v="small">{device.lastSeenAt ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}` : 'Not connected yet'}</T>
              {device.unmatched.length ? (
                <Row gap={8} style={{ alignItems: 'flex-start' }}>
                  <Icon name="alert-circle-outline" size={16} color={c.warn} />
                  <T v="small" style={{ flex: 1 }}>
                    IDs it couldn’t match to one student: {device.unmatched.join(', ')}. Each needs to equal a roll number used only once in the college.
                  </T>
                </Row>
              ) : null}
              <Button label="Remove" kind="ghost" size="sm" onPress={() => setRemoving(device)} style={{ alignSelf: 'flex-start', marginLeft: -12 }} />
            </Card>
          ))}
        </View>
      ) : (
        <T v="small">Nothing connected yet.</T>
      )}

      <SectionTitle title="Marked late after" />
      <Row wrap gap={8}>
        {GRACE.map((minutes) => (
          <Chip key={minutes} label={`${minutes} min`} active={grace === minutes} onPress={() => update((p) => ({ ...p, institution: { ...p.institution, lateAfterMinutes: minutes } }))} />
        ))}
      </Row>
      <T v="small" style={{ marginTop: space.sm }}>
        How long after a student’s first class starts a gate scan counts as late.
      </T>

      <SectionTitle title="How fingerprints work" />
      <Card style={{ gap: 6 }}>
        <T v="small">Phones can’t identify a student by fingerprint, so this needs a fingerprint machine. The machine keeps the fingerprints and tells TimeFlex only the student’s ID and the time. TimeFlex never receives or stores a fingerprint.</T>
        <T v="small">Enrol each student using their roll number as their ID. Before collecting fingerprints, students need to be told and to agree. A QR card is always the simpler option.</T>
      </Card>

      <Sheet visible={!!removing} onClose={() => setRemoving(null)} title={`Remove ${removing?.name ?? ''}?`}>
        <T>Its key stops working at once. Scans it already sent stay on record.</T>
        <Button label="Yes, remove it" kind="danger" onPress={remove} />
        <Button label="Keep it" kind="ghost" onPress={() => setRemoving(null)} />
      </Sheet>
    </Screen>
  );
}
