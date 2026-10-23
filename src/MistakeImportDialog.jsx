import React, { useRef, useState } from 'react';
import { X, UploadCloud, ClipboardCopy, CheckCircle2, FileJson, AlertTriangle } from 'lucide-react';
import { db } from './db';
import { parseMistakePack, addMistakePack } from './mistakePack';
import { MISTAKE_AI_PROMPT } from './mistakeAiPrompt';

export default function MistakeImportDialog({ subjectId, subjectName, onClose, onImported }) {
  const inputRef = useRef(null);
  const [pack, setPack] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = async (file) => {
    setError(''); setResult(null); setPack(null); setFileName(file?.name || '');
    if (!file) return;
    try { setPack(await parseMistakePack(file)); }
    catch (e) { setError(e.message); }
  };
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(MISTAKE_AI_PROMPT);
    } catch {
      // http环境下剪贴板接口可能不可用，改用传统复制方案
      const element = document.createElement('textarea');
      element.value = MISTAKE_AI_PROMPT;
      element.style.position = 'fixed';
      element.style.opacity = '0';
      document.body.appendChild(element);
      element.select();
      const ok = document.execCommand('copy');
      element.remove();
      if (!ok) { setError('复制失败，请在HTTPS地址打开应用'); return; }
    }
    setCopied(true);
  };
  const commit = async () => {
    if (!pack || busy) return;
    setBusy(true); setError('');
    try {
      const result = await addMistakePack(db, pack, subjectId, subjectName);
      setResult(result);
      onImported?.(result);
    } catch (e) { setError(e.message || '导入失败'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/45 flex items-center justify-center p-3 sm:p-6" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label="导入AI错题包" className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto text-slate-800">
        <header className="sticky top-0 bg-white z-10 flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold">导入错题</h2>
            <p className="text-xs text-gray-500 mt-1">新增到「{subjectName || '当前科目'}」 · 文件靠后的题显示在列表上方</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="p-2 rounded-lg hover:bg-gray-100"><X size={20}/></button>
        </header>
        <div className="p-5 space-y-5">
          <section>
            <h3 className="text-sm font-bold mb-2 flex gap-2 items-center"><FileJson size={16}/> ① 选择文件</h3>
            <input ref={inputRef} type="file" accept=".merror,.json,application/json" className="hidden" onChange={e => { load(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" onClick={() => inputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 rounded-xl p-4 border-2 border-dashed border-blue-200 bg-blue-50/40 text-blue-700 hover:bg-blue-50 text-sm font-bold">
              <UploadCloud size={20}/> {fileName || '点击选择 .merror / .json 错题包'}
            </button>
            <p className="text-xs text-gray-500 mt-2">支持文字题干、Markdown、LaTeX、表格及内嵌静态图解；文件第1题最后显示，第末题最先显示。最多120道/24MB。</p>
          </section>
          {pack && (
            <div className="border border-blue-100 bg-blue-50/40 rounded-xl p-3 text-sm">
              <p className="font-bold mb-1">校验完成：{pack.items.length}道</p>
              <p className="text-xs text-gray-500">文件学科：{pack.subject || '未指定'} · 导入学科：{subjectName || '当前'}</p>
              <ol className="max-h-32 overflow-y-auto list-decimal pl-5 text-xs mt-2 space-y-1">
                {pack.items.map(item => <li key={item.sourceId}>{item.title}</li>)}
              </ol>
              {!result && <button type="button" onClick={commit} disabled={busy}
                className="w-full mt-3 py-2.5 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-60">
                {busy ? '正在导入…' : '确认导入（自动修正重复题排序）'}
              </button>}
            </div>
          )}
          {result && <p role="status" className="text-sm flex gap-2 items-center text-green-700 bg-green-50 rounded-xl p-3">
            <CheckCircle2 size={18}/> 新增 {result.added} 道，已按文件顺序重排 {result.reordered} 道（原有解析、修改与掌握状态不变）。
          </p>}
          {error && <div role="alert" className="text-sm text-red-700 bg-red-50 rounded-xl p-3 flex items-start gap-2"><AlertTriangle size={18} className="shrink-0"/>{error}</div>}
          <section className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-bold mb-2 flex gap-2 items-center"><ClipboardCopy size={16}/> ② 复制 AI 提示词</h3>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">把提示词发给 AI，再提供题目、手写过程或讲解内容，AI 就能生成相同格式的批量错题包。每题单独一条，答案解析初始隐藏。</p>
            <button type="button" onClick={copyPrompt} className="w-full py-3 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 font-bold text-sm flex items-center justify-center gap-2">
              <ClipboardCopy size={17}/>{copied ? '已复制 AI 提示词' : '复制 AI 生成错题文件提示词'}
            </button>
          </section>
        </div>
      </section>
    </div>
  );
}
