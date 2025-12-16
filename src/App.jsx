import React, { useState, useMemo, useEffect } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import { 
  Plus, Maximize, ArrowLeft, Eye, EyeOff, Trash2, Save, Edit, X, Search, ChevronRight, 
  Folder, FileText, ChevronDown, ChevronRight as ChevronRightIcon, GripVertical, Image as ImageIcon, Tag, 
  ArrowUpLeft, ArrowRightSquare, PanelLeftClose, PanelLeftOpen, 
  MoreVertical, // [关键] 菜单按钮图标
  CheckSquare, Copy, Scissors, Clipboard, CheckCircle2, Circle,
  Home, ChevronLeft, ArrowDownUp, Calendar
} from 'lucide-react';

import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragOverlay, useDndMonitor, pointerWithin } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

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
const APP_VERSION = "v3.4.0 (稳定修复版)";

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
  
  // [新增] 科目管理逻辑
  const subjects = useLiveQuery(() => db.subjects.toArray()) || [];
  const [activeSubjectId, setActiveSubjectId] = useState(null);

  // 初始化：如果没有选中科目且加载了科目列表，默认选中第一个
  useEffect(() => {
    if (!activeSubjectId && subjects.length > 0) {
      setActiveSubjectId(subjects[0].id);
    }
  }, [subjects, activeSubjectId]);

  // 初始化：如果是全新安装（无科目），自动创建默认科目
  useEffect(() => {
    const initDB = async () => {
      if (await db.subjects.count() === 0) {
        await db.subjects.bulkAdd([{ name: '数学' }, { name: '408' }]);
      }
    };
    initDB();
  }, []);

  const handleAddSubject = async () => {
    const name = prompt("请输入新科目名称（如：英语、政治）：");
    if (name && name.trim()) {
      const id = await db.subjects.add({ name: name.trim() });
      setActiveSubjectId(id); // 自动切换到新科目
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
      {/* 顶部通栏 - [修改] 支持科目切换 */}
      <nav className="bg-white shadow-sm px-4 py-3 z-30 flex justify-between items-center border-b border-gray-200 shrink-0 gap-4">
        {activeTab === 'mistakes' ? (
          <div className="flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar mask-gradient pr-2">
            {subjects.map(sub => (
              <button 
                key={sub.id} 
                onClick={() => setActiveSubjectId(sub.id)}
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
        
        <button onClick={toggleFullScreen} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 shrink-0">
          <Maximize size={20} />
        </button>
      </nav>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'mistakes' ? (
          /* [修改] 传递当前科目ID */
          <MistakeSystem subjectId={activeSubjectId} />
        ) : (
          <NoteSystem />
        )}
      </div>

      {/* 底部导航栏 */}
      <div className="bg-white border-t border-gray-200 p-2 flex justify-around items-center shrink-0 safe-area-bottom pb-4 z-40">
        <button onClick={() => setActiveTab('mistakes')} className={cn("flex flex-col items-center gap-1 p-2 rounded-xl transition-all w-24", activeTab === 'mistakes' ? "text-blue-600 bg-blue-50" : "text-gray-400 hover:bg-gray-50")}>
          <div className="relative"><Edit size={24} strokeWidth={activeTab === 'mistakes' ? 2.5 : 2} /></div>
          <span className="text-[10px] font-bold">错题本</span>
        </button>
        <button onClick={() => setActiveTab('notes')} className={cn("flex flex-col items-center gap-1 p-2 rounded-xl transition-all w-24", activeTab === 'notes' ? "text-indigo-600 bg-indigo-50" : "text-gray-400 hover:bg-gray-50")}>
          <Folder size={24} strokeWidth={activeTab === 'notes' ? 2.5 : 2} />
          <span className="text-[10px] font-bold">知识库</span>
        </button>
      </div>
    </div>
  );
}

// [修改] 接收 subjectId 参数
function MistakeSystem({ subjectId }) {
  const [view, setView] = useState('list'); 
  const [currentMistakeId, setCurrentMistakeId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // [关键修改] 根据 subjectId 过滤错题
  const mistakes = useLiveQuery(() => {
    if (!subjectId) return [];
    return db.mistakes
      .where('subjectId').equals(subjectId)
      .reverse()
      .sortBy('createdAt');
  }, [subjectId]);

  const currentMistake = useLiveQuery(() => currentMistakeId ? db.mistakes.get(currentMistakeId) : null, [currentMistakeId]);

  // 下面逻辑基本不变，只是依赖项变了
  const filteredMistakes = useMemo(() => {
    if (!mistakes) return [];
    if (!searchQuery) return mistakes;
    const lowerQuery = searchQuery.toLowerCase();
    return mistakes.filter(m => {
      const dateStr = new Date(m.createdAt).toLocaleDateString();
      const title = m.title || "";
      return title.toLowerCase().includes(lowerQuery) || dateStr.includes(lowerQuery);
    });
  }, [mistakes, searchQuery]);

  // 上一题/下一题逻辑（保持不变，省略部分重复代码，直接使用之前的逻辑即可，核心是 filteredMistakes 已经变了）
  const handleNextMistake = () => {
    if (!mistakes || !currentMistakeId) return;
    const listToUse = searchQuery ? filteredMistakes : mistakes;
    const currentIndex = listToUse.findIndex(m => m.id === currentMistakeId);
    if (currentIndex !== -1 && currentIndex < listToUse.length - 1) {
      setCurrentMistakeId(listToUse[currentIndex + 1].id);
    } else {
      alert("已经是最后一题了");
    }
  };

  const handlePrevMistake = () => {
    if (!mistakes || !currentMistakeId) return;
    const listToUse = searchQuery ? filteredMistakes : mistakes;
    const currentIndex = listToUse.findIndex(m => m.id === currentMistakeId);
    if (currentIndex > 0) {
      setCurrentMistakeId(listToUse[currentIndex - 1].id);
    } else {
      alert("已经是第一题了");
    }
  };

  const hasNext = useMemo(() => {
    if (!mistakes || !currentMistakeId) return false;
    const listToUse = searchQuery ? filteredMistakes : mistakes;
    const currentIndex = listToUse.findIndex(m => m.id === currentMistakeId);
    return currentIndex !== -1 && currentIndex < listToUse.length - 1;
  }, [mistakes, filteredMistakes, currentMistakeId, searchQuery]);

  const hasPrev = useMemo(() => {
    if (!mistakes || !currentMistakeId) return false;
    const listToUse = searchQuery ? filteredMistakes : mistakes;
    const currentIndex = listToUse.findIndex(m => m.id === currentMistakeId);
    return currentIndex > 0;
  }, [mistakes, filteredMistakes, currentMistakeId, searchQuery]);

  // 如果没有选中科目（比如加载中），显示提示
  if (!subjectId) return <div className="h-full flex items-center justify-center text-gray-400">正在加载科目...</div>;

  return (
    <div className="h-full overflow-y-auto bg-gray-100 pb-20">
      {view === 'list' && (
        <div className="max-w-3xl mx-auto p-3 space-y-3">
           <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search size={18} className="text-gray-400" /></div>
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索错题..." className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm transition"/>
            </div>
            {/* [修改] 传递 subjectId 给 Form */}
            <MistakeList mistakes={filteredMistakes} onAdd={() => setView('add')} onOpen={(id) => { setCurrentMistakeId(id); setView('detail'); }} />
            <div className="text-center py-4 text-gray-400 text-xs font-mono opacity-60">Build: {APP_VERSION}</div>
        </div>
      )}
      {/* [修改] 传递 subjectId 给 Add Form */}
      {view === 'add' && <MistakeForm mode="add" subjectId={subjectId} onFinish={() => setView('list')} onCancel={() => setView('list')} />}
      
      {view === 'detail' && currentMistake && (
        <MistakeDetail 
          mistake={currentMistake} 
          hasNext={hasNext} 
          onNext={handleNextMistake} 
          hasPrev={hasPrev} 
          onPrev={handlePrevMistake} 
          onDelete={() => setView('list')} 
          onEdit={() => setView('edit')} 
          onBack={() => setView('list')} 
        />
      )}
      
      {view === 'edit' && currentMistake && (
        <MistakeForm mode="edit" initialData={currentMistake} onFinish={() => setView('detail')} onCancel={() => setView('detail')} />
      )}
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
  const [clipboard, setClipboard] = useState({ items: [], mode: 'copy' });

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
      <div className={cn("bg-gray-50 border-r border-gray-200 flex flex-col transition-all duration-300 absolute md:relative z-20 h-full shadow-lg md:shadow-none", !mobileMenuOpen && "-translate-x-full md:translate-x-0", isSidebarExpanded ? "w-96" : "w-64")}>
        <div className="p-3 border-b border-gray-200 flex gap-2 items-center">
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full text-xs bg-white border rounded px-2 py-1.5 focus:outline-blue-500" placeholder="搜索..." />
          <button onClick={() => setIsSidebarExpanded(!isSidebarExpanded)} className="hidden md:flex p-1.5 hover:bg-gray-200 rounded text-gray-500 transition"><PanelLeftClose size={16}/></button>
          <button onClick={() => setMobileMenuOpen(false)} className="md:hidden"><X size={16}/></button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-auto p-2">
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
        <div className="p-3 border-t border-gray-200 grid grid-cols-2 gap-2 shrink-0 bg-gray-50">
           <button onClick={() => handleCreate('folder', 'root')} className="flex items-center justify-center gap-1 bg-white border border-gray-300 rounded py-2 text-xs font-bold hover:bg-gray-100"><Folder size={14}/> 根文件夹</button>
           <button onClick={() => handleCreate('file', 'root')} className="flex items-center justify-center gap-1 bg-blue-600 text-white rounded py-2 text-xs font-bold hover:bg-blue-700"><FileText size={14}/> 根知识点</button>
        </div>
      </div>

      <div className="flex-1 h-full overflow-hidden flex flex-col relative bg-white">
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
            <NoteEditor nodeId={selectedNodeId} onNavigate={setSelectedNodeId} onBack={() => setMobileMenuOpen(true)} />
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
function NoteEditor({ nodeId, onBack, onNavigate }) {
  const note = useLiveQuery(() => db.notes.get(nodeId), [nodeId]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [newTag, setNewTag] = useState('');

  // [新增] 文本编辑相关状态
  const [text, setText] = useState('');
  const [isPreview, setIsPreview] = useState(true); // 默认开启预览模式，方便查看
  
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
               </div>
            </div>

            {isPreview ? (
              <div 
                  className="w-full p-4 bg-white border border-gray-200 rounded-xl min-h-[120px] prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:bg-gray-100 cursor-text hover:border-blue-300 transition"
                  onClick={() => setIsPreview(false)} // 点击即进入编辑模式，体验流畅
                  title="点击编辑"
              >
                 {text ? (
                   <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                     {text}
                   </ReactMarkdown>
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
    </div>
  );
}

// --- [修改版] 错题列表：显示复盘次数和熟练度 ---
function MistakeList({ mistakes, onAdd, onOpen }) {
  if (!mistakes) return <div className="text-center mt-20 text-gray-400">加载数据中...</div>;
  if (mistakes.length === 0) return <div className="flex flex-col items-center justify-center mt-10 text-gray-400 p-4"><div className="mb-4 p-4 bg-gray-200 rounded-full">📝</div><p className="mb-6 font-medium">没有找到相关错题</p><button onClick={onAdd} className="bg-blue-600 text-white px-6 py-2 rounded-full font-bold shadow-lg hover:bg-blue-700 transition text-sm">添加错题</button></div>;
  
  return (
    <div className="space-y-3">
      {mistakes.map((item) => {
        // 兼容逻辑：优先取数组，没有则取旧字段，最后为空
        const images = item.questionImages || (item.questionImg ? [item.questionImg] : []);
        const firstImg = images[0];
        const count = images.length;
        // [新增] 计算复盘次数
        const reviewCount = getReviewCount(item.reviewLogs);

        return (
          <div key={item.id} onClick={() => onOpen(item.id)} className="bg-white rounded-xl shadow-sm border border-gray-200 active:scale-[0.98] transition-transform cursor-pointer overflow-hidden flex h-36">
            <div className="w-[35%] p-3 flex flex-col justify-between border-r border-gray-100 bg-white z-10">
              <div><h3 className="font-bold text-gray-800 text-sm line-clamp-3 leading-relaxed">{item.title || "未命名"}</h3></div>
              <div className="space-y-1">
                <div className="flex flex-wrap gap-1">
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium border", item.reflection ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-gray-100 text-gray-400 border-gray-200')}>
                        {item.reflection ? '已复盘' : '待复盘'}
                    </span>
                    {/* [新增] 复盘次数显示 */}
                    {reviewCount > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border bg-indigo-50 text-indigo-600 border-indigo-100 flex items-center gap-0.5">
                        <Calendar size={10} /> {reviewCount}次
                      </span>
                    )}
                    {/* 熟练度显示 */}
                    {item.isMastered && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border bg-green-50 text-green-600 border-green-100 flex items-center gap-0.5">
                            <CheckCircle2 size={10} /> 已掌握
                        </span>
                    )}
                </div>
                <div className="text-[10px] text-gray-400 font-medium pl-0.5">{new Date(item.createdAt).toLocaleDateString(undefined, {month:'2-digit', day:'2-digit'})}</div>
              </div>
            </div>
            <div className="flex-1 relative bg-gray-50 h-full group">
              {firstImg ? (
                <>
                  <img src={firstImg} alt="题目" className="absolute inset-0 w-full h-full object-cover" />
                  {count > 1 && (
                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full backdrop-blur-sm flex items-center gap-1">
                      <ImageIcon size={10}/> +{count - 1}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-300 text-xs">无图</div>
              )}
            </div>
          </div>
        );
      })}
      <button onClick={onAdd} className="fixed bottom-20 right-6 bg-blue-600 text-white p-4 rounded-full shadow-[0_4px_14px_rgba(37,99,235,0.4)] hover:bg-blue-700 active:scale-90 transition-all z-40"><Plus size={26} strokeWidth={2.5} /></button>
    </div>
  );
}

// [修改] 接收 subjectId
function MistakeForm({ mode, initialData, onFinish, onCancel, subjectId }) {
  const isEdit = mode === 'edit';
  const [title, setTitle] = useState(initialData?.title || '');
  
  const [qImages, setQImages] = useState(
    initialData?.questionImages || (initialData?.questionImg ? [initialData.questionImg] : [])
  );
  
  const [aImg, setAImg] = useState(initialData?.analysisImg || null);
  const [reflection, setReflection] = useState(initialData?.reflection || '');
  const [analysisText, setAnalysisText] = useState(initialData?.analysisText || '');
  const [loading, setLoading] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  const handleSubmit = async () => {
    if (qImages.length === 0) return alert("必须上传题目图片");
    setLoading(true);
    const data = { 
      title, 
      questionImages: qImages, 
      questionImg: qImages[0], 
      analysisImg: aImg, 
      analysisText, 
      reflection 
    };
    try {
      if (isEdit) {
        // 编辑模式：subjectId 保持不变（已存在于 id 对应的记录中）
        await db.mistakes.update(initialData.id, data);
      } else {
        // [修改] 新增模式：写入当前的 subjectId
        await db.mistakes.add({ ...data, subjectId, createdAt: new Date() });
      }
      onFinish();
    } catch (e) { alert("保存失败: " + e.message); } finally { setLoading(false); }
  };

  return (
    // ... 保持原有 JSX 渲染代码不变，完全一样 ...
    <div className="bg-white min-h-screen sm:min-h-0 sm:rounded-xl p-4 sm:p-6 pb-20 space-y-5 relative">
      <div className="flex justify-between items-center mb-2">
         <h2 className="text-lg font-bold text-gray-800">{isEdit ? '编辑错题' : '记录错题'}</h2>
         {isEdit && <button onClick={onCancel}><X size={24} className="text-gray-400"/></button>}
      </div>
      <div className="space-y-4">
        <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">1. 题目图片 ({qImages.length}) <span className="text-red-500">*</span></label>
            <MultiImageUpload images={qImages} onChange={setQImages} />
        </div>

        <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">标题 / 备注</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：极限计算" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-500 transition" />
        </div>
        
        <div className="border-t border-dashed pt-4">
            <label className="block text-sm font-bold text-gray-700 mb-2">2. 复盘思路</label>
            <textarea value={reflection} onChange={e => setReflection(e.target.value)} className="w-full p-3 bg-yellow-50 border border-yellow-200 rounded-xl h-28 text-sm outline-none focus:border-yellow-400 resize-none" placeholder="关键点在哪里？"></textarea>
        </div>
        
        <div className="border-t border-dashed pt-4">
          <div className="flex justify-between items-center mb-2">
             <label className="block text-sm font-bold text-gray-700">3. 答案解析 (支持 LaTeX)</label>
             <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-bold">
                <button onClick={() => setIsPreviewMode(false)} className={cn("px-3 py-1 rounded-md transition-all", !isPreviewMode ? "bg-white shadow text-blue-600" : "text-gray-500")}>编辑</button>
                <button onClick={() => setIsPreviewMode(true)} className={cn("px-3 py-1 rounded-md transition-all", isPreviewMode ? "bg-white shadow text-blue-600" : "text-gray-500")}>预览</button>
             </div>
          </div>
          
          <ImageUpload value={aImg} onChange={setAImg} isAnalysis />
          
          {isPreviewMode ? (
            <div className="w-full mt-3 p-4 bg-gray-50 border border-gray-200 rounded-xl min-h-[160px] prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2">
               {analysisText ? (
                 <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                   {analysisText}
                 </ReactMarkdown>
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

// --- [修改版] 错题详情：增加复盘自动记录 ---
function MistakeDetail({ mistake, onDelete, onEdit, onNext, hasNext, onPrev, hasPrev, onBack }) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  
  // 切换题目时重置解析显示状态
  useEffect(() => { setShowAnalysis(false); }, [mistake.id]);

  // [新增] 自动记录复盘行为 (查看解析时触发)
  useEffect(() => {
    if (showAnalysis) {
      const today = new Date().toDateString();
      const logs = mistake.reviewLogs || [];
      // 获取最后一次复盘的时间（如果存在）
      const lastLogDate = logs.length > 0 ? new Date(logs[logs.length - 1]).toDateString() : null;
      
      // 如果最后一次复盘不是今天，则追加记录
      if (lastLogDate !== today) {
        db.mistakes.update(mistake.id, {
          reviewLogs: [...logs, Date.now()]
        });
      }
    }
  }, [showAnalysis, mistake]);
  
  const handleDelete = async () => { 
    if(confirm('删除后无法恢复，确定吗？')) { 
      await db.mistakes.delete(mistake.id); 
      onDelete(); 
    } 
  }

  // 切换熟练掌握状态
  const toggleMastered = async () => {
    await db.mistakes.update(mistake.id, { isMastered: !mistake.isMastered });
  };

  // 兼容多图和单图
  const images = mistake.questionImages || (mistake.questionImg ? [mistake.questionImg] : []);

  return (
    <div className="bg-white min-h-screen sm:min-h-0 sm:rounded-xl pb-24 overflow-hidden relative">
      <div className="p-4 border-b border-gray-100 flex justify-between items-start bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
           <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition" title="返回列表"><Home size={20}/></button>
           <div>
             <h2 className="font-bold text-lg text-gray-900 leading-snug">{mistake.title || "题目详情"}</h2>
             <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-gray-400">{new Date(mistake.createdAt).toLocaleString()}</p>
                {mistake.isMastered && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 rounded border border-green-200">已掌握</span>}
                {/* [新增] 详情页也显示复盘统计 */}
                <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 rounded border border-indigo-100 flex items-center gap-1">
                   <Calendar size={10} /> 复盘 {getReviewCount(mistake.reviewLogs)} 天
                </span>
             </div>
           </div>
        </div>
        <button onClick={onEdit} className="p-2 bg-gray-50 text-blue-600 rounded-lg hover:bg-blue-50"><Edit size={18} /></button>
      </div>
      
      <div className="p-4 space-y-6">
        {/* 题目图片 */}
        <div className="space-y-2">
          {images.map((img, idx) => (
            <div key={idx} className="rounded-xl overflow-hidden border border-gray-100 shadow-sm relative">
               <img src={img} alt={`题目 ${idx+1}`} className="w-full" />
               {images.length > 1 && <div className="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded-full backdrop-blur-md">{idx + 1}/{images.length}</div>}
            </div>
          ))}
          {images.length === 0 && <div className="p-8 text-center text-gray-300 bg-gray-50 rounded-xl">无图片</div>}
        </div>

        {/* 底部悬浮栏 */}
        <div className="fixed bottom-20 w-full max-w-3xl left-1/2 -translate-x-1/2 px-4 z-20 flex items-center justify-center pointer-events-none">
          <div className="bg-white/95 backdrop-blur-md p-2 rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-200 flex items-center gap-2 pointer-events-auto overflow-x-auto no-scrollbar max-w-full">
             {hasPrev && (<><button onClick={onPrev} className="p-3 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition shrink-0" title="上一题"><ChevronLeft size={24} /></button><div className="h-6 w-[1px] bg-gray-200 shrink-0"></div></>)}
             
             <button 
                onClick={toggleMastered}
                className={cn(
                  "flex items-center gap-1 px-4 py-3 rounded-full font-bold text-sm transition-all whitespace-nowrap shrink-0",
                  mistake.isMastered 
                    ? "bg-green-50 text-green-600 border border-green-200" 
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                )}
             >
                {mistake.isMastered ? <><CheckCircle2 size={18}/> 已掌握</> : <><Circle size={18}/> 标记掌握</>}
             </button>

             <button onClick={() => setShowAnalysis(!showAnalysis)} className={cn("flex items-center gap-2 px-6 py-3 rounded-full font-bold text-sm transition-all whitespace-nowrap shrink-0", showAnalysis ? 'bg-gray-100 text-gray-700' : 'bg-blue-600 text-white shadow-lg')}>{showAnalysis ? <><EyeOff size={18}/> 遮住答案</> : <><Eye size={18}/> 查看解析</>}</button>
             
             {hasNext && (<><div className="h-6 w-[1px] bg-gray-200 shrink-0"></div><button onClick={onNext} className="p-3 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition shrink-0" title="下一题"><ChevronRight size={24} /></button></>)}
             <div className="h-6 w-[1px] bg-gray-200 shrink-0"></div>
             <button onClick={handleDelete} className="p-3 rounded-full text-red-400 hover:bg-red-50 transition shrink-0"><Trash2 size={20} /></button>
          </div>
        </div>

        {/* 解析区域 */}
        <div className={cn("space-y-4 transition-all duration-300", showAnalysis ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden')}>
          <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200 text-sm"><div className="font-bold text-yellow-800 mb-1 flex items-center gap-1">💡 我的复盘</div><p className="whitespace-pre-wrap text-gray-800 leading-relaxed">{mistake.reflection || "暂无复盘记录"}</p></div>
          <div className="bg-white p-4 rounded-xl border-l-4 border-green-500 shadow-sm">
            <div className="font-bold text-green-700 mb-2 text-sm">标准解析</div>
            {mistake.analysisImg && <img src={mistake.analysisImg} className="w-full rounded-lg mb-2 border border-gray-100"/>}
            
            <div className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:bg-gray-100">
               <ReactMarkdown 
                 remarkPlugins={[remarkGfm, remarkMath]} 
                 rehypePlugins={[rehypeKatex]}
               >
                 {mistake.analysisText || "暂无文字解析"}
               </ReactMarkdown>
            </div>
          </div>
          <div className="h-20"></div>
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
