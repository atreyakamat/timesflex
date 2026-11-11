import { router } from 'expo-router';
import { View } from 'react-native';
import { space } from '../src/theme';
import { Card, IconButton, Row, Screen, T } from '../src/ui';

const SECTIONS: [string, string][] = [
  ['What is stored', 'Your name, e-mail and password, kept only as a secure hash. Your institute’s classes, subjects, rooms and timetables. Teachers’ names and any phone numbers or e-mails you add. Student names and attendance, if you add them. If your college uses cards or fingerprint machines, when each student scanned. If phone check-in is on, TimeFlex checks a phone’s network address at the moment it taps in, and doesn’t store it.'],
  ['Fingerprints', 'TimeFlex never receives or stores a fingerprint. A fingerprint machine keeps those itself, and tells TimeFlex only a student’s ID and the time. A college using one is responsible for telling students and getting their agreement. A QR card holds a code and no personal details.'],
  ['Why', 'Only to build timetables, arrange cover, keep attendance and tell teachers about changes. It is not sold, and not used for advertising.'],
  ['Who can see it', 'Only people signed in to your institute’s account, and whoever runs this server, who can reach the database to keep it working.'],
  ['WhatsApp', 'Messages go through WhatsApp, so WhatsApp handles them under its own terms. If automatic sending is on, teachers’ numbers and messages go to Meta. Teachers should agree before receiving messages.'],
  ['AI', 'Sentences typed to the assistant may be read by an AI model, with your teachers’, subjects’ and classes’ names for context. On this server that model runs on the server itself, unless its operator has turned on an outside provider.'],
  ['Your choices', 'You can correct anything at any time, and delete your account with everything in it under More. Backups are kept for up to 14 days, then removed.'],
];

export default function Privacy() {
  return (
    <Screen>
      <Row gap={12} style={{ marginBottom: space.lg }}>
        <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <T v="h1">Your data</T>
      </Row>
      <View style={{ gap: space.md, maxWidth: 720 }}>
        {SECTIONS.map(([title, text]) => (
          <Card key={title} style={{ gap: 6 }}>
            <T v="h3">{title}</T>
            <T>{text}</T>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
