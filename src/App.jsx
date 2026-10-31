import React, { useState, useMemo, useEffect, useRef, useId, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Dexie from 'dexie';
import { LIST_CONTEXT_EVENT, readMistakeListState, writeMistakeListState, notifyListContextChanged, clearMistakeNavigationState } from './mistakeListState';
import { toggleNextRound, toggleMastered as toggleReviewMastered } from './reviewRoundsPatch';
import { db } from './db';
import ImmersiveNoteReader from './ImmersiveNoteReader';
import { exportCompleteBackup, restoreCompleteBackup } from './fullBackup';
import { addFirstRoundMember, migrateLegacyFirstRoundMembership } from './firstRoundMembership';
import {
  MISTAKE_PAGE_SIZE,
  isMistakeListReversed,
  getMistakeListReverseKey,
  buildMistakeCard,
  getSelectedReviewRound,
  queryMistakeCards,
  rebuildAllMistakeCards,
  refreshMistakeCard
} from './searchIndex';
import { useLiveQuery } from 'dexie-react-hooks';
import { 
  Plus, Maximize, ArrowLeft, Eye, EyeOff, Trash2, Save, Edit, X, Search, ChevronRight, 
  Folder, FileText, ChevronDown, ChevronRight as ChevronRightIcon, GripVertical, Image as ImageIcon, Tag, 
  ArrowUpLeft, ArrowRightSquare, PanelLeftClose, PanelLeftOpen, 
  MoreVertical, 
  CheckSquare, Copy, Scissors, Clipboard, CheckCircle2, Circle,
  Home, ChevronLeft, ArrowDownUp, Calendar,
  Download, UploadCloud, Bot, ListX
} from 'lucide-react';

import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragOverlay, useDndMonitor, pointerWithin } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { parseRichNoteCollection, downloadRichNotePackage } from './richNotePackage';
import { RICH_NOTE_AI_PROMPT } from './richNoteAiPrompt';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { exportMistakesForAI } from './aiExport';
import AiExportDialog from './AiExportDialog';
import MistakeImportDialog from './MistakeImportDialog';
import ListScrollHandle from './ListScrollHandle';
import MistakeListSearch from './MistakeListSearch';
import {
  getLastReviewProgressKey,
  removeMistakeFromReviewRound,
  setSelectedReviewRound,
  isMistakeInReviewRound,
} from './reviewRoundActions';

// --- 工具函数 ---



function cn(...inputs) { return twMerge(clsx(inputs)); }
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = error => reject(error);
});

const getReviewCount = (logs) => {
  if (!logs || !Array.isArray(logs)) return 0;
  const uniqueDays = new Set(logs.map(ts => new Date(ts).toDateString()));
  return uniqueDays.size;
};

const generateId = () => Math.random().toString(36).substr(2, 9);
const APP_VERSION = `v${__APP_VERSION__}`;
const normalizeMarkdownMath = (markdown = '') => {
  const source = String(markdown ?? '');

  // remark-math only recognizes display delimiters reliably when they are on
  // their own lines. Legacy AI packages put $$...$$ inside ordinary paragraphs
  // and directly after punctuation, which exposed raw red LaTeX in the UI.
  // Keep fenced code blocks literal and normalize both supported delimiters.
  return source.split(/(```[\s\S]*?```)/g).map(part => {
    if (part.startsWith('```')) return part;
    return part
      .replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_match, brackets, dollars) => {
        const expression = (brackets ?? dollars).trim();
        return `\n\n$$\n${expression}\n$$\n\n`;
      })
      .replace(/\\\(([\s\S]*?)\\\)/g, (_match, expression) => `$${expression.trim()}$`);
  }).join('');
};

function MarkdownView({ children, assets = {} }) {
  return (
    <ReactMarkdown
      urlTransform={(url) => (url.startsWith('note-asset:') && Object.prototype.hasOwnProperty.call(assets, url.slice(11))) ? url : defaultUrlTransform(url)}
      remarkPlugins={[
        remarkGfm,
        [remarkMath, { singleDollarTextMath: true }]
      ]}
      rehypePlugins={[
        [rehypeKatex, { strict: false, throwOnError: false }]
      ]}
      components={{
        a: ({ node: _node, ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer" />
        ),
        img: ({ node: _node, src, ...props }) => (
          <img {...props} src={src?.startsWith('note-asset:') ? assets[src.slice(11)] : src}
            loading="lazy" className="max-w-full h-auto rounded-lg" />
        ),
        table: ({ node: _node, ...props }) => (
          <table {...props} className="w-full" />
        )
      }}
    >
      {normalizeMarkdownMath(children)}
    </ReactMarkdown>
  );
}

// [原有] 递归删除
const deleteNoteRecursive = async (nodeId) => {
  const children = await db.notes.where('parentId').equals(nodeId).toArray();
  for (const child of children) { await deleteNoteRecursive(child.id); }
  await db.notes.delete(nodeId);
};

// [新增] 递归复制辅助函数 (核心逻辑)
const cloneNodeRecursive = async (nodeId, newParentId) => {
  const original = await db.notes.get(nodeId);
  if (!original) return;

  // 1. 创建副本 (生成新 ID)
  const newNodeId = await db.notes.add({
    ...original,
    id: undefined, // 让 DB 生成新 ID，或者手动生成
    parentId: newParentId,
    title: original.title + (newParentId === original.parentId ? " (副本)" : ""), // 同目录复制加后缀
    createdAt: new Date(),
    order: Date.now()
  });

  // 2. 如果是文件夹，递归复制子节点
  if (original.type === 'folder') {
    const children = await db.notes.where('parentId').equals(nodeId).toArray();
    for (const child of children) {
      await cloneNodeRecursive(child.id, newNodeId);
    }
  }
};

// 在 App 组件内
function App() {
  const [activeTab, setActiveTab] = useState('mistakes'); 
  const [aiExportProgress, setAiExportProgress] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupProgress, setBackupProgress] = useState(null);
  const [showAiExportDialog, setShowAiExportDialog] = useState(false);
  const [showMistakeImportDialog, setShowMistakeImportDialog] = useState(false);
  const [importRefreshCounter, setImportRefreshCounter] = useState(0);

  // [新增] 科目管理逻辑
  const subjects = useLiveQuery(() => db.subjects.toArray()) || [];
  const [activeSubjectId, setActiveSubjectId] = useState(() => {
    const raw = localStorage.getItem('mathNotebook.activeSubjectId');
    return raw && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  });
  const [mistakeView, setMistakeView] = useState('list');

  // 初始化：如果没有选中科目且加载了科目列表，默认选中第一个
  useEffect(() => {
    if (subjects.length > 0 && !subjects.some(subject => String(subject.id) === String(activeSubjectId))) {
      setActiveSubjectId(subjects[0].id);
    }
  }, [subjects, activeSubjectId]);

  useEffect(() => {
    if (activeSubjectId !== null) localStorage.setItem('mathNotebook.activeSubjectId', String(activeSubjectId));
  }, [activeSubjectId]);

  // StrictMode 会执行两次 effect，事务内检查防止生成两组默认科目。
  useEffect(() => {
    db.transaction('rw', db.subjects, async () => {
      if (await db.subjects.count() === 0) await db.subjects.bulkAdd([{ name: '数学' }, { name: '408' }]);
    }).catch(error => console.error(error));
  }, []);

  // 索引自检：防止旧数据、导入数据、异常升级后 mistakeCards 为空。
// 这里只重建轻量索引，不动原始 mistakes 图片数据。
useEffect(() => {
  const checkMistakeCards = async () => {
    const [mistakeCount, cardCount] = await db.transaction('r', db.mistakes, db.mistakeCards, () =>
      Promise.all([db.mistakes.count(), db.mistakeCards.count()]));

    if (mistakeCount !== cardCount) {
      await rebuildAllMistakeCards(db);
    }
  };

  checkMistakeCards();
}, []);

  const handleAddSubject = async () => {
    const name = prompt("请输入新科目名称（如：英语、政治）：");
    if (name && name.trim()) {
      const id = await db.subjects.add({ name: name.trim() });
      setActiveTab('mistakes');
setMistakeView('list');
setActiveSubjectId(id); // 自动切换到新科目
    }
  };

  const handleAiExport = async (options) => {
    if (aiExportProgress) return;

    try {
      setShowAiExportDialog(false);
      setAiExportProgress({ stage: 'preparing', completed: 0, total: 0 });
      const result = await exportMistakesForAI({
        db,
        appVersion: APP_VERSION,
        options,
        onProgress: setAiExportProgress,
      });

      alert(
        `✅ AI 专用文件导出成功\n\n` +
        `文件：${result.filename}\n` +
        `错题：${result.summary.counts.mistakes} 道\n` +
        `题目图片：${result.summary.counts.questionImages} 张\n` +
        `解析图片：${result.summary.counts.analysisImages} 张\n\n` +
        `已自动生成 ${result.outputFormat === 'zip' ? 'ZIP' : 'Markdown'}，现在可以直接发给 AI。`
      );
    } catch (error) {
      console.error(error);
      alert(`❌ AI 文件导出失败：${error.message || error}`);
    } finally {
      setAiExportProgress(null);
    }
  };

  // [新增] 导出备份数据
 // 流式全量备份：不把所有带图错题在内存中拼成一个大 Blob。
 const handleExport = async () => {
   if (backupBusy) return;
   setBackupBusy(true);
   setBackupProgress({ stage: 'preparing', completed: 0, total: 0 });
   try {
     const result = await exportCompleteBackup(db, setBackupProgress);
     alert('✅ 完整备份数据已发送至下载：' + result.filename + '\n'
       + '错题：' + result.counts.mistakes + ' 条\n'
       + '笔记：' + result.counts.notes + ' 条\n'
       + '轮次题目：' + result.counts.reviewRoundItems + ' 条\n'
       + '包括题目截图、解析图片、图文笔记和复盘记录。请到系统下载文件夹确认文件已保存。');
   } catch (error) {
     if (error?.name !== 'AbortError') {
       console.error('完整备份导出失败', error);
       alert('❌ 完整备份导出失败：' + (error?.message || error)
         + '\n现有错题与复盘记录未被修改。请检查下载权限和设备剩余空间。');
     }
   } finally {
     setBackupProgress(null);
     setBackupBusy(false);
   }
 };

// 逐行读取 .mathbackup 文件
const readNdjsonBackup = async (file, onLineObject) => {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8');

  let buffer = '';
  let lineNo = 0;

  while (true) {
    const read = reader.read();
    // 只在等待文件 I/O 时维持事务，不把数据库写入包进 waitFor（会相互等待）。
    const { value, done } = await (Dexie.currentTransaction ? Dexie.waitFor(read) : read);

    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;

      lineNo += 1;

      let obj;
      try {
        obj = JSON.parse(text);
      } catch (e) {
        throw new Error(`第 ${lineNo} 行解析失败，备份文件可能损坏`);
      }

      await onLineObject(obj, lineNo);
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    lineNo += 1;

    let obj;
    try {
      obj = JSON.parse(buffer.trim());
    } catch (e) {
      throw new Error(`第 ${lineNo} 行解析失败，备份文件可能损坏`);
    }

    await onLineObject(obj, lineNo);
  }

  return lineNo;
};

// JSON 将 Date 转成字符串；只恢复约定的日期字段，不改题面和笔记正文。
const reviveImportedRecord = record => {
  const revived = { ...record };
  for (const key of ['createdAt', 'updatedAt', 'decidedAt', 'removedAt']) {
    const value = revived[key];
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) revived[key] = date;
    }
  }
  if (Array.isArray(revived.relatedQuestions)) revived.relatedQuestions = revived.relatedQuestions.map(reviveImportedRecord);
  return revived;
};

// 导入旧版小 JSON 备份
const importOldJsonBackup = async (file) => {
  const text = await file.text();
  const backup = JSON.parse(text);

  if (!backup.data || !backup.data.mistakes) {
    throw new Error('旧版 JSON 备份格式错误或数据损坏');
  }

  const importedMistakes = (backup.data.mistakes || []).map(reviveImportedRecord);
  const importedNotes = (backup.data.notes || []).map(reviveImportedRecord);
  const importedSubjects = backup.data.subjects || [];
  const importedRoundItems = (backup.data.reviewRoundItems || []).map(reviveImportedRecord);
  const importedRoundExclusions = (backup.data.reviewRoundExclusions || []).map(reviveImportedRecord);
  const membershipIsExplicit = backup.firstRoundMembershipExplicit === true
    || backup.data.firstRoundMembershipExplicit === true;

  await db.transaction(
    'rw',
    db.mistakes,
    db.notes,
    db.subjects,
    db.mistakeCards,
    db.reviewRoundItems,
    db.reviewRoundExclusions,
    async () => {
    await db.mistakes.clear();
    await db.notes.clear();
    await db.subjects.clear();
    await db.mistakeCards.clear();
    await db.reviewRoundItems.clear();
    await db.reviewRoundExclusions.clear();

    if (importedSubjects.length > 0) {
      await db.subjects.bulkPut(importedSubjects);
    } else {
      await db.subjects.bulkAdd([{ name: '数学' }, { name: '408' }]);
    }
    const subjects = await db.subjects.toArray();
    const normalizeSubject = record => subjects.find(subject => String(subject.id) === String(record.subjectId))?.id || subjects[0].id;
    const normalizedMistakes = importedMistakes.map(record => ({ ...record, subjectId: normalizeSubject(record) }));
    if (normalizedMistakes.length > 0) {
      await db.mistakes.bulkPut(normalizedMistakes);
      await db.mistakeCards.bulkPut(normalizedMistakes.map(buildMistakeCard));
    }
    if (importedNotes.length > 0) await db.notes.bulkPut(importedNotes);

    if (importedRoundItems.length > 0) {
      await db.reviewRoundItems.bulkPut(importedRoundItems.map(record => ({ ...record, subjectId: normalizeSubject(record) })));
    }

    if (importedRoundExclusions.length > 0) {
      await db.reviewRoundExclusions.bulkPut(importedRoundExclusions.map(record => ({ ...record, subjectId: normalizeSubject(record) })));
    }
    // 旧备份第一轮并没有成员记录，按“所有原题-历史移出项”还原一次，然后销毁旧隐藏标记。
    // 新版备份已经显式记录第一轮成员，不能自动补题，否则会复活真正移出的题。
    if (!membershipIsExplicit) await migrateLegacyFirstRoundMembership(db);
  });

  return {
    mistakes: importedMistakes.length,
    relatedQuestions: importedMistakes.reduce((sum, item) => sum + (Array.isArray(item.relatedQuestions) ? item.relatedQuestions.length : 0), 0),
    notes: importedNotes.length,
    subjects: importedSubjects.length || 2,
    reviewRoundItems: importedRoundItems.length,
    reviewRoundExclusions: importedRoundExclusions.length
  };
};

