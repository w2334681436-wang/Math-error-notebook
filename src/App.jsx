import React, { useState, useMemo, useEffect } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import { 
  Plus, Maximize, ArrowLeft, Eye, EyeOff, Trash2, Save, Edit, X, Search, ChevronRight, 
  Folder, FileText, ChevronDown, ChevronRight as ChevronRightIcon, GripVertical, Image as ImageIcon, Tag
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
const APP_VERSION = "v2.0.2 (修复解析显示)";

// ==========================================
// 主入口 App
// ==========================================
function App() {
  const [activeTab, setActiveTab] = useState('mistakes'); // 'mistakes' | 'notes'

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

      {/* 主内容区域 (两个系统切换) */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'mistakes' ? <MistakeSystem /> : <NoteSystem />}
      </div>

      {/* 底部导航栏 */}
      <div className="bg-white border-t border-gray-200 p-2 flex justify-around items-center shrink-0 safe-area-bottom pb-4 z-40">
        <button 
          onClick={() => setActiveTab('mistakes')}
          className={cn("flex flex-col items-center gap-1 p-2 rounded-xl transition-all w-24", activeTab === 'mistakes' ? "text-blue-600 bg-blue-50" : "text-gray-400 hover:bg-gray-50")}
        >
          <div className="relative">
            <Edit size={24} strokeWidth={activeTab === 'mistakes' ? 2.5 : 2} />
          </div>
          <span className="text-[10px] font-bold">错题本</span>
        </button>
        <button 
          onClick={() => setActiveTab('notes')}
          className={cn("flex flex-col items-center gap-1 p-2 rounded-xl transition-all w-24", activeTab === 'notes' ? "text-indigo-600 bg-indigo-50" : "text-gray-400 hover:bg-gray-50")}
        >
          <Folder size={24} strokeWidth={activeTab === 'notes' ? 2.5 : 2} />
          <span className="text-[10px] font-bold">知识库</span>
        </button>
      </div>
    </div>
  );
}

