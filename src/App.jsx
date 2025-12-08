import React, { useState, useMemo } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Maximize, ArrowLeft, Eye, EyeOff, Trash2, Save, Edit, X, Search, ChevronRight } from 'lucide-react';

// --- 版本控制 ---
const APP_VERSION = "v1.4.0 (搜索+下一题)";

// --- 工具函数 ---
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = error => reject(error);
});

// --- 主应用组件 ---
function App() {
  const [view, setView] = useState('list'); 
  const [currentMistakeId, setCurrentMistakeId] = useState(null);
  const [searchQuery, setSearchQuery] = useState(''); // 新增：搜索关键词状态

  // 获取所有错题
  const mistakes = useLiveQuery(() => db.mistakes.orderBy('createdAt').reverse().toArray());
  
  // 获取当前错题
  const currentMistake = useLiveQuery(
    () => currentMistakeId ? db.mistakes.get(currentMistakeId) : null,
    [currentMistakeId]
  );

  // --- 搜索过滤逻辑 ---
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

  // --- 下一题逻辑 ---
  const handleNextMistake = () => {
    if (!mistakes || !currentMistakeId) return;
    // 在当前过滤后的列表中查找（这样搜索后也能点下一题）
    const listToUse = searchQuery ? filteredMistakes : mistakes;
    const currentIndex = listToUse.findIndex(m => m.id === currentMistakeId);
    if (currentIndex !== -1 && currentIndex < listToUse.length - 1) {
      setCurrentMistakeId(listToUse[currentIndex + 1].id);
      // 保持在详情页，只切换数据
      window.scrollTo(0, 0); // 回到顶部
    } else {
      alert("已经是最后一题了");
    }
  };

  // 判断是否还有下一题（用于控制按钮显示）
  const hasNext = useMemo(() => {
    if (!mistakes || !currentMistakeId) return false;
    const listToUse = searchQuery ? filteredMistakes : mistakes;
    const currentIndex = listToUse.findIndex(m => m.id === currentMistakeId);
    return currentIndex !== -1 && currentIndex < listToUse.length - 1;
  }, [mistakes, filteredMistakes, currentMistakeId, searchQuery]);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(e => console.log(e));
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 font-sans">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm p-4 sticky top-0 z-30 flex justify-between items-center border-b border-gray-200">
        <div className="flex items-center gap-3">
          {view !== 'list' && (
            <button onClick={() => setView('list')} className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition text-gray-600">
              <ArrowLeft size={22} />
            </button>
          )}
          <h1 className="text-lg font-bold text-gray-900 tracking-tight">
            {view === 'list' ? '数学复盘' : view === 'add' ? '记录错题' : '错题详情'}
          </h1>
        </div>
        <button onClick={toggleFullScreen} className="p-2 -mr-2 hover:bg-gray-100 rounded-full text-gray-500">
          <Maximize size={22} />
        </button>
      </nav>

      {/* 主内容区 */}
      <main className="max-w-3xl mx-auto pb-24">
        {view === 'list' && (
          <div className="space-y-3 p-3">
            {/* 搜索框 */}
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={18} className="text-gray-400" />
              </div>
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索题目、备注或日期..." 
                className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm transition"
              />
            </div>

            <MistakeList 
              mistakes={filteredMistakes} 
              onAdd={() => setView('add')} 
              onOpen={(id) => { setCurrentMistakeId(id); setView('detail'); }} 
            />
          </div>
        )}
        
        {view === 'add' && <MistakeForm mode="add" onFinish={() => setView('list')} />}
        
        {view === 'detail' && currentMistake && (
          <MistakeDetail 
            mistake={currentMistake} 
            hasNext={hasNext} // 传入是否有下一题
            onNext={handleNextMistake} // 传入下一题处理函数
            onDelete={() => setView('list')}
            onEdit={() => setView('edit')}
          />
        )}
        
        {view === 'edit' && currentMistake && (
          <MistakeForm 
            mode="edit" 
            initialData={currentMistake} 
            onFinish={() => setView('detail')} 
            onCancel={() => setView('detail')}
          />
        )}
      </main>

      {/* 版本号显示 */}
      {view === 'list' && (
        <div className="text-center py-6 text-gray-400 text-xs font-mono opacity-60">
          Build: {APP_VERSION}
        </div>
      )}
    </div>
  );
}

