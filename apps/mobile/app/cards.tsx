import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { cardSheetHtml, type StudentCard } from '@core';
import { api } from '../src/api';
import { QrCode, qrSvg } from '../src/qr';
import { useStore } from '../src/store';
import { space } from '../src/theme';
import { Button, Card, Chip, Empty, IconButton, Row, Screen, Sheet, T, useToast } from '../src/ui';

/** Printable student cards. A card holds a signed code and no personal details. */
export default function Cards() {
  const { institutionId, profile, saveNow } = useStore();
  const toast = useToast();
  const [cards, setCards] = useState<StudentCard[] | null>(null);
  const [divisionId, setDivisionId] = useState(profile.divisions.find((d) => d.students?.length)?.id ?? '');
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!institutionId) return;
    try {
      // Students added a moment ago need to reach the server before they can have a card.
      await saveNow();
      setCards(await api.listCards(institutionId));
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not load the cards.');
      setCards([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId]);
  useEffect(() => {
    load();
  }, [load]);

  const shown = (cards ?? []).filter((card) => card.divisionId === divisionId);
  const print = (list: StudentCard[]) => {
    const page = globalThis.open?.('', '_blank');
    if (!page) {
      toast.show('Your browser blocked the print window. Allow pop-ups for this site and try again.');
      return;
    }
    page.document.write(cardSheetHtml(profile.institution.name, list, qrSvg));
    page.document.close();
    page.focus();
    page.print();
  };
  const replaceAll = async () => {
    if (!institutionId) return;
    setBusy(true);
    try {
      await api.rotateCards(institutionId);
      setReplacing(false);
      await load();
      toast.show('Every old card has stopped working. Print the new ones.');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not replace the cards.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Row gap={12} style={{ marginBottom: space.lg }}>
        <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flex: 1 }}>
          <T v="h1">Student cards</T>
          <T v="small">Print one per student. They show it at the gate or in class.</T>
        </View>
      </Row>

      {cards && !cards.length ? (
        <Empty icon="id-card-outline" title="No students yet" text="Add students to your class lists, and their cards appear here." action={<Button label="Class lists" onPress={() => router.push('/setup/classes')} />} />
      ) : (
        <View style={{ gap: space.md }}>
          <Row wrap gap={8}>
            {profile.divisions
              .filter((d) => d.students?.length)
              .map((d) => (
                <Chip key={d.id} label={d.name} active={d.id === divisionId} onPress={() => setDivisionId(d.id)} />
              ))}
          </Row>
          {Platform.OS === 'web' ? (
            <Row wrap gap={8}>
              <Button label={`Print this class (${shown.length})`} icon="print-outline" disabled={!shown.length} onPress={() => print(shown)} />
              <Button label={`Print everyone (${cards?.length ?? 0})`} kind="secondary" disabled={!cards?.length} onPress={() => print(cards ?? [])} />
            </Row>
          ) : (
            <T v="small">To print these, open TimeFlex on a computer.</T>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {shown.map((card) => (
              <Card key={card.studentId} style={{ flexGrow: 1, flexBasis: 160, alignItems: 'center', gap: 6 }}>
                <QrCode value={card.code} size={120} />
                <T v="h3" numberOfLines={1}>
                  {card.name}
                </T>
                <T v="small">
                  {card.rollNo} · {card.divisionName}
                </T>
              </Card>
            ))}
          </View>
          <Button label="A card was lost: replace all cards" kind="ghost" icon="refresh-outline" onPress={() => setReplacing(true)} />
        </View>
      )}

      <Sheet visible={replacing} onClose={() => setReplacing(false)} title="Replace every card?">
        <T>Every card already printed stops working at once, so everyone in the college needs a new one. Scan history stays.</T>
        <Button label="Yes, replace them all" kind="danger" loading={busy} onPress={replaceAll} />
        <Button label="Keep the current cards" kind="ghost" onPress={() => setReplacing(false)} />
      </Sheet>
    </Screen>
  );
}