// ==========================================
// 子系统 1: 错题本 (Mistake System)
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
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={18} className="text-gray-400" />
              </div>
              <input 
                type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索错题..." 
                className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm transition"
              />
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
// 子系统 2: 笔记系统 (Note System) - 无限嵌套增强版
// ==========================================
function NoteSystem() {
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(true); 

  // 获取所有笔记
  const allNotes = useLiveQuery(() => db.notes.orderBy('order').toArray()) || [];

  // 构建树形结构 (递归)
  const noteTree = useMemo(() => {
    const buildTree = (pid) => {
      return allNotes
        .filter(n => n.parentId === pid)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(n => ({ ...n, children: buildTree(n.id) }));
    };
    return buildTree('root');
  }, [allNotes]);

  // 搜索过滤
  const filteredNotes = useMemo(() => {
    if (!searchTerm) return [];
    return allNotes.filter(n => {
      const titleMatch = n.title?.toLowerCase().includes(searchTerm.toLowerCase());
      const tagMatch = n.tags?.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()));
      return (titleMatch || tagMatch) && n.type === 'file';
    });
  }, [allNotes, searchTerm]);

  // 创建逻辑 (支持无限嵌套)
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
  
  // 核心拖拽结束逻辑
  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeNode = allNotes.find(n => n.id === active.id);
    const overNode = allNotes.find(n => n.id === over.id);

    if (!activeNode || !overNode) return;

    // 逻辑 1: 如果拖拽到了一个文件夹"里面" (通过 TreeNode 的自动展开，用户会拖到子列表中)
    // 逻辑 2: 如果直接拖拽到文件夹"标题"上，则归入该文件夹
    // 逻辑 3: 排序
    
    // 我们简化逻辑：
    // 如果 overNode 是文件夹，且 activeNode 不是 overNode 的父级(防止死循环)，且 activeNode 目前不在 overNode 里
    // 那么有两个情况：用户是想排序？还是想拖入？
    // 约定：如果直接盖在 Folder 上，算拖入；如果只是在列表中间，算排序。
    // 由于 dnd-kit sortable 的特性，这里我们主要处理 "归属变更" 和 "同级排序"

    if (overNode.type === 'folder' && activeNode.parentId !== overNode.id) {
       // 跨层级拖拽：归入文件夹
       await db.notes.update(activeNode.id, { parentId: overNode.id });
    } else {
       // 同级或跨级排序：交换位置或更新 parentId
       // 如果 active 和 over 的 parentId 不同，说明拖到了另一个列表的缝隙中
       if (activeNode.parentId !== overNode.parentId) {
         await db.notes.update(activeNode.id, { parentId: overNode.parentId, order: overNode.order });
       } else {
         // 同级排序：交换 order
         const newOrder = overNode.order;
         const oldOrder = activeNode.order;
         await db.notes.update(activeNode.id, { order: newOrder });
         await db.notes.update(overNode.id, { order: oldOrder });
       }
    }
  };

  return (
    <div className="flex h-full bg-white">
      {/* 左侧目录栏 */}
      <div className={cn("w-64 bg-gray-50 border-r border-gray-200 flex flex-col transition-all duration-300 absolute md:relative z-20 h-full", !mobileMenuOpen && "-translate-x-full md:translate-x-0 md:w-64")}>
        <div className="p-3 border-b border-gray-200 flex gap-2">
          <input 
             value={searchTerm}
             onChange={e => setSearchTerm(e.target.value)}
             className="w-full text-xs bg-white border rounded px-2 py-1.5 focus:outline-blue-500"
             placeholder="搜索标签或标题..."
          />
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
              {/* 这里传入所有 ID 以便 DndContext 知道所有可拖拽项，但视觉层级由 NoteTree 递归渲染 */}
              <SortableContext items={allNotes.map(n => n.id)} strategy={verticalListSortingStrategy}>
                 <NoteTree nodes={noteTree} selectedId={selectedNodeId} onSelect={(id) => { setSelectedNodeId(id); if(window.innerWidth < 768) setMobileMenuOpen(false); }} onCreate={handleCreate} />
              </SortableContext>
            </DndContext>
          )}
        </div>
        
        {/* 底部根目录创建按钮 */}
        <div className="p-3 border-t border-gray-200 grid grid-cols-2 gap-2 shrink-0 bg-gray-50">
           <button onClick={() => handleCreate('folder', 'root')} className="flex items-center justify-center gap-1 bg-white border border-gray-300 rounded py-2 text-xs font-bold hover:bg-gray-100"><Folder size={14}/> 根文件夹</button>
           <button onClick={() => handleCreate('file', 'root')} className="flex items-center justify-center gap-1 bg-blue-600 text-white rounded py-2 text-xs font-bold hover:bg-blue-700"><FileText size={14}/> 根知识点</button>
        </div>
      </div>

     // [新增] 获取当前选中的节点对象
  const selectedNode = useMemo(() => allNotes.find(n => n.id === selectedNodeId), [allNotes, selectedNodeId]);
  
  // [新增] 如果选中了文件夹，获取其下的子内容
  const folderContents = useMemo(() => {
     if (!selectedNode || selectedNode.type !== 'folder') return [];
     return allNotes.filter(n => n.parentId === selectedNode.id).sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [allNotes, selectedNode]);

  return (
    <div className="flex h-full bg-white">
      {/* 左侧目录栏代码保持不变... */}
      {/* ... */}

      {/* 右侧内容区 */}
      <div className="flex-1 h-full overflow-hidden flex flex-col relative bg-white">
        {!mobileMenuOpen && (
          <button onClick={() => setMobileMenuOpen(true)} className="absolute top-4 left-4 z-10 p-2 bg-white shadow-md border rounded-full md:hidden">
            <ChevronRightIcon size={20} />
          </button>
        )}
        
        {/* 根据选中类型渲染不同视图 */}
        {selectedNode ? (
          selectedNode.type === 'folder' ? (
            <FolderView 
              folder={selectedNode} 
              contents={folderContents} 
              onNavigate={setSelectedNodeId} 
              onCreate={handleCreate}
            />
          ) : (
            <NoteEditor nodeId={selectedNodeId} onBack={() => setMobileMenuOpen(true)} />
          )
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-300 select-none">
            <Folder size={64} className="mb-4 opacity-20"/>
            <p>选择文件夹或知识点</p>
          </div>
        )}
      </div>
    </div>
  );
}

// --- 目录树组件 (递归) ---
function NoteTree({ nodes, selectedId, onSelect, onCreate, level = 0 }) {
  return (
    <div className="space-y-0.5">
      {nodes.map(node => (
        <TreeNode key={node.id} node={node} selectedId={selectedId} onSelect={onSelect} onCreate={onCreate} level={level} />
      ))}
    </div>
  );
}

