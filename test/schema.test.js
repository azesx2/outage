import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadJsonDir } from './helpers.js';

const schema = JSON.parse(readFileSync(new URL('../schema/latest.schema.json', import.meta.url)));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

for (const [name, data] of loadJsonDir('output/valid')) {
  test(`schema accepts output/valid/${name}`, () => {
    assert.ok(validate(data), ajv.errorsText(validate.errors));
  });
}

for (const [name, data] of loadJsonDir('output/invalid')) {
  test(`schema rejects output/invalid/${name}`, () => {
    assert.equal(validate(data), false);
  });
}
