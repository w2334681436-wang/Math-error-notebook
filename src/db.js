import Dexie from 'dexie';

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

// [新增] 版本 3: 增加多科目支持
db.version(3).stores({
  mistakes: '++id, title, createdAt, subjectId', // 增加 subjectId 索引
  notes: '++id, parentId, title, type, *tags, order',
  subjects: '++id, name' // 新增科目表
}).upgrade(async tx => {
  // 数据迁移逻辑：如果是老用户升级，创建默认科目，并将旧错题归类到"数学"
  const mathId = await tx.table('subjects').add({ name: '数学' });
  await tx.table('subjects').add({ name: '408' }); // 预置 408
  
  // 将所有旧错题的 subjectId 设置为数学的 ID
  await tx.table('mistakes').toCollection().modify({ subjectId: mathId });
});
