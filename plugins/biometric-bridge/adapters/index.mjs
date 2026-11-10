// Every way the bridge can hear about a punch. To support another machine, add a file here
// that exports a create function with the same shape, and list it below. See docs/BIOMETRIC-GUIDE.md.
//
//   create(options, { enqueue, log, offset, stateFile, onReceived }) => { start(), stop() }
//
//   enqueue([{ identifier, at, scanId }])  identifier: the person's ID on the machine
//                                         at: ISO time with a zone; scanId: the same every time
//                                         this punch is resent, so nothing counts twice
import { createAdmsSource } from './zkteco-adms.mjs';
import { createFolderSource } from './folder.mjs';
import { createWebhookSource } from './webhook.mjs';

export const SOURCES = {
  'zkteco-adms': createAdmsSource,
  folder: createFolderSource,
  webhook: createWebhookSource,
};
