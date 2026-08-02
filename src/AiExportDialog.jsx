import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bot, Brain, Check, FileText, Image as ImageIcon, Layers3, X } from 'lucide-react';
import { db } from './db';

const contentOptions = [
  {
    key: 'includeQuestionImages',
    label: '题目图片',
    description: 'AI 可以直接识别完整题目',
    icon: ImageIcon,
  },
  {
    key: 'includeAnalysisImages',
    label: '解析图片',
    description: '保留手写或截图形式的答案',
    icon: ImageIcon,
  },
  {
    key: 'includeReflection',
    label: '我的复盘思路',
    description: '帮助 AI 判断具体错误原因',
    icon: Brain,
  },
  {
    key: 'includeAnalysisText',
    label: '标准解析文字',
    description: '保留 Markdown 与 LaTeX 解析',
    icon: FileText,
  },
  {
    key: 'includeReviewInfo',
    label: '复习轮次与掌握状态',
    description: '用于判断复习优先级和薄弱程度',
    icon: Layers3,
  },
];

const defaultContent = {
  includeQuestionImages: true,
  includeAnalysisImages: true,
  includeReflection: true,
  includeAnalysisText: true,
  includeReviewInfo: true,
};

function ToggleCard({ checked, icon: Icon, label, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border p-3 text-left flex items-center gap-3 transition ${
        checked ? 'border-violet-300 bg-violet-50' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${checked ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-gray-800">{label}</span>
        <span className="block text-[11px] leading-4 text-gray-500 mt-0.5">{description}</span>
      </span>
      <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${checked ? 'bg-violet-600 border-violet-600 text-white' : 'border-gray-300'}`}>
        {checked && <Check size={14} strokeWidth={3} />}
      </span>
    </button>
  );
}

export default function AiExportDialog({ subjects, onCancel, onConfirm }) {
  const [selectedSubjectIds, setSelectedSubjectIds] = useState(() => new Set(subjects.map(subject => String(subject.id))));
  const [includeNeedsReview, setIncludeNeedsReview] = useState(true);
  const [includeMastered, setIncludeMastered] = useState(true);
  const [content, setContent] = useState(defaultContent);
  const subjectCounts = useLiveQuery(async () => {
    const mistakes = await db.mistakes.toArray();
    return mistakes.reduce((counts, mistake) => {
      const key = String(mistake.subjectId);
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
  }, []) || {};

  const selectedCount = useMemo(
    () => subjects.reduce((sum, subject) => (
      selectedSubjectIds.has(String(subject.id)) ? sum + (subjectCounts[String(subject.id)] || 0) : sum
    ), 0),
    [selectedSubjectIds, subjectCounts, subjects],
  );
  const willContainImages = content.includeQuestionImages || content.includeAnalysisImages;
  const canExport = selectedSubjectIds.size > 0 && (includeNeedsReview || includeMastered);

  const toggleSubject = subjectId => {
    const next = new Set(selectedSubjectIds);
    const key = String(subjectId);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedSubjectIds(next);
  };

  const submit = () => {
    if (!canExport) return;
    onConfirm({
      selectedSubjectIds: [...selectedSubjectIds],
      includeNeedsReview,
      includeMastered,
      ...content,
    });
  };

  return (
    <div className="fixed inset-0 z-[200000] bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6" onClick={onCancel}>
      <div className="bg-white w-full max-w-2xl max-h-[92vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col" onClick={event => event.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 shrink-0">
          <span className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center"><Bot size={22} /></span>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-gray-900">导出给 AI</h2>
            <p className="text-xs text-gray-500 mt-0.5">选择范围和内容，文件格式会自动优化</p>
          </div>
          <button type="button" onClick={onCancel} className="p-2 rounded-full text-gray-400 hover:bg-gray-100"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-black text-gray-800">1. 选择学科</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">当前勾选学科共 {selectedCount} 道错题</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSubjectIds(
                  selectedSubjectIds.size === subjects.length ? new Set() : new Set(subjects.map(subject => String(subject.id))),
                )}
                className="text-xs font-bold text-violet-600 px-2 py-1 rounded-lg hover:bg-violet-50"
              >
                {selectedSubjectIds.size === subjects.length ? '取消全选' : '全部选择'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {subjects.map(subject => {
                const checked = selectedSubjectIds.has(String(subject.id));
                return (
                  <button
                    type="button"
                    key={subject.id}
                    onClick={() => toggleSubject(subject.id)}
                    className={`rounded-xl border px-3 py-3 flex items-center gap-2 text-left transition ${checked ? 'border-violet-300 bg-violet-50' : 'border-gray-200 bg-white'}`}
                  >
                    <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${checked ? 'bg-violet-600 border-violet-600 text-white' : 'border-gray-300'}`}>
                      {checked && <Check size={14} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold text-sm text-gray-800 truncate">{subject.name}</span>
                      <span className="block text-[10px] text-gray-500">{subjectCounts[String(subject.id)] || 0} 题</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-black text-gray-800 mb-3">2. 选择题目状态</h3>
            <div className="grid grid-cols-2 gap-2">
              <ToggleCard checked={includeNeedsReview} icon={Brain} label="仍需复习" description="尚未标记掌握的错题" onClick={() => setIncludeNeedsReview(value => !value)} />
              <ToggleCard checked={includeMastered} icon={Check} label="已经掌握" description="包含历史已掌握题目" onClick={() => setIncludeMastered(value => !value)} />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-black text-gray-800 mb-1">3. 选择打包内容</h3>
            <p className="text-[11px] text-gray-500 mb-3">标题、科目、错题 ID 和时间始终保留</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {contentOptions.map(option => (
                <ToggleCard
                  key={option.key}
                  checked={content[option.key]}
                  icon={option.icon}
                  label={option.label}
                  description={option.description}
                  onClick={() => setContent(current => ({ ...current, [option.key]: !current[option.key] }))}
                />
              ))}
            </div>
          </section>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-start gap-3">
            <FileText size={18} className="text-slate-500 mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-black text-slate-700">自动文件格式</div>
              <p className="text-[11px] leading-5 text-slate-500 mt-0.5">
                {willContainImages
                  ? '已勾选图片：将优先生成 ZIP，图片会作为真实文件保存，同时附带 AI 说明、Markdown 和 JSONL。若所选题目实际没有图片，则自动改为 Markdown。'
                  : '未勾选图片：将生成单个 Markdown 文件，体积更小，AI 可以从头到尾直接读取。'}
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 flex items-center gap-3 shrink-0 bg-white">
          <button type="button" onClick={onCancel} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-600 text-sm font-bold hover:bg-gray-200">取消</button>
          <button
            type="button"
            onClick={submit}
            disabled={!canExport}
            className="flex-[1.5] py-3 rounded-xl bg-violet-600 text-white text-sm font-black shadow-md hover:bg-violet-700 disabled:bg-gray-300 disabled:shadow-none flex items-center justify-center gap-2"
          >
            <Bot size={18} /> 开始导出
          </button>
        </div>
      </div>
    </div>
  );
}