// --- 单个节点组件 (支持自动展开与无限嵌套) ---
function TreeNode({ node, selectedId, onSelect, onCreate, level }) {
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  
  // 保持缩进样式，拖拽时半透明
  const style = { 
    transform: CSS.Transform.toString(transform), 
    transition, 
    opacity: isDragging ? 0.4 : 1,
    paddingLeft: `${level * 12 + 8}px` 
  };
  
  const isFolder = node.type === 'folder';
  const isSelected = selectedId === node.id;

  // --- 自动展开逻辑 ---
  // 当拖拽元素在当前文件夹上方悬停超过 600ms 时，自动展开
  useDndMonitor({
    onDragOver({ over }) {
      if (isFolder && !expanded && over?.id === node.id) {
        // 使用防抖或简单的延时逻辑需要配合 state，这里简化处理：
        // 实际开发中最好用 useRef 记录 timer，这里为了代码简洁直接触发（用户体验稍微快一点）
        // 为了防止误触，可以在这里加一个简单的概率锁或者依赖外部状态，
        // 但最简单有效的方法是：只要拖到了上面，就尝试展开。
        // 由于 dnd-kit 的事件触发频率高，我们做一个简单的 id 检查即可。
        // 注意：这会导致拖过就展开，如果需要延时，可以结合 setTimeout
        const timer = setTimeout(() => {
           setExpanded(true);
        }, 500); 
        return () => clearTimeout(timer);
      }
    }
  });

  return (
    <div ref={setNodeRef} style={style} className="select-none py-0.5 outline-none">
      <div 
        className={cn(
          "flex items-center gap-1 p-2 rounded-lg cursor-pointer transition-all group relative border border-transparent",
          isSelected ? "bg-indigo-50 text-indigo-700 border-indigo-100" : "hover:bg-gray-100 text-gray-700"
        )}
        onClick={(e) => { 
             e.stopPropagation(); 
             if(isFolder) setExpanded(!expanded);
             onSelect(node.id);
        }}
      >
        {/* 拖拽手柄 */}
        <div {...attributes} {...listeners} className="text-gray-300 hover:text-gray-600 cursor-grab px-1 py-1 touch-none">
            <GripVertical size={14}/>
        </div>
        
        {/* 展开/收起箭头 */}
        <div className="w-4 h-4 flex items-center justify-center mr-1">
          {isFolder && (
            <div className="transition-transform duration-200" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                <ChevronRightIcon size={14}/>
            </div>
          )}
        </div>
        
        {/* 图标 */}
        {isFolder ? (
            <Folder size={16} className={cn("shrink-0 transition-colors", isSelected ? "fill-indigo-200 text-indigo-600" : "text-gray-400 group-hover:text-blue-400")} /> 
        ) : (
            <FileText size={16} className="shrink-0 text-gray-400"/>
        )}
        
        <span className="text-sm truncate flex-1 font-medium">{node.title}</span>
        
        {/* 悬浮操作栏 (支持新建文件夹和文件) */}
        {isFolder && (
          <div className="absolute right-2 opacity-0 group-hover:opacity-100 flex items-center bg-white shadow-sm border border-gray-100 rounded-md overflow-hidden transition-opacity">
             <button 
               onClick={(e) => { e.stopPropagation(); onCreate('folder', node.id); setExpanded(true); }}
               className="p-1.5 hover:bg-gray-100 text-gray-500 hover:text-blue-600 border-r border-gray-100"
               title="新建子文件夹"
             >
                <Folder size={12} strokeWidth={2.5}/>
                <span className="sr-only">Folder</span>
             </button>
             <button 
               onClick={(e) => { e.stopPropagation(); onCreate('file', node.id); setExpanded(true); }}
               className="p-1.5 hover:bg-gray-100 text-gray-500 hover:text-blue-600"
               title="新建子知识点"
             >
                <FileText size={12} strokeWidth={2.5}/>
                <span className="sr-only">File</span>
             </button>
          </div>
        )}
      </div>
      
      {/* 子级渲染 */}
      {isFolder && expanded && node.children && (
        <div className="transition-all duration-300 ease-in-out">
            <NoteTree nodes={node.children} selectedId={selectedId} onSelect={onSelect} onCreate={onCreate} level={level + 1} />
        </div>
      )}
    </div>
  );
}

      // --- 文件夹资源管理器视图 ---
