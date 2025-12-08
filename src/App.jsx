import React, { useState, useMemo, useEffect } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import { 
  Plus, Maximize, ArrowLeft, Eye, EyeOff, Trash2, Save, Edit, X, Search, ChevronRight, 
  Folder, FileText, ChevronDown, ChevronRight as ChevronRightIcon, GripVertical, Image as ImageIcon, Tag, 
  ArrowUpLeft, ArrowRightSquare // [修复] 补全了这里丢失的图标
} from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragOverlay, useDndMonitor } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- 工具函数 ---
function cn(...inputs) { return twMerge(clsx(inputs)); }
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = error => reject(error);
});
const generateId = () => Math.random().toString(36).substr(2, 9);
const APP_VERSION = "v3.1.0 (稳定修复版)";

// [新增] 递归删除辅助函数
const deleteNoteRecursive = async (nodeId) => {
  const children = await db.notes.where('parentId').equals(nodeId).toArray();
  for (const child of children) {
    await deleteNoteRecursive(child.id);
  }
  await db.notes.delete(nodeId);
};

// ==========================================
// 主入口 App
// ==========================================
function App() {
  const [activeTab, setActiveTab] = useState('mistakes'); 

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(e => console.log(e));
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans flex flex-col h-screen overflow-hidden">
      {/* 顶部通栏 */}
      <nav className="bg-white shadow-sm px-4 py-3 z-30 flex justify-between items-center border-b border-gray-200 shrink-0">
        <h1 className="text-lg font-bold bg-gradient-to-r from-blue-700 to-blue-500 bg-clip-text text-transparent">
          {activeTab === 'mistakes' ? '数学复盘' : '知识笔记'}
        </h1>
        <button onClick={toggleFullScreen} className="p-2 hover:bg-gray-100 rounded-full text-gray-500">
          <Maximize size={20} />
        </button>
      </nav>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'mistakes' ? <MistakeSystem /> : <NoteSystem />}
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