// 导入新版 .mathbackup 备份
const importNdjsonBackup = async (file) => {
  let meta = null;

  const counts = {
    mistakes: 0,
    relatedQuestions: 0,
    notes: 0,
    subjects: 0,
    reviewRoundItems: 0,
    reviewRoundExclusions: 0
  };

  // 第一遍：只校验文件，不清空数据库
  await readNdjsonBackup(file, async (obj, lineNo) => {
    if (lineNo === 1) {
      if (obj.format !== 'MathNotebookBackupNDJSON') {
        throw new Error('不是有效的新版 .mathbackup 备份文件');
      }

      meta = obj;
      return;
    }

    if (![
      'mistakes',
      'notes',
      'subjects',
      'reviewRoundItems',
      'reviewRoundExclusions'
    ].includes(obj.table)) {
      throw new Error(`第 ${lineNo} 行表名错误：${obj.table}`);
    }

    if (!obj.record || typeof obj.record !== 'object') {
      throw new Error(`第 ${lineNo} 行记录格式错误`);
    }

    counts[obj.table] += 1;
    if (obj.table === 'mistakes') {
      counts.relatedQuestions += Array.isArray(obj.record.relatedQuestions) ? obj.record.relatedQuestions.length : 0;
    }
  });

  if (!meta) {
    throw new Error('备份文件缺少元信息');
  }

  if (meta.counts) {
    for (const table of ['mistakes', 'notes', 'subjects', 'reviewRoundItems', 'reviewRoundExclusions']) {
      if (Number.isInteger(meta.counts[table]) && meta.counts[table] !== counts[table]) {
        throw new Error(`备份中的 ${table} 数量不完整，未修改原数据`);
      }
    }
  }

  // 文件读取不能让 IndexedDB 事务提前结束；任何失败都会回滚，包括旧数据的清空。
  await db.transaction('rw', db.mistakes, db.notes, db.subjects, db.mistakeCards, db.reviewRoundItems, db.reviewRoundExclusions, async () => {
    // 第二遍：确认文件可读后，再覆盖写入
    await db.mistakes.clear();
    await db.notes.clear();
    await db.subjects.clear();
    await db.mistakeCards.clear();
    await db.reviewRoundItems.clear();
    await db.reviewRoundExclusions.clear();

    const batches = {
      mistakes: [],
      notes: [],
      subjects: [],
      reviewRoundItems: [],
      reviewRoundExclusions: []
    };

    const BATCH_SIZE = 20;

    const flushSubjects = async () => {
      if (batches.subjects.length === 0) return;
      await db.subjects.bulkPut(batches.subjects);
      batches.subjects = [];
    };

    const flushNotes = async () => {
      if (batches.notes.length === 0) return;
      await db.notes.bulkPut(batches.notes);
      batches.notes = [];
    };

    const flushMistakes = async () => {
      if (batches.mistakes.length === 0) return;

      await db.mistakes.bulkPut(batches.mistakes);
      await db.mistakeCards.bulkPut(batches.mistakes.map(buildMistakeCard));

      batches.mistakes = [];
    };

    const flushRoundItems = async () => {
      if (batches.reviewRoundItems.length === 0) return;
      await db.reviewRoundItems.bulkPut(batches.reviewRoundItems);
      batches.reviewRoundItems = [];
    };

    const flushRoundExclusions = async () => {
      if (batches.reviewRoundExclusions.length === 0) return;
      await db.reviewRoundExclusions.bulkPut(batches.reviewRoundExclusions);
      batches.reviewRoundExclusions = [];
    };

    await readNdjsonBackup(file, async (obj, lineNo) => {
      if (lineNo === 1) return;
      obj.record = reviveImportedRecord(obj.record);

      if (obj.table === 'subjects') {
        batches.subjects.push(obj.record);

        if (batches.subjects.length >= BATCH_SIZE) {
          await flushSubjects();
        }
      }

      if (obj.table === 'notes') {
        batches.notes.push(obj.record);

        if (batches.notes.length >= BATCH_SIZE) {
          await flushNotes();
        }
      }

      if (obj.table === 'mistakes') {
        batches.mistakes.push(obj.record);

        if (batches.mistakes.length >= BATCH_SIZE) {
          await flushMistakes();
        }
      }

      if (obj.table === 'reviewRoundItems') {
        batches.reviewRoundItems.push(obj.record);

        if (batches.reviewRoundItems.length >= BATCH_SIZE) {
          await flushRoundItems();
        }
      }

      if (obj.table === 'reviewRoundExclusions') {
        batches.reviewRoundExclusions.push(obj.record);

        if (batches.reviewRoundExclusions.length >= BATCH_SIZE) {
          await flushRoundExclusions();
        }
      }
    });

    await flushSubjects();
    await flushNotes();
    await flushMistakes();
    await flushRoundItems();
    await flushRoundExclusions();

    if (await db.subjects.count() === 0) {
      const mathId = await db.subjects.add({ name: '数学' });
      await db.subjects.add({ name: '408' });
      await db.mistakes.toCollection().modify({ subjectId: mathId });
      await db.reviewRoundItems.toCollection().modify({ subjectId: mathId });
      await db.reviewRoundExclusions.toCollection().modify({ subjectId: mathId });
      let offset = 0;
      while (true) {
        const records = await db.mistakes.orderBy(':id').offset(offset).limit(BATCH_SIZE).toArray();
        if (!records.length) break;
        await db.mistakeCards.bulkPut(records.map(buildMistakeCard));
        offset += records.length;
      }
      counts.subjects = 2;
    }
    if (meta.firstRoundMembershipExplicit !== true) {
      await migrateLegacyFirstRoundMembership(db);
    }
  });

  return counts;
};

// [增强版] 导入：兼容新版 .mathbackup 和旧版小 JSON
const handleImport = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!confirm('⚠️ 警告：导入将【清空并覆盖】当前所有数据！\n\n确定要继续吗？建议先导出当前数据作为备份。')) {
    e.target.value = '';
    return;
  }

  try {
    const firstText = await file.slice(0, 4096).text();
    const firstLine = firstText.split(/\r?\n/)[0]?.trim();

    let firstObj;
    try { firstObj = JSON.parse(firstLine); } catch { /* 多行旧 JSON 的第一行不是完整对象。 */ }
    setBackupBusy(true);
    setBackupProgress({ stage: 'validate', completed: 0, total: file.size });
    const result = firstObj?.format === 'MathNotebookBackupNDJSON'
      ? await restoreCompleteBackup(db, file, setBackupProgress)
      : await importOldJsonBackup(file);
    const imported = result.counts || result;
    clearMistakeNavigationState();
    // Restore per-subject selected round, list order and saved learning position
    // only after the full database has been successfully committed.
    if (result.settings && typeof result.settings === 'object') {
      for (const [key, value] of Object.entries(result.settings)) {
        if (key.startsWith('mathNotebook.') && typeof value === 'string') {
          try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
        }
      }
    }

    alert(
      `✅ 数据导入成功！页面将自动刷新。\n\n` +
      `错题：${imported.mistakes} 条\n` +
      `题目图片与解析：已随题目一并恢复\n` +
      `笔记：${imported.notes} 条\n` +
      `科目：${imported.subjects} 个\n` +
      `轮次题目：${imported.reviewRoundItems || 0} 条\n` +
      `本轮移出记录：${imported.reviewRoundExclusions || 0} 条`
    );

    window.location.reload();
  } catch (error) {
    console.error(error);
    alert('❌ 导入失败: ' + error.message);
  } finally {
    setBackupProgress(null);
    setBackupBusy(false);
    e.target.value = '';
  }
};

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(e => console.log(e));
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans flex flex-col h-screen overflow-hidden">
    {/* 顶部通栏 - [修改] 增加导出导入按钮 */}
      <nav className="bg-white shadow-sm px-4 py-3 z-30 flex justify-between items-center border-b border-gray-200 shrink-0 gap-4">
        {activeTab === 'mistakes' ? (
          <div className="flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar mask-gradient pr-2">
            {subjects.map(sub => (
              <button 
                key={sub.id}
                data-subject-id={sub.id}
                onClick={() => {
  setActiveTab('mistakes');
  setMistakeView('list');
  setActiveSubjectId(sub.id);
}}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap transition-all flex-shrink-0",
                  activeSubjectId === sub.id 
                    ? "bg-blue-600 text-white shadow-md" 
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                )}
              >
                {sub.name}
              </button>
            ))}
            <button 
              onClick={handleAddSubject} 
              className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 flex-shrink-0"
              title="添加新科目"
            >
              <Plus size={16} strokeWidth={3} />
            </button>
          </div>
        ) : (
          <h1 className="text-lg font-bold bg-gradient-to-r from-blue-700 to-blue-500 bg-clip-text text-transparent flex-1">
            知识笔记
          </h1>
        )}

        {/* [新增] 右侧功能区：导出、导入、全屏 */}
        <div className="flex items-center gap-1">
          {activeTab === 'mistakes' && mistakeView !== 'list' && (
  <button
    onClick={() => setMistakeView('list')}
    className="p-2 hover:bg-gray-100 rounded-full text-gray-600 shrink-0 flex items-center gap-1"
    title="返回错题列表"
  >
    <Home size={20} />
    <span className="hidden sm:inline text-xs font-bold">主页</span>
  </button>
)}

{activeTab === 'mistakes' && mistakeView === 'detail' && (
  <button
    onClick={() => window.dispatchEvent(new Event('mistake-detail-edit'))}
    className="px-3 py-2 bg-gray-100 text-gray-700 rounded-full shrink-0 flex items-center gap-1 text-xs font-bold hover:bg-gray-200"
    title="编辑当前显示的题目"
  >
    <Edit size={16} />
    <span className="hidden sm:inline">编辑</span>
  </button>
)}

{activeTab === 'mistakes' && (mistakeView === 'add' || mistakeView === 'edit') && (
  <button
    onClick={() => window.dispatchEvent(new Event('mistake-form-save'))}
    className="px-3 py-2 bg-blue-600 text-white rounded-full shrink-0 flex items-center gap-1 text-xs font-bold shadow-sm hover:bg-blue-700"
    title="保存错题"
  >
    <Save size={16} />
    <span className="hidden sm:inline">保存</span>
  </button>
)}
          {activeTab === 'mistakes' && mistakeView === 'list' && (
            <button type="button" onClick={() => setShowMistakeImportDialog(true)}
              className="px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-full text-blue-700 shrink-0 flex items-center gap-1 text-xs font-bold" title="增量导入AI错题包，不覆盖原数据">
              <UploadCloud size={17}/><span>导入错题</span>
            </button>
          )}
          <button
            onClick={() => setShowAiExportDialog(true)}
            disabled={Boolean(aiExportProgress)}
            className="px-2.5 py-2 bg-violet-50 hover:bg-violet-100 rounded-full text-violet-700 shrink-0 flex items-center gap-1 text-xs font-bold disabled:opacity-60"
            title="选择学科和内容后，导出最适合 AI 读取的文件"
          >
            <Bot size={18} />
            <span>
              {aiExportProgress?.stage === 'packing'
                ? `${aiExportProgress.completed}/${aiExportProgress.total}`
                : aiExportProgress
                  ? '打包中'
                  : '给AI'}
            </span>
          </button>

          <button onClick={handleExport} disabled={backupBusy} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 shrink-0 disabled:opacity-40" title="流式导出所有科目、错题图片、解析和图文笔记为可恢复的 .mathbackup">
            <Download size={20} />
          </button>

          <label className={cn("p-2 hover:bg-gray-100 rounded-full text-gray-500 shrink-0 cursor-pointer", backupBusy && "opacity-40 pointer-events-none")} title="选择 .mathbackup 一键导入完整数据库">
            <UploadCloud size={20} />
            {/* 隐藏的文件输入框，选中文件后立即触发 handleImport */}
           <input type="file" accept=".json,.mathbackup,application/json" onChange={handleImport} className="hidden" />
          </label>

          {backupProgress && (
            <span role="status" aria-live="polite" className="max-w-40 truncate text-[11px] font-semibold text-blue-700">
              {backupProgress.stage === 'commit' ? '恢复中' : backupProgress.stage === 'validate' ? '验证中' : backupProgress.stage === 'ready' ? '下载收尾' : '备份中'}
              {' '} {backupProgress.total ? Math.min(100, Math.floor(100 * backupProgress.completed / backupProgress.total)) : 0}%
            </span>
          )}
          <div className="w-[1px] h-4 bg-gray-200 mx-1"></div>

          <button onClick={toggleFullScreen} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 shrink-0" title="全屏">
            <Maximize size={20} />
          </button>
        </div>
      </nav>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'mistakes' ? (
          /* [修改] 传递当前科目ID */
         <MistakeSystem
  key={`${activeSubjectId}:${importRefreshCounter}`}
  subjectId={activeSubjectId}
  view={mistakeView}
  setView={setMistakeView}
/>
        ) : (
          <NoteSystem />
        )}
      </div>

      {/* 底部导航栏 */}
      <div className="bg-white border-t border-gray-200 p-2 flex justify-around items-center shrink-0 safe-area-bottom pb-4 z-40">
        <button
  onClick={() => {
    setActiveTab('mistakes');
    setMistakeView('list');
  }} 
          className={cn("flex flex-col items-center gap-1 p-2 rounded-xl transition-all w-24", activeTab === 'mistakes' ? "text-blue-600 bg-blue-50" : "text-gray-400 hover:bg-gray-50")}>
          <div className="relative"><Edit size={24} strokeWidth={activeTab === 'mistakes' ? 2.5 : 2} /></div>
          <span className="text-[10px] font-bold">错题本</span>
        </button>
        <button onClick={() => setActiveTab('notes')} className={cn("flex flex-col items-center gap-1 p-2 rounded-xl transition-all w-24", activeTab === 'notes' ? "text-indigo-600 bg-indigo-50" : "text-gray-400 hover:bg-gray-50")}>
          <Folder size={24} strokeWidth={activeTab === 'notes' ? 2.5 : 2} />
          <span className="text-[10px] font-bold">知识库</span>
        </button>
      </div>

      {showMistakeImportDialog && (
        <MistakeImportDialog subjectId={activeSubjectId} subjectName={subjects.find(s => String(s.id) === String(activeSubjectId))?.name || ''}
          onClose={() => setShowMistakeImportDialog(false)} onImported={() => { writeMistakeListState(activeSubjectId, 1, { keyword: '', visibleLimit: MISTAKE_PAGE_SIZE, scrollTop: 0, anchorId: null, anchorOffset: 0 }); setSelectedReviewRound(activeSubjectId, 1); setImportRefreshCounter(n => n + 1); setActiveTab('mistakes'); setMistakeView('list'); }} />
      )}
      {showAiExportDialog && (
        <AiExportDialog
          subjects={subjects}
          onCancel={() => setShowAiExportDialog(false)}
          onConfirm={handleAiExport}
        />
      )}
    </div>
  );
}

