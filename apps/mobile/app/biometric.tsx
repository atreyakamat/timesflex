import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { searchStudents } from '@core';
import { api, type ImportSummary, type ReaderLink } from '../src/api';
import { useStore } from '../src/store';
import { space, useTheme } from '../src/theme';
import { Button, Card, Field, Icon, IconButton, Row, Screen, SectionTitle, Segmented, T, useToast } from '../src/ui';

type Tab = 'connect' | 'import' | 'ids';

/** The four ways to connect a machine, simplest first. Each says what to look for on the machine. */
const ROUTES = [
  {
    title: 'It can save a file (USB stick or its software)',
    body: 'Nearly every machine can. Export the attendance log, then upload it on the “Upload a file” tab. Good for weekly or daily catch-up, with nothing to install.',
  },
  {
    title: 'Its software saves files on a computer automatically',
    body: 'Install the TimeFlex connector on that computer and point its “folder” source at where the files land. New punches are sent every minute.',
  },
  {
    title: 'Its menu has ADMS, Cloud server or PUSH',
    body: 'The machine can send each punch over the network as it happens. Run the connector with its “zkteco-adms” source and set the machine’s server address to that computer. Try one machine first: this hasn’t been tested on real hardware yet.',
  },
  {
    title: 'Its software can call a web address (a webhook)',
    body: 'Run the connector’s “webhook” source and give the software its address and secret. You tell the connector which fields hold the ID and the time.',
  },
];

const readFile = () =>
  new Promise<{ name: string; text: string } | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt,.dat,.tsv,.log';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then((text) => resolve({ name: file.name, text }), () => resolve(null));
    };
    input.click();
  });

