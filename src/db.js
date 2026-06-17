// src/db.js
import Dexie from 'dexie';
import { buildMistakeCard } from './searchIndex';

export const db = new Dexie('MathMistakesDB');

// 版本 1: 错题本
db.version(1).stores({
  mistakes: '++id, title, createdAt'
});

// 版本 2: 增加笔记系统
db.version(2).stores({
  mistakes: '++id, title, createdAt',
  notes: '++id, parentId, title, type, *tags, order'
});

// 版本 3: 增加多科目支持
db.version(3).stores({
  mistakes: '++id, title, createdAt, subjectId',
  notes: '++id, parentId, title, type, *tags, order',
  subjects: '++id, name'
}).upgrade(async tx => {
  const subjectsTable = tx.table('subjects');
  const mistakesTable = tx.table('mistakes');
  const mathId = await subjectsTable.add({ name: '数学' });
  await subjectsTable.add({ name: '408' });
  await mistakesTable.toCollection().modify({ subjectId: mathId });
});

// 版本 4: 增加错题轻量索引表
db.version(4).stores({
  mistakes: '++id, title, createdAt, subjectId',
  notes: '++id, parentId, title, type, *tags, order, [parentId+order]',
  subjects: '++id, name',
  mistakeCards: 'id, subjectId, createdAtMs, updatedAtMs, title, *tokens, [subjectId+createdAtMs]'
}).upgrade(async tx => {
  const mistakes = await tx.table('mistakes').toArray();
  const cards = mistakes
    .filter(m => m && m.id !== undefined && m.id !== null)
    .map(buildMistakeCard);
  if (cards.length > 0) {
    await tx.table('mistakeCards').bulkPut(cards);
  }
});

// 版本 5: 新复盘轮次系统
// 1. 新增 reviewRoundItems：每科、每轮自己的刷题列表。
// 2. 清空旧 reviewLogs，重置旧“复盘次数”。
// 3. 第一轮不单独建表，默认等于该科目的全部原始错题。
db.version(5).stores({
  mistakes: '++id, title, createdAt, subjectId',
  notes: '++id, parentId, title, type, *tags, order, [parentId+order]',
  subjects: '++id, name',
  mistakeCards: 'id, subjectId, createdAtMs, updatedAtMs, title, *tokens, [subjectId+createdAtMs]',
  reviewRoundItems: '++id, subjectId, roundNo, mistakeId, order, decidedAt, [subjectId+roundNo+order], [subjectId+roundNo+mistakeId]'
}).upgrade(async tx => {
  const mistakesTable = tx.table('mistakes');
  const cardsTable = tx.table('mistakeCards');
  const roundItemsTable = tx.table('reviewRoundItems');

  await roundItemsTable.clear();

  await mistakesTable.toCollection().modify(mistake => {
    mistake.reviewLogs = [];
    mistake.reviewCount = 0;
    mistake.reviewTimes = 0;
    mistake.updatedAt = mistake.updatedAt || new Date();
  });

  const mistakes = await mistakesTable.toArray();
  const cards = mistakes
    .filter(m => m && m.id !== undefined && m.id !== null)
    .map(buildMistakeCard);

  await cardsTable.clear();
  if (cards.length > 0) {
    await cardsTable.bulkPut(cards);
  }
});

function sanitizeMistakeRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const copy = { ...record };
  copy.reviewLogs = [];
  copy.reviewCount = 0;
  copy.reviewTimes = 0;
  return copy;
}

function sanitizeMistakeChanges(changes) {
  if (!changes || typeof changes !== 'object') return changes;
  const copy = { ...changes };
  if ('reviewLogs' in copy) copy.reviewLogs = [];
  if ('reviewCount' in copy) copy.reviewCount = 0;
  if ('reviewTimes' in copy) copy.reviewTimes = 0;
  return copy;
}

// 兜底：旧版 App.jsx 里“查看解析自动写 reviewLogs”的逻辑即使还存在，
// 这里也会把 reviewLogs 拦截为空，保证打开/查看题目不再增加复盘次数。
const rawMistakeAdd = db.mistakes.add.bind(db.mistakes);
const rawMistakePut = db.mistakes.put.bind(db.mistakes);
const rawMistakeBulkPut = db.mistakes.bulkPut.bind(db.mistakes);
const rawMistakeUpdate = db.mistakes.update.bind(db.mistakes);

db.mistakes.add = (record, ...args) => rawMistakeAdd(sanitizeMistakeRecord(record), ...args);
db.mistakes.put = (record, ...args) => rawMistakePut(sanitizeMistakeRecord(record), ...args);
db.mistakes.bulkPut = (records, ...args) => rawMistakeBulkPut((records || []).map(sanitizeMistakeRecord), ...args);
db.mistakes.update = (key, changes) => rawMistakeUpdate(key, sanitizeMistakeChanges(changes));