function MistakeSystem({ subjectId, view, setView }) {
  const [, setRevision] = useState(0);
  useEffect(() => {
    const update = event => {
      const relevant = event.type === 'storage'
        ? [`mathNotebook.selectedReviewRound.${subjectId}`, getMistakeListReverseKey(subjectId)].includes(event.key)
        : String(event.detail?.subjectId) === String(subjectId);
      if (relevant) {
        setView('list');
        setRevision(value => value + 1);
      }
    };
    window.addEventListener(LIST_CONTEXT_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(LIST_CONTEXT_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, [subjectId, setView]);
  if (!subjectId) return <div className="p-10 text-center text-gray-400">正在加载科目...</div>;
  const roundNo = getSelectedReviewRound(subjectId);
  return <MistakeWorkspace key={`${subjectId}:${roundNo}`} subjectId={subjectId} roundNo={roundNo} reversed={isMistakeListReversed(subjectId)} view={view} setView={setView}/>;
}

function MistakeWorkspace({ subjectId, roundNo, reversed, view, setView }) {
  const [saved] = useState(() => readMistakeListState(subjectId, roundNo));
  const [currentMistakeId, setCurrentMistakeId] = useState(null);
  const [searchQuery, setSearchQuery] = useState(saved.keyword);
  const [visibleLimit, setVisibleLimit] = useState(saved.visibleLimit);
  const [highlightedMistakeId, setHighlightedMistakeId] = useState(null);
  const [navigating, setNavigating] = useState(false);
  const [relatedEditorTargetId, setRelatedEditorTargetId] = useState(null);
  const consumeRelatedEditorRequest = useCallback(() => setRelatedEditorTargetId(null), []);
  const scrollerRef = useRef(null);
  const scrollerId = useId();
  const snapshotRef = useRef(saved);
  const persistenceEnabled = useRef(true);
  const restorePending = useRef(true);
  const focusOnReturn = useRef(false);
  const lastViewRef = useRef(null);
  const lastOrderRef = useRef(reversed);
  const writeTimerRef = useRef(null);
  const lastPageRef = useRef(null);
  const latestRef = useRef(null);
  const navigationLock = useRef(false);
  const progressRequestRef = useRef(0);

  const queryKey = JSON.stringify([roundNo, reversed, searchQuery, visibleLimit]);
  const page = useLiveQuery(async () => {
    // 多读一条判断是否还有下一页，避免刚好 20/40 条时出现不存在的“下一题”。
    const cards = await queryMistakeCards(db, {
      subjectId, roundNo, reversed, keyword: searchQuery, offset: 0, limit: visibleLimit + 1,
    });
    return { key: queryKey, cards: cards.slice(0, visibleLimit), hasMore: cards.length > visibleLimit };
  }, [subjectId, roundNo, reversed, searchQuery, visibleLimit]);
  const listReady = page?.key === queryKey;
  if (listReady) lastPageRef.current = page;
  const displayPage = lastPageRef.current;
  const list = displayPage?.cards || [];
  const hasMore = Boolean(displayPage?.hasMore);
  const currentMistake = useLiveQuery(
    () => currentMistakeId ? db.mistakes.get(currentMistakeId) : null,
    [currentMistakeId]
  );
  latestRef.current = { view, currentMistakeId, listReady };
  snapshotRef.current = { ...snapshotRef.current, keyword: searchQuery, visibleLimit };

  const persistSnapshot = useCallback(() => {
    if (persistenceEnabled.current) writeMistakeListState(subjectId, roundNo, snapshotRef.current);
  }, [subjectId, roundNo]);
  const captureListPosition = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || latestRef.current?.view !== 'list' || restorePending.current || !latestRef.current?.listReady) return;
    const top = scroller.getBoundingClientRect().top;
    const anchor = Array.from(scroller.querySelectorAll('[id^="mistake-card-"]'))
      .find(card => card.getBoundingClientRect().bottom > top);
    snapshotRef.current = {
      ...snapshotRef.current,
      scrollTop: scroller.scrollTop,
      anchorId: anchor?.id.replace('mistake-card-', '') || null,
      anchorOffset: anchor ? anchor.getBoundingClientRect().top - top : 0,
    };
  }, []);
  const saveListPosition = useCallback(() => {
    captureListPosition();
    persistSnapshot();
  }, [captureListPosition, persistSnapshot]);
  const handleScroll = () => {
    captureListPosition();
    clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(persistSnapshot, 120);
  };
  useEffect(() => {
    const reset = () => { persistenceEnabled.current = false; };
    window.addEventListener('math-notebook-reset-navigation', reset);
    window.addEventListener('pagehide', saveListPosition);
    return () => {
      window.removeEventListener('math-notebook-reset-navigation', reset);
      window.removeEventListener('pagehide', saveListPosition);
      clearTimeout(writeTimerRef.current);
      progressRequestRef.current += 1;
      persistSnapshot();
    };
  }, [saveListPosition, persistSnapshot]);

  useLayoutEffect(() => {
    const enteringList = view === 'list' && lastViewRef.current !== 'list';
    if (enteringList) focusOnReturn.current = lastViewRef.current === 'detail';
    const orderChanged = lastOrderRef.current !== reversed;
    if (enteringList || orderChanged) restorePending.current = true;
    if (orderChanged) {
      focusOnReturn.current = false;
      snapshotRef.current = { ...snapshotRef.current, scrollTop: 0, anchorId: null, anchorOffset: 0 };
      persistSnapshot();
    }
    lastOrderRef.current = reversed;
    lastViewRef.current = view;
    if (view !== 'list' || !listReady || !restorePending.current) return;

    const scroller = scrollerRef.current;
    scroller.scrollTop = snapshotRef.current.scrollTop;
    const anchor = snapshotRef.current.anchorId && document.getElementById(`mistake-card-${snapshotRef.current.anchorId}`);
    if (anchor && scroller.contains(anchor)) {
      scroller.scrollTop += anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top - snapshotRef.current.anchorOffset;
    }
    // 只在“返回列表”时定位当前题，加载更多和索引刷新绝不触发重新滚动。
    if (currentMistakeId && focusOnReturn.current) {
      document.getElementById(`mistake-card-${currentMistakeId}`)?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      setHighlightedMistakeId(currentMistakeId);
    }
    restorePending.current = false;
    focusOnReturn.current = false;
    saveListPosition();
  }, [view, listReady, page, currentMistakeId, reversed, persistSnapshot, saveListPosition]);

  useLayoutEffect(() => {
    if (view !== 'list') scrollerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [view, currentMistakeId]);
  useEffect(() => {
    if (!highlightedMistakeId || view !== 'list') return;
    const timer = setTimeout(() => setHighlightedMistakeId(null), 2500);
    return () => clearTimeout(timer);
  }, [view, highlightedMistakeId]);

  const openProgress = useCallback(async () => {
    let pending;
    try { pending = JSON.parse(localStorage.getItem('mathNotebook.pendingOpenMistake') || 'null'); } catch { return; }
    if (!pending || String(pending.subjectId) !== String(subjectId) || Number(pending.roundNo) !== roundNo) return;
    const request = ++progressRequestRef.current;
    const cards = await queryMistakeCards(db, { subjectId, roundNo, reversed, limit: Number.MAX_SAFE_INTEGER });
    if (request !== progressRequestRef.current) return;
    const index = cards.findIndex(card => String(card.id) === String(pending.mistakeId));
    localStorage.removeItem('mathNotebook.pendingOpenMistake');
    if (index < 0) return;
    saveListPosition();
    setSearchQuery('');
    setVisibleLimit(limit => Math.max(limit, Math.ceil((index + 1) / MISTAKE_PAGE_SIZE) * MISTAKE_PAGE_SIZE));
    setCurrentMistakeId(cards[index].id);
    setView('detail');
  }, [subjectId, roundNo, reversed, saveListPosition, setView]);
  useEffect(() => {
    const open = () => { openProgress().catch(error => console.error(error)); };
    window.addEventListener('math-notebook-open-progress', open);
    open();
    return () => window.removeEventListener('math-notebook-open-progress', open);
  }, [openProgress]);

  const loadMore = useCallback(() => {
    if (hasMore && listReady && !restorePending.current) setVisibleLimit(limit => limit + MISTAKE_PAGE_SIZE);
  }, [hasMore, listReady]);
  const handleNextMistake = async () => {
    if (!currentMistakeId || !listReady || navigationLock.current) return;
    const index = list.findIndex(item => item.id === currentMistakeId);
    if (index < 0) return;
    if (index + 1 < list.length) {
      setCurrentMistakeId(list[index + 1].id);
      return;
    }
    if (!hasMore) return;
    navigationLock.current = true;
    setNavigating(true);
    try {
      const next = await queryMistakeCards(db, {
        subjectId, roundNo, reversed, keyword: searchQuery, offset: index + 1, limit: 1,
      });
      if (latestRef.current?.view !== 'detail' || latestRef.current?.currentMistakeId !== currentMistakeId) return;
      setVisibleLimit(limit => limit + MISTAKE_PAGE_SIZE);
      if (next[0]) setCurrentMistakeId(next[0].id);
    } catch (error) {
      console.error(error);
      alert('加载下一题失败，请重试');
    } finally {
      navigationLock.current = false;
      setNavigating(false);
    }
  };
  const handlePrevMistake = () => {
    if (!listReady || navigationLock.current) return;
    const index = list.findIndex(item => item.id === currentMistakeId);
    if (index > 0) setCurrentMistakeId(list[index - 1].id);
  };
  const currentIndex = list.findIndex(item => item.id === currentMistakeId);

  return (
    <div className="relative w-full max-w-6xl mx-auto h-full">
    <div id={scrollerId} ref={scrollerRef} data-mistake-list-owner="react" onScroll={handleScroll} className={cn("w-full h-full overflow-y-auto px-3 sm:px-5 lg:px-8 py-4 pb-28", view === 'list' && 'mistake-list-scroller')}>
      <div>
      {view === 'list' && <>
        <MistakeListSearch scrollRef={scrollerRef} value={searchQuery} onChange={event => {
            progressRequestRef.current += 1;
            restorePending.current = true;
            snapshotRef.current = { ...snapshotRef.current, scrollTop: 0, anchorId: null, anchorOffset: 0 };
            setSearchQuery(event.target.value);
            setVisibleLimit(MISTAKE_PAGE_SIZE);
          }}/>
        <div id="mn-global-list-reverse-toggle" data-native-sort="true" className="flex justify-end mb-3">
          <button type="button" data-role="reverse-toggle" onClick={() => {
            saveListPosition();
            localStorage.setItem(getMistakeListReverseKey(subjectId), reversed ? '0' : '1');
            notifyListContextChanged(subjectId);
          }} className="rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 px-3 py-2 text-xs font-bold">{reversed ? '还原顺序' : '倒序显示'}</button>
        </div>
        <MistakeList mistakes={displayPage?.cards} highlightedId={highlightedMistakeId} scrollRoot={scrollerRef} onAdd={() => { saveListPosition(); setCurrentMistakeId(null); setView('add'); }} onOpen={id => {
          if (!listReady) return;
          progressRequestRef.current += 1;
          saveListPosition();
          setHighlightedMistakeId(id);
          setCurrentMistakeId(id);
          setView('detail');
        }} onLoadMore={loadMore} hasMore={hasMore}/>
        <div className="text-center text-[10px] text-gray-300 mt-4">Build: {APP_VERSION}</div>
      </>}
      {view === 'add' && <MistakeForm mode="add" subjectId={subjectId} onFinish={() => setView('list')} onCancel={() => setView('list')}/>}
      {view === 'detail' && (currentMistake?.id === currentMistakeId ? <MistakeDetail key={currentMistake.id} mistake={currentMistake} reviewRoundNo={roundNo} initialAddRelated={relatedEditorTargetId === currentMistake.id} onRelatedRequestConsumed={consumeRelatedEditorRequest} onRemoveFromRound={() => { setCurrentMistakeId(null); setView('list'); }} onEdit={() => setView('edit')} onNext={handleNextMistake} hasNext={!navigating && currentIndex >= 0 && (currentIndex < list.length - 1 || hasMore)} onPrev={handlePrevMistake} hasPrev={!navigating && currentIndex > 0} onBack={() => setView('list')}/> : <div className="p-10 text-center text-gray-400">正在加载题目...</div>)}
      {view === 'edit' && currentMistake?.id === currentMistakeId && <MistakeForm mode="edit" initialData={currentMistake} subjectId={subjectId} onFinish={() => setView('detail')} onCancel={() => setView('detail')} onAddRelated={() => { setRelatedEditorTargetId(currentMistakeId); setView('detail'); }}/>}
      </div>
    </div>
    {view === 'list' && <ListScrollHandle scrollRef={scrollerRef} controlsId={scrollerId}/>}
    </div>
  );
}

// ==========================================
// 模块二：笔记系统 (NoteSystem) - [修复拖拽乱跳]
// ==========================================
function NoteSystem() {
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(true); 
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); 
  const [clipboard, setClipboard] = useState({ items: [], mode: 'copy' });
  const [aiPromptCopied, setAiPromptCopied] = useState(false);

  const allNotes = useLiveQuery(() => db.notes.orderBy('order').toArray()) || [];

  const noteTree = useMemo(() => {
    const buildTree = (pid) => {
      return allNotes.filter(n => n.parentId === pid).sort((a, b) => (a.order || 0) - (b.order || 0)).map(n => ({ ...n, children: buildTree(n.id) }));
    };
    return buildTree('root');
  }, [allNotes]);

  const filteredNotes = useMemo(() => {
    if (!searchTerm) return [];
    return allNotes.filter(n => {
      const titleMatch = n.title?.toLowerCase().includes(searchTerm.toLowerCase());
      const tagMatch = n.tags?.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()));
      return (titleMatch || tagMatch) && n.type === 'file';
    });
  }, [allNotes, searchTerm]);

  const handleCreate = async (type, parentId = 'root') => {
    const newId = await db.notes.add({
      parentId,
      title: type === 'folder' ? '新建文件夹' : '新建知识点',
      type,
      content: [],
      tags: [],
      order: Date.now(),
      createdAt: new Date()
    });
    return newId;
  };

  // Single .knote and multi-note .knote bundle use the same import entry point.
  // All items are validated before the transaction; a failed item cannot leave
  // half-imported notes or folders in IndexedDB.
  const handleRichNoteImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const collection = await parseRichNoteCollection(file);
      const result = await db.transaction('rw', db.notes, async () => {
        const createdIds = [];
        let skipped = 0;
        let newFolders = 0;
        const folderCache = new Map();

        for (const imported of collection.notes) {
          let parentId = 'root';
          for (const name of imported.folderPath) {
            const cacheKey = JSON.stringify([parentId, name]);
            if (folderCache.has(cacheKey)) {
              parentId = folderCache.get(cacheKey);
              continue;
            }
            const siblings = await db.notes.where('parentId').equals(parentId).toArray();
            let folder = siblings.find(item => item.type === 'folder' && item.title === name);
            if (!folder) {
              const id = await db.notes.add({
                parentId, title: name, type: 'folder',
                text: '', content: [], tags: [],
                order: Date.now() + newFolders,
                createdAt: new Date()
              });
              folder = { id };
              newFolders += 1;
            }
            folderCache.set(cacheKey, folder.id);
            parentId = folder.id;
          }

          // Re-importing the exact same title in the same folder does not
          // overwrite the user's edited notes or create duplicate entries.
          const siblings = await db.notes.where('parentId').equals(parentId).toArray();
          if (siblings.some(item => item.type === 'file' && item.title === imported.title)) {
            skipped += 1;
            continue;
          }

          const newId = await db.notes.add({
            parentId, title: imported.title, type: 'file',
            text: imported.text, assets: imported.assets,
            content: [], tags: imported.tags,
            order: Date.now() + createdIds.length,
            createdAt: new Date()
          });
          createdIds.push(newId);
        }
        return { createdIds, skipped, newFolders, total: collection.notes.length };
      });
      setSearchTerm('');
      if (result.createdIds.length) {
        setSelectedNodeId(result.createdIds[0]);
        setMobileMenuOpen(false);
      }
      alert(
        '✅ 图文笔记导入完成！\n\n'
        + '新增笔记：' + result.createdIds.length + ' 篇\n'
        + '按章节创建文件夹：' + result.newFolders + ' 个\n'
        + '同路径同标题跳过：' + result.skipped + ' 篇\n'
        + '合计检查：' + result.total + ' 篇\n\n'
        + '原有错题及笔记均未被覆盖。'
      );
    } catch (error) {
      console.error('图文笔记导入失败', error);
      alert('❌ 图文笔记导入失败：' + (error?.message || error));
    } finally {
      event.target.value = '';
    }
  };

  const handleCopyRichNotePrompt = async () => {
    const fallbackCopy = () => {
      const input = document.createElement('textarea');
      input.value = RICH_NOTE_AI_PROMPT;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      try {
        input.focus();
        input.select();
        if (!document.execCommand('copy')) throw new Error('浏览器未允许复制');
      } finally {
        input.remove();
      }
    };

    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(RICH_NOTE_AI_PROMPT);
        } catch {
          fallbackCopy();
        }
      } else {
        fallbackCopy();
      }
      setAiPromptCopied(true);
    } catch (error) {
      setAiPromptCopied(false);
      console.error('复制图文笔记提示词失败', error);
      alert('无法自动复制提示词，请确认浏览器允许访问剪贴板后重试。');
    }
  };

  const handleAddToClipboard = (ids, mode) => { setClipboard({ items: ids, mode }); };

  const handlePaste = async (targetParentId) => {
    if (clipboard.items.length === 0) return;
    if (clipboard.mode === 'move') {
      for (const id of clipboard.items) {
         const node = allNotes.find(n => n.id === id);
         if (node && node.id !== targetParentId) { await db.notes.update(id, { parentId: targetParentId, order: Date.now() }); }
      }
      setClipboard({ items: [], mode: 'copy' });
    } else {
      for (const id of clipboard.items) { await cloneNodeRecursive(id, targetParentId); }
    }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor));

  const isDescendant = (sourceId, targetId) => {
    if (sourceId === targetId) return true;
    let current = allNotes.find(n => n.id === targetId);
    while (current && current.parentId !== 'root') {
      if (current.parentId === sourceId) return true;
      current = allNotes.find(n => n.id === current.parentId);
    }
    return false;
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeNode = allNotes.find(n => n.id === active.id);
    const overNode = allNotes.find(n => n.id === over.id);
    if (!activeNode || !overNode) return;
    if (isDescendant(activeNode.id, overNode.id)) return; 

    if (overNode.type === 'folder' && activeNode.parentId !== overNode.id) {
       await db.notes.update(activeNode.id, { parentId: overNode.id });
    } else {
       if (activeNode.parentId !== overNode.parentId) {
         await db.notes.update(activeNode.id, { parentId: overNode.parentId, order: overNode.order });
       } else {
         await db.notes.update(activeNode.id, { order: overNode.order });
         await db.notes.update(overNode.id, { order: activeNode.order });
       }
    }
  };

  const selectedNode = useMemo(() => allNotes.find(n => n.id === selectedNodeId), [allNotes, selectedNodeId]);
  const folderContents = useMemo(() => {
     if (!selectedNode || selectedNode.type !== 'folder') return [];
     return allNotes.filter(n => n.parentId === selectedNode.id).sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [allNotes, selectedNode]);

  return (
    <div className="flex h-full bg-white">
      <div className={cn("bg-gray-50 border-r border-gray-200 flex flex-col transition-all duration-300 absolute md:relative z-20 h-full shadow-lg md:shadow-none", !mobileMenuOpen && "-translate-x-full md:translate-x-0", isSidebarOpen ? (isSidebarExpanded ? "w-96" : "w-64") : "w-64 md:w-12")}>
        {!isSidebarOpen && <button type="button" onClick={() => setIsSidebarOpen(true)} title="展开左侧目录" aria-label="展开左侧目录" className="hidden md:flex w-9 h-9 mt-3 mx-auto items-center justify-center rounded-lg text-gray-600 hover:text-indigo-600 hover:bg-indigo-50"><PanelLeftOpen size={19}/></button>}
        <div className={cn("p-3 border-b border-gray-200 flex gap-2 items-center", !isSidebarOpen && "md:hidden")}>
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full text-xs bg-white border rounded px-2 py-1.5 focus:outline-blue-500" placeholder="搜索..." />
          <button onClick={() => setIsSidebarOpen(false)} title="收起左侧目录" aria-label="收起左侧目录" className="hidden md:flex p-1.5 hover:bg-gray-200 rounded text-gray-500 transition"><PanelLeftClose size={16}/></button>
          <button onClick={() => setMobileMenuOpen(false)} className="md:hidden"><X size={16}/></button>
        </div>
        <div className={cn("flex-1 overflow-y-auto overflow-x-auto p-2", !isSidebarOpen && "md:hidden")}>
          {searchTerm ? (
            <div className="space-y-1 min-w-max">
              {filteredNotes.map(note => (
                <div key={note.id} onClick={() => { setSelectedNodeId(note.id); if(window.innerWidth < 768) setMobileMenuOpen(false); }} className="p-2 bg-white border rounded text-sm cursor-pointer hover:bg-blue-50">
                  <div className="font-bold text-gray-700">{note.title}</div>
                  <div className="flex gap-1 mt-1">{note.tags?.map(t => <span key={t} className="text-[10px] bg-blue-100 text-blue-600 px-1 rounded">{t}</span>)}</div>
                </div>
              ))}
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
              {/* [修复] 使用 pointerWithin 替代 closestCenter，解决树形结构拖拽乱跳问题 */}
              <SortableContext items={allNotes.map(n => n.id)} strategy={verticalListSortingStrategy}>
                 <div className="min-w-max pb-4 pr-4"> 
                    <NoteTree nodes={noteTree} selectedId={selectedNodeId} onSelect={(id) => { setSelectedNodeId(id); if(window.innerWidth < 768) setMobileMenuOpen(false); }} onCreate={handleCreate} />
                 </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
        <div className={cn("p-3 border-t border-gray-200 shrink-0 bg-gray-50 space-y-2", !isSidebarOpen && "md:hidden")}>
          <label className="flex items-center justify-center gap-2 w-full border border-indigo-200 bg-indigo-50 text-indigo-700 rounded py-2.5 text-xs font-bold hover:bg-indigo-100 cursor-pointer">
            <UploadCloud size={15}/> 导入图文笔记（单篇/合集）
            <input type="file" accept=".knote,.md,application/json,text/markdown" onChange={handleRichNoteImport} className="hidden"/>
          </label>
          <button
            type="button"
            onClick={handleCopyRichNotePrompt}
            title="复制生成单篇或多篇自动分章节 .knote 笔记包的 AI 提示词"
            className={cn("flex items-center justify-center gap-2 w-full border rounded py-2.5 text-xs font-bold transition",
              aiPromptCopied
                ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                : "border-gray-300 bg-white text-indigo-700 hover:bg-indigo-50")}
          >
            {aiPromptCopied ? <CheckCircle2 size={15}/> : <Copy size={15}/>}
            {aiPromptCopied ? '已复制 AI 提示词（点击可再复制）' : '复制 AI 提示词（生成单篇/合集）'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => handleCreate('folder', 'root')} className="flex items-center justify-center gap-1 bg-white border border-gray-300 rounded py-2 text-xs font-bold hover:bg-gray-100"><Folder size={14}/> 根文件夹</button>
            <button onClick={() => handleCreate('file', 'root')} className="flex items-center justify-center gap-1 bg-blue-600 text-white rounded py-2 text-xs font-bold hover:bg-blue-700"><FileText size={14}/> 根知识点</button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col relative bg-white">
        {!mobileMenuOpen && (<button onClick={() => setMobileMenuOpen(true)} className="absolute top-4 left-4 z-10 p-2 bg-white shadow-md border rounded-full md:hidden"><ChevronRightIcon size={20} /></button>)}

        {selectedNode ? (
          selectedNode.type === 'folder' ? (
            <FolderView 
              folder={selectedNode} 
              contents={folderContents} 
              onNavigate={setSelectedNodeId} 
              onCreate={handleCreate} 
              onBack={() => setSelectedNodeId(selectedNode.parentId === 'root' ? null : selectedNode.parentId)}
              onCopy={(ids) => handleAddToClipboard(ids, 'copy')}
              onCut={(ids) => handleAddToClipboard(ids, 'move')}
              onPaste={() => handlePaste(selectedNode.id)}
              clipboardCount={clipboard.items.length}
            />
          ) : (
            <NoteEditor
               nodeId={selectedNodeId}
               onExport={() => {
                 const folderPath = [];
                 let parentId = selectedNode.parentId;
                 while (parentId && parentId !== 'root') {
                   const parent = allNotes.find(item => item.id === parentId);
                   if (!parent) break;
                   if (parent.type === 'folder') folderPath.unshift(parent.title);
                   parentId = parent.parentId;
                 }
                 downloadRichNotePackage(selectedNode, folderPath);
               }}
               onNavigate={setSelectedNodeId} 
               onBack={() => {
                 setSelectedNodeId(selectedNode.parentId === 'root' ? null : selectedNode.parentId);
                 if (selectedNode.parentId === 'root' && window.innerWidth < 768) setMobileMenuOpen(true);
               }} 
            />
          )
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-300 select-none"><Folder size={64} className="mb-4 opacity-20"/><p className="mt-2">从左侧选择知识点或文件夹</p></div>
        )}
      </div>
    </div>
  );
}
// ==========================================
// 组件库
// ==========================================

function NoteTree({ nodes, selectedId, onSelect, onCreate, level = 0 }) {
  return (
    <div className="space-y-0.5">
      {nodes.map(node => (
        <TreeNode key={node.id} node={node} selectedId={selectedId} onSelect={onSelect} onCreate={onCreate} level={level} />
      ))}
    </div>
  );
}

function TreeNode({ node, selectedId, onSelect, onCreate, level }) {
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, paddingLeft: `${level * 12 + 8}px` };
  const isFolder = node.type === 'folder';
  const isSelected = selectedId === node.id;

  useDndMonitor({
    onDragOver({ over }) {
      if (isFolder && !expanded && over?.id === node.id) {
        const timer = setTimeout(() => { setExpanded(true); }, 500); 
        return () => clearTimeout(timer);
      }
    }
  });

  return (
    <div ref={setNodeRef} style={style} className="select-none py-0.5 outline-none">
      <div 
        className={cn("flex items-center gap-1 p-2 rounded-lg cursor-pointer transition-all group relative border border-transparent", isSelected ? "bg-indigo-50 text-indigo-700 border-indigo-100" : "hover:bg-gray-100 text-gray-700")}
        onClick={(e) => { e.stopPropagation(); if(isFolder) setExpanded(!expanded); onSelect(node.id); }}
      >
        <div {...attributes} {...listeners} className="text-gray-300 hover:text-gray-600 cursor-grab px-1 py-1 touch-none"><GripVertical size={14}/></div>
        <div className="w-4 h-4 flex items-center justify-center mr-1">{isFolder && (<div className="transition-transform duration-200" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}><ChevronRightIcon size={14}/></div>)}</div>
        {isFolder ? <Folder size={16} className={cn("shrink-0 transition-colors", isSelected ? "fill-indigo-200 text-indigo-600" : "text-gray-400 group-hover:text-blue-400")} /> : <FileText size={16} className="shrink-0 text-gray-400"/>}
        <span className="text-sm truncate flex-1 font-medium">{node.title}</span>
        {isFolder && (
          <div className="absolute right-2 opacity-0 group-hover:opacity-100 flex items-center bg-white shadow-sm border border-gray-100 rounded-md overflow-hidden transition-opacity">
             <button onClick={(e) => { e.stopPropagation(); onCreate('folder', node.id); setExpanded(true); }} className="p-1.5 hover:bg-gray-100 text-gray-500 hover:text-blue-600 border-r border-gray-100"><Folder size={12} strokeWidth={2.5}/></button>
             <button onClick={(e) => { e.stopPropagation(); onCreate('file', node.id); setExpanded(true); }} className="p-1.5 hover:bg-gray-100 text-gray-500 hover:text-blue-600"><FileText size={12} strokeWidth={2.5}/></button>
          </div>
        )}
      </div>
      {isFolder && expanded && node.children && (<div className="transition-all duration-300 ease-in-out"><NoteTree nodes={node.children} selectedId={selectedId} onSelect={onSelect} onCreate={onCreate} level={level + 1} /></div>)}
    </div>
  );
}