/** Connecting fingerprint and card machines of any brand. */
export default function Biometric() {
  const { institutionId, profile, saveNow } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('connect');

  // Upload
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [kind, setKind] = useState<'gate' | 'classroom'>('gate');
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);

  // Machine IDs
  const [links, setLinks] = useState<ReaderLink[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [linking, setLinking] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pasted, setPasted] = useState('');

  const load = useCallback(() => {
    if (!institutionId) return;
    Promise.all([api.listReaderIds(institutionId), api.listDevices(institutionId)])
      .then(([rows, devices]) => {
        setLinks(rows);
        setUnmatched((list) => [...new Set([...devices.flatMap((d) => d.unmatched), ...list])]);
      })
      .catch((e) => toast.show(e instanceof Error ? e.message : 'Could not load.'));
  }, [institutionId, toast]);
  useEffect(load, [load]);
  const stillUnmatched = unmatched.filter((id) => !links.some((row) => row.readerId.toLowerCase() === id.toLowerCase()));

  const send = async (dryRun: boolean) => {
    if (!institutionId || !text.trim()) return;
    setBusy(true);
    try {
      await saveNow();
      const result = await api.importScans(institutionId, { text, kind, name: fileName || 'pasted', dryRun });
      if (dryRun) setPreview(result);
      else {
        setPreview(null);
        setText('');
        setFileName('');
        toast.show(`Imported ${result.accepted} scan${result.accepted === 1 ? '' : 's'}${result.duplicates ? `, ${result.duplicates} already there` : ''}.`);
      }
      if (result.unmatched.length) setUnmatched((list) => [...new Set([...result.unmatched, ...list])]);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  };
  const choose = async () => {
    const file = await readFile();
    if (!file) return;
    setFileName(file.name);
    setText(file.text);
    setPreview(null);
  };
  const linkTo = async (readerId: string, studentId: string) => {
    if (!institutionId) return;
    try {
      await saveNow();
      await api.linkReaderIds(institutionId, { links: [{ readerId, studentId }] });
      setLinking(null);
      setQuery('');
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not link that.');
    }
  };
  const linkPasted = async () => {
    if (!institutionId) return;
    try {
      await saveNow();
      const result = await api.linkReaderIds(institutionId, { text: pasted });
      toast.show(`Linked ${result.saved}.${result.problems.length ? ` ${result.problems.length} line(s) need a look.` : ''}`);
      setPasted(result.problems.map((p) => p.line).join('\n'));
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not link those.');
    }
  };
  const unlink = async (readerId: string) => {
    if (!institutionId) return;
    try {
      await api.unlinkReaderId(institutionId, readerId);
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not unlink that.');
    }
  };

  const linkPicker = (readerId: string) => (
    <Card style={{ gap: space.sm }}>
      <T v="h3">Who is machine ID {readerId}?</T>
      <Field placeholder="Search name or roll number" value={query} onChangeText={setQuery} autoCorrect={false} autoFocus />
      {searchStudents(profile, query)
        .slice(0, 6)
        .map((student) => (
          <Button key={student.id} label={`${student.name} · ${student.rollNo} · ${student.divisionName}`} kind="secondary" size="sm" style={{ alignSelf: 'stretch' }} onPress={() => linkTo(readerId, student.id)} />
        ))}
      <Button label="Cancel" kind="ghost" size="sm" onPress={() => setLinking(null)} style={{ alignSelf: 'flex-start' }} />
    </Card>
  );

  return (
    <Screen>
      <Row gap={12} style={{ marginBottom: space.lg }}>
        <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flex: 1 }}>
          <T v="h1">Fingerprint machines</T>
          <T v="small">Any brand. Connect it, upload its file, and match its IDs to students.</T>
        </View>
      </Row>
      <Segmented
        options={[
          { value: 'connect', label: 'Connect' },
          { value: 'import', label: 'Upload a file' },
          { value: 'ids', label: `Machine IDs${stillUnmatched.length ? ` (${stillUnmatched.length})` : ''}` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'connect' ? (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <T v="small">Check your machine’s menu or manual. Use the first that fits.</T>
          {ROUTES.map((route, index) => (
            <Card key={route.title} style={{ gap: 4 }}>
              <Row gap={10} style={{ alignItems: 'flex-start' }}>
                <T v="h3" color={c.accent}>
                  {index + 1}
                </T>
                <View style={{ flex: 1, gap: 4 }}>
                  <T v="h3">{route.title}</T>
                  <T v="small">{route.body}</T>
                </View>
              </Row>
            </Card>
          ))}
          <Card tone="accent" style={{ gap: 6 }}>
            <T v="h3">Before anything else</T>
            <T v="small">Enrol each student on the machine with their roll number as their ID, if it allows. If it only allows its own numbers, link them on the Machine IDs tab.</T>
            <T v="small">The connector needs a key: add a device under Devices. The full guide, for whoever sets it up, is docs/BIOMETRIC-GUIDE.md in TimeFlex’s files.</T>
            <Button label="Devices and keys" kind="secondary" size="sm" icon="hardware-chip-outline" onPress={() => router.push('/devices')} style={{ alignSelf: 'flex-start' }} />
          </Card>
        </View>
      ) : tab === 'import' ? (
        <View style={{ gap: space.md, marginTop: space.md }}>
          <Card style={{ gap: space.md }}>
            <T v="small">Export the attendance log from the machine or its software, as CSV or text. Any column order and most date formats work. You’ll see a preview first.</T>
            {Platform.OS === 'web' ? <Button label={fileName ? `Chosen: ${fileName}` : 'Choose a file'} icon="document-outline" kind="secondary" onPress={choose} style={{ alignSelf: 'flex-start' }} /> : null}
            <Field
              label={Platform.OS === 'web' ? 'Or paste it' : 'Paste the file’s contents'}
              placeholder={'Emp Code,Punch Time\nA01,09/11/2026 08:50 AM'}
              multiline
              value={text.length > 4000 ? `${text.slice(0, 4000)}\n… (${text.length} characters)` : text}
              editable={text.length <= 4000}
              onChangeText={(value) => {
                setText(value);
                setPreview(null);
              }}
              style={{ minHeight: 110, textAlignVertical: 'top', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined }}
            />
            {text.length > 4000 ? <Button label="Clear" kind="ghost" size="sm" onPress={() => { setText(''); setFileName(''); setPreview(null); }} style={{ alignSelf: 'flex-start' }} /> : null}
            <Segmented
              options={[
                { value: 'gate', label: 'Machine at the gate' },
                { value: 'classroom', label: 'In a classroom' },
              ]}
              value={kind}
              onChange={setKind}
            />
            <T v="small">{kind === 'gate' ? 'Arriving after the first class has started is marked late.' : 'Records who was there, without late marks.'}</T>
            <Button label="Preview" icon="eye-outline" disabled={!text.trim()} loading={busy && !preview} onPress={() => send(true)} style={{ alignSelf: 'flex-start' }} />
          </Card>

          {preview ? (
            <Card style={{ gap: space.sm }}>
              <T v="h3">
                {preview.matched} of {preview.readable} punches matched a student
              </T>
              {preview.rows.map((row) => (
                <Row key={`${row.id}${row.time}`} gap={8}>
                  <Icon name={row.name ? 'checkmark-circle' : 'help-circle-outline'} size={16} color={row.name ? c.ok : c.warn} />
                  <T v="small" style={{ flex: 1 }} numberOfLines={1}>
                    {row.id} · {row.time} · {row.name ? `${row.name}, ${row.className}` : 'no student with this ID'}
                  </T>
                </Row>
              ))}
              {preview.unmatchedCount ? <T v="small">{preview.unmatchedCount} ID(s) don’t match anyone yet. Link them on the Machine IDs tab, then upload again.</T> : null}
              {preview.outOfRange ? <T v="small">{preview.outOfRange} punch(es) are in the future or over two months old, and will be left out. Check the machine’s clock.</T> : null}
              {preview.skipped ? (
                <T v="small">
                  {preview.skipped} line(s) weren’t punches{preview.unreadable.length ? `, such as: ${preview.unreadable.slice(0, 2).join(' | ')}` : ''}.
                </T>
              ) : null}
              <Button label={`Import ${preview.matched} punch${preview.matched === 1 ? '' : 'es'}`} icon="cloud-upload-outline" disabled={!preview.matched} loading={busy} onPress={() => send(false)} style={{ alignSelf: 'flex-start' }} />
            </Card>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: space.md, marginTop: space.md }}>
          <T v="small">Only needed when the machine’s ID for a student isn’t their roll number. A linked ID always wins over a roll number.</T>
          {stillUnmatched.length ? (
            <>
              <SectionTitle title="Not matched yet" />
              {stillUnmatched.map((id) =>
                linking === id ? (
                  <View key={id}>{linkPicker(id)}</View>
                ) : (
                  <Card key={id} style={{ paddingVertical: space.sm }}>
                    <Row gap={8} style={{ justifyContent: 'space-between' }}>
                      <T v="mono">{id}</T>
                      <Button label="Link to a student" size="sm" kind="secondary" onPress={() => { setLinking(id); setQuery(''); }} />
                    </Row>
                  </Card>
                ),
              )}
            </>
          ) : null}

          <SectionTitle title="Link many at once" />
          <Card style={{ gap: space.sm }}>
            <Field label="One per line: machine ID, roll number" placeholder={'1023, SYA01\n1024, SYA02'} multiline value={pasted} onChangeText={setPasted} style={{ minHeight: 90, textAlignVertical: 'top' }} />
            <Button label="Link these" disabled={!pasted.trim()} onPress={linkPasted} style={{ alignSelf: 'flex-start' }} />
          </Card>

          <SectionTitle title={`Linked (${links.length})`} />
          {links.length ? (
            <Card style={{ gap: 2 }}>
              {links.map((row) => (
                <Row key={row.readerId} gap={8} style={{ justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.border }}>
                  <T v="label" style={{ flex: 1, color: c.text }} numberOfLines={1}>
                    {row.readerId} → {row.name ? `${row.name} · ${row.rollNo} · ${row.className}` : 'a student no longer on the lists'}
                  </T>
                  <Button label="Unlink" kind="ghost" size="sm" onPress={() => unlink(row.readerId)} />
                </Row>
              ))}
            </Card>
          ) : (
            <T v="small">None yet.</T>
          )}
        </View>
      )}
    </Screen>
  );
}