// ==========================================
// 模块一：错题本系统 (MistakeSystem)
// ==========================================
function MistakeSystem() {
  const [view, setView] = useState('list'); 
  const [currentMistakeId, setCurrentMistakeId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const mistakes = useLiveQuery(() => db.mistakes.orderBy('createdAt').reverse().toArray());
  const currentMistake = useLiveQuery(() => currentMistakeId ? db.mistakes.get(currentMistakeId) : null, [currentMistakeId]);

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

  const hasNext = useMemo(() => {
    if (!mistakes || !currentMistakeId) return false;
    const listToUse = searchQuery ? filteredMistakes : mistakes;
    const currentIndex = listToUse.findIndex(m => m.id === currentMistakeId);
    return currentIndex !== -1 && currentIndex < listToUse.length - 1;
  }, [mistakes, filteredMistakes, currentMistakeId, searchQuery]);

  return (
    <div className="h-full overflow-y-auto bg-gray-100 pb-20">
      {view === 'list' && (
        <div className="max-w-3xl mx-auto p-3 space-y-3">
           <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search size={18} className="text-gray-400" /></div>
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索错题、备注或日期..." className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm transition"/>
            </div>
            <MistakeList mistakes={filteredMistakes} onAdd={() => setView('add')} onOpen={(id) => { setCurrentMistakeId(id); setView('detail'); }} />
            <div className="text-center py-4 text-gray-400 text-xs font-mono opacity-60">Build: {APP_VERSION}</div>
        </div>
      )}
      {view === 'add' && <MistakeForm mode="add" onFinish={() => setView('list')} onCancel={() => setView('list')} />}
      {view === 'detail' && currentMistake && (
        <MistakeDetail mistake={currentMistake} hasNext={hasNext} onNext={handleNextMistake} onDelete={() => setView('list')} onEdit={() => setView('edit')} onBack={() => setView('list')} />
      )}
      {view === 'edit' && currentMistake && (
        <MistakeForm mode="edit" initialData={currentMistake} onFinish={() => setView('detail')} onCancel={() => setView('detail')} />
      )}
    </div>
  );
}

// ==========================================
// 模块二：笔记系统 (NoteSystem)
// ==========================================
function NoteSystem() {
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(true); 

  const allNotes = useLiveQuery(() => db.notes.orderBy('order').toArray()) || [];

  const noteTree = useMemo(() => {
    const buildTree = (pid) => {
      return allNotes
        .filter(n => n.parentId === pid)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(n => ({ ...n, children: buildTree(n.id) }));
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
    const title = type === 'folder' ? '新建文件夹' : '新建知识点';
    await db.notes.add({
      parentId,
      title,
      type,
      content: [],
      tags: [],
      order: Date.now(),
      createdAt: new Date()
    });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor));
  
  // 检查循环引用：判断 targetId 是否是 sourceId 的子孙
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

    // [修复] 防止循环嵌套
    if (isDescendant(activeNode.id, overNode.id)) {
      return; 
    }

    if (overNode.type === 'folder' && activeNode.parentId !== overNode.id) {
       await db.notes.update(activeNode.id, { parentId: overNode.id });
    } else {
       if (activeNode.parentId !== overNode.parentId) {
         await db.notes.update(activeNode.id, { parentId: overNode.parentId, order: overNode.order });
       } else {
         const newOrder = overNode.order;
         const oldOrder = activeNode.order;
         await db.notes.update(activeNode.id, { order: newOrder });
         await db.notes.update(overNode.id, { order: oldOrder });
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
      {/* 左侧目录栏 */}
      <div className={cn("w-64 bg-gray-50 border-r border-gray-200 flex flex-col transition-all duration-300 absolute md:relative z-20 h-full", !mobileMenuOpen && "-translate-x-full md:translate-x-0 md:w-64")}>
        <div className="p-3 border-b border-gray-200 flex gap-2">
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full text-xs bg-white border rounded px-2 py-1.5 focus:outline-blue-500" placeholder="搜索标签或标题..." />
          <button onClick={() => setMobileMenuOpen(false)} className="md:hidden"><X size={16}/></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 scrollbar-hide">
          {searchTerm ? (
            <div className="space-y-1">
              {filteredNotes.map(note => (
                <div key={note.id} onClick={() => { setSelectedNodeId(note.id); if(window.innerWidth < 768) setMobileMenuOpen(false); }} className="p-2 bg-white border rounded text-sm cursor-pointer hover:bg-blue-50">
                  <div className="font-bold text-gray-700">{note.title}</div>
                  <div className="flex gap-1 mt-1">{note.tags?.map(t => <span key={t} className="text-[10px] bg-blue-100 text-blue-600 px-1 rounded">{t}</span>)}</div>
                </div>
              ))}
              {filteredNotes.length === 0 && <div className="text-gray-400 text-xs text-center mt-4">无搜索结果</div>}
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={allNotes.map(n => n.id)} strategy={verticalListSortingStrategy}>
                 <NoteTree nodes={noteTree} selectedId={selectedNodeId} onSelect={(id) => { setSelectedNodeId(id); if(window.innerWidth < 768) setMobileMenuOpen(false); }} onCreate={handleCreate} />
              </SortableContext>
            </DndContext>
          )}
        </div>
        
        <div className="p-3 border-t border-gray-200 grid grid-cols-2 gap-2 shrink-0 bg-gray-50">
           <button onClick={() => handleCreate('folder', 'root')} className="flex items-center justify-center gap-1 bg-white border border-gray-300 rounded py-2 text-xs font-bold hover:bg-gray-100"><Folder size={14}/> 根文件夹</button>
           <button onClick={() => handleCreate('file', 'root')} className="flex items-center justify-center gap-1 bg-blue-600 text-white rounded py-2 text-xs font-bold hover:bg-blue-700"><FileText size={14}/> 根知识点</button>
        </div>
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 h-full overflow-hidden flex flex-col relative bg-white">
        {!mobileMenuOpen && (
          <button onClick={() => setMobileMenuOpen(true)} className="absolute top-4 left-4 z-10 p-2 bg-white shadow-md border rounded-full md:hidden"><ChevronRightIcon size={20} /></button>
        )}
        
        {selectedNode ? (
          selectedNode.type === 'folder' ? (
            <FolderView 
              folder={selectedNode} 
              contents={folderContents} 
              onNavigate={setSelectedNodeId} 
              onCreate={handleCreate}
              onBack={() => setSelectedNodeId(selectedNode.parentId === 'root' ? null : selectedNode.parentId)}
            />
          ) : (
            <NoteEditor nodeId={selectedNodeId} onBack={() => setMobileMenuOpen(true)} />
          )
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-300 select-none">
            <Folder size={64} className="mb-4 opacity-20"/>
            <p className="mt-2">从左侧选择知识点或文件夹</p>
          </div>
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

function MoveModal({ node, allNotes, onClose, onConfirm }) {
  const isDescendant = (sourceId, targetNode) => {
    let curr = targetNode;
    while(curr && curr.parentId !== 'root') {
        if(curr.parentId === sourceId) return true;
        curr = allNotes.find(n => n.id === curr.parentId);
    }
    return false;
  };

  const validTargets = allNotes
    .filter(n => n.type === 'folder' && n.id !== node.id && !isDescendant(node.id, n) && n.id !== node.parentId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const renderOptions = (parentId = 'root', level = 0) => {
      const children = validTargets.filter(n => n.parentId === parentId);
      if (children.length === 0) return null;
      return children.map(folder => (
          <React.Fragment key={folder.id}>
              <div onClick={() => onConfirm(folder.id)} className="p-3 hover:bg-blue-50 cursor-pointer flex items-center gap-2 border-b border-gray-50 text-sm text-gray-700" style={{ paddingLeft: `${level * 20 + 12}px` }}>
                  <Folder size={16} className="text-blue-500 fill-blue-100"/>{folder.title}
              </div>
              {renderOptions(folder.id, level + 1)}
          </React.Fragment>
      ));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center"><h3 className="font-bold text-gray-800">移动 "{node.title}" 到...</h3><button onClick={onClose}><X size={20} className="text-gray-400"/></button></div>
            <div className="flex-1 overflow-y-auto">
                {node.parentId !== 'root' && (<div onClick={() => onConfirm('root')} className="p-3 hover:bg-blue-50 cursor-pointer flex items-center gap-2 border-b border-gray-50 text-sm font-bold text-gray-800 bg-gray-50"><Folder size={16} className="text-gray-500"/>根目录 (Root)</div>)}
                {renderOptions('root', 0)}
                {validTargets.length === 0 && node.parentId === 'root' && <div className="p-8 text-center text-gray-400 text-xs">没有其他可移动的目标文件夹</div>}
            </div>
        </div>
    </div>
  );
}

function FolderView({ folder, contents, onNavigate, onCreate, onBack }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(folder.title);
  const [moveTargetNode, setMoveTargetNode] = useState(null); 
  const allNotes = useLiveQuery(() => db.notes.toArray()) || [];

  useEffect(() => { setTitle(folder.title); }, [folder.id, folder.title]);

  const handleRename = async () => { if (title.trim() && title !== folder.title) { await db.notes.update(folder.id, { title: title.trim() }); } setEditingTitle(false); };
  const handleDelete = async () => { if (confirm(`确定要删除文件夹 "${folder.title}" 吗？\n里面的所有内容都将被永久删除！`)) { await deleteNoteRecursive(folder.id); onBack(); } };
  const handleMoveConfirm = async (targetId) => { if (moveTargetNode) { await db.notes.update(moveTargetNode.id, { parentId: targetId }); setMoveTargetNode(null); } };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="p-4 border-b border-gray-100 flex items-center gap-3 sticky top-0 bg-white/95 backdrop-blur z-10">
        {folder.parentId !== 'root' && (<button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500" title="返回上一级"><ArrowUpLeft size={20}/></button>)}
        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Folder size={24}/></div>
        <div className="flex-1 mr-4">
           {editingTitle ? (<input autoFocus value={title} onChange={e => setTitle(e.target.value)} onBlur={handleRename} onKeyDown={e => e.key === 'Enter' && handleRename()} className="text-xl font-bold w-full border-b border-blue-500 outline-none bg-transparent text-gray-800"/>) : (<h2 onClick={() => setEditingTitle(true)} className="text-xl font-bold text-gray-800 cursor-pointer hover:bg-gray-50 rounded px-2 -ml-2 truncate border border-transparent hover:border-gray-200 transition-all" title="点击重命名">{folder.title}</h2>)}
           <p className="text-xs text-gray-400 mt-0.5 ml-0.5">{contents.length} 个项目</p>
        </div>
        <div className="flex items-center gap-2">
            <div className="flex bg-gray-100 rounded-lg p-1 mr-2"><button onClick={() => onCreate('folder', folder.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold hover:bg-white hover:shadow-sm rounded-md text-gray-600 transition-all"><Plus size={14}/> 文件夹</button><div className="w-[1px] bg-gray-300 my-1 mx-1"></div><button onClick={() => onCreate('file', folder.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold hover:bg-white hover:shadow-sm rounded-md text-blue-600 transition-all"><Plus size={14}/> 知识点</button></div>
            <button onClick={handleDelete} className="p-2 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-full transition-colors" title="删除文件夹"><Trash2 size={20}/></button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {contents.length === 0 ? (
           <div className="h-full flex flex-col items-center justify-center text-gray-300"><div className="w-16 h-16 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center mb-2"><Folder size={24} className="opacity-20"/></div><p className="text-sm">此文件夹为空</p></div>
        ) : (
           <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {contents.map(item => (
                 <div key={item.id} className="group p-4 rounded-xl hover:bg-blue-50 border border-transparent hover:border-blue-100 cursor-pointer transition-all flex flex-col items-center gap-3 text-center active:scale-95 relative">
                    <div className="absolute inset-0 z-0" onClick={() => onNavigate(item.id)}></div>
                    <div className={cn("w-16 h-16 flex items-center justify-center rounded-2xl shadow-sm transition-transform group-hover:-translate-y-1 z-10", item.type === 'folder' ? "bg-blue-100 text-blue-500" : "bg-white border border-gray-200 text-gray-400")}>
                       {item.type === 'folder' ? <Folder size={32} fill="currentColor" className="opacity-80"/> : <FileText size={32} />}
                    </div>
                    <div className="w-full z-10">
                       <div className="font-medium text-gray-700 text-sm truncate group-hover:text-blue-700">{item.title}</div>
                       <div className="text-[10px] text-gray-400 mt-1">{new Date(item.createdAt).toLocaleDateString()}</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setMoveTargetNode(item); }} className="absolute top-2 right-2 p-1.5 bg-white shadow-md rounded-full text-gray-500 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity z-20" title="移动到..."><ArrowRightSquare size={14}/></button>
                 </div>
              ))}
           </div>
        )}
      </div>
      {moveTargetNode && (<MoveModal node={moveTargetNode} allNotes={allNotes} onClose={() => setMoveTargetNode(null)} onConfirm={handleMoveConfirm}/>)}
    </div>
  );
}

function NoteEditor({ nodeId, onBack }) {
  const note = useLiveQuery(() => db.notes.get(nodeId), [nodeId]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [newTag, setNewTag] = useState('');

  useEffect(() => { if(note) setTitle(note.title); }, [note]);
  if (!note) return <div className="p-10 text-center">加载中...</div>;

  const handleUpdate = (updates) => db.notes.update(nodeId, updates);
  const handleAddImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const base64 = await fileToBase64(file);
    const newContent = [...(note.content || []), { id: generateId(), src: base64, desc: '' }];
    handleUpdate({ content: newContent });
  };
  const handleDeleteImage = (imgId) => { handleUpdate({ content: note.content.filter(c => c.id !== imgId) }); }
  const handleAddTag = () => { if(!newTag.trim()) return; const tags = [...(note.tags || [])]; if(!tags.includes(newTag.trim())) { tags.push(newTag.trim()); handleUpdate({ tags }); } setNewTag(''); }
  const handleRemoveTag = (tag) => { handleUpdate({ tags: note.tags.filter(t => t !== tag) }); }
  const handleDeleteNote = async () => { if(confirm('确定删除此条目吗？如果是文件夹，内容将一并删除。')) { await db.notes.delete(nodeId); onBack(); } }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="p-4 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
        <div className="flex-1 mr-4">
           {editingTitle ? (
             <input autoFocus value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { setEditingTitle(false); handleUpdate({ title }); }} onKeyDown={e => { if(e.key === 'Enter') { setEditingTitle(false); handleUpdate({ title }); } }} className="text-xl font-bold w-full border-b border-blue-500 outline-none"/>
           ) : (
             <h2 onClick={() => setEditingTitle(true)} className="text-xl font-bold cursor-pointer hover:bg-gray-50 rounded px-2 -ml-2 truncate">{note.title}</h2>
           )}
           <div className="text-xs text-gray-400 mt-1 ml-1 flex items-center gap-2">{new Date(note.createdAt).toLocaleDateString()}{note.type === 'folder' && <span className="bg-gray-100 px-1 rounded">文件夹</span>}</div>
        </div>
        <button onClick={handleDeleteNote} className="text-red-400 hover:bg-red-50 p-2 rounded-full"><Trash2 size={20}/></button>
      </div>
      {note.type === 'file' && (
        <div className="px-6 py-2 flex flex-wrap items-center gap-2 border-b border-gray-50">
            <Tag size={14} className="text-gray-400"/>
            {note.tags?.map(tag => (<span key={tag} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded-full flex items-center gap-1 group">{tag}<X size={10} className="cursor-pointer opacity-0 group-hover:opacity-100" onClick={() => handleRemoveTag(tag)}/></span>))}
            <div className="flex items-center gap-1 bg-gray-50 rounded-full px-2 py-1"><input value={newTag} onChange={e => setNewTag(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddTag()} placeholder="添加标签..." className="bg-transparent text-xs w-20 outline-none"/><Plus size={12} className="cursor-pointer text-gray-400" onClick={handleAddTag}/></div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
         {note.type === 'folder' ? (
             <div className="text-center text-gray-400 mt-20"><Folder size={48} className="mx-auto mb-4 opacity-30"/><p>这是文件夹，请在左侧点击 + 号添加子知识点</p></div>
         ) : (
             <>
                {note.content?.map((item, idx) => (
                    <div key={item.id} className="group relative bg-gray-50 rounded-xl p-2 border border-gray-100">
                        <img src={item.src} className="w-full rounded-lg" />
                        <button onClick={() => handleDeleteImage(item.id)} className="absolute top-4 right-4 bg-red-500 text-white p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition"><Trash2 size={16}/></button>
                        <textarea placeholder="给这张图写点备注..." className="w-full bg-transparent text-sm mt-2 p-2 outline-none resize-none h-10 focus:bg-white focus:h-20 transition-all rounded" defaultValue={item.desc} onBlur={(e) => { const newContent = [...note.content]; newContent[idx].desc = e.target.value; handleUpdate({ content: newContent }); }}/>
                    </div>
                ))}
                <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 flex flex-col items-center justify-center text-gray-400 hover:bg-gray-50 hover:border-indigo-200 transition cursor-pointer relative"><ImageIcon size={32} className="mb-2"/><span className="text-sm font-bold">添加知识点截图</span><input type="file" accept="image/*" onChange={handleAddImage} className="absolute inset-0 opacity-0 cursor-pointer"/></div>
             </>
         )}
         <div className="h-20"></div>
      </div>
    </div>
  );
}

// 错题本复用组件... (已包含在上方 MistakeSystem 模块中)
function MistakeList({ mistakes, onAdd, onOpen }) {
  if (!mistakes) return <div className="text-center mt-20 text-gray-400">加载数据中...</div>;
  if (mistakes.length === 0) return <div className="flex flex-col items-center justify-center mt-10 text-gray-400 p-4"><div className="mb-4 p-4 bg-gray-200 rounded-full">📝</div><p className="mb-6 font-medium">没有找到相关错题</p><button onClick={onAdd} className="bg-blue-600 text-white px-6 py-2 rounded-full font-bold shadow-lg hover:bg-blue-700 transition text-sm">添加错题</button></div>;
  return (
    <div className="space-y-3">
      {mistakes.map((item) => (
        <div key={item.id} onClick={() => onOpen(item.id)} className="bg-white rounded-xl shadow-sm border border-gray-200 active:scale-[0.98] transition-transform cursor-pointer overflow-hidden flex h-36">
          <div className="w-[35%] p-3 flex flex-col justify-between border-r border-gray-100 bg-white z-10">
            <div><h3 className="font-bold text-gray-800 text-sm line-clamp-3 leading-relaxed">{item.title || "未命名"}</h3></div>
            <div className="space-y-1"><span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium border", item.reflection ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-gray-100 text-gray-400 border-gray-200')}>{item.reflection ? '已复盘' : '待复盘'}</span><div className="text-[10px] text-gray-400 font-medium pl-0.5">{new Date(item.createdAt).toLocaleDateString(undefined, {month:'2-digit', day:'2-digit'})}</div></div>
          </div>
          <div className="flex-1 relative bg-gray-50 h-full">{item.questionImg ? <img src={item.questionImg} alt="题目" className="absolute inset-0 w-full h-full object-cover" /> : <div className="flex items-center justify-center h-full text-gray-300 text-xs">无图</div>}</div>
        </div>
      ))}
      <button onClick={onAdd} className="fixed bottom-20 right-6 bg-blue-600 text-white p-4 rounded-full shadow-[0_4px_14px_rgba(37,99,235,0.4)] hover:bg-blue-700 active:scale-90 transition-all z-40"><Plus size={26} strokeWidth={2.5} /></button>
    </div>
  );
}

function MistakeForm({ mode, initialData, onFinish, onCancel }) {
  const isEdit = mode === 'edit';
  const [title, setTitle] = useState(initialData?.title || '');
  const [qImg, setQImg] = useState(initialData?.questionImg || null);
  const [aImg, setAImg] = useState(initialData?.analysisImg || null);
  const [reflection, setReflection] = useState(initialData?.reflection || '');
  const [analysisText, setAnalysisText] = useState(initialData?.analysisText || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!qImg) return alert("必须上传题目图片");
    setLoading(true);
    const data = { title, questionImg: qImg, analysisImg: aImg, analysisText, reflection };
    try {
      if (isEdit) await db.mistakes.update(initialData.id, data);
      else await db.mistakes.add({ ...data, createdAt: new Date() });
      onFinish();
    } catch (e) { alert("保存失败"); } finally { setLoading(false); }
  };

  return (
    <div className="bg-white min-h-screen sm:min-h-0 sm:rounded-xl p-4 sm:p-6 pb-20 space-y-5 relative">
      <div className="flex justify-between items-center mb-2">
         <h2 className="text-lg font-bold text-gray-800">{isEdit ? '编辑错题' : '记录错题'}</h2>
         {isEdit && <button onClick={onCancel}><X size={24} className="text-gray-400"/></button>}
      </div>
      <div className="space-y-4">
        <div><label className="block text-sm font-bold text-gray-700 mb-2">1. 题目图片 <span className="text-red-500">*</span></label><ImageUpload value={qImg} onChange={setQImg} /></div>
        <div><label className="block text-sm font-bold text-gray-700 mb-2">标题 / 备注</label><input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：极限计算" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-500 transition" /></div>
        <div className="border-t border-dashed pt-4"><label className="block text-sm font-bold text-gray-700 mb-2">2. 复盘思路</label><textarea value={reflection} onChange={e => setReflection(e.target.value)} className="w-full p-3 bg-yellow-50 border border-yellow-200 rounded-xl h-28 text-sm outline-none focus:border-yellow-400 resize-none" placeholder="关键点在哪里？"></textarea></div>
        <div className="border-t border-dashed pt-4"><label className="block text-sm font-bold text-gray-700 mb-2">3. 答案解析</label><ImageUpload value={aImg} onChange={setAImg} isAnalysis /><textarea value={analysisText} onChange={e => setAnalysisText(e.target.value)} className="w-full mt-3 p-3 bg-gray-50 border border-gray-200 rounded-xl h-20 text-sm outline-none focus:border-green-500 resize-none" placeholder="文字解析..."></textarea></div>
      </div>
      <button onClick={handleSubmit} disabled={loading} className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-bold shadow-md mt-4 flex justify-center items-center gap-2"><Save size={18} /> {loading ? '保存中...' : '保存'}</button>
    </div>
  );
}

function ImageUpload({ value, onChange, isAnalysis }) {
  const handleFile = async (e) => { const file = e.target.files[0]; if(file) onChange(await fileToBase64(file)); };
  return (
    <div className={cn("relative border-2 border-dashed rounded-xl h-32 flex items-center justify-center overflow-hidden bg-gray-50 transition", isAnalysis ? 'border-green-200' : 'border-blue-200')}>
      {!value ? <div className="flex flex-col items-center gap-1 text-gray-400"><Plus size={24} /> <span className="text-xs">点击上传</span><input type="file" accept="image/*" onChange={handleFile} className="absolute inset-0 opacity-0 cursor-pointer"/></div> : <div className="relative w-full h-full group"><img src={value} className="w-full h-full object-contain" /><button onClick={()=>onChange(null)} className="absolute top-2 right-2 p-1.5 bg-red-500/80 text-white rounded-full"><Trash2 size={14}/></button></div>}
    </div>
  )
}

function MistakeDetail({ mistake, onDelete, onEdit, onNext, hasNext, onBack }) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  useEffect(() => { setShowAnalysis(false); }, [mistake.id]);
  const handleDelete = async () => { if(confirm('删除后无法恢复，确定吗？')) { await db.mistakes.delete(mistake.id); onDelete(); } }

  return (
    <div className="bg-white min-h-screen sm:min-h-0 sm:rounded-xl pb-24 overflow-hidden relative">
      <div className="p-4 border-b border-gray-100 flex justify-between items-start bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
           <button onClick={onBack} className="md:hidden p-1 -ml-2"><ArrowLeft size={20}/></button>
           <div><h2 className="font-bold text-lg text-gray-900 leading-snug">{mistake.title || "题目详情"}</h2><p className="text-xs text-gray-400 mt-1">{new Date(mistake.createdAt).toLocaleString()}</p></div>
        </div>
        <button onClick={onEdit} className="p-2 bg-gray-50 text-blue-600 rounded-lg hover:bg-blue-50"><Edit size={18} /></button>
      </div>
      <div className="p-4 space-y-6">
        <div className="rounded-xl overflow-hidden border border-gray-100 shadow-sm"><img src={mistake.questionImg} alt="题目" className="w-full" /></div>
        <div className="fixed bottom-20 w-full max-w-3xl left-1/2 -translate-x-1/2 px-4 z-20 flex items-center justify-center pointer-events-none">
          <div className="bg-white/95 backdrop-blur-md p-2 rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-200 flex items-center gap-3 pointer-events-auto">
             <button onClick={handleDelete} className="p-3 rounded-full text-red-400 hover:bg-red-50 transition"><Trash2 size={20} /></button>
             <div className="h-6 w-[1px] bg-gray-200"></div>
             <button onClick={() => setShowAnalysis(!showAnalysis)} className={cn("flex items-center gap-2 px-6 py-3 rounded-full font-bold text-sm transition-all whitespace-nowrap", showAnalysis ? 'bg-gray-100 text-gray-700' : 'bg-green-600 text-white shadow-lg')}>{showAnalysis ? <><EyeOff size={18}/> 遮住答案</> : <><Eye size={18}/> 查看解析</>}</button>
             {hasNext && <><div className="h-6 w-[1px] bg-gray-200"></div><button onClick={onNext} className="p-3 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition"><ChevronRight size={24} /></button></>}
          </div>
        </div>
        <div className={cn("space-y-4 transition-all duration-300", showAnalysis ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden')}>
          <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200 text-sm"><div className="font-bold text-yellow-800 mb-1 flex items-center gap-1">💡 我的复盘</div><p className="whitespace-pre-wrap text-gray-800 leading-relaxed">{mistake.reflection || "暂无复盘记录"}</p></div>
          <div className="bg-white p-4 rounded-xl border-l-4 border-green-500 shadow-sm">
            <div className="font-bold text-green-700 mb-2 text-sm">标准解析</div>
            {mistake.analysisImg && <img src={mistake.analysisImg} className="w-full rounded-lg mb-2 border border-gray-100"/>}
            <div className="text-gray-700 text-sm whitespace-pre-wrap leading-relaxed">{mistake.analysisText}</div>
          </div>
          <div className="h-20"></div>
        </div>
      </div>
    </div>
  );
}

export default App;
