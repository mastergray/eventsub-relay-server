// src/EventQueue/tests/index.js
import test from "node:test";
import assert from "node:assert/strict";
import EventQueue from "../index.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("starts STOPPED and becomes ACTIVE on start()", async (t) => {
  const q = new EventQueue({
    queueDelay: 5,
    onMessage: async () => {},
    onIdle: async () => {},
    onError: async () => {},
  });
  t.after(() => q.stop());

  assert.equal(q.mode, EventQueue.MODES.STOPPED);
  q.start();
  assert.equal(q.mode, EventQueue.MODES.ACTIVE);
  q.stop();
  assert.equal(q.mode, EventQueue.MODES.STOPPED);
});

test("send() returns false when STOPPED, true when ACTIVE", async (t) => {
  const q = new EventQueue({
    queueDelay: 5,
    onMessage: async () => {},
    onIdle: async () => {},
    onError: async () => {},
  });
  t.after(() => q.stop());

  assert.equal(await q.send({ a: 1 }), false);

  q.start();
  assert.equal(await q.send({ a: 2 }), true);

  q.stop();
  assert.equal(await q.send({ a: 3 }), false);
});

test("drains messages in FIFO order and resets queue/head", async (t) => {
  const seen = [];
  const drained = deferred();

  let sawThird = false;

  const q = new EventQueue({
    queueDelay: 5,
    onMessage: async (msg) => {
      seen.push(msg);
      if (seen.length === 3) sawThird = true;
    },
    onIdle: async () => {
      // first idle tick after seeing the 3rd message implies drain finished + queue cleared
      if (sawThird) drained.resolve();
    },
    onError: async (err) => { throw err; },
  });
  t.after(() => q.stop());

  q.start();
  await q.send(1);
  await q.send(2);
  await q.send(3);

  await drained.promise;

  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(q.size, 0);
  assert.equal(q.queueHead, 0);
  assert.deepEqual(q.queue, []);
});


test("onIdle fires when empty and sets idleSince", async (t) => {
  const sawIdle = deferred();
  let idleCalls = 0;

  const q = new EventQueue({
    queueDelay: 5,
    onMessage: async () => {},
    onError: async (err) => { throw err; },
    onIdle: async (eq) => {
      idleCalls++;
      assert.equal(typeof eq.idleSince, "number");
      // resolve on first idle tick
      if (idleCalls === 1) sawIdle.resolve();
    },
  });
  t.after(() => q.stop());

  q.start();
  await sawIdle.promise;
  assert.ok(idleCalls >= 1);
});

test("processing a message clears idleSince during onMessage", async (t) => {
  const sawIdle = deferred();
  const sawMsg = deferred();

  let idleSinceInOnMessage;

  const q = new EventQueue({
    queueDelay: 5,
    onIdle: async (eq) => {
      // ensure we start from an idle state first
      if (eq.idleSince && !sawIdle.resolved) {
        sawIdle.resolve();
        sawIdle.resolved = true;
      }
    },
    onMessage: async (_msg, eq) => {
      idleSinceInOnMessage = eq.idleSince; // should be null at start of drain
      sawMsg.resolve();
    },
    onError: async (err) => { throw err; },
  });
  t.after(() => q.stop());

  q.start();
  await sawIdle.promise;

  await q.send("x");
  await sawMsg.promise;

  assert.equal(idleSinceInOnMessage, null);
});

test("queue overflow calls onError and does not enqueue beyond queueMax", async (t) => {
  let errorCalls = 0;

  const q = new EventQueue({
    queueDelay: 50, // slow ticks so we can fill before drain
    queueMax: 3,
    onMessage: async () => {},
    onIdle: async () => {},
    onError: async (err) => {
      errorCalls++;
      assert.match(err.message, /Queue overflow/);
    },
  });
  t.after(() => q.stop());

  q.start();

  assert.equal(await q.send(1), true);
  assert.equal(await q.send(2), true);
  assert.equal(await q.send(3), true);

  const res = await q.send(4);
  assert.equal(res, undefined);

  assert.equal(q.size, 3);
  assert.equal(errorCalls, 1);
});

test("stop() clears timer and prevents further processing", async (t) => {
  const seen = [];

  const q = new EventQueue({
    queueDelay: 5,
    onMessage: async (m) => { seen.push(m); },
    onIdle: async () => {},
    onError: async (err) => { throw err; },
  });
  t.after(() => q.stop());

  q.start();
  await q.send("a");
  q.stop();

  await sleep(30);

  assert.deepEqual(seen, []);
  assert.equal(q.queueTimer, null);
  assert.equal(q.idleSince, null);
  assert.equal(q.lastActive, null);
});

test("if onMessage throws, onError is invoked", async (t) => {
  const sawError = deferred();

  const q = new EventQueue({
    queueDelay: 5,
    onMessage: async () => { throw new Error("boom"); },
    onIdle: async () => {},
    onError: async (err) => {
      assert.match(err.message, /boom/);
      sawError.resolve();
    },
  });
  t.after(() => q.stop());

  q.start();
  await q.send("x");

  await sawError.promise;
});

test("spam burst: slow onMessage still processes FIFO with no overlap/duplication", async (t) => {
  const N = 200;
  const perMsgMs = 2;
  const timeoutMs = 5_000;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const done = (() => {
    let resolve;
    const promise = new Promise((res) => (resolve = res));
    return { promise, resolve };
  })();

  const timeout = (() => {
    let id;
    const promise = new Promise((_, rej) => {
      id = setTimeout(() => rej(new Error("timed out waiting for burst")), timeoutMs);
    });
    return { promise, cancel: () => clearTimeout(id) };
  })();

  const seen = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const q = new EventQueue({
    queueDelay: 5,
    onIdle: async () => {
      if (seen.length === N) done.resolve();
    },
    onMessage: async (msg) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);

      await sleep(perMsgMs);

      seen.push(msg);

      inFlight--;
    },
    onError: async (err) => { throw err; },
  });

  t.after(() => q.stop());

  q.start();
  for (let i = 0; i < N; i++) assert.equal(await q.send(i), true);

  try {
    await Promise.race([done.promise, timeout.promise]);
  } finally {
    timeout.cancel();
  }

  assert.equal(seen.length, N);
  for (let i = 0; i < N; i++) assert.equal(seen[i], i);
  assert.equal(maxInFlight, 1);

  assert.equal(q.size, 0);
  assert.equal(q.queueHead, 0);
  assert.deepEqual(q.queue, []);
});
