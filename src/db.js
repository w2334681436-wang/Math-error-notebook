import Dexie from 'dexie';

export const db = new Dexie('MathMistakesDB');

db.version(1).stores({
  mistakes: '++id, title, createdAt' 
});
