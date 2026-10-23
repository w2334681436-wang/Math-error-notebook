import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addFirstRoundMember, migrateLegacyFirstRoundMembership
} from './firstRoundMembership.js';
import { removeMistakeFromReviewRound, isMistakeInReviewRound } from './reviewRoundActions.js';

class Table {
  constructor(data = []) {
    this.data = data.map(item => ({ ...item }));
    this.nextId = this.data.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
  }
  async each(fn) { for (const item of this.data) fn(item); }
  async bulkAdd(items) { for (const item of items) await this.add(item); }
  async add(item) { const id = this.nextId++; this.data.push({ ...item, id }); return id; }
  async clear() { this.data = []; }
  async update(id, patch) {
    const found = this.data.find(item => item.id === id);
    if (found) Object.assign(found, patch);
  }
  where(index) {
    const table = this;
    return {
      equals(key) {
        const fields = index.replace(/\[|\]/g, '').split('+');
        const query = item => {
          if (fields.length === 1) return item[fields[0]] === key;
          return fields.every((field, n) => item[field] === key[n]);
        };
        return {
          async first() { return table.data.find(query); },
          async delete() {
            const count = table.data.filter(query).length;
            table.data = table.data.filter(item => !query(item));
            return count;
          }
        };
      },
      between(low, high) {
        const fields = index.replace(/\[|\]/g, '').split('+');
        const compare = (item, tuple) => {
          for (let n = 0; n < fields.length; n++) {
            const a = item[fields[n]], b = tuple[n];
            if (a < b) return -1;
            if (a > b) return 1;
          }
          return 0;
        };
        return {
          async count() { return table.data.filter(row => compare(row, low) >= 0 && compare(row, high) <= 0).length; },
        };
      }
    };
  }
}

function mockDb({ mistakes = [], roundItems = [], exclusions = [] } = {}) {
  const tables = {
    mistakes: new Table(mistakes),
    reviewRoundItems: new Table(roundItems),
    reviewRoundExclusions: new Table(exclusions),
  };
  return {
    ...tables,
    table(name) { return tables[name]; }
  };
}

test('v6 upgrade migrates visible first-round entries, not removed ones', async () => {
  const db = mockDb({
    mistakes: [
      { id: 101, subjectId: 1, title: '第17题', createdAt: new Date(2026, 9, 21) },
      { id: 102, subjectId: 1, title: '第18题', createdAt: new Date(2026, 9, 22) },
    ],
    roundItems: [{ id: 15, subjectId: 1, roundNo: 2, mistakeId: 101, order: 10 }],
    exclusions: [{ id: 8, subjectId: 1, roundNo: 1, mistakeId: 102 }]
  });
  await migrateLegacyFirstRoundMembership(db);
  assert.equal(await isMistakeInReviewRound(db, { subjectId: 1, roundNo: 1, mistakeId: 101 }), true);
  assert.equal(await isMistakeInReviewRound(db, { subjectId: 1, roundNo: 1, mistakeId: 102 }), false);
  assert.equal(await isMistakeInReviewRound(db, { subjectId: 1, roundNo: 2, mistakeId: 101 }), true);
  assert.equal(db.reviewRoundExclusions.data.length, 0);
});

test('remove truly deletes membership record but preserves other rounds and original', async () => {
  const db = mockDb({
    mistakes: [{ id: 101, subjectId: 1, title: '原题' }],
    roundItems: [
      { id: 1, subjectId: 1, roundNo: 1, mistakeId: 101, order: 1 },
      { id: 2, subjectId: 1, roundNo: 2, mistakeId: 101, order: 2 }
    ]
  });
  const res = await removeMistakeFromReviewRound(db, { subjectId: 1, roundNo: 1, mistakeId: 101 });
  assert.equal(res.removed, true);
  assert.equal(res.remainingInRound, 0);
  assert.equal(db.reviewRoundItems.data.some(item => item.roundNo === 1 && item.mistakeId === 101), false);
  assert.equal(db.reviewRoundItems.data.some(item => item.roundNo === 2 && item.mistakeId === 101), true);
  assert.equal(db.mistakes.data.length, 1);
  assert.equal(db.reviewRoundExclusions.data.length, 0);
});

test('reimport adds a new first-round membership only when previously removed', async () => {
  const db = mockDb({ mistakes: [{ id: 5, subjectId: 1, title: '2023第17题' }] });
  const original = db.mistakes.data[0];
  assert.equal(await addFirstRoundMember(db, original), true);
  assert.equal(await addFirstRoundMember(db, original), false);
  assert.equal(db.reviewRoundItems.data.length, 1);
  await removeMistakeFromReviewRound(db, { subjectId: 1, roundNo: 1, mistakeId: 5 });
  assert.equal(db.reviewRoundItems.data.length, 0);
  assert.equal(await addFirstRoundMember(db, original), true);
  assert.equal(db.reviewRoundItems.data.length, 1);
});