// --- 1. 错题列表组件 ---
function MistakeList({ mistakes, onAdd, onOpen }) {
  if (!mistakes) return <div className="text-center mt-20 text-gray-400">加载数据中...</div>;
  
  if (mistakes.length === 0) return (
    <div className="flex flex-col items-center justify-center mt-10 text-gray-400 p-4">
      <div className="mb-4 p-4 bg-gray-200 rounded-full">📝</div>
      <p className="mb-6 font-medium">没有找到相关错题</p>
      <button onClick={onAdd} className="bg-blue-600 text-white px-6 py-2 rounded-full font-bold shadow-lg hover:bg-blue-700 transition text-sm">
        添加错题
      </button>
    </div>
  );

  return (
    <div className="space-y-3">
      {mistakes.map((item) => (
        <div 
          key={item.id} 
          onClick={() => onOpen(item.id)}
          className="bg-white rounded-xl shadow-sm border border-gray-200 active:scale-[0.98] transition-transform cursor-pointer overflow-hidden flex h-36"
        >
          {/* 左侧：信息区 (35%) */}
          <div className="w-[35%] p-3 flex flex-col justify-between border-r border-gray-100 bg-white z-10">
            <div>
              <h3 className="font-bold text-gray-800 text-sm line-clamp-3 leading-relaxed">
                {item.title || "未命名"}
              </h3>
            </div>
            <div className="space-y-1">
               <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
                   item.reflection 
                   ? 'bg-blue-50 text-blue-600 border-blue-100' 
                   : 'bg-gray-100 text-gray-400 border-gray-200'
               }`}>
                   {item.reflection ? '已复盘' : '待复盘'}
               </span>
               <div className="text-[10px] text-gray-400 font-medium pl-0.5">
                 {new Date(item.createdAt).toLocaleDateString(undefined, {month:'2-digit', day:'2-digit'})}
               </div>
            </div>
          </div>
          
          {/* 右侧：图片区 (65%) */}
          <div className="flex-1 relative bg-gray-50 h-full">
            {item.questionImg ? (
              <img src={item.questionImg} alt="题目" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-300 text-xs">无图</div>
            )}
          </div>
        </div>
      ))}
      
      {/* 悬浮按钮 */}
      <button 
        onClick={onAdd}
        className="fixed bottom-8 right-6 bg-blue-600 text-white p-4 rounded-full shadow-[0_4px_14px_rgba(37,99,235,0.4)] hover:bg-blue-700 active:scale-90 transition-all z-40"
      >
        <Plus size={26} strokeWidth={2.5} />
      </button>
    </div>
  );
}

// --- 2. 通用表单组件 ---
function MistakeForm({ mode, initialData, onFinish, onCancel }) {
  const isEdit = mode === 'edit';
  const [title, setTitle] = useState(initialData?.title || '');
  const [qImg, setQImg] = useState(initialData?.questionImg || null);
  const [aImg, setAImg] = useState(initialData?.analysisImg || null);
  const [reflection, setReflection] = useState(initialData?.reflection || '');
  const [analysisText, setAnalysisText] = useState(initialData?.analysisText || '');
  const [loading, setLoading] = useState(false);

  const handleImage = async (e, setter) => {
    const file = e.target.files[0];
    if (file) {
      const base64 = await fileToBase64(file);
      setter(base64);
    }
  };

  const handleSubmit = async () => {
    if (!qImg) return alert("必须上传题目图片");
    setLoading(true);
    const data = { title, questionImg: qImg, analysisImg: aImg, analysisText, reflection };
    try {
      if (isEdit) {
        await db.mistakes.update(initialData.id, data);
      } else {
        await db.mistakes.add({ ...data, createdAt: new Date() });
      }
      onFinish();
    } catch (e) {
      alert("保存失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white min-h-screen sm:min-h-0 sm:rounded-xl p-4 sm:p-6 pb-20 space-y-5 relative">
      <div className="flex justify-between items-center mb-2">
         <h2 className="text-lg font-bold text-gray-800">{isEdit ? '编辑错题' : '记录错题'}</h2>
         {isEdit && <button onClick={onCancel}><X size={24} className="text-gray-400"/></button>}
      </div>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">1. 题目图片 <span className="text-red-500">*</span></label>
          <ImageUpload value={qImg} onChange={setQImg} />
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">标题 / 备注</label>
          <input 
            type="text" value={title} onChange={e => setTitle(e.target.value)}
            placeholder="例如：极限计算-洛必达法则条件" 
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-500 transition" 
          />
        </div>
        <div className="border-t border-dashed pt-4">
          <label className="block text-sm font-bold text-gray-700 mb-2">2. 复盘思路</label>
          <textarea 
            value={reflection} onChange={e => setReflection(e.target.value)}
            className="w-full p-3 bg-yellow-50 border border-yellow-200 rounded-xl h-28 text-sm outline-none focus:border-yellow-400 transition resize-none"
            placeholder="关键点在哪里？当时是怎么想错的？"
          ></textarea>
        </div>
        <div className="border-t border-dashed pt-4">
          <label className="block text-sm font-bold text-gray-700 mb-2">3. 答案解析</label>
          <ImageUpload value={aImg} onChange={setAImg} isAnalysis />
          <textarea 
            value={analysisText} onChange={e => setAnalysisText(e.target.value)}
            className="w-full mt-3 p-3 bg-gray-50 border border-gray-200 rounded-xl h-20 text-sm outline-none focus:border-green-500 transition resize-none"
            placeholder="或粘贴文字解析..."
          ></textarea>
        </div>
      </div>
      <button 
        onClick={handleSubmit} disabled={loading}
        className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-bold shadow-md active:scale-[0.98] transition flex justify-center items-center gap-2 mt-4"
      >
        <Save size={18} /> {loading ? '保存中...' : '保存'}
      </button>
    </div>
  );
}

function ImageUpload({ value, onChange, isAnalysis }) {
  const handleFile = async (e) => {
    const file = e.target.files[0];
    if(file) onChange(await fileToBase64(file));
  };
  return (
    <div className={`relative border-2 border-dashed rounded-xl h-32 flex items-center justify-center overflow-hidden bg-gray-50 transition ${isAnalysis ? 'border-green-200' : 'border-blue-200'}`}>
      {!value ? (
        <div className="flex flex-col items-center gap-1 text-gray-400">
          <Plus size={24} /> <span className="text-xs">点击上传</span>
          <input type="file" accept="image/*" onChange={handleFile} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
        </div>
      ) : (
        <div className="relative w-full h-full group">
          <img src={value} className="w-full h-full object-contain" />
          <button onClick={()=>onChange(null)} className="absolute top-2 right-2 p-1.5 bg-red-500/80 text-white rounded-full"><Trash2 size={14}/></button>
        </div>
      )}
    </div>
  )
}

// --- 3. 错题详情组件 (新增下一题) ---
function MistakeDetail({ mistake, onDelete, onEdit, onNext, hasNext }) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  
  // 切换题目时，自动重置“显示解析”的状态
  // 这样点下一题时，新题目的解析是隐藏的
  React.useEffect(() => {
    setShowAnalysis(false);
  }, [mistake.id]);

  const handleDelete = async () => {
    if(confirm('删除后无法恢复，确定吗？')) {
      await db.mistakes.delete(mistake.id);
      onDelete();
    }
  }

  return (
    <div className="bg-white min-h-screen sm:min-h-0 sm:rounded-xl pb-24 overflow-hidden relative">
      <div className="p-4 border-b border-gray-100 flex justify-between items-start bg-white sticky top-0 z-10">
        <div>
           <h2 className="font-bold text-lg text-gray-900 leading-snug">{mistake.title || "题目详情"}</h2>
           <p className="text-xs text-gray-400 mt-1">{new Date(mistake.createdAt).toLocaleString()}</p>
        </div>
        <button onClick={onEdit} className="p-2 bg-gray-50 text-blue-600 rounded-lg hover:bg-blue-50">
          <Edit size={18} />
        </button>
      </div>

      <div className="p-4 space-y-6">
        <div className="rounded-xl overflow-hidden border border-gray-100 shadow-sm">
          <img src={mistake.questionImg} alt="题目" className="w-full" />
        </div>

        {/* 底部控制栏 */}
        <div className="fixed bottom-6 w-full max-w-3xl left-1/2 -translate-x-1/2 px-4 z-20 flex items-center justify-center pointer-events-none">
          <div className="bg-white/95 backdrop-blur-md p-2 rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-200 flex items-center gap-3 pointer-events-auto">
             <button onClick={handleDelete} className="p-3 rounded-full text-red-400 hover:bg-red-50 transition">
              <Trash2 size={20} />
            </button>
            
            <div className="h-6 w-[1px] bg-gray-200"></div>

            <button 
              onClick={() => setShowAnalysis(!showAnalysis)}
              className={`flex items-center gap-2 px-6 py-3 rounded-full font-bold text-sm transition-all whitespace-nowrap ${
                showAnalysis 
                ? 'bg-gray-100 text-gray-700' 
                : 'bg-green-600 text-white shadow-lg'
              }`}
            >
              {showAnalysis ? <><EyeOff size={18}/> 遮住答案</> : <><Eye size={18}/> 查看解析</>}
            </button>

            {/* 下一题按钮：只有当 hasNext 为 true 时才显示 */}
            {hasNext && (
              <>
                <div className="h-6 w-[1px] bg-gray-200"></div>
                <button 
                  onClick={onNext} 
                  className="p-3 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition animate-pulse-slow"
                  title="下一题"
                >
                  <ChevronRight size={24} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className={`space-y-4 transition-all duration-300 ${showAnalysis ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'}`}>
          <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200 text-sm">
             <div className="font-bold text-yellow-800 mb-1 flex items-center gap-1">💡 我的复盘</div>
             <p className="whitespace-pre-wrap text-gray-800 leading-relaxed">
               {mistake.reflection || "暂无复盘记录"}
             </p>
          </div>
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
