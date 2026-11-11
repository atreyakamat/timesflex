#!/usr/bin/env node
// Pretends to be a biometric machine, so the whole path can be tried with no hardware.
//
//   node simulate.mjs http://localhost:8081 A01 A02 A03
//
// It does what public write-ups say a machine does: says hello, then uploads punches for those
// roll numbers. It proves our side works. It doesn't prove a particular real machine will.
const [, , bridge = 'http://localhost:8081', ...people] = process.argv;
const serial = process.env.SERIAL ?? 'SIMULATOR1';
if (!people.length) {
  console.error('Usage: node simulate.mjs <bridge address> <roll number> [roll number...]');
  process.exit(1);
}
const pad = (n) => String(n).padStart(2, '0');
// Machines report their own local time, with no zone. This uses this computer's.
const stamp = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

const hello = await fetch(`${bridge}/iclock/cdata?SN=${serial}&options=all&pushver=2.4.1`);
console.log(`Hello: ${hello.status}\n${await hello.text()}\n`);

const now = new Date();
const body = people.map((person) => `${person}\t${stamp(now)}\t0\t1\t0\t0`).join('\n');
const upload = await fetch(`${bridge}/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=9999`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body });
console.log(`Upload: ${upload.status} ${await upload.text()}`);

const poll = await fetch(`${bridge}/iclock/getrequest?SN=${serial}`);
console.log(`Asked for commands: ${poll.status} ${await poll.text()}`);
