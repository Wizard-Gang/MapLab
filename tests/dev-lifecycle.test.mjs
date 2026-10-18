// ML-009: the `npm start` launcher's rules (R1 H8). Only a listener that proves it is a MapLab dev server is stopped.
import { describe, expect, test, vi } from 'vitest';
import { DEFAULT_PORT, identify, needsInstall, parsePort, resetPaths, teardown, waitForReady } from '../scripts/dev-lifecycle.mjs';

describe('configuration', () => {
  test('MAPLAB_PORT defaults to 5182 and must be a port number', () => {
    expect([DEFAULT_PORT, parsePort(undefined), parsePort(''), parsePort('5190')]).toEqual([5182, 5182, 5182, 5190]);
    for (const bad of ['0', '65536', '51.2', '-1', 'x', ' 5182']) expect(() => parsePort(bad)).toThrow('MAPLAB_PORT');
  });
  test('reset never leaves the checkout, and install runs when node_modules is missing or older than the lockfile', () => {
    expect(resetPaths('/repo')).toEqual(['/repo/dist', '/repo/node_modules/.vite']);
    expect(() => resetPaths('/repo', ['../elsewhere'])).toThrow('outside the checkout');
    expect(() => resetPaths('/repo', ['.'])).toThrow('outside the checkout');
    expect([needsInstall({ nodeModules: false, lockHash: 'a', installedHash: 'a' }), needsInstall({ nodeModules: true, lockHash: 'a', installedHash: 'b' }),
      needsInstall({ nodeModules: true, lockHash: 'a', installedHash: 'a' })]).toEqual([true, true, false]);
  });
});

describe('teardown', () => {
  const maplab = { app: 'maplab', pid: 4242, root: '/repo', library: '~/Documents/MapLab' };
  test('an empty port needs nothing', async () => {
    const stop = vi.fn();
    expect(await teardown({ port: 5182, listeners: () => [], whoIs: async () => null, stop })).toBe(null);
    expect(stop).not.toHaveBeenCalled();
  });
  test('stops the MapLab server that identifies itself as the listener', async () => {
    let listening = [4242];
    const stop = vi.fn(async () => { listening = []; });
    expect(await teardown({ port: 5182, listeners: () => listening, whoIs: async () => maplab, stop })).toEqual(maplab);
    expect(stop).toHaveBeenCalledWith(4242);
  });
  test.each([
    ['another app', [999], null],
    ['a MapLab answer from a different process than the listener', [999], maplab],
    ['a second listener besides MapLab', [4242, 999], maplab],
  ])('refuses %s and stops nothing', async (_label, pids, who) => {
    const stop = vi.fn();
    await expect(teardown({ port: 5182, listeners: () => pids, whoIs: async () => who, stop })).rejects.toThrow('not a MapLab dev server, so nothing was stopped');
    expect(stop).not.toHaveBeenCalled();
  });
  test('reports a port still held after the stop', async () => {
    await expect(teardown({ port: 5182, listeners: () => [4242], whoIs: async () => maplab, stop: async () => {} })).rejects.toThrow('still in use');
  });
});

describe('identity and readiness', () => {
  test('identify sends the guarded headers and accepts only a MapLab identity', async () => {
    const seen = [];
    const reply = (body, ok = true) => async (url, init) => { seen.push([url, init.headers]); return { ok, json: async () => body, body: { cancel: async () => {} } }; };
    expect(await identify(5182, reply({ app: 'maplab', pid: 7, root: '/r', library: 'l' }))).toMatchObject({ pid: 7 });
    expect(seen[0]).toEqual(['http://127.0.0.1:5182/__maplab/identity', { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5182' }]);
    expect(await identify(5182, reply({ app: 'riglab', pid: 7, root: '/r' }))).toBe(null);
    expect(await identify(5182, reply({}, false))).toBe(null);
    expect(await identify(5182, async () => { throw new Error('ECONNREFUSED'); })).toBe(null);
  });
  test('readiness waits for the started process itself, and stops waiting when it exits', async () => {
    const answers = [null, { pid: 1 }, { pid: 9, library: 'l' }];
    expect(await waitForReady(5182, 9, { exited: () => false, whoIs: async () => answers.shift(), wait: async () => {} })).toEqual({ pid: 9, library: 'l' });
    await expect(waitForReady(5182, 9, { exited: () => true, whoIs: async () => null })).rejects.toThrow('exited');
  });
});
