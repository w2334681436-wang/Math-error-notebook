// src/App.jsx
import React, { useState, useEffect } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Maximize, ArrowLeft, Eye, EyeOff, Trash2, Save, Edit, X } from 'lucide-react';

// --- 工具函数 ---
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = error => reject(error);
});

// --- 主应用组件 ---
function App() {
  const [view, setView] = useState('list'); // 'list', 'add', 'detail'
  const [currentMistakeId, setCurrentMistakeId] = useState(null);
  const mistakes = useLiveQuery(() => db.mistakes.orderBy('createdAt').reverse().toArray());
  const currentMistake = useLiveQuery(
    () => currentMistakeId ? db.mistakes.get(currentMistakeId) : null,
    [currentMistakeId]
  );

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(e => console.log(e));
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm p-4 sticky top-0 z-30 flex justify-between items-center">
        <div className="flex items-center gap-3">
          {view !== 'list' && (
            <button onClick={() => setView('list')} className="p-2 -ml-2 hover:bg-gray-50 rounded-full transition">
              <ArrowLeft size={24} className="text-gray-600" />
            </button>
          )}
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-700 to-blue-500 bg-clip-text text-transparent">
            {view === 'list' ? '数学复盘' : view === 'add' ? '记录错题' : '错题详情'}
          </h1>
        </div>
        <button onClick={toggleFullScreen} className="p-2 -mr-2 hover:bg-gray-50 rounded-full text-gray-500 transition">
          <Maximize size={24} />
        </button>
      </nav>

      {/* 主内容区 */}
      <main className="p-4 max-w-3xl mx-auto pb-24">
        {view === 'list' && (
          <MistakeList 
            mistakes={mistakes} 
            onAdd={() => setView('add')} 
            onOpen={(id) => { setCurrentMistakeId(id); setView('detail'); }} 
          />
        )}
        {view === 'add' && <MistakeForm mode="add" onFinish={() => setView('list')} />}
        {view === 'detail' && currentMistake && (
          <MistakeDetail 
            mistake={currentMistake} 
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
    </div>
  );
}

// --- 1. 错题列表组件 (全新布局) ---
function MistakeList({ mistakes, onAdd, onOpen }) {
  if (!mistakes) return <div className="text-center mt-20 text-gray-400 animate-pulse">加载数据中...</div>;
  if (mistakes.length === 0) return (
    <div className="flex flex-col items-center justify-center mt-20 text-gray-400">
      <div className="mb-4 text-6xl">📝</div>
      <p className="mb-6">还没有错题，开始你的复盘之旅吧！</p>
      <button onClick={onAdd} className="bg-blue-600 text-white px-6 py-3 rounded-full font-bold shadow-lg hover:bg-blue-700 transition">
        添加第一道题
      </button>
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {mistakes.map((item) => (
          <div 
            key={item.id} 
            onClick={() => onOpen(item.id)}
            className="relative h-64 bg-white rounded-2xl shadow-sm active:scale-[0.98] transition-all cursor-pointer overflow-hidden group"
          >
            {/* 图片占满整个容器 */}
            {item.questionImg ? (
              <img src={item.questionImg} alt="题目" className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-105" />
            ) : (
              <div className="absolute inset-0 bg-gray-100 flex items-center justify-center text-gray-300">无图片</div>
            )}
            
            {/* 底部文本条：半透明背景，左标题右日期 */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-4 pt-10 flex justify-between items-end text-white">
              <h3 className="font-bold text-lg truncate mr-4 flex-1 text-shadow">{item.title || "无标题错题"}</h3>
              <span className="text-xs opacity-80 font-medium whitespace-nowrap bg-black/30 px-2 py-1 rounded-full backdrop-blur-sm">
                {new Date(item.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>
      <button 
        onClick={onAdd}
        className="fixed bottom-8 right-6 bg-blue-600 text-white p-4 rounded-full shadow-[0_4px_20px_rgba(37,99,235,0.4)] hover:bg-blue-700 active:scale-90 transition-all z-40"
      >
        <Plus size={28} strokeWidth={2.5} />
      </button>
    </div>
  );
}

// --- 2. 通用表单组件 (用于添加和编辑) ---
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
      alert("保存失败，可能是图片太大。建议截图时截小一点。");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm space-y-5 relative">
      {isEdit && (
        <button onClick={onCancel} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-500 hover:bg-gray-200">
          <X size={20} />
        </button>
      )}
      <h2 className="text-xl font-bold text-gray-800">{isEdit ? '编辑错题' : '记录新错题'}</h2>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">1. 题目图片 (必填)</label>
          <ImageUpload value={qImg} onChange={setQImg} />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">备注/标题</label>
          <input 
            type="text" 
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="例如：导数极值点遗漏情况" 
            className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl text-base focus:ring-2 focus:ring-blue-500 focus:bg-white transition outline-none" 
          />
        </div>

        <div className="border-t border-dashed pt-4">
          <label className="block text-sm font-bold text-gray-700 mb-2">2. 复盘思路 (关键!)</label>
          <textarea 
            value={reflection}
            onChange={e => setReflection(e.target.value)}
            className="w-full p-3 bg-yellow-50 border border-yellow-200 rounded-xl h-32 text-base focus:ring-2 focus:ring-yellow-500 transition outline-none resize-none"
            placeholder="写下你的思维断点：为什么错了？哪个知识点没关联上？"
          ></textarea>
        </div>

        <div className="border-t border-dashed pt-4">
          <label className="block text-sm font-bold text-gray-700 mb-2">3. 正确解析</label>
          <ImageUpload value={aImg} onChange={setAImg} isAnalysis />
          <textarea 
            value={analysisText}
            onChange={e => setAnalysisText(e.target.value)}
            className="w-full mt-3 p-3 bg-gray-50 border border-gray-100 rounded-xl h-24 text-sm focus:ring-2 focus:ring-green-500 focus:bg-white transition outline-none resize-none"
            placeholder="或粘贴文字解析..."
          ></textarea>
        </div>
      </div>

      <button 
        onClick={handleSubmit} 
        disabled={loading}
        className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:bg-blue-700 active:scale-[0.98] transition flex justify-center items-center gap-2 disabled:opacity-50 disabled:scale-100"
      >
        <Save size={20} />
        {loading ? '保存中...' : '保存记录'}
      </button>
    </div>
  );
}

// 子组件：图片上传控件
function ImageUpload({ value, onChange, isAnalysis }) {
  const handleFile = async (e) => {
    const file = e.target.files[0];
    if(file) onChange(await fileToBase64(file));
  };
  return (
    <div className={`relative border-2 border-dashed rounded-xl p-2 text-center h-40 flex items-center justify-center overflow-hidden bg-gray-50 transition hover:bg-gray-100 ${isAnalysis ? 'border-green-200' : 'border-blue-200'}`}>
      {!value ? (
        <div className="flex flex-col items-center gap-2 text-gray-400">
          <Plus size={30} className={isAnalysis ? 'text-green-400' : 'text-blue-400'} />
          <span className="text-sm font-medium">点击上传或拍照</span>
          <input type="file" accept="image/*" onChange={handleFile} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
        </div>
      ) : (
        <div className="relative w-full h-full group">
          <img src={value} className="w-full h-full object-contain" />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-4">
            <button onClick={() => document.getElementById('edit-' + (isAnalysis?'a':'q')).click()} className="p-2 bg-white rounded-full text-gray-700"><Edit size={20}/></button>
            <button onClick={()=>onChange(null)} className="p-2 bg-white rounded-full text-red-500"><Trash2 size={20}/></button>
          </div>
            <input id={'edit-' + (isAnalysis?'a':'q')} type="file" accept="image/*" onChange={handleFile} className="hidden"/>
        </div>
      )}
    </div>
  )
}

// --- 3. 错题详情组件 (带编辑入口) ---
function MistakeDetail({ mistake, onDelete, onEdit }) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  
  const handleDelete = async () => {
    if(confirm('删除后无法恢复，确定要彻底删除这道题吗？')) {
      await db.mistakes.delete(mistake.id);
      onDelete();
    }
  }

  return (
    <div className="space-y-6">
      {/* 题目区域 */}
      <div className="bg-white p-5 rounded-2xl shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-2 h-full bg-blue-500"></div>
        <div className="flex justify-between items-start mb-4 pl-4">
          <h2 className="font-bold text-xl text-gray-800">{mistake.title || "题目"}</h2>
          <button onClick={onEdit} className="p-2 bg-gray-100 text-blue-600 rounded-full hover:bg-blue-100 transition flex items-center gap-1 text-sm font-bold px-3">
            <Edit size={16} /> 编辑
          </button>
        </div>
        <img src={mistake.questionImg} alt="题目" className="w-full rounded-xl border border-gray-100" />
      </div>

      {/* 控制栏 */}
      <div className="flex justify-between items-center px-2 py-4 sticky bottom-0 bg-gray-100/80 backdrop-blur-md z-10 -mx-4 px-6 border-t border-gray-200/50">
        <button 
          onClick={() => setShowAnalysis(!showAnalysis)}
          className={`flex items-center gap-2 px-6 py-3 rounded-full font-bold text-lg transition-all shadow-md ${
            showAnalysis 
            ? 'bg-gray-200 text-gray-700 scale-95' 
            : 'bg-green-600 text-white hover:bg-green-700 hover:scale-105 active:scale-95'
          }`}
        >
          {showAnalysis ? <><EyeOff size={20}/> 遮住答案</> : <><Eye size={20}/> 查看解析</>}
        </button>

        <button onClick={handleDelete} className="text-red-400 p-3 rounded-full hover:bg-red-50 transition border border-transparent hover:border-red-100">
          <Trash2 size={24} />
        </button>
      </div>

      {/* 复盘与解析区域 (动画显示) */}
      <div className={`space-y-4 transition-all duration-500 ${showAnalysis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none h-0 overflow-hidden'}`}>
        <div className="bg-yellow-50 p-5 rounded-2xl border border-yellow-200 shadow-sm relative">
          <div className="absolute -top-3 left-4 bg-yellow-400 text-yellow-900 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider shadow-sm">我的复盘</div>
          <p className="text-gray-800 whitespace-pre-wrap leading-relaxed mt-2">
            {mistake.reflection || "（当时没有记录复盘思路... 下次记得写上！）"}
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border-l-4 border-green-500">
          <h3 className="font-bold text-lg text-green-800 mb-4 flex items-center gap-2">
            <span className="bg-green-100 p-1 rounded">🎯</span> 标准解析
          </h3>
          {mistake.analysisImg && (
            <img src={mistake.analysisImg} alt="解析" className="w-full rounded-xl mb-4 border border-gray-100" />
          )}
          {mistake.analysisText && (
            <div className="bg-gray-50 p-4 rounded-xl text-gray-700 whitespace-pre-wrap leading-7 text-base">
              {mistake.analysisText}
            </div>
          )}
          {!mistake.analysisImg && !mistake.analysisText && <p className="text-gray-400 italic text-center py-4">暂无解析内容</p>}
        </div>
      </div>
    </div>
  );
}

export default App;
