import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, wallet } from '../src/core/ledger';
import { seededRng, type Rng } from '../src/core/rng';
import * as sessions from '../src/core/sessions';
import { MINUTE } from '../src/core/time';
import { execute, press, typedAnswer } from '../src/discord/router';
import { load, tick } from '../src/market/market';
import { JOB_RULES, shiftPay } from '../src/work/jobs';
import { KIND, TUNING, type WorkState } from '../src/work/shift';
import { KINDS, isRight, makeTask } from '../src/work/tasks';

const G = 'g1', C = 'chan1';
const config = { ...botConfig(), prefix: 'r!' };
const noon = eastern('2026-11-13T12:00', -5);

function setup() {
  const db = freshDb();
  tick(db, seededRng(9), noon);
  let now = noon;
  const ctx = (user = 'u1', rng: Rng = seededRng(2)): Ctx => ({ db, config, rng, now, guildId: G, channelId: C, user: { id: user, name: user }, isOwner: false, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = 'u1', rng?: Rng) => execute(find(name)!, ctx(user, rng), args);
  const later = (ms: number) => { now += ms; };
  const pending = (user = 'u1') => sessions.active<WorkState>(db, KIND, G, user, now);
  return { db, ctx, run, later, pending };
}
const text = (r: ReplyObject | null | undefined) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
/** The right answer to a stored task, as a player would type it. */
const answerOf = (s: WorkState) => (s.task.steps ? s.task.steps.join(' ') : s.task.grade.type === 'near' ? String(Math.round(s.task.grade.value)) : s.task.grade.type === 'exact' ? s.task.grade.value : s.task.grade.values[0]!);
const noRush = { next: () => 0.99, int: (a: number) => a, chance: () => false, pick: <T>(l: readonly T[]) => l[0]!, pickWeighted: <T>(l: readonly (readonly [T, number])[]) => l[0]![0], shuffle: <T>(l: readonly T[]) => [...l] } as unknown as Rng;

test('every task kind accepts its own right answer and rejects nonsense', () => {
  for (const [style, kinds] of Object.entries(KINDS)) for (const kind of kinds) for (let tier = 0; tier <= 3; tier++) {
    for (let seed = 0; seed < 10; seed++) {
      const t = makeTask(style, seededRng(seed * 7 + tier), { tier, kind });
      const st = { task: t } as WorkState;
      assert.ok(isRight(t, answerOf(st)), `${style}/${kind} tier ${tier} seed ${seed}: right answer graded wrong`);
      assert.ok(!isRight(t, 'definitely not it'), `${style}/${kind}: nonsense graded right`);
      if (t.choices) {
        assert.ok(t.choices.length <= 25, 'fits in Discord buttons');
        for (const c of t.choices) assert.ok(c.value.length <= 80, 'button values stay short');
      }
    }
  }
});

test('apply, then a shift paid by button press', async () => {
  const { db, run, ctx, pending } = setup();
  assert.match(text(await run('work')), /do not have a job/);
  assert.match(text(await run('apply', { ticker: 'nach' })), /Hired: De Nacho[\s\S]*Dishwasher/);
  TUNING.kind = 'count';
  const r = await run('work');
  TUNING.kind = undefined;
  assert.ok(r.session, 'the task is stored');
  const s = pending()!;
  const before = balance(db, wallet(G, 'u1'));
  const out = typedAnswer(ctx('u1', noRush), answerOf(s.state));
  assert.match(text(out!.reply), /Shift complete\.\*\* Correct/);
  const paid = balance(db, wallet(G, 'u1')) - before;
  const base = shiftPay('NACH', undefined, 0);
  assert.ok(paid >= base * 0.9 && paid <= base * 2, `paid about a shift's worth (${paid} vs ${base})`);
  assert.equal(pending(), null, 'the task is finished');
  assert.ok(audit(db).ok);
});

test('a button press and a typed answer at once: only one is paid (the old button bug)', async () => {
  const { db, run, ctx, pending } = setup();
  await run('apply', { ticker: 'RRM' });
  TUNING.kind = 'queue';
  await run('work');
  TUNING.kind = undefined;
  const s = pending()!;
  const right = answerOf(s.state);
  const before = balance(db, wallet(G, 'u1'));
  const first = press(ctx('u1', noRush), sessions.buttonId(s.id, right));
  assert.match(text(first.followUp), /Correct/);
  const afterFirst = balance(db, wallet(G, 'u1'));
  const second = press(ctx('u1', noRush), sessions.buttonId(s.id, right));
  assert.equal(second.followUp, undefined, 'the second press pays nothing');
  assert.ok(second.update || second.notice, 'but it still gets a response');
  assert.equal(typedAnswer(ctx('u1', noRush), right), null, 'and a typed answer after that is ignored');
  assert.equal(balance(db, wallet(G, 'u1')), afterFirst);
  assert.ok(afterFirst > before);
});

test('buttons survive a restart: the stored task is graded from the database', async () => {
  const { db, run, pending } = setup();
  await run('apply', { ticker: 'BLU' });
  TUNING.kind = 'tool';
  await run('work');
  TUNING.kind = undefined;
  const id = pending()!.id;
  // A "restarted bot": nothing in memory, just the database and the button's custom id
  const freshCtx: Ctx = { db, config, rng: noRush, now: noon + 3000, guildId: G, channelId: C, user: { id: 'u1', name: 'u1' }, isOwner: false, notes: [] };
  const stored = sessions.get<WorkState>(db, id, noon)!;
  const r = press(freshCtx, sessions.buttonId(id, answerOf(stored.state)));
  assert.match(text(r.followUp), /Correct/);
});

test('someone else pressing your buttons is told no, and nothing happens', async () => {
  const { run, ctx, pending } = setup();
  await run('apply', { ticker: 'RRM' });
  TUNING.kind = 'queue';
  await run('work');
  TUNING.kind = undefined;
  const s = pending()!;
  const r = press(ctx('intruder'), sessions.buttonId(s.id, answerOf(s.state)));
  assert.match(r.notice!, /another player/);
  assert.ok(pending(), 'the task is still waiting');
});

test('wrong and slow answers pay less; cooldown applies', async () => {
  const { db, run, ctx, later, pending } = setup();
  await run('apply', { ticker: 'BNW' });
  TUNING.kind = 'math';
  await run('work');
  const before = balance(db, wallet(G, 'u1'));
  assert.match(text(typedAnswer(ctx('u1', noRush), '-1')!.reply), /Incorrect\. The answer was/);
  const wrongPay = balance(db, wallet(G, 'u1')) - before;
  assert.equal(wrongPay, Math.round(shiftPay('BNW', load(db)!.prices.BNW! * 100, 0) * JOB_RULES.missShare));

  assert.match(text(await run('work')), /next shift is available/);
  later(JOB_RULES.workCooldownMs);
  await run('work');
  later(25_000);
  const s = pending()!;
  assert.match(text(typedAnswer(ctx('u1', noRush), answerOf(s.state))!.reply), /Time expired/);
  TUNING.kind = undefined;
});

test('memory tasks: buttons in order, and the prompt hides after a few seconds', async () => {
  const { run, ctx, pending } = setup();
  await run('apply', { ticker: 'NACH' });
  TUNING.kind = 'memory';
  const r = await run('work');
  TUNING.kind = undefined;
  assert.deepEqual(r.buttons, [], 'no buttons while the order is shown');
  assert.ok(r.later && r.later.ms >= 3000 && r.later.edit.buttons!.length > 0, 'the buttons come with the hidden prompt');
  const s = pending()!;
  const steps = s.state.task.steps!;
  for (const step of steps.slice(0, -1)) assert.deepEqual(press(ctx('u1', noRush), sessions.buttonId(s.id, step)), {}, 'partial combos just wait');
  const done = press(ctx('u1', noRush), sessions.buttonId(s.id, steps[steps.length - 1]!));
  assert.match(text(done.followUp), /Correct/);
});

test('performance review: 8 of 10 right is a promotion', async () => {
  const { run, ctx, later, pending, db } = setup();
  await run('apply', { ticker: 'BLU' });
  TUNING.kind = 'bricks';
  let last: ReplyObject | null = null;
  for (let i = 0; i < 10; i++) {
    await run('work');
    const s = pending()!;
    last = typedAnswer(ctx('u1', noRush), i < 8 ? answerOf(s.state) : 'nope')!.reply;
    later(JOB_RULES.workCooldownMs);
  }
  TUNING.kind = undefined;
  assert.match(text(last), /Performance review: 8\/10\.\*\* Promoted to Builder/);
  assert.match(text(await run('job')), /\*\*Builder\*\*/);
  assert.ok(audit(db).ok);
});

test('rush orders: a correct answer can bring another task right away', async () => {
  const { run, ctx, pending } = setup();
  await run('apply', { ticker: 'BNW' });
  TUNING.kind = 'math';
  await run('work');
  const always = { ...noRush, chance: () => true } as Rng;
  const s = pending()!;
  const out = typedAnswer(ctx('u1', always), answerOf(s.state))!.reply;
  TUNING.kind = undefined;
  assert.match(text(out), /Rush order #1/);
  assert.ok(out.session && pending(), 'the rush task is waiting');
});

test('gigs pay without a job; quitting is locked for a day and asks first', async () => {
  const { run, ctx, later, pending } = setup();
  await run('gig');
  const s = pending()!;
  assert.match(text(typedAnswer(ctx('u1', noRush), answerOf(s.state))!.reply), /Gig complete/);
  assert.match(text(await run('gig')), /next gig/);

  await run('apply', { ticker: 'RRM' });
  assert.match(text(await run('quit')), /hired recently/);
  later(JOB_RULES.quitLockMs);
  const q = await run('quit');
  const id = q.session!;
  assert.match(text(press(ctx(), sessions.buttonId(id, 'no')).update), /cancelled/);
  const q2 = await run('quit');
  assert.match(text(press(ctx(), sessions.buttonId(q2.session!, 'yes')).update), /resigned/);
  assert.match(text(await run('work')), /do not have a job/);
  later(MINUTE);
});

test('a bankrupt company lays you off with severance', async () => {
  const { db, run } = setup();
  await run('apply', { ticker: 'BSTG' });
  const m = load(db)!;
  db.setMeta('market.data', JSON.stringify({ ...m, statuses: { ...m.statuses, BSTG: 'bankrupt' } }));
  const before = balance(db, wallet(G, 'u1'));
  assert.match(text(await run('work')), /Laid off\.[\s\S]*Severance/);
  assert.equal(balance(db, wallet(G, 'u1')) - before, Math.round(JOB_RULES.basePay * JOB_RULES.severanceShifts));
  assert.match(text(await run('work')), /do not have a job/);
});
