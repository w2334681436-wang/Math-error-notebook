import Dexie from 'dexie';

export const db = new Dexie('MathMistakesDB');

// 版本 1: 错题本
db.version(1).stores({
  mistakes: '++id, title, createdAt' 
});

// 版本 2: 增加笔记系统
// notes表字段:
// id: 唯一ID
// parentId: 父级ID (用于层级)
// title: 标题
// type: 'folder' | 'file' (文件夹或知识点)
// content: 知识点内容 (图片数组)
// tags: 标签数组
// order: 排序权重
// createdAt: 创建时间
db.version(2).stores({
  mistakes: '++id, title, createdAt',
  notes: '++id, parentId, title, type, *tags, order' 
});
