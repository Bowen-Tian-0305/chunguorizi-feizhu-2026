import test from 'node:test';
import assert from 'node:assert/strict';
import {amountBar} from '../public/amount-bars.js';

test('amount bars show a common scale without treating missing amounts as zero', () => {
  assert.match(amountBar(140,240), /--amount-width:58\.33%/);
  assert.match(amountBar(140,310), /--amount-width:45\.16%/);
  assert.match(amountBar(310,310), /--amount-width:100\.00%/);
  assert.match(amountBar(0,0), /--amount-width:0\.00%/);
  assert.equal(amountBar(null,240),'');
  assert.equal(amountBar(140,null),'');
  assert.equal(amountBar(Number.NaN,240),'');
});
