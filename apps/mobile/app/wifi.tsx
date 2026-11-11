import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { cardSheetHtml } from '@core';
import { api, checkinLink, type CheckinSettings, type CheckinStudent } from '../src/api';
import { qrSvg } from '../src/qr';
import { useStore } from '../src/store';
import { space, useTheme } from '../src/theme';
import { Button, Card, Chip, Field, IconButton, Pill, Row, Screen, SectionTitle, Segmented, T, useToast } from '../src/ui';

/** Students tap in from their own phones, only while on the department's Wi-Fi. */
export default function Wifi() {
  const { institutionId, profile, saveNow } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const [settings, setSettings] = useState<CheckinSettings | null>(null);
  const [students, setStudents] = useState<CheckinStudent[]>([]);
  const [label, setLabel] = useState('');
  const [cidr, setCidr] = useState('');
  const [divisionId, setDivisionId] = useState(profile.divisions.find((d) => d.students?.length)?.id ?? '');
  const [links, setLinks] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!institutionId) return;
    try {
      await saveNow();
      const [next, list] = await Promise.all([api.getCheckin(institutionId), api.listCheckinStudents(institutionId)]);
      setSettings(next);
      setStudents(list);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not load.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (enabled: boolean, networks: CheckinSettings['networks']) => {
    if (!institutionId) return false;
    try {
      setSettings(await api.saveCheckin(institutionId, { enabled, networks }));
      return true;
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not save that.');
      return false;
    }
  };
  const add = async () => {
    if (!settings) return;
    if (await save(settings.enabled, [...settings.networks, { id: '', label: label.trim(), cidr: cidr.trim() }])) {
      setLabel('');
      setCidr('');
    }
  };
  const makeLinks = async (body: { studentId: string } | { divisionId: string }, print: boolean) => {
    if (!institutionId) return;
    try {
      const rows = await api.makeCheckinLinks(institutionId, body);
      setLinks((all) => ({ ...all, ...Object.fromEntries(rows.map((row) => [row.studentId, checkinLink(row.code)])) }));
      if (print) {
        const page = globalThis.open?.('', '_blank');
        if (!page) return toast.show('Your browser blocked the print window. Allow pop-ups and try again.');
        page.document.write(cardSheetHtml(`${profile.institution.name}: scan once, on your own phone`, rows.map((row) => ({ ...row, code: checkinLink(row.code) })), qrSvg));
        page.document.close();
        page.focus();
        page.print();
      }
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not make links.');
    }
  };
  const unlink = async (student: CheckinStudent) => {
    if (!institutionId) return;
    try {
      await api.unlinkCheckinStudent(institutionId, student.studentId);
      setLinks(({ [student.studentId]: _gone, ...rest }) => rest);
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not do that.');
    }
  };
  const shown = students.filter((student) => student.divisionId === divisionId);

  return (
    <Screen>
      <Row gap={12} style={{ marginBottom: space.lg }}>
        <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flex: 1 }}>
          <T v="h1">Phone check-in</T>
          <T v="small">Students tap “I’m here” on their phone, only on your Wi-Fi. Teachers see it on the register and confirm it.</T>
        </View>
      </Row>

      {settings ? (
        <View style={{ gap: space.md }}>
          <Segmented
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
            ]}
            value={settings.enabled ? 'on' : 'off'}
            onChange={(value) => save(value === 'on', settings.networks)}
          />

          <Card tone={settings.onNetwork ? 'ok' : undefined} style={{ gap: 6 }}>
            <T v="h3">{settings.onNetwork ? `You’re on “${settings.onNetwork}”` : 'This device isn’t on a saved network'}</T>
            <T v="small">The address TimeFlex sees for you now: {settings.yourIp || 'unknown'}</T>
            <T v="small">To add a network, open this page on a device connected to that Wi-Fi with mobile data off, and use the address shown here. To validate one, check it says “You’re on” from there.</T>
            {settings.yourIp && !settings.onNetwork ? <Button label="Use this address" kind="secondary" size="sm" onPress={() => setCidr(settings.yourIp)} style={{ alignSelf: 'flex-start' }} /> : null}
            <Button label="Check again" kind="ghost" size="sm" onPress={load} style={{ alignSelf: 'flex-start', marginLeft: -12 }} />
          </Card>

          <SectionTitle title="Department networks" />
          {settings.networks.map((network) => (
            <Card key={network.id} style={{ paddingVertical: space.sm }}>
              <Row gap={8} style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <T v="h3">{network.label}</T>
                  <T v="mono">{network.cidr}</T>
                </View>
                <Button
                  label="Remove"
                  kind="ghost"
                  size="sm"
                  onPress={() => {
                    const rest = settings.networks.filter((item) => item.id !== network.id);
                    save(settings.enabled && rest.length > 0, rest);
                  }}
                />
              </Row>
            </Card>
          ))}
          <Card style={{ gap: space.sm }}>
            <Field label="Name" placeholder="e.g. Computer dept Wi-Fi" value={label} onChangeText={setLabel} maxLength={60} />
            <Field label="Address or range" placeholder="e.g. 203.0.113.7 or 10.20.0.0/16" value={cidr} onChangeText={setCidr} autoCapitalize="none" autoCorrect={false} />
            <Button label="Add network" icon="add" disabled={!label.trim() || !cidr.trim()} onPress={add} style={{ alignSelf: 'flex-start' }} />
          </Card>

          <SectionTitle title="Students’ phones" />
          <T v="small">Each student opens a personal link once, and it ties to that phone. A link can’t be reused by a friend.</T>
          <Row wrap gap={8}>
            {profile.divisions
              .filter((d) => d.students?.length)
              .map((d) => (
                <Chip key={d.id} label={d.name} active={d.id === divisionId} onPress={() => setDivisionId(d.id)} />
              ))}
          </Row>
          {Platform.OS === 'web' ? <Button label={`Print QR slips for this class (${shown.length})`} icon="print-outline" disabled={!shown.length} onPress={() => makeLinks({ divisionId }, true)} style={{ alignSelf: 'flex-start' }} /> : null}
          <Card style={{ gap: 2 }}>
            {shown.map((student) => (
              <View key={student.studentId} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.border, gap: 4 }}>
                <Row gap={8} style={{ justifyContent: 'space-between' }}>
                  <T v="label" style={{ flex: 1, color: c.text }} numberOfLines={1}>
                    {student.rollNo} · {student.name}
                  </T>
                  {student.phone ? <Pill label="Phone set up" tone="ok" /> : null}
                  <Button label={student.phone ? 'New link' : 'Link'} kind="ghost" size="sm" onPress={() => makeLinks({ studentId: student.studentId }, false)} />
                  {student.phone ? <Button label="Remove" kind="ghost" size="sm" onPress={() => unlink(student)} /> : null}
                </Row>
                {links[student.studentId] ? <Field value={links[student.studentId]} editable={false} selectTextOnFocus accessibilityLabel={`Link for ${student.name}`} /> : null}
              </View>
            ))}
          </Card>

          <SectionTitle title="Good to know" />
          <Card style={{ gap: 6 }}>
            <T v="small">This proves a phone is on your network, not that its owner is in the room, so someone in the corridor could tap in. That’s why the teacher confirms the register.</T>
            <T v="small">If your internet provider changes your public address, check-in stops until you update it here. Ask for a fixed IP if you can.</T>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}
