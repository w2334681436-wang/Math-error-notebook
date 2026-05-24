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
// 目的：列表页、搜索页只读 mistakeCards，不读带 base64 大图的 mistakes。
db.version(4).stores({
  mistakes: '++id, title, createdAt, subjectId',
  notes: '++id, parentId, title, type, *tags, order, [parentId+order]',
  subjects: '++id, name',

  // id 使用错题 id，不自增。
  // tokens 是 multiEntry 索引，用于中文/英文搜索。
  // [subjectId+createdAtMs] 用于按科目分页读取。
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