function FolderView({ folder, contents, onNavigate, onCreate }) {
  return (
    <div className="flex flex-col h-full bg-white">
      {/* 文件夹头部 */}
      <div className="p-4 border-b border-gray-100 flex items-center gap-3 sticky top-0 bg-white/95 backdrop-blur z-10">
        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
           <Folder size={24}/>
        </div>
        <div className="flex-1">
           <h2 className="text-xl font-bold text-gray-800">{folder.title}</h2>
           <p className="text-xs text-gray-400">{contents.length} 个项目</p>
        </div>
        {/* 快速新建按钮 */}
        <div className="flex gap-2">
            <button onClick={() => onCreate('folder', folder.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-gray-100 hover:bg-gray-200 rounded text-gray-600">
                <Plus size={14}/> 文件夹
            </button>
            <button onClick={() => onCreate('file', folder.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 rounded text-white">
                <Plus size={14}/> 知识点
            </button>
        </div>
      </div>

      {/* 内容网格 */}
      <div className="flex-1 overflow-y-auto p-4">
        {contents.length === 0 ? (
           <div className="h-full flex flex-col items-center justify-center text-gray-300">
              <div className="w-16 h-16 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center mb-2">
                 <Folder size={24} className="opacity-20"/>
              </div>
              <p className="text-sm">此文件夹为空</p>
           </div>
        ) : (
           <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {contents.map(item => (
                 <div 
                   key={item.id}
                   onClick={() => onNavigate(item.id)}
                   className="group p-4 rounded-xl hover:bg-blue-50 border border-transparent hover:border-blue-100 cursor-pointer transition-all flex flex-col items-center gap-3 text-center active:scale-95"
                 >
                    {/* 图标 */}
                    <div className={cn(
                        "w-16 h-16 flex items-center justify-center rounded-2xl shadow-sm transition-transform group-hover:-translate-y-1",
                        item.type === 'folder' ? "bg-blue-100 text-blue-500" : "bg-white border border-gray-200 text-gray-400"
                    )}>
                       {item.type === 'folder' ? (
                          <Folder size={32} fill="currentColor" className="opacity-80"/>
                       ) : (
                          <FileText size={32} />
                       )}
                    </div>
                    
                    {/* 标题 */}
                    <div className="w-full">
                       <div className="font-medium text-gray-700 text-sm truncate group-hover:text-blue-700">
                          {item.title}
                       </div>
                       <div className="text-[10px] text-gray-400 mt-1">
                          {new Date(item.createdAt).toLocaleDateString()}
                       </div>
                    </div>
                 </div>
              ))}
           </div>
        )}
      </div>
    </div>
  );
}

// --- 知识点编辑器 ---
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

  const handleDeleteImage = (imgId) => {
      handleUpdate({ content: note.content.filter(c => c.id !== imgId) });
  }

  const handleAddTag = () => {
      if(!newTag.trim()) return;
      const tags = [...(note.tags || [])];
      if(!tags.includes(newTag.trim())) {
          tags.push(newTag.trim());
          handleUpdate({ tags });
      }
      setNewTag('');
  }

  const handleRemoveTag = (tag) => {
      handleUpdate({ tags: note.tags.filter(t => t !== tag) });
  }

  const handleDeleteNote = async () => {
      if(confirm('确定删除此条目吗？如果是文件夹，内容将一并删除。')) {
          await db.notes.delete(nodeId);
          onBack();
      }
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 头部 */}
      <div className="p-4 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
        <div className="flex-1 mr-4">
           {editingTitle ? (
             <input 
               autoFocus
               value={title}
               onChange={e => setTitle(e.target.value)}
               onBlur={() => { setEditingTitle(false); handleUpdate({ title }); }}
               onKeyDown={e => { if(e.key === 'Enter') { setEditingTitle(false); handleUpdate({ title }); } }}
               className="text-xl font-bold w-full border-b border-blue-500 outline-none"
             />
           ) : (
             <h2 onClick={() => setEditingTitle(true)} className="text-xl font-bold cursor-pointer hover:bg-gray-50 rounded px-2 -ml-2 truncate">
               {note.title}
             </h2>
           )}
           <div className="text-xs text-gray-400 mt-1 ml-1 flex items-center gap-2">
               {new Date(note.createdAt).toLocaleDateString()}
               {note.type === 'folder' && <span className="bg-gray-100 px-1 rounded">文件夹</span>}
           </div>
        </div>
        <button onClick={handleDeleteNote} className="text-red-400 hover:bg-red-50 p-2 rounded-full"><Trash2 size={20}/></button>
      </div>

      {/* 标签区 */}
      {note.type === 'file' && (
        <div className="px-6 py-2 flex flex-wrap items-center gap-2 border-b border-gray-50">
            <Tag size={14} className="text-gray-400"/>
            {note.tags?.map(tag => (
                <span key={tag} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded-full flex items-center gap-1 group">
                    {tag}
                    <X size={10} className="cursor-pointer opacity-0 group-hover:opacity-100" onClick={() => handleRemoveTag(tag)}/>
                </span>
            ))}
            <div className="flex items-center gap-1 bg-gray-50 rounded-full px-2 py-1">
                <input 
                    value={newTag} 
                    onChange={e => setNewTag(e.target.value)} 
                    onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                    placeholder="添加标签..." 
                    className="bg-transparent text-xs w-20 outline-none"
                />
                <Plus size={12} className="cursor-pointer text-gray-400" onClick={handleAddTag}/>
            </div>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
         {note.type === 'folder' ? (
             <div className="text-center text-gray-400 mt-20">
                 <Folder size={48} className="mx-auto mb-4 opacity-30"/>
                 <p>这是文件夹，请在左侧点击 + 号添加子知识点</p>
             </div>
         ) : (
             <>
                {/* 图片列表 */}
                {note.content?.map((item, idx) => (
                    <div key={item.id} className="group relative bg-gray-50 rounded-xl p-2 border border-gray-100">
                        <img src={item.src} className="w-full rounded-lg" />
                        <button onClick={() => handleDeleteImage(item.id)} className="absolute top-4 right-4 bg-red-500 text-white p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition"><Trash2 size={16}/></button>
                        <textarea 
                           placeholder="给这张图写点备注..."
                           className="w-full bg-transparent text-sm mt-2 p-2 outline-none resize-none h-10 focus:bg-white focus:h-20 transition-all rounded"
                           defaultValue={item.desc}
                           onBlur={(e) => {
                               const newContent = [...note.content];
                               newContent[idx].desc = e.target.value;
                               handleUpdate({ content: newContent });
                           }}
                        />
                    </div>
                ))}
                
                {/* 添加图片按钮 */}
                <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 flex flex-col items-center justify-center text-gray-400 hover:bg-gray-50 hover:border-indigo-200 transition cursor-pointer relative">
                    <ImageIcon size={32} className="mb-2"/>
                    <span className="text-sm font-bold">添加知识点截图</span>
                    <input type="file" accept="image/*" onChange={handleAddImage} className="absolute inset-0 opacity-0 cursor-pointer"/>
                </div>
             </>
         )}
         <div className="h-20"></div>
      </div>
    </div>
  );
}

// ==========================================
// 错题本复用组件
// ==========================================

function MistakeList({ mistakes, onAdd, onOpen }) {
  if (!mistakes) return <div className="text-center mt-20 text-gray-400">加载数据中...</div>;
  if (mistakes.length === 0) return (
    <div className="flex flex-col items-center justify-center mt-10 text-gray-400 p-4">
      <div className="mb-4 p-4 bg-gray-200 rounded-full">📝</div>
      <p className="mb-6 font-medium">没有找到相关错题</p>
      <button onClick={onAdd} className="bg-blue-600 text-white px-6 py-2 rounded-full font-bold shadow-lg hover:bg-blue-700 transition text-sm">添加错题</button>
    </div>
  );
  return (
    <div className="space-y-3">
      {mistakes.map((item) => (
        <div key={item.id} onClick={() => onOpen(item.id)} className="bg-white rounded-xl shadow-sm border border-gray-200 active:scale-[0.98] transition-transform cursor-pointer overflow-hidden flex h-36">
          <div className="w-[35%] p-3 flex flex-col justify-between border-r border-gray-100 bg-white z-10">
            <div><h3 className="font-bold text-gray-800 text-sm line-clamp-3 leading-relaxed">{item.title || "未命名"}</h3></div>
            <div className="space-y-1">
               <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium border", item.reflection ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-gray-100 text-gray-400 border-gray-200')}>{item.reflection ? '已复盘' : '待复盘'}</span>
               <div className="text-[10px] text-gray-400 font-medium pl-0.5">{new Date(item.createdAt).toLocaleDateString(undefined, {month:'2-digit', day:'2-digit'})}</div>
            </div>
          </div>
          <div className="flex-1 relative bg-gray-50 h-full">
            {item.questionImg ? <img src={item.questionImg} alt="题目" className="absolute inset-0 w-full h-full object-cover" /> : <div className="flex items-center justify-center h-full text-gray-300 text-xs">无图</div>}
          </div>
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
