import React, { useState } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Maximize, ArrowLeft, Eye, EyeOff, Trash2, Save } from 'lucide-react';

// 工具：图片转Base64
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = error => reject(error);
});

function App() {
  const [view, setView] = useState('list'); // 'list', 'add', 'detail'
  const [currentMistake, setCurrentMistake] = useState(null);
  const mistakes = useLiveQuery(() => db.mistakes.orderBy('createdAt').reverse().toArray());

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(e => console.log(e));
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 pb-10">
      <nav className="bg-white shadow-sm p-4 sticky top-0 z-20 flex justify-between items-center">
        <div className="flex items-center gap-2">
          {view !== 'list' && (
            <button onClick={() => setView('list')} className="p-2 hover:bg-gray-100 rounded-full">
              <ArrowLeft size={24} />
            </button>
          )}
          <h1 className="text-xl font-bold text-blue-900">数学错题本</h1>
        </div>
        <button onClick={toggleFullScreen} className="p-2 hover:bg-gray-100 rounded-full text-gray-600">
          <Maximize size={24} />
        </button>
      </nav>

      <main className="p-4 max-w-3xl mx-auto">
        {view === 'list' && (
          <MistakeList 
            mistakes={mistakes} 
            onAdd={() => setView('add')} 
            onOpen={(item) => { setCurrentMistake(item); setView('detail'); }} 
          />
        )}
        {view === 'add' && <AddMistake onSave={() => setView('list')} />}
        {view === 'detail' && <MistakeDetail mistake={currentMistake} onDelete={() => setView('list')} />}
      </main>
    </div>
  );
}