// --- [修复版] 高效移动弹窗组件 (防死循环) ---
function MoveModal({ node, allNotes, onClose, onConfirm }) {
  // 使用 useMemo 缓存计算结果，避免每次渲染都重新计算导致卡顿
  const validTargets = useMemo(() => {
    // 辅助函数：安全地检查 sourceId 是否是 targetNode 的祖先
    const isDescendant = (sourceId, targetNode) => {
      let curr = targetNode;
      let safeGuard = 0; // [关键] 安全计数器，防止死循环

      // 如果向上查找超过 500 层，或者找不到父级，或者到了根目录，就停止
      while(curr && curr.parentId !== 'root' && safeGuard < 500) {
          if(curr.parentId === sourceId) return true;
          // 在 allNotes 中查找父级
          curr = allNotes.find(n => n.id === curr.parentId);
          safeGuard++;
      }
      return false;
    };

    return allNotes
      .filter(n => n.type === 'folder') // 只能移动到文件夹
      .filter(n => n.id !== node.id)    // 不能移动到自己
      .filter(n => n.id !== node.parentId) // 不能原地移动
      .filter(n => !isDescendant(node.id, n)) // 不能移动到自己的子孙文件夹中
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [allNotes, node]);

  // 渲染树状选项
  const renderOptions = (parentId = 'root', level = 0) => {
      // 为了性能，只查找当前层级的子文件夹
      const children = validTargets.filter(n => n.parentId === parentId);
      if (children.length === 0) return null;

      return children.map(folder => (
          <React.Fragment key={folder.id}>
              <div 
                  onClick={() => onConfirm(folder.id)}
                  className="p-3 hover:bg-blue-50 cursor-pointer flex items-center gap-2 border-b border-gray-50 text-sm text-gray-700 active:bg-blue-100 transition-colors"
                  style={{ paddingLeft: `${level * 20 + 12}px` }}
              >
                  <Folder size={16} className="text-blue-500 fill-blue-100 shrink-0"/>
                  <span className="truncate">{folder.title}</span>
              </div>
              {/* 递归限制层级深度，防止栈溢出 */}
              {level < 20 && renderOptions(folder.id, level + 1)}
          </React.Fragment>
      ));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm flex flex-col max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="font-bold text-gray-800 truncate pr-4">将 "{node.title}" 移动到...</h3>
                <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-full text-gray-500 transition"><X size={20}/></button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {/* 根目录选项 */}
                {node.parentId !== 'root' && (
                    <div onClick={() => onConfirm('root')} className="p-3 hover:bg-blue-50 cursor-pointer flex items-center gap-2 border-b border-gray-50 text-sm font-bold text-gray-800 bg-gray-50/50">
                        <Folder size={16} className="text-gray-500"/>
                        根目录 (Root)
                    </div>
                )}

                {/* 文件夹树 */}
                {renderOptions('root', 0)}

                {validTargets.length === 0 && node.parentId === 'root' && (
                    <div className="p-8 text-center text-gray-400 text-xs flex flex-col items-center">
                        <Folder size={32} className="mb-2 opacity-20"/>
                        没有其他可移动的目标文件夹
                    </div>
                )}
            </div>
        </div>
    </div>
  );
}

// --- [修复版] 文件夹视图 (稳定交互) ---
function FolderView({ folder, contents, onNavigate, onCreate, onBack, onCopy, onCut, onPaste, clipboardCount }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(folder.title);
  const [renamingId, setRenamingId] = useState(null);

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [moveTargetModal, setMoveTargetModal] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'order', label: '自定义' }); 

  const allNotes = useLiveQuery(() => db.notes.toArray()) || [];
  const bgLongPressTimer = React.useRef(null); // 仅用于背景长按

  useEffect(() => { setTitle(folder.title); setSelectedIds(new Set()); setIsSelectionMode(false); setRenamingId(null); }, [folder.id]);

  const sortedContents = useMemo(() => {
    let sorted = [...contents];
    if (sortConfig.key === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
    else if (sortConfig.key === 'date') sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else sorted.sort((a, b) => (a.order || 0) - (b.order || 0));
    return sorted;
  }, [contents, sortConfig]);

  // [配置] 拖拽传感器：200ms 延迟，5px 容差 (手感最佳)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id || sortConfig.key !== 'order') return;
    const oldIndex = sortedContents.findIndex(c => c.id === active.id);
    const newIndex = sortedContents.findIndex(c => c.id === over.id);
    const newOrderArray = arrayMove(sortedContents, oldIndex, newIndex);
    newOrderArray.forEach((item, index) => {
        if (item.order !== index) db.notes.update(item.id, { order: index });
    });
  };

  // --- 空白区域长按逻辑 (粘贴菜单) ---
  const handleBgPointerDown = (e) => {
    if (e.target.dataset.type !== 'folder-bg') return; // 确保点在背景上

    // 清除旧定时器
    if (bgLongPressTimer.current) clearTimeout(bgLongPressTimer.current);

    const clientX = e.clientX;
    const clientY = e.clientY;

    bgLongPressTimer.current = setTimeout(() => {
      setContextMenu({ x: clientX, y: clientY, targetId: 'folder_bg' });
    }, 600); // 600ms 长按触发粘贴
  };

  const clearBgTimer = () => {
    if (bgLongPressTimer.current) {
      clearTimeout(bgLongPressTimer.current);
      bgLongPressTimer.current = null;
    }
  };

  // --- 菜单操作 ---
  const handleMenuClick = (id, e) => {
      // 按钮触发菜单
      const rect = e.currentTarget.getBoundingClientRect();
      setContextMenu({ x: rect.left, y: rect.bottom, targetId: id });
  };

  const handleMenuAction = (action) => {
    const targetId = contextMenu?.targetId;
    if (!targetId) return;
    if (action === 'rename') { setRenamingId(targetId); } else if (action === 'copy') { onCopy([targetId]); } else if (action === 'cut') { onCut([targetId]); } else if (action === 'delete') { if (confirm("删除此项？")) deleteNoteRecursive(targetId); } else if (action === 'select') { setIsSelectionMode(true); setSelectedIds(new Set([targetId])); } else if (action === 'paste') { onPaste(); }
    setContextMenu(null);
  };

  // 辅助功能...
  const handleRename = async () => { if (title.trim()) await db.notes.update(folder.id, { title: title.trim() }); setEditingTitle(false); };
  const handleCreateWrapper = async (type) => { const newId = await onCreate(type, folder.id); setRenamingId(newId); };
  const handleItemRenameConfirm = async (id, newName) => { if (newName.trim()) { await db.notes.update(id, { title: newName.trim() }); } setRenamingId(null); };
  const handleDeleteFolder = async () => { if (confirm('确定删除此文件夹及其内容吗？')) { await deleteNoteRecursive(folder.id); onBack(); } };
  const handleBulkDelete = async () => { if (confirm(`确定删除选中的 ${selectedIds.size} 项吗？`)) { for (const id of selectedIds) await deleteNoteRecursive(id); setSelectedIds(new Set()); setIsSelectionMode(false); } };
  const handleBulkMoveConfirm = async (targetId) => { for (const id of selectedIds) { if (id !== targetId) await db.notes.update(id, { parentId: targetId }); } setMoveTargetModal(false); setSelectedIds(new Set()); setIsSelectionMode(false); };
  const toggleSelection = (id) => { const newSet = new Set(selectedIds); if (newSet.has(id)) newSet.delete(id); else newSet.add(id); setSelectedIds(newSet); };
  const onItemClick = (id) => { if (isSelectionMode) { toggleSelection(id); } else { onNavigate(id); } };

  return (
    <div className="flex flex-col h-full bg-white relative">
      <div className="p-4 border-b border-gray-100 flex items-center gap-3 sticky top-0 bg-white/95 backdrop-blur z-10">
        {folder.parentId !== 'root' && (<button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"><ArrowUpLeft size={20}/></button>)}
        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Folder size={24}/></div>
        <div className="flex-1 mr-2 overflow-hidden">
           {editingTitle ? (<input autoFocus value={title} onChange={e => setTitle(e.target.value)} onBlur={handleRename} onKeyDown={e => e.key === 'Enter' && handleRename()} className="text-xl font-bold w-full border-b border-blue-500 outline-none"/>) : (<h2 onClick={() => setEditingTitle(true)} className="text-xl font-bold text-gray-800 truncate" title="点击重命名">{folder.title}</h2>)}
           <p className="text-xs text-gray-400 mt-0.5">{contents.length} 个项目</p>
        </div>
        <div className="relative">
            <button onClick={() => setShowSortMenu(!showSortMenu)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 flex items-center gap-1"><ArrowDownUp size={18}/></button>
            {showSortMenu && (
                <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)}></div>
                <div className="absolute top-full right-0 mt-2 bg-white shadow-xl border border-gray-100 rounded-lg py-1 w-32 z-50">
                    <button onClick={() => { setSortConfig({key:'order', label:'自定义'}); setShowSortMenu(false); }} className={cn("w-full text-left px-4 py-2 text-sm hover:bg-gray-50", sortConfig.key==='order' && "text-blue-600 bg-blue-50")}>自定义顺序</button>
                    <button onClick={() => { setSortConfig({key:'title', label:'名称'}); setShowSortMenu(false); }} className={cn("w-full text-left px-4 py-2 text-sm hover:bg-gray-50", sortConfig.key==='title' && "text-blue-600 bg-blue-50")}>按名称</button>
                    <button onClick={() => { setSortConfig({key:'date', label:'时间'}); setShowSortMenu(false); }} className={cn("w-full text-left px-4 py-2 text-sm hover:bg-gray-50", sortConfig.key==='date' && "text-blue-600 bg-blue-50")}>按时间</button>
                </div>
                </>
            )}
        </div>
        <button onClick={() => { setIsSelectionMode(!isSelectionMode); setSelectedIds(new Set()); }} className={cn("p-2 rounded-full font-bold text-xs flex items-center gap-1 transition", isSelectionMode ? "bg-blue-100 text-blue-600" : "hover:bg-gray-100 text-gray-600")}>{isSelectionMode ? '完成' : <><CheckSquare size={18}/> 编辑</>}</button>
      </div>

      <div 
        className="flex-1 overflow-y-auto p-4" 
        onClick={() => setContextMenu(null)}
        // 背景长按监听
        data-type="folder-bg"
        onPointerDown={handleBgPointerDown}
        onPointerMove={clearBgTimer} // 移动取消
        onPointerUp={clearBgTimer}   // 抬起取消
        onPointerLeave={clearBgTimer}
      >
        {contents.length === 0 ? (
           <div className="h-full flex flex-col items-center justify-center text-gray-300 pointer-events-none"><div className="w-16 h-16 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center mb-2"><Folder size={24} className="opacity-20"/></div><p className="text-sm">长按空白处粘贴</p></div>
        ) : (
           <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={clearBgTimer} onDragEnd={handleDragEnd}>
             <SortableContext items={sortedContents.map(n => n.id)} strategy={rectSortingStrategy}>
               <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 pb-20" data-type="folder-bg">
                  {sortedContents.map(item => (
                     <SortableGridItem 
                        key={item.id} item={item} isSelectionMode={isSelectionMode} isSelected={selectedIds.has(item.id)}
                        onClick={(e) => { if(!isSelectionMode && sortConfig.key !== 'order') e.stopPropagation(); onItemClick(item.id); }}
                        // [新增] 传入菜单点击回调
                        onMenuClick={(e) => handleMenuClick(item.id, e)}
                     >
                        {isSelectionMode && (<div className="absolute top-2 right-2 text-blue-500 z-50">{selectedIds.has(item.id) ? <CheckCircle2 size={20} fill="white"/> : <Circle size={20} className="text-gray-300"/>}</div>)}
                        <div className={cn("w-16 h-16 flex items-center justify-center rounded-2xl shadow-sm transition-transform z-10", item.type === 'folder' ? "bg-blue-100 text-blue-500" : "bg-white border border-gray-200 text-gray-400")}>{item.type === 'folder' ? <Folder size={32} fill="currentColor" className="opacity-80"/> : <FileText size={32} />}</div>
                        <div className="w-full z-10">
                           {renamingId === item.id ? (
                               <input autoFocus defaultValue={item.title} onBlur={(e) => handleItemRenameConfirm(item.id, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleItemRenameConfirm(item.id, e.currentTarget.value)} onClick={(e) => e.stopPropagation()} className="w-full text-center text-sm border-b border-blue-500 outline-none bg-transparent"/>
                           ) : (
                               <><div className="font-medium text-gray-700 text-sm truncate">{item.title}</div><div className="text-[10px] text-gray-400 mt-1">{new Date(item.createdAt).toLocaleDateString()}</div></>
                           )}
                        </div>
                     </SortableGridItem>
                  ))}
               </div>
             </SortableContext>
           </DndContext>
        )}
      </div>

      {isSelectionMode && (
        <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 flex justify-around items-center shadow-[0_-4px_20px_rgba(0,0,0,0.1)] z-20 animate-in slide-in-from-bottom duration-200">
           <button onClick={() => { onCopy(Array.from(selectedIds)); setIsSelectionMode(false); }} className="flex flex-col items-center gap-1 text-gray-600 hover:text-blue-600 disabled:opacity-30" disabled={selectedIds.size===0}><Copy size={20}/><span className="text-[10px]">复制</span></button>
           <button onClick={() => { setMoveTargetModal(true); }} className="flex flex-col items-center gap-1 text-gray-600 hover:text-blue-600 disabled:opacity-30" disabled={selectedIds.size===0}><ArrowRightSquare size={20}/><span className="text-[10px]">移动</span></button>
           <button onClick={() => { onCut(Array.from(selectedIds)); setIsSelectionMode(false); }} className="flex flex-col items-center gap-1 text-gray-600 hover:text-blue-600 disabled:opacity-30" disabled={selectedIds.size===0}><Scissors size={20}/><span className="text-[10px]">剪切</span></button>
           <button onClick={handleBulkDelete} className="flex flex-col items-center gap-1 text-red-500 hover:text-red-700 disabled:opacity-30" disabled={selectedIds.size===0}><Trash2 size={20}/><span className="text-[10px]">删除</span></button>
        </div>
      )}

      {!isSelectionMode && (
        <div className="absolute bottom-6 right-6 z-20 flex flex-col gap-3">
           <button onClick={() => handleCreateWrapper('folder')} className="w-12 h-12 bg-white text-gray-600 rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 border border-gray-100 transition" title="新建文件夹"><Folder size={20}/></button>
           <button onClick={() => handleCreateWrapper('file')} className="w-12 h-12 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-blue-700 transition" title="新建知识点"><Plus size={24}/></button>
        </div>
      )}

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)}></div>
          <div className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-100 py-1 w-32 animate-in zoom-in-95 duration-100 overflow-hidden" style={{ top: Math.min(contextMenu.y, window.innerHeight - 200), left: Math.min(contextMenu.x, window.innerWidth - 128) }}>
            {contextMenu.targetId === 'folder_bg' ? (
               <button onClick={() => handleMenuAction('paste')} className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 flex items-center gap-2" disabled={clipboardCount === 0}><Clipboard size={16} className={clipboardCount > 0 ? "text-blue-600" : "text-gray-400"}/><span className={clipboardCount > 0 ? "text-gray-800" : "text-gray-400"}>粘贴 ({clipboardCount})</span></button>
            ) : (
               <>
                 <button onClick={() => handleMenuAction('select')} className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-2 text-gray-700"><CheckCircle2 size={16}/> 多选</button>
                 <button onClick={() => handleMenuAction('rename')} className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-2 text-gray-700"><Edit size={16}/> 重命名</button>
                 <button onClick={() => handleMenuAction('copy')} className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-2 text-gray-700"><Copy size={16}/> 复制</button>
                 <button onClick={() => handleMenuAction('cut')} className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-2 text-gray-700"><Scissors size={16}/> 剪切</button>
                 <div className="h-[1px] bg-gray-100 my-1"></div>
                 <button onClick={() => handleMenuAction('delete')} className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-50 flex items-center gap-2 text-red-600"><Trash2 size={16}/> 删除</button>
               </>
            )}
          </div>
        </>
      )}

      {moveTargetModal && (<MoveModal node={{ title: `${selectedIds.size} 个项目`, parentId: folder.id, id: 'bulk_move' }} allNotes={allNotes} onClose={() => setMoveTargetModal(false)} onConfirm={handleBulkMoveConfirm}/>)}
    </div>
  );
}

