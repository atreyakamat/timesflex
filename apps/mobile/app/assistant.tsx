import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  actionsFromIntent,
  describeAction,
  isRunAction,
  parseCommand,
  setupInsights,
  timetableInsights,
  type AgentAction,
} from '@core';
import { api } from '../src/api';
import { useStore } from '../src/store';
import { radius, space, useTheme } from '../src/theme';
import { Background, Button, Card, Chip, Gradient, Icon, IconButton, Row, T } from '../src/ui';

interface Message {
  id: number;
  from: 'ai' | 'me';
  text: string;
  actions?: AgentAction[];
  state?: 'proposed' | 'applied' | 'cancelled' | 'working';
}

const EXAMPLES = ['Mehta is away tomorrow', 'make 3 variations', 'max 3 a day for Rao', 'add lab 3 with 32 seats', 'Iyer can’t teach on Fridays'];

export default function Assistant() {
  const store = useStore();
  const { profile, liveSessions, unplaced } = store;
  const { c } = useTheme();
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const counter = useRef(1);
  const scroll = useRef<ScrollView>(null);
  const insights = [...setupInsights(profile), ...timetableInsights(profile, liveSessions, unplaced.length)].filter((i) => i.fix && i.level !== 'good');
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: 0,
      from: 'ai',
      text: insights.length
        ? `Hi! Tell me what changed, or let me fix what I noticed: ${insights[0].title.toLowerCase()}.`
        : 'Hi! Tell me what changed in plain words — I’ll show you what I’ll do before doing it.',
      ...(insights[0]?.fix ? { actions: insights[0].fix.actions, state: 'proposed' as const } : {}),
    },
  ]);

  const push = (message: Omit<Message, 'id'>) => {
    const id = counter.current++;
    setMessages((list) => [...list, { ...message, id }]);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 80);
    return id;
  };
  const setState = (id: number, state: Message['state'], extra?: Partial<Message>) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, state, ...extra } : m)));

  const send = async (input = text) => {
    const clean = input.trim();
    if (!clean || thinking) return;
    setText('');
    push({ from: 'me', text: clean });
    let result = parseCommand(clean, profile);
    if (!result.understood) {
      setThinking(true);
      try {
        const reply = await api.interpret(clean, {
          teachers: profile.teachers.map((t) => t.name),
          subjects: profile.subjects.map((s) => s.name),
          classes: profile.divisions.map((d) => d.name),
        });
        if (reply.source === 'llm') {
          const fromModel = actionsFromIntent(reply.intent, profile);
          if (fromModel.understood || reply.intent.intent !== 'unknown') result = fromModel;
        }
      } catch {
        // Offline: the rule-based reply below still helps.
      } finally {
        setThinking(false);
      }
    }
    push(result.actions.length ? { from: 'ai', text: result.reply, actions: result.actions, state: 'proposed' } : { from: 'ai', text: result.reply });
  };

  const apply = async (message: Message) => {
    if (!message.actions) return;
    setState(message.id, 'working');
    try {
      const outcome = await store.applyAgent(message.actions);
      setState(message.id, 'applied');
      push({ from: 'ai', text: outcome ?? 'Done. Everything is saved.' });
    } catch (e) {
      setState(message.id, 'proposed');
      push({ from: 'ai', text: e instanceof Error ? e.message : 'That did not work.' });
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Background />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
          <Row style={{ justifyContent: 'space-between', padding: space.lg }}>
            <Row gap={10}>
              <Gradient style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="sparkles" size={20} color="#fff" />
              </Gradient>
              <View>
                <T v="h3">TimeFlex assistant</T>
                <T v="small">Shows every change before making it</T>
              </View>
            </Row>
            <IconButton icon="close" label="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} />
          </Row>

          <ScrollView ref={scroll} contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
            {messages.map((m) =>
              m.from === 'me' ? (
                <View key={m.id} style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: c.primary, borderRadius: 18, borderBottomRightRadius: 6, paddingVertical: 10, paddingHorizontal: 14 }}>
                  <T color={c.onPrimary} style={{ fontWeight: '600' }}>
                    {m.text}
                  </T>
                </View>
              ) : (
                <View key={m.id} style={{ alignSelf: 'flex-start', maxWidth: '92%', gap: 8 }}>
                  <View style={{ backgroundColor: c.glassStrong, borderRadius: 18, borderBottomLeftRadius: 6, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: c.glassBorder }}>
                    <T style={{ color: c.text }}>{m.text}</T>
                  </View>
                  {m.actions && (
                    <Card style={{ gap: 8, padding: space.md }}>
                      <T v="label">{m.state === 'applied' ? 'Done:' : 'I will:'}</T>
                      {m.actions.map((action, i) => (
                        <Row key={i} gap={8} align="flex-start">
                          <Icon name={m.state === 'applied' ? 'checkmark-circle' : isRunAction(action) ? 'sparkles-outline' : 'create-outline'} size={18} color={m.state === 'applied' ? c.ok : c.accent} />
                          <T style={{ flex: 1 }}>{describeAction(action, profile)}</T>
                        </Row>
                      ))}
                      {(m.state === 'proposed' || m.state === 'working') && (
                        <Row gap={8}>
                          <Button label="Apply" icon="checkmark" size="sm" loading={m.state === 'working'} onPress={() => apply(m)} />
                          <Button label="Cancel" kind="ghost" size="sm" onPress={() => setState(m.id, 'cancelled')} />
                        </Row>
                      )}
                      {m.state === 'applied' && m.actions.some(isRunAction) && <Button label="See the timetable" size="sm" kind="secondary" onPress={() => router.push('/timetable')} />}
                      {m.state === 'cancelled' && <T v="small">Cancelled.</T>}
                    </Card>
                  )}
                </View>
              ),
            )}
            {thinking && (
              <T v="small" style={{ paddingLeft: 4 }}>
                Thinking with the local model…
              </T>
            )}
          </ScrollView>

          <View style={{ padding: space.lg, gap: space.sm }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {EXAMPLES.map((example) => (
                <Chip key={example} label={example} onPress={() => setText(example)} />
              ))}
            </ScrollView>
            <Row gap={8}>
              <TextInput
                value={text}
                onChangeText={setText}
                onSubmitEditing={() => send()}
                placeholder="Tell me what changed…"
                placeholderTextColor={c.muted}
                returnKeyType="send"
                style={{ flex: 1, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.glassStrong, borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: c.text }}
              />
              <Pressable accessibilityLabel="Send" onPress={() => send()} disabled={!text.trim()}>
                <View style={{ width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary, opacity: text.trim() ? 1 : 0.4 }}>
                  <Icon name="arrow-up" size={22} color={c.onPrimary} />
                </View>
              </Pressable>
            </Row>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