function MistakeList({ mistakes, onAdd, onOpen }) {
  if (!mistakes) return <div className="text-center mt-20 text-gray-400">加载数据中...</div>;
  if (mistakes.length === 0) return (
    <div className="text-center mt-20">
      <div className="text-gray-400 mb-4">还没有错题，开始记录吧！</div>
      <button onClick={onAdd} className="bg-blue-600 text-white px-6 py-2 rounded-full font-bold">添加第一道题</button>
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-1 gap-4">
        {mistakes.map((item) => (
          <div 
            key={item.id} 
            onClick={() => onOpen(item)}
            className="bg-white rounded-xl shadow-sm active:scale-95 transition-transform cursor-pointer overflow-hidden border border-gray-100 flex h-28"
          >
            <div className="w-28 bg-gray-50 flex-shrink-0">
              {item.questionImg ? (
                <img src={item.questionImg} alt="题目" className="object-cover w-full h-full" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">无图</div>
              )}
            </div>
            <div className="p-3 flex-1 flex flex-col justify-center">
              <h3 className="font-bold text-gray-800 line-clamp-2">{item.title || "未命名错题"}</h3>
              <p className="text-xs text-gray-400 mt-2">{new Date(item.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        ))}
      </div>
      <button 
        onClick={onAdd}
        className="fixed bottom-8 right-6 bg-blue-600 text-white p-4 rounded-full shadow-xl hover:bg-blue-700 z-30"
      >
        <Plus size={28} />
      </button>
    </div>
  );
}

function AddMistake({ onSave }) {
  const [title, setTitle] = useState('');
  const [qImg, setQImg] = useState(null);
  const [aImg, setAImg] = useState(null);
  const [reflection, setReflection] = useState('');
  const [analysisText, setAnalysisText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleImage = async (e, setter) => {
    const file = e.target.files[0];
    if (file) {
      // 简单的图片压缩逻辑（防止存入数据库过大）
      const base64 = await fileToBase64(file);
      setter(base64);
    }
  };

  const saveToDb = async () => {
    if (!qImg) return alert("必须上传题目图片");
    setLoading(true);
    try {
      await db.mistakes.add({
        title,
        questionImg: qImg,
        analysisImg: aImg,
        analysisText,
        reflection,
        createdAt: new Date()
      });
      onSave();
    } catch (e) {
      alert("保存失败，可能是图片太大。建议截图时截小一点。");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-4 rounded-xl shadow-sm space-y-4">
      <h2 className="text-lg font-bold mb-4">记录新错题</h2>
      
      <div>
        <label className="block text-sm font-bold text-gray-700 mb-1">1. 题目图片 (必填)</label>
        <div className="relative border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:bg-gray-50">
           {!qImg ? (
             <>
               <span className="text-gray-400 text-sm">点击上传或拍照</span>
               <input type="file" accept="image/*" onChange={(e) => handleImage(e, setQImg)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
             </>
           ) : (
             <div className="relative">
                <img src={qImg} className="max-h-40 mx-auto rounded"/>
                <button onClick={()=>setQImg(null)} className="absolute top-0 right-0 bg-red-500 text-white text-xs p-1 rounded">删除</button>
             </div>
           )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-700 mb-1">备注/标题</label>
        <input 
          type="text" 
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="例如：泰勒公式展开错误" 
          className="w-full p-3 bg-gray-50 border-none rounded-lg text-sm" 
        />
      </div>

      <div className="border-t pt-4">
        <label className="block text-sm font-bold text-gray-700 mb-1">2. 复盘思路 (你的思考)</label>
        <textarea 
          value={reflection}
          onChange={e => setReflection(e.target.value)}
          className="w-full p-3 bg-yellow-50 border border-yellow-100 rounded-lg h-24 text-sm"
          placeholder="我是怎么想错的？哪个知识点忘了？"
        ></textarea>
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-700 mb-1">3. 正确解析 (截图或文字)</label>
        <div className="flex gap-2 mb-2">
            <div className="relative flex-1 border-2 border-dashed border-gray-300 rounded-lg p-2 text-center h-20 flex items-center justify-center">
                {!aImg ? (
                    <>
                    <span className="text-gray-400 text-xs">上传解析图</span>
                    <input type="file" accept="image/*" onChange={(e) => handleImage(e, setAImg)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
                    </>
                ) : (
                    <div className="relative w-full h-full">
                        <img src={aImg} className="h-full mx-auto object-contain"/>
                        <button onClick={()=>setAImg(null)} className="absolute top-0 right-0 bg-red-500 w-4 h-4 rounded-full border border-white"></button>
                    </div>
                )}
            </div>
        </div>
        <textarea 
          value={analysisText}
          onChange={e => setAnalysisText(e.target.value)}
          className="w-full p-3 bg-gray-50 border-none rounded-lg h-20 text-sm"
          placeholder="粘贴文字解析..."
        ></textarea>
      </div>

      <button 
        onClick={saveToDb} 
        disabled={loading}
        className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold shadow-lg active:scale-95 transition-transform flex justify-center items-center gap-2"
      >
        <Save size={18} />
        {loading ? '保存中...' : '保存'}
      </button>
    </div>
  );
}

function MistakeDetail({ mistake, onDelete }) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  
  const handleDelete = async () => {
    if(confirm('删除后无法恢复，确定吗？')) {
      await db.mistakes.delete(mistake.id);
      onDelete();
    }
  }

  return (
    <div className="space-y-4 pb-20">
      <div className="bg-white p-4 rounded-xl shadow-sm">
        <h2 className="font-bold text-lg mb-3 border-l-4 border-blue-500 pl-2">{mistake.title || "题目"}</h2>
        <img src={mistake.questionImg} alt="题目" className="w-full rounded-lg" />
      </div>

      <div className="flex justify-between items-center px-2">
        <button 
          onClick={() => setShowAnalysis(!showAnalysis)}
          className={`flex items-center gap-2 px-6 py-3 rounded-full font-bold transition shadow-md ${
            showAnalysis 
            ? 'bg-gray-200 text-gray-700' 
            : 'bg-green-600 text-white animate-pulse'
          }`}
        >
          {showAnalysis ? <><EyeOff size={18}/> 遮住答案</> : <><Eye size={18}/> 查看解析</>}
        </button>

        <button onClick={handleDelete} className="bg-white text-red-400 p-3 rounded-full shadow-sm border border-gray-100">
          <Trash2 size={20} />
        </button>
      </div>

      {showAnalysis && (
        <div className="animate-fade-in space-y-4">
          {mistake.reflection && (
             <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200">
                <div className="text-yellow-800 text-xs font-bold mb-1 uppercase tracking-wider">我的复盘</div>
                <p className="text-gray-800 whitespace-pre-wrap">{mistake.reflection}</p>
             </div>
          )}

          <div className="bg-white p-4 rounded-xl shadow-sm border-t-4 border-green-500">
            <div className="font-bold text-green-700 mb-2">标准解析</div>
            {mistake.analysisImg && (
              <img src={mistake.analysisImg} alt="解析" className="w-full rounded-lg mb-4" />
            )}
            {mistake.analysisText && (
              <div className="text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
                {mistake.analysisText}
              </div>
            )}
            {!mistake.analysisImg && !mistake.analysisText && <p className="text-gray-400 italic">暂无解析内容</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