// --- [更新] 知识点编辑器：支持 Markdown/LaTeX 文本 + 图片 ---
function NoteEditor({ nodeId, onBack, onNavigate, onExport }) {
  const note = useLiveQuery(() => db.notes.get(nodeId), [nodeId]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [newTag, setNewTag] = useState('');

  // [新增] 文本编辑相关状态
  const [text, setText] = useState('');
  const [isPreview, setIsPreview] = useState(true); // 默认开启预览模式，方便查看
  const [immersiveOpen, setImmersiveOpen] = useState(false);
  const readerOwnedFullscreen = useRef(false);
  const closeImmersive = useCallback((exitNative = true) => {
    setImmersiveOpen(false);
    if (exitNative && readerOwnedFullscreen.current && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    readerOwnedFullscreen.current = false;
  }, []);
  const openImmersive = () => {
    db.notes.update(nodeId, { text });
    setIsPreview(true);
    setImmersiveOpen(true);
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      readerOwnedFullscreen.current = true;
      document.documentElement.requestFullscreen().catch(() => { readerOwnedFullscreen.current = false; });
    }
  };
  useEffect(() => () => {
    if (readerOwnedFullscreen.current && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    readerOwnedFullscreen.current = false;
  }, []);

  const siblings = useLiveQuery(async () => {
    if (!note) return [];
    const items = await db.notes.where('parentId').equals(note.parentId).toArray();
    return items.filter(n => n.type === 'file').sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [note?.parentId]);

  const { prevId, nextId } = useMemo(() => {
    if (!siblings || siblings.length < 2) return { prevId: null, nextId: null };
    const idx = siblings.findIndex(n => n.id === nodeId);
    if (idx === -1) return { prevId: null, nextId: null };
    return { prevId: idx > 0 ? siblings[idx - 1].id : null, nextId: idx < siblings.length - 1 ? siblings[idx + 1].id : null };
  }, [siblings, nodeId]);

  // [修改] 初始化数据，加载 title 和 text
  useEffect(() => { 
    if(note) {
        setTitle(note.title); 
        // 只有当 text 有值且当前不在编辑状态时才更新，防止打字时光标跳动
        // 这里简单处理：切换笔记时更新 text
        setText(note.text || '');

        // 如果没有内容，默认进入编辑模式；有内容则默认预览
        if (note.text === undefined || note.text === '') {
            setIsPreview(false);
        }
    } 
  }, [note?.id]); // 依赖改为 note.id，避免每次输入触发重置

  if (!note) return <div className="p-10 text-center">加载中...</div>;

  const handleUpdate = (updates) => db.notes.update(nodeId, updates);

  // [新增] 保存文本内容
  const handleTextSave = () => {
    handleUpdate({ text });
  };

  const handleAddImage = async (e) => { const file = e.target.files[0]; if (!file) return; const base64 = await fileToBase64(file); const newContent = [...(note.content || []), { id: generateId(), src: base64, desc: '' }]; handleUpdate({ content: newContent }); };
  const handleDeleteImage = (imgId) => { handleUpdate({ content: note.content.filter(c => c.id !== imgId) }); }
  const handleAddTag = () => { if(!newTag.trim()) return; const tags = [...(note.tags || [])]; if(!tags.includes(newTag.trim())) { tags.push(newTag.trim()); handleUpdate({ tags }); } setNewTag(''); }
  const handleRemoveTag = (tag) => { handleUpdate({ tags: note.tags.filter(t => t !== tag) }); }
  const handleDeleteNote = async () => { if(confirm('确定删除此条目吗？')) { await db.notes.delete(nodeId); onBack(); } }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 顶部导航栏 */}
      <div className="p-4 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
        <div className="flex items-center gap-3 flex-1 mr-4 overflow-hidden">
           <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500" title="返回上一级">
             <ArrowUpLeft size={20}/>
           </button>

           <div className="flex-1">
             {editingTitle ? (
               <input autoFocus value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { setEditingTitle(false); handleUpdate({ title }); }} onKeyDown={e => { if(e.key === 'Enter') { setEditingTitle(false); handleUpdate({ title }); } }} className="text-xl font-bold w-full border-b border-blue-500 outline-none"/>
             ) : (
               <h2 onClick={() => setEditingTitle(true)} className="text-xl font-bold cursor-pointer hover:bg-gray-50 rounded px-2 -ml-2 truncate">{note.title}</h2>
             )}
             <div className="text-xs text-gray-400 mt-1 ml-1 flex items-center gap-2">{new Date(note.createdAt).toLocaleDateString()}</div>
           </div>
        </div>

        <div className="flex items-center gap-1 mr-2 bg-gray-100 p-1 rounded-lg">
            <button onClick={() => onNavigate(prevId)} disabled={!prevId} className="p-1.5 hover:bg-white hover:shadow-sm rounded-md disabled:opacity-30 transition-all text-gray-600"><ChevronLeft size={18}/></button>
            <div className="w-[1px] h-4 bg-gray-300"></div>
            <button onClick={() => onNavigate(nextId)} disabled={!nextId} className="p-1.5 hover:bg-white hover:shadow-sm rounded-md disabled:opacity-30 transition-all text-gray-600"><ChevronRight size={18}/></button>
        </div>
        <button onClick={onExport} title="导出含图片与公式的 .knote 笔记包" className="text-indigo-600 hover:bg-indigo-50 p-2 rounded-full"><Download size={20}/></button>
        <button onClick={handleDeleteNote} className="text-red-400 hover:bg-red-50 p-2 rounded-full"><Trash2 size={20}/></button>
      </div>

      {/* 标签栏 */}
      {note.type === 'file' && (
        <div className="px-6 py-2 flex flex-wrap items-center gap-2 border-b border-gray-50">
            <Tag size={14} className="text-gray-400"/>
            {note.tags?.map(tag => (<span key={tag} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded-full flex items-center gap-1 group">{tag}<X size={10} className="cursor-pointer opacity-0 group-hover:opacity-100" onClick={() => handleRemoveTag(tag)}/></span>))}
            <div className="flex items-center gap-1 bg-gray-50 rounded-full px-2 py-1"><input value={newTag} onChange={e => setNewTag(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddTag()} placeholder="添加标签..." className="bg-transparent text-xs w-20 outline-none"/><Plus size={12} className="cursor-pointer text-gray-400" onClick={handleAddTag}/></div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
         {/* [新增] Markdown 文本编辑/预览区域 */}
         <div className="space-y-2">
            <div className="flex justify-between items-center">
               <label className="text-sm font-bold text-gray-700 flex items-center gap-2">
                 <FileText size={16}/> 笔记内容
               </label>
               <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-bold">
                  <button onClick={() => setIsPreview(false)} className={cn("px-3 py-1 rounded-md transition-all", !isPreview ? "bg-white shadow text-blue-600" : "text-gray-500")}>编辑</button>
                  <button onClick={() => { setIsPreview(true); handleTextSave(); }} className={cn("px-3 py-1 rounded-md transition-all", isPreview ? "bg-white shadow text-blue-600" : "text-gray-500")}>预览</button>
                  <button type="button" onClick={openImmersive} title="沉浸式全屏阅读（Esc退出）" aria-label="沉浸式全屏阅读"
                    className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition">
                    <Maximize size={15}/><span className="hidden sm:inline">沉浸阅读</span>
                  </button>
               </div>
            </div>

            {isPreview ? (
              <div 
    className="w-full p-4 bg-white border border-gray-200 rounded-xl min-h-[120px] prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:bg-gray-100 prose-pre:text-gray-800 prose-code:text-gray-800 transition"
>
                 {text ? (
                   <MarkdownView assets={note.assets || {}}>{text}</MarkdownView>
                 ) : (
                   <span className="text-gray-400 italic flex items-center gap-1"><Edit size={14}/> 点击此处开始编写笔记 (支持 Markdown & LaTeX)...</span>
                 )}
              </div>
            ) : (
              <textarea 
                value={text} 
                onChange={e => setText(e.target.value)} 
                onBlur={handleTextSave} // 失去焦点自动保存
                className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl min-h-[300px] text-sm outline-none focus:border-blue-500 resize-y font-mono leading-relaxed" 
                placeholder="# 标题&#10;这是正文内容，支持 **加粗** 和 $E=mc^2$ 公式。&#10;&#10;```js&#10;console.log('代码高亮');&#10;```"
                autoFocus
              ></textarea>
            )}
         </div>

         {/* 原有的图片列表 (保留作为补充资料/截图区域) */}
         {note.content?.length > 0 && <div className="border-t border-gray-100 my-4"></div>}

         {note.content?.map((item, idx) => (
            <div key={item.id} className="group relative bg-gray-50 rounded-xl p-2 border border-gray-100">
                <img src={item.src} className="w-full rounded-lg" />
                <button onClick={() => handleDeleteImage(item.id)} className="absolute top-4 right-4 bg-red-500 text-white p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition"><Trash2 size={16}/></button>
                <textarea placeholder="给这张图写点备注..." className="w-full bg-transparent text-sm mt-2 p-2 outline-none resize-none h-10 focus:bg-white focus:h-20 transition-all rounded" defaultValue={item.desc} onBlur={(e) => { const newContent = [...note.content]; newContent[idx].desc = e.target.value; handleUpdate({ content: newContent }); }}/>
            </div>
         ))}

         <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 flex flex-col items-center justify-center text-gray-400 hover:bg-gray-50 hover:border-indigo-200 transition cursor-pointer relative">
            <ImageIcon size={32} className="mb-2"/>
            <span className="text-sm font-bold">添加补充截图</span>
            <input type="file" accept="image/*" onChange={handleAddImage} className="absolute inset-0 opacity-0 cursor-pointer"/>
         </div>
         <div className="h-20"></div>
      </div>
      {immersiveOpen && (
        <ImmersiveNoteReader
          noteId={nodeId}
          title={note.title}
          body={text ? <MarkdownView assets={note.assets || {}}>{text}</MarkdownView> : <p className="text-gray-400">此笔记暂无正文，请退出阅读后编辑。</p>}
          images={note.content || []}
          prevId={prevId}
          nextId={nextId}
          onNavigate={onNavigate}
          onClose={closeImmersive}
          nativeFullscreenRef={readerOwnedFullscreen}
        />
      )}
    </div>
  );
}

function MistakeThumb({ mistakeId, imageCount }) {
  const mistake = useLiveQuery(
    () => mistakeId ? db.mistakes.get(mistakeId) : null,
    [mistakeId]
  );

  const images = mistake?.questionImages || (mistake?.questionImg ? [mistake.questionImg] : []);
  const firstImg = images[0];

  if (!firstImg) {
    return (
      <div className="w-28 sm:w-40 md:w-48 h-28 sm:h-32 md:h-36 bg-gray-100 flex flex-col items-center justify-center text-gray-300 shrink-0">
        <ImageIcon size={20} />
        <span className="text-[10px] mt-1">{imageCount || 0}图</span>
      </div>
    );
  }

  return (
    <div className="w-28 sm:w-40 md:w-48 h-28 sm:h-32 md:h-36 bg-gray-50 overflow-hidden relative shrink-0">
      <img
        src={firstImg}
        alt=""
        loading="lazy"
        className="w-full h-full object-cover"
      />
      {imageCount > 1 && (
        <div className="absolute right-1 bottom-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
          +{imageCount - 1}
        </div>
      )}
    </div>
  );
}

function MistakeList({ mistakes, highlightedId, scrollRoot, onAdd, onOpen, onLoadMore, hasMore }) {
  const loaderRef = useRef(null);

  useEffect(() => {
    if (!hasMore || !loaderRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onLoadMore?.();
        }
      },
      { root: scrollRoot.current, rootMargin: '360px' }
    );

    observer.observe(loaderRef.current);

    return () => observer.disconnect();
  }, [hasMore, onLoadMore, mistakes?.length]);

  if (!mistakes) {
    return <div className="text-center mt-20 text-gray-400">加载数据中...</div>;
  }

  if (mistakes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center mt-10 text-gray-400 p-4">
        <div className="mb-4 p-4 bg-gray-200 rounded-full">
          <FileText size={32} />
        </div>
        <p className="mb-6 font-medium">没有找到相关错题</p>
        <button
          onClick={onAdd}
          className="bg-blue-600 text-white px-6 py-2 rounded-full font-bold shadow-lg hover:bg-blue-700 transition text-sm"
        >
          添加错题
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {mistakes.map((item) => (
        <div
  id={`mistake-card-${item.id}`}
  key={item.id}
  onClick={() => onOpen(item.id)}
  className={cn(
    "bg-white rounded-xl shadow-sm border active:scale-[0.98] transition-all cursor-pointer overflow-hidden flex",
    highlightedId === item.id
      ? "border-blue-500 ring-2 ring-blue-200 bg-blue-50/60"
      : "border-gray-200"
  )}
>
          <MistakeThumb mistakeId={item.id} imageCount={item.imageCount} />

          <div className="p-3 flex-1 min-w-0">
            <h3 className="font-bold text-gray-800 text-sm line-clamp-2 leading-relaxed">
              {item.title || '未命名'}
            </h3>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <span
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full font-medium border",
                  item.hasReflection
                    ? "bg-blue-50 text-blue-600 border-blue-100"
                    : "bg-gray-100 text-gray-400 border-gray-200"
                )}
              >
                {item.hasReflection ? '已复盘' : '待复盘'}
              </span>

              {item.reviewCount > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border bg-indigo-50 text-indigo-600 border-indigo-100 flex items-center gap-0.5">
                  <Calendar size={10} />
                  {item.reviewCount}次
                </span>
              )}

              {item.isMastered && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border bg-green-50 text-green-600 border-green-100 flex items-center gap-0.5">
                  <CheckCircle2 size={10} />
                  已掌握
                </span>
              )}

              {item.imageCount > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border bg-orange-50 text-orange-600 border-orange-100 flex items-center gap-0.5">
                  <ImageIcon size={10} />
                  {item.imageCount}图
                </span>
              )}

              {item.hasQuestionMarkdown && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border bg-sky-50 text-sky-700 border-sky-100">
                  Markdown 题目
                </span>
              )}

              {item.relatedQuestionCount > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border bg-violet-50 text-violet-700 border-violet-100">
                  举一反三 {item.relatedQuestionCount} 题
                </span>
              )}

              {item.hasAnalysis && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border bg-purple-50 text-purple-600 border-purple-100">
                  有解析
                </span>
              )}
            </div>

            <div className="mt-2 text-[10px] text-gray-400 font-medium">
              {new Date(item.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
              })}
            </div>
          </div>
        </div>
      ))}

      <div ref={loaderRef} className="py-6 text-center text-xs text-gray-400">
        {hasMore ? '继续下拉加载更多...' : '已经到底了'}
      </div>

      <button
        onClick={onAdd}
        className="fixed bottom-20 right-6 bg-blue-600 text-white p-4 rounded-full shadow-[0_4px_14px_rgba(37,99,235,0.4)] hover:bg-blue-700 active:scale-90 transition-all z-40"
      >
        <Plus size={26} strokeWidth={2.5} />
      </button>
    </div>
  );
}
// [修改] 接收 subjectId
function MistakeForm({ mode, initialData, onFinish, onCancel, onAddRelated, subjectId }) {
  const isEdit = mode === 'edit';
  const [title, setTitle] = useState(initialData?.title || '');
  const [questionMarkdown, setQuestionMarkdown] = useState(initialData?.questionMarkdown || '');

  const [qImages, setQImages] = useState(
    getQuestionImages(initialData)
  );

const [aImages, setAImages] = useState(
    initialData?.analysisImages || (initialData?.analysisImg ? [initialData.analysisImg] : [])
  );  const [reflection, setReflection] = useState(initialData?.reflection || '');
  const [analysisText, setAnalysisText] = useState(initialData?.analysisText || '');
  const [loading, setLoading] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isQuestionPreviewMode, setIsQuestionPreviewMode] = useState(false);
  const [isReflectionPreviewMode, setIsReflectionPreviewMode] = useState(false);

  const handleSubmit = async (addRelated = false) => {
      if (loading) return;
  if (qImages.length === 0 && !questionMarkdown.trim()) {
    return alert("请上传题目图片，或输入 Markdown 格式的题目内容");
  }

  setLoading(true);

  const now = new Date();

  const data = {
    title,
    questionImages: qImages,
    questionImg: qImages[0],
    questionMarkdown,
    analysisImages: aImages,
    analysisImg: aImages[0] || null,
    analysisText,
    reflection,
    updatedAt: now
  };

  try {
    if (isEdit) {
      await db.transaction('rw', db.mistakes, db.mistakeCards, async () => {
        await db.mistakes.update(initialData.id, data);

        const updatedMistake = await db.mistakes.get(initialData.id);
        await db.mistakeCards.put(buildMistakeCard(updatedMistake));
      });
    } else {
      await db.transaction('rw', db.mistakes, db.mistakeCards, db.reviewRoundItems, async () => {
        const id = await db.mistakes.add({
          ...data,
          subjectId,
          createdAt: now
        });

        const newMistake = await db.mistakes.get(id);
        await db.mistakeCards.put(buildMistakeCard(newMistake));
        await addFirstRoundMember(db, newMistake);
      });
    }

    if (addRelated === true && onAddRelated) onAddRelated();
    else onFinish();
  } catch (e) {
    alert("保存失败: " + e.message);
  } finally {
    setLoading(false);
  }
};

    useEffect(() => {
  const handleTopSave = () => {
    handleSubmit();
  };

  window.addEventListener('mistake-form-save', handleTopSave);

  return () => {
    window.removeEventListener('mistake-form-save', handleTopSave);
  };
}, [handleSubmit]);

  return (
    // ... 保持原有 JSX 渲染代码不变，完全一样 ...
    <div className="bg-white min-h-screen sm:min-h-0 sm:rounded-xl p-4 sm:p-6 pb-20 space-y-5 relative w-full max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-2">
         <h2 className="text-lg font-bold text-gray-800">{isEdit ? '编辑错题' : '记录错题'}</h2>
         {isEdit && <button onClick={onCancel}><X size={24} className="text-gray-400"/></button>}
      </div>
      <div className="space-y-4">
        <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">1. 题目图片 ({qImages.length})</label>
            <MultiImageUpload images={qImages} onChange={setQImages} />
        </div>

        <div>
          <div className="flex justify-between items-center mb-2 gap-3">
            <label className="block text-sm font-bold text-gray-700">
              题目 Markdown
              <span className="ml-2 text-xs font-normal text-gray-400">图片与 Markdown 至少填写一种</span>
            </label>
            <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-bold shrink-0">
              <button type="button" onClick={() => setIsQuestionPreviewMode(false)} className={cn("px-3 py-1 rounded-md transition-all", !isQuestionPreviewMode ? "bg-white shadow text-blue-600" : "text-gray-500")}>编辑</button>
              <button type="button" onClick={() => setIsQuestionPreviewMode(true)} className={cn("px-3 py-1 rounded-md transition-all", isQuestionPreviewMode ? "bg-white shadow text-blue-600" : "text-gray-500")}>预览</button>
            </div>
          </div>
          {isQuestionPreviewMode ? (
            <div className="w-full p-4 bg-blue-50/40 border border-blue-100 rounded-xl min-h-[180px] prose prose-sm max-w-none overflow-x-auto">
              {questionMarkdown.trim() ? <MarkdownView assets={initialData?.questionAssets || {}}>{questionMarkdown}</MarkdownView> : <span className="text-gray-400 italic">暂无 Markdown 题目内容...</span>}
            </div>
          ) : (
            <textarea
              value={questionMarkdown}
              onChange={e => setQuestionMarkdown(e.target.value)}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl min-h-[180px] text-sm outline-none focus:border-blue-500 resize-y font-mono"
              placeholder={'支持标准 Markdown、GFM 表格/任务列表、代码块、链接、图片，以及 LaTeX：$x^2$ 或 $$\\int_0^1 x\,dx$$'}
            />
          )}
        </div>

        <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">标题 / 备注</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：极限计算" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-500 transition" />
        </div>

        <div className="border-t border-dashed pt-4">
          <div className="flex justify-between items-center mb-2 gap-3">
            <label className="block text-sm font-bold text-gray-700">2. 我的复盘（Markdown）</label>
            <div className="flex bg-yellow-100/70 p-1 rounded-lg text-xs font-bold shrink-0">
              <button type="button" onClick={() => setIsReflectionPreviewMode(false)} className={cn("px-3 py-1 rounded-md transition-all", !isReflectionPreviewMode ? "bg-white shadow text-yellow-700" : "text-gray-500")}>编辑</button>
              <button type="button" onClick={() => setIsReflectionPreviewMode(true)} className={cn("px-3 py-1 rounded-md transition-all", isReflectionPreviewMode ? "bg-white shadow text-yellow-700" : "text-gray-500")}>预览</button>
            </div>
          </div>
          {isReflectionPreviewMode ? (
            <div className="w-full min-h-[160px] p-4 bg-yellow-50 border border-yellow-200 rounded-xl prose prose-sm max-w-none overflow-x-auto">
              {reflection.trim() ? <MarkdownView>{reflection}</MarkdownView> : <span className="text-gray-400 italic">暂无复盘内容...</span>}
            </div>
          ) : (
            <textarea
              value={reflection}
              onChange={e => setReflection(e.target.value)}
              className="w-full min-h-[160px] p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-sm outline-none focus:border-yellow-400 resize-y font-mono"
              placeholder="支持任意 Markdown：标题、列表、表格、代码块、链接、图片，以及 LaTeX 公式……"
            />
          )}
        </div>

        <div className="border-t border-dashed pt-4">
          <div className="flex justify-between items-center mb-2">
             <label className="block text-sm font-bold text-gray-700">3. 答案解析 (支持 LaTeX)</label>
             <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-bold">
                <button onClick={() => setIsPreviewMode(false)} className={cn("px-3 py-1 rounded-md transition-all", !isPreviewMode ? "bg-white shadow text-blue-600" : "text-gray-500")}>编辑</button>
                <button onClick={() => setIsPreviewMode(true)} className={cn("px-3 py-1 rounded-md transition-all", isPreviewMode ? "bg-white shadow text-blue-600" : "text-gray-500")}>预览</button>
             </div>
          </div>

<MultiImageUpload images={aImages} onChange={setAImages} />

          {isPreviewMode ? (
            <div className="w-full mt-3 p-4 bg-gray-50 border border-gray-200 rounded-xl min-h-[160px] prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2">
               {analysisText ? (
                 <MarkdownView assets={initialData?.analysisAssets || {}}>{analysisText}</MarkdownView>
               ) : (
                 <span className="text-gray-400 italic">暂无内容...</span>
               )}
            </div>
          ) : (
            <textarea 
              value={analysisText} 
              onChange={e => setAnalysisText(e.target.value)} 
              className="w-full mt-3 p-3 bg-gray-50 border border-gray-200 rounded-xl h-40 text-sm outline-none focus:border-green-500 resize-none font-mono" 
              placeholder="可以使用 Markdown 和 LaTeX 公式，例如：$E=mc^2$"
            ></textarea>
          )}
        </div>
      </div>
      {isEdit && onAddRelated && (
        <section className="rounded-xl border border-violet-100 bg-violet-50/50 p-4 space-y-3">
          <h3 className="font-bold text-gray-900">举一反三</h3>
          <p className="text-xs text-gray-500">已添加 {Array.isArray(initialData.relatedQuestions) ? initialData.relatedQuestions.length : 0} 道相关题</p>
          <button type="button" onClick={() => handleSubmit(true)} disabled={loading} className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"><Plus size={16}/> 保存并添加相关题</button>
        </section>
      )}
      <button onClick={handleSubmit} disabled={loading} className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-bold shadow-md mt-4 flex justify-center items-center gap-2"><Save size={18} /> {loading ? '保存中...' : '保存'}</button>
    </div>
  );
}

