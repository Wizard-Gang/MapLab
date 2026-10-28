import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {GraphCache} from '../src/navigation/cache';
import type {Graph} from '../src/navigation/surface';
const cases=JSON.parse(readFileSync('conformance/surface/cases.json','utf8'));
const graph=JSON.parse(readFileSync(`conformance/surface/${cases.cases[0].id}.graph.json`,'utf8')) as Graph;
const withId=(key:string,profile='p'):Graph=>({...graph,identity:{...graph.identity,cacheKey:key,profileSha256:profile}});
test('serialized byte budget refuses oversized entries without retaining traces',()=>{
  const cache=new GraphCache(1);expect(cache.put(graph)).toBe(false);expect([cache.bytes,cache.size]).toEqual([0,0]);
  expect(new GraphCache(0).put(graph)).toBe(false);
  for(const budget of [-1,NaN,Infinity])expect(()=>new GraphCache(budget)).toThrow('Invalid graph cache budget');
});
test('per-profile LRU keeps recently read graphs and isolates profiles',()=>{
  const cache=new GraphCache(100000000,2);cache.put(withId('a'));cache.put(withId('b'));expect(cache.get('a')).toBeDefined();cache.put(withId('c'));
  expect(cache.get('b')).toBeUndefined();cache.put(withId('other','q'));expect(cache.get('a')).toBeDefined();expect(cache.size).toBe(3);
  const copy=cache.get('a')!;(copy.diagnostics as string[]).push('consumer mutation');expect(cache.get('a')!.diagnostics).not.toContain('consumer mutation');
});
test('global byte ceiling evicts old profiles and never caches incomplete candidates',()=>{
  const g=withId('a'),bytes=new TextEncoder().encode(JSON.stringify(g)).length,cache=new GraphCache(bytes+10);
  expect(cache.put(g)).toBe(true);expect(cache.put(withId('b','q'))).toBe(true);expect(cache.size).toBe(1);expect(cache.get('a')).toBeUndefined();expect(cache.bytes).toBeLessThanOrEqual(cache.budget);
  expect(cache.put({...withId('bad'),status:'budget'})).toBe(false);cache.clear();expect(cache.bytes).toBe(0);
});
