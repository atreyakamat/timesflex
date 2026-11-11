import crypto from 'node:crypto';

/**
 * Sending through Meta's official WhatsApp Cloud API. It's optional: without these settings the
 * app opens WhatsApp for the coordinator to send each message by hand.
 *
 * Teachers haven't messaged the business first, so Meta only allows pre-approved templates, and
 * they must have agreed to receive messages. See DOCKER.md for the template to submit.
 */
export const whatsappConfig = () => ({
  token: process.env.WHATSAPP_TOKEN ?? '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  template: process.env.WHATSAPP_TEMPLATE ?? 'timetable_update',
  language: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? 'en',
  apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v27.0',
  appSecret: process.env.WHATSAPP_APP_SECRET ?? '',
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
});

export const whatsappEnabled = () => {
  const config = whatsappConfig();
  return Boolean(config.token && config.phoneNumberId);
};

/** International format. Ten-digit numbers are assumed Indian (+91), as in the app's links. */
export const toWhatsAppNumber = (phone) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? `+${digits}` : null;
};

/** Template values can't contain line breaks or long runs of spaces. */
const templateValue = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || '-';

/** Sends one template message. Resolves to Meta's message id, or throws a message safe to show. */
export const sendWhatsAppTemplate = async ({ to, name, institution, summary }) => {
  const config = whatsappConfig();
  const response = await fetch(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: config.template,
        language: { code: config.language },
        components: [
          {
            type: 'body',
            parameters: [templateValue(name, 60), templateValue(institution, 80), templateValue(summary, 800)].map((text) => ({ type: 'text', text })),
          },
        ],
      },
    }),
  });
  const reply = await response.json().catch(() => ({}));
  const id = reply?.messages?.[0]?.id;
  if (!response.ok || !id) {
    console.warn('WhatsApp send failed:', response.status, reply?.error?.code, reply?.error?.message);
    throw new Error(reply?.error?.code === 131056 ? 'Too many messages to this number. Try again shortly.' : 'WhatsApp did not accept this message.');
  }
  return id;
};

/** Meta signs each webhook with the app secret. Compared in constant time. */
export const validSignature = (rawBody, header) => {
  const { appSecret } = whatsappConfig();
  if (!appSecret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const given = Buffer.from(header.slice('sha256='.length));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

/** Every delivery status in a webhook payload, which can batch many. */
export const statusesIn = (payload) => {
  const found = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      for (const status of Array.isArray(change?.value?.statuses) ? change.value.statuses : []) {
        if (typeof status?.id === 'string' && typeof status?.status === 'string') found.push(status);
      }
    }
  }
  return found;
};