// --- [替换] 单图上传辅助组件 ---
function ImageUpload({ value, onChange, isAnalysis }) {
  const handleFile = async (e) => { const file = e.target.files[0]; if(file) onChange(await fileToBase64(file)); };
  return (
    <div className={cn("relative border-2 border-dashed rounded-xl h-32 flex items-center justify-center overflow-hidden bg-gray-50 transition", isAnalysis ? 'border-green-200' : 'border-blue-200')}>
      {!value ? <div className="flex flex-col items-center gap-1 text-gray-400"><Plus size={24} /> <span className="text-xs">点击上传</span><input type="file" accept="image/*" onChange={handleFile} className="absolute inset-0 opacity-0 cursor-pointer"/></div> : <div className="relative w-full h-full group"><img src={value} className="w-full h-full object-contain" /><button onClick={()=>onChange(null)} className="absolute top-2 right-2 p-1.5 bg-red-500/80 text-white rounded-full"><Trash2 size={14}/></button></div>}
    </div>
  )
}

function RelatedQuestionForm({ initialData, defaultTitle, onSave, onCancel, onDelete }) {
  const [title, setTitle] = useState(initialData?.title || defaultTitle || '举一反三题');
  const [questionMarkdown, setQuestionMarkdown] = useState(initialData?.questionMarkdown || '');
  const [questionImages, setQuestionImages] = useState(() => getQuestionImages(initialData));
  const [reflection, setReflection] = useState(initialData?.reflection || '');
  const [analysisText, setAnalysisText] = useState(initialData?.analysisText || '');
  const [analysisImages, setAnalysisImages] = useState(initialData?.analysisImages || []);
  const [questionPreview, setQuestionPreview] = useState(false);
  const [reflectionPreview, setReflectionPreview] = useState(false);
  const [analysisPreview, setAnalysisPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    if (!questionMarkdown.trim() && questionImages.length === 0) {
      alert('请上传题目图片，或输入 Markdown 格式的题目内容');
      return;
    }

    setSaving(true);
    try {
      const now = new Date();
      await onSave({
        ...initialData,
        id: initialData?.id || `related-${Date.now()}-${generateId()}`,
        title: title.trim() || defaultTitle || '举一反三题',
        questionMarkdown,
        questionImages,
        questionImg: questionImages[0] || null,
        reflection,
        analysisText,
        analysisImages,
        createdAt: initialData?.createdAt || now,
        updatedAt: now,
      });
    } catch (error) {
      console.error(error);
      alert(`保存相关题失败：${error.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white min-h-screen sm:min-h-0 sm:rounded-xl p-4 sm:p-6 pb-24 space-y-5 relative w-full max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{initialData ? '编辑相关题' : '添加举一反三题'}</h2>
          <p className="text-xs text-gray-400 mt-1">相关题保存在当前原题下，可在目录中随时切换。</p>
        </div>
        <button type="button" onClick={onCancel} className="p-2 rounded-lg bg-gray-100 text-gray-500"><X size={20}/></button>
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-700 mb-2">相关题标题</label>
        <input value={title} onChange={e => setTitle(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-blue-500" placeholder="例如：同类题 1｜换元积分变式" />
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-700 mb-2">题目图片（可选）</label>
        <MultiImageUpload images={questionImages} onChange={setQuestionImages}/>
      </div>

      <div>
        <div className="flex justify-between items-center mb-2 gap-3">
          <label className="text-sm font-bold text-gray-700">题目 Markdown</label>
          <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-bold">
            <button type="button" onClick={() => setQuestionPreview(false)} className={cn('px-3 py-1 rounded-md', !questionPreview ? 'bg-white shadow text-blue-600' : 'text-gray-500')}>编辑</button>
            <button type="button" onClick={() => setQuestionPreview(true)} className={cn('px-3 py-1 rounded-md', questionPreview ? 'bg-white shadow text-blue-600' : 'text-gray-500')}>预览</button>
          </div>
        </div>
        {questionPreview ? (
          <div className="min-h-[180px] p-4 bg-blue-50/40 border border-blue-100 rounded-xl prose prose-sm max-w-none overflow-x-auto">
            {questionMarkdown.trim() ? <MarkdownView>{questionMarkdown}</MarkdownView> : <span className="text-gray-400 italic">暂无 Markdown 题目内容...</span>}
          </div>
        ) : (
          <textarea value={questionMarkdown} onChange={e => setQuestionMarkdown(e.target.value)} className="w-full min-h-[180px] p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm outline-none focus:border-blue-500 resize-y" placeholder="支持标题、列表、表格、代码块、链接、图片、LaTeX 公式等 Markdown 内容" />
        )}
      </div>

      <div className="border-t border-dashed pt-4">
        <div className="flex justify-between items-center mb-2 gap-3">
          <label className="text-sm font-bold text-gray-700">我的复盘（Markdown）</label>
          <div className="flex bg-yellow-100/70 p-1 rounded-lg text-xs font-bold shrink-0">
            <button type="button" onClick={() => setReflectionPreview(false)} className={cn('px-3 py-1 rounded-md', !reflectionPreview ? 'bg-white shadow text-yellow-700' : 'text-gray-500')}>编辑</button>
            <button type="button" onClick={() => setReflectionPreview(true)} className={cn('px-3 py-1 rounded-md', reflectionPreview ? 'bg-white shadow text-yellow-700' : 'text-gray-500')}>预览</button>
          </div>
        </div>
        {reflectionPreview ? (
          <div className="min-h-[150px] p-4 bg-yellow-50 border border-yellow-200 rounded-xl prose prose-sm max-w-none overflow-x-auto">
            {reflection.trim() ? <MarkdownView>{reflection}</MarkdownView> : <span className="text-gray-400 italic">暂无复盘内容...</span>}
          </div>
        ) : (
          <textarea
            value={reflection}
            onChange={e => setReflection(e.target.value)}
            className="w-full min-h-[150px] p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-sm outline-none focus:border-yellow-400 resize-y font-mono"
            placeholder="支持任意 Markdown：标题、列表、表格、代码块、链接、图片，以及 LaTeX 公式……"
          />
        )}
      </div>

      <div className="border-t border-dashed pt-4">
        <div className="flex justify-between items-center mb-2 gap-3">
          <label className="text-sm font-bold text-gray-700">答案解析</label>
          <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-bold">
            <button type="button" onClick={() => setAnalysisPreview(false)} className={cn('px-3 py-1 rounded-md', !analysisPreview ? 'bg-white shadow text-green-600' : 'text-gray-500')}>编辑</button>
            <button type="button" onClick={() => setAnalysisPreview(true)} className={cn('px-3 py-1 rounded-md', analysisPreview ? 'bg-white shadow text-green-600' : 'text-gray-500')}>预览</button>
          </div>
        </div>
        <MultiImageUpload images={analysisImages} onChange={setAnalysisImages}/>
        {analysisPreview ? (
          <div className="min-h-[160px] mt-3 p-4 bg-gray-50 border border-gray-200 rounded-xl prose prose-sm max-w-none overflow-x-auto">
            {analysisText.trim() ? <MarkdownView>{analysisText}</MarkdownView> : <span className="text-gray-400 italic">暂无文字解析...</span>}
          </div>
        ) : (
          <textarea value={analysisText} onChange={e => setAnalysisText(e.target.value)} className="w-full min-h-[160px] mt-3 p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm outline-none focus:border-green-500 resize-y" placeholder="支持 Markdown 与 LaTeX" />
        )}
      </div>

      <div className="flex gap-3">
        {initialData && onDelete && (
          <button type="button" onClick={onDelete} className="px-4 py-3.5 rounded-xl font-bold text-red-600 bg-red-50 hover:bg-red-100 flex items-center gap-2"><Trash2 size={18}/> 删除</button>
        )}
        <button type="button" onClick={submit} disabled={saving} className="flex-1 bg-blue-600 text-white py-3.5 rounded-xl font-bold shadow-md flex justify-center items-center gap-2 disabled:opacity-60"><Save size={18}/>{saving ? '保存中...' : '保存相关题'}</button>
      </div>
    </div>
  );
}

function getQuestionImages(question) {
  const images = Array.isArray(question?.questionImages)
    ? question.questionImages.filter(image => typeof image === 'string' && image.trim())
    : [];
  if (images.length > 0) return images;
  return typeof question?.questionImg === 'string' && question.questionImg.trim() ? [question.questionImg] : [];
}

// 原题、相关题和悬浮面板统一：有图片只展示图片，无图片才展示 Markdown。
function QuestionContent({ question }) {
  const images = getQuestionImages(question);
  return (
    <div className="space-y-3">
      {images.length === 0 && question.questionMarkdown?.trim() && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-4 sm:p-5 overflow-x-auto prose prose-sm sm:prose-base max-w-none">
          <MarkdownView assets={question.questionAssets || {}}>{question.questionMarkdown}</MarkdownView>
        </div>
      )}
      <div className="space-y-2">
        {images.map((img, idx) => (
          <div key={idx} className="rounded-xl overflow-hidden border border-gray-100 shadow-sm relative">
            <img src={img} alt={`题目 ${idx + 1}`} className="w-full"/>
            {images.length > 1 && <div className="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded-full backdrop-blur-md">{idx + 1}/{images.length}</div>}
          </div>
        ))}
        {images.length === 0 && !question.questionMarkdown?.trim() && <div className="p-8 text-center text-gray-300 bg-gray-50 rounded-xl">暂无题目内容</div>}
      </div>
    </div>
  );
}

function QuestionPeek({ question }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef(null);
  const contentId = useId();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = event => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setOpen(false);
        toggleRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return createPortal(
    <aside
      data-question-peek
      aria-label="悬浮题目"
      className="fixed right-4 z-50 rounded-2xl border border-blue-200 bg-white shadow-xl overflow-hidden"
      style={{ top: 'calc(72px + env(safe-area-inset-top, 0px))', width: open ? 'min(780px, calc(100% - 32px))' : undefined }}
    >
      <div className="flex items-center gap-3 p-2">
        {open && <span className="min-w-0 flex-1 truncate pl-2 text-sm font-bold text-gray-800">{question.title || '当前题目'}</span>}
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen(value => !value)}
          className="flex items-center gap-1.5 shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <FileText size={17}/>
          {open ? '收起题目' : '显示题目'}
          {open ? <ChevronDown size={16} className="rotate-180"/> : <ChevronDown size={16}/>}
        </button>
      </div>
      <div
        id={contentId}
        hidden={!open}
        role="region"
        aria-label="当前题目内容"
        tabIndex={open ? 0 : -1}
        className="overflow-auto overscroll-contain border-t border-blue-100 p-3 sm:p-4"
        style={{ maxHeight: '45vh', WebkitOverflowScrolling: 'touch' }}
      >
        {open && <QuestionContent question={question}/>}
      </div>
    </aside>,
    document.body
  );
}

// --- 错题详情：原题 + 举一反三相关题目录 ---
function MistakeDetail({ mistake, reviewRoundNo, initialAddRelated = false, onRelatedRequestConsumed, onRemoveFromRound, onEdit, onNext, hasNext, onPrev, hasPrev, onBack }) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [selectedRelatedId, setSelectedRelatedId] = useState(null);
  const [relatedEditor, setRelatedEditor] = useState(() => initialAddRelated ? { mode: 'add' } : null);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const decisionLock = useRef(false);
  const currentRound = Number(reviewRoundNo) || 1;
  const nextRound = currentRound + 1;
  const inNextRound = useLiveQuery(() => isMistakeInReviewRound(db, {
    subjectId: mistake.subjectId, roundNo: nextRound, mistakeId: mistake.id,
  }), [mistake.subjectId, nextRound, mistake.id]);
  const relatedQuestions = Array.isArray(mistake.relatedQuestions) ? mistake.relatedQuestions : [];
  const activeRelated = relatedQuestions.find(item => item.id === selectedRelatedId) || null;
  const activeQuestion = activeRelated || mistake;
  const isOriginal = !activeRelated;

  useEffect(() => {
    setShowAnalysis(false);
    setSelectedRelatedId(null);
  }, [mistake.id]);

  useEffect(() => {
    if (initialAddRelated) onRelatedRequestConsumed?.();
  }, [initialAddRelated, onRelatedRequestConsumed]);

  useEffect(() => {
    setShowAnalysis(false);
  }, [selectedRelatedId]);

  useEffect(() => {
    if (selectedRelatedId && !relatedQuestions.some(item => item.id === selectedRelatedId)) {
      setSelectedRelatedId(null);
    }
  }, [relatedQuestions, selectedRelatedId]);

  useEffect(() => {
    const editCurrentQuestion = () => {
      if (activeRelated) setRelatedEditor({ mode: 'edit', question: activeRelated });
      else onEdit();
    };
    window.addEventListener('mistake-detail-edit', editCurrentQuestion);
    return () => window.removeEventListener('mistake-detail-edit', editCurrentQuestion);
  }, [activeRelated, onEdit]);

  const saveRelatedQuestion = async (question) => {
    const current = Array.isArray(mistake.relatedQuestions) ? mistake.relatedQuestions : [];
    const index = current.findIndex(item => item.id === question.id);
    const next = [...current];
    if (index >= 0) next[index] = question;
    else next.push(question);

    await db.mistakes.update(mistake.id, { relatedQuestions: next, updatedAt: new Date() });
    await refreshMistakeCard(db, mistake.id);
    setSelectedRelatedId(question.id);
    setRelatedEditor(null);
  };

  const deleteRelatedQuestion = async (questionId) => {
    if (!confirm('确定删除这道相关题吗？删除后无法恢复。')) return;
    const next = relatedQuestions.filter(item => item.id !== questionId);
    await db.mistakes.update(mistake.id, { relatedQuestions: next, updatedAt: new Date() });
    await refreshMistakeCard(db, mistake.id);
    setSelectedRelatedId(null);
    setRelatedEditor(null);
  };

  const handleRemoveFromRound = async () => {
    const roundNo = Number(reviewRoundNo) || 1;
    const roundName = roundNo === 1 ? '第一轮刷题' : `第${roundNo}轮刷题`;

    if (!confirm(`确定从“${roundName}”永久移除本轮的这道题吗？\n\n将真实删除本轮的题目成员记录，不是暂时隐藏。其他轮次不受影响；若该题不属于任何其他轮次，原题、图片和解析也会永久删除。再次导入将创建新题。`)) return;

    try {
      const result = await removeMistakeFromReviewRound(db, {
        subjectId: mistake.subjectId,
        roundNo,
        mistakeId: mistake.id,
        title: mistake.title || '未命名错题',
      });

      if (roundNo > 1 && result.remainingInRound === 0) {
        const remainingItems = await db.reviewRoundItems.where('subjectId').equals(mistake.subjectId).toArray();
        const highestRound = remainingItems.reduce((highest, item) => Math.max(highest, Number(item.roundNo) || 1), 1);
        if (highestRound < roundNo) setSelectedReviewRound(mistake.subjectId, highestRound);
      }

      const progressKey = getLastReviewProgressKey(mistake.subjectId, roundNo);
      try {
        const progress = JSON.parse(localStorage.getItem(progressKey) || 'null');
        if (String(progress?.mistakeId) === String(mistake.id)) localStorage.removeItem(progressKey);
      } catch {
        localStorage.removeItem(progressKey);
      }
      localStorage.removeItem('mathNotebook.activeMistakeId');
      localStorage.removeItem('mathNotebook.pendingOpenMistake');
      onRemoveFromRound();
    } catch (error) {
      console.error(error);
      alert(`移出本轮失败：${error.message || error}`);
    }
  };

  const handleReviewDecision = async action => {
    if (decisionLock.current) return;
    decisionLock.current = true;
    setDecisionSaving(true);
    try {
      const current = await db.mistakes.get(mistake.id);
      if (current) await action(current, currentRound);
    } catch (error) {
      console.error(error);
      alert('操作失败，请重试');
    } finally {
      decisionLock.current = false;
      setDecisionSaving(false);
    }
  };

  if (relatedEditor) {
    return (
      <RelatedQuestionForm
        initialData={relatedEditor.mode === 'edit' ? relatedEditor.question : null}
        defaultTitle={`举一反三 ${relatedQuestions.length + 1}`}
        onSave={saveRelatedQuestion}
        onCancel={() => setRelatedEditor(null)}
        onDelete={relatedEditor.mode === 'edit' ? () => deleteRelatedQuestion(relatedEditor.question.id) : null}
      />
    );
  }

  const analysisImages = activeQuestion.analysisImages || (activeQuestion.analysisImg ? [activeQuestion.analysisImg] : []);
  const createdAt = activeQuestion.createdAt || mistake.createdAt;

  return (
    <div className="bg-white min-h-screen sm:min-h-0 sm:rounded-xl pb-24 overflow-hidden relative">
      {showAnalysis && <QuestionPeek key={`${mistake.id}:${selectedRelatedId || 'original'}`} question={activeQuestion}/>}
      <div className="p-4 border-b border-gray-100 flex justify-between items-start bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition shrink-0" title="返回列表"><Home size={20}/></button>
          <div className="min-w-0">
            <h2 className="font-bold text-lg text-gray-900 leading-snug truncate">{activeQuestion.title || (isOriginal ? '题目详情' : '举一反三题')}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-xs text-gray-400">{new Date(createdAt).toLocaleString()}</p>
              {!isOriginal && <span className="text-[10px] bg-violet-50 text-violet-700 px-1.5 rounded border border-violet-200">相关题</span>}
              {isOriginal && mistake.isMastered && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 rounded border border-green-200">已掌握</span>}
              {isOriginal && <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 rounded border border-indigo-100 flex items-center gap-1"><Calendar size={10}/> 复盘 {getReviewCount(mistake.reviewLogs)} 天</span>}
            </div>
          </div>
        </div>
        <button onClick={() => isOriginal ? onEdit() : setRelatedEditor({ mode: 'edit', question: activeRelated })} className="p-2 bg-gray-50 text-blue-600 rounded-lg hover:bg-blue-50 shrink-0" title={isOriginal ? '编辑原题' : '编辑相关题'}><Edit size={18}/></button>
      </div>

      <div className="p-4 space-y-6">
        {relatedQuestions.length > 0 && <section className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/70 to-blue-50/60 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="font-bold text-gray-900 flex items-center gap-2"><FileText size={18} className="text-violet-600"/> 举一反三题目目录</h3>
              <p className="text-xs text-gray-500 mt-1">当前原题下共 {relatedQuestions.length} 道相关题，点击即可切换。</p>
            </div>
            <button onClick={() => setRelatedEditor({ mode: 'add' })} className="px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm hover:bg-violet-700 shrink-0"><Plus size={16}/> 添加相关题</button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button onClick={() => setSelectedRelatedId(null)} className={cn('px-4 py-2.5 rounded-xl border text-sm font-bold whitespace-nowrap transition', isOriginal ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300')}>原题</button>
            {relatedQuestions.map((item, index) => (
              <button key={item.id} onClick={() => setSelectedRelatedId(item.id)} className={cn('px-4 py-2.5 rounded-xl border text-sm font-bold whitespace-nowrap transition max-w-[240px] truncate', selectedRelatedId === item.id ? 'bg-violet-600 text-white border-violet-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300')} title={item.title || `相关题 ${index + 1}`}>
                {index + 1}. {item.title || `相关题 ${index + 1}`}
              </button>
            ))}
          </div>
        </section>}

        <QuestionContent question={activeQuestion}/>

        <div className="math-detail-toolbar" data-review-toolbar="fixed" role="toolbar" aria-label="题目操作">
          <button type="button" onClick={onPrev} disabled={!isOriginal || !hasPrev} className="math-toolbar-prev bg-blue-50 text-blue-600" title="上一题" aria-label="上一题"><ChevronLeft size={24}/></button>
          <button type="button" onClick={() => isOriginal ? handleReviewDecision(toggleReviewMastered) : setRelatedEditor({ mode: 'edit', question: activeRelated })} disabled={decisionSaving} aria-pressed={isOriginal ? Boolean(mistake.isMastered) : undefined} className={cn('math-toolbar-mastered', isOriginal && mistake.isMastered ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600')} title={isOriginal ? (mistake.isMastered ? '再次点击取消掌握标记' : '标记掌握') : '编辑相关题'}>
            {isOriginal ? (mistake.isMastered ? <><CheckCircle2 size={17}/> 已掌握</> : <><Circle size={17}/> 标记掌握</>) : <><Edit size={17}/> 编辑相关题</>}
          </button>
          <button type="button" onClick={() => setShowAnalysis(value => !value)} className={cn('math-toolbar-analysis', showAnalysis ? 'bg-gray-100 text-gray-700' : 'bg-blue-600 text-white')}>
            {showAnalysis ? <><EyeOff size={18}/> 遮住答案</> : <><Eye size={18}/> 查看解析</>}
          </button>
          <button type="button" onClick={() => handleReviewDecision(toggleNextRound)} disabled={!isOriginal || !showAnalysis || decisionSaving || inNextRound === undefined} aria-pressed={Boolean(inNextRound)} className={cn('math-toolbar-round', inNextRound ? 'bg-blue-100 text-blue-700' : 'bg-blue-600 text-white')} title={!showAnalysis ? '查看解析后可操作' : inNextRound ? `取消加入第${nextRound}轮` : `加入第${nextRound}轮`}>
            {inNextRound ? '取消加入' : '加入'}第{nextRound}轮
          </button>
          <button type="button" onClick={onNext} disabled={!isOriginal || !hasNext} className="math-toolbar-next bg-blue-50 text-blue-600" title="下一题" aria-label="下一题"><ChevronRight size={24}/></button>
          <button type="button" onClick={handleRemoveFromRound} disabled={!isOriginal || decisionSaving} className="math-toolbar-remove bg-red-50 text-red-500" title={`永久删除第${currentRound}轮成员记录；其他轮次保留，若无其他轮次则连原题一并删除`}><ListX size={17}/> 移出本轮</button>
        </div>

        <div className={cn('space-y-4 transition-all duration-300', showAnalysis ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden')}>
          <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200 text-sm">
            <div className="font-bold text-yellow-800 mb-1 flex items-center gap-1">💡 我的复盘</div>
            <div className="text-gray-800 leading-relaxed prose prose-sm max-w-none overflow-x-auto prose-p:my-1 prose-headings:my-2 prose-pre:bg-yellow-100/60 prose-pre:text-gray-800 prose-code:text-gray-800">
              <MarkdownView>{activeQuestion.reflection || '暂无复盘记录'}</MarkdownView>
            </div>
          </div>
          <div className="bg-white p-4 rounded-xl border-l-4 border-green-500 shadow-sm">
            <div className="font-bold text-green-700 mb-2 text-sm">标准解析</div>
            <div className="space-y-2 mb-3">
              {analysisImages.map((img, idx) => (
                <div key={idx} className="rounded-lg overflow-hidden border border-gray-100 relative shadow-sm">
                  <img src={img} alt={`解析图片 ${idx + 1}`} className="w-full"/>
                  {analysisImages.length > 1 && <div className="absolute top-2 left-2 bg-green-600/80 text-white text-xs px-2 py-0.5 rounded-full backdrop-blur-md">{idx + 1}</div>}
                </div>
              ))}
            </div>
            <div className="mistake-rich-analysis text-gray-700 leading-relaxed prose max-w-none overflow-x-auto">
              <MarkdownView assets={activeQuestion.analysisAssets || {}}>{activeQuestion.analysisText || '暂无文字解析'}</MarkdownView>
            </div>
          </div>
          <div className="h-20"/>
        </div>
      </div>
    </div>
  );
}

// --- [新增] 多图上传组件 ---
function MultiImageUpload({ images = [], onChange, max = 9 }) {
  const handleFile = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    // 限制数量
    if (images.length + files.length > max) {
      alert(`最多只能上传 ${max} 张图片`);
      return;
    }

    const base64Promises = files.map(fileToBase64);
    const newImages = await Promise.all(base64Promises);
    onChange([...images, ...newImages]);
  };

  const removeImage = (index) => {
    const newImages = [...images];
    newImages.splice(index, 1);
    onChange(newImages);
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      {images.map((img, idx) => (
        <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 group">
          <img src={img} className="w-full h-full object-cover" />
          <button 
            onClick={() => removeImage(idx)}
            className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X size={12} />
          </button>
          <div className="absolute bottom-1 right-1 bg-black/50 text-white text-[10px] px-1.5 rounded-full backdrop-blur-sm">
            {idx + 1}
          </div>
        </div>
      ))}

      {images.length < max && (
        <div className="relative aspect-square border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:bg-gray-50 hover:border-blue-300 transition cursor-pointer">
          <Plus size={24} />
          <span className="text-xs mt-1">添加图片</span>
          <input 
            type="file" 
            accept="image/*" 
            multiple // 允许选择多张
            onChange={handleFile} 
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </div>
      )}
    </div>
  );
}

// --- [修复版] 可拖拽项：分离拖拽与菜单逻辑 ---
function SortableGridItem({ item, isSelectionMode, isSelected, onClick, onMenuClick, onContextMenu, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      // dnd-kit 的 listeners 绑定在主容器上，负责长按拖拽
      {...attributes}
      {...listeners}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "group p-4 rounded-xl border cursor-pointer transition-all flex flex-col items-center gap-3 text-center relative select-none touch-manipulation",
        isSelectionMode && isSelected ? "bg-blue-50 border-blue-300 ring-2 ring-blue-200" : "hover:bg-gray-50 border-transparent hover:border-gray-200",
        isSelectionMode && !isSelected && "opacity-60 grayscale",
        isDragging && "shadow-2xl scale-105 bg-white ring-2 ring-blue-500 z-50"
      )}
    >
      {/* [关键] 独立的菜单触发按钮 (右上角三点) */}
      {!isSelectionMode && (
        <button
          onClick={(e) => {
            e.stopPropagation(); // 阻止冒泡，防止触发点击进入
            // 阻止 dnd-kit 捕获此按钮的按下事件，防止误触发拖拽
            onMenuClick(e);
          }}
          // 这里使用 onPointerDown 阻止冒泡，确保点击按钮时绝对不会触发拖拽
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-1 right-1 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-20"
        >
          <MoreVertical size={16} />
        </button>
      )}

      {/* 选择模式下的勾选框 */}
      {isSelectionMode && (
        <div className="absolute top-2 right-2 text-blue-500 z-20">
          {isSelected ? <CheckCircle2 size={20} fill="white"/> : <Circle size={20} className="text-gray-300"/>}
        </div>
      )}

      {children}
    </div>
  );
}
export default App;
