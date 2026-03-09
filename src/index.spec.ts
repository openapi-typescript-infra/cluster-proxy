import { expect, test } from 'vitest';

import { createMainProxy } from './mainProxy.ts';

test('Basic export handling', () => {
  expect(createMainProxy).toBeTruthy();
  expect(typeof createMainProxy).toEqual('function');
});
