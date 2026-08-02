import { Zip, ZipPassThrough, strToU8 } from 'fflate';

const TEXT_MIME = 'text/plain;charset=utf-8';
const ZIP_MIME = 'application/zip';
const MARKDOWN_MIME = 'text/markdown;charset=utf-8';
const SELECTED_ROUND_PREFIX = 'mathNotebook.selectedReviewRound.';
const LAST_PROGRESS_PREFIX = 'mathNotebook.lastReviewProgress.';

export const DEFAULT_AI_EXPORT_OPTIONS = Object.freeze({
  selectedSubjectIds: null,
  includeNeedsReview: true,
  includeMastered: true,
  includeQuestionImages: true,
  includeAnalysisImages: true,
  includeReflection: true,
  includeAnalysisText: true,
  includeReviewInfo: true,
});

function normalizeOptions(options = {}) {
  return { ...DEFAULT_AI_EXPORT_OPTIONS, ...options };
}

function safeFileSegment(value, fallback = '未命名') {
  const text = String(value ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return text || fallback;
}

function oneLine(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function imageExtension(mime = '') {
  const normalized = mime.toLowerCase().split(';')[0].trim();
  const mapping = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
  };
  return mapping[normalized] || 'img';
}

function getStoredImages(record, pluralKey, legacyKey) {
  const candidates = [];
  if (Array.isArray(record?.[pluralKey])) candidates.push(...record[pluralKey]);
  if (record?.[legacyKey]) candidates.push(record[legacyKey]);

  const seen = new Set();
  return candidates.filter(value => {
    if (typeof value !== 'string' || !value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^,]*?),(.*)$/s.exec(dataUrl || '');
  if (!match) return null;

  const metadata = match[1] || TEXT_MIME;
  return {
    mime: metadata.split(';')[0] || TEXT_MIME,
    isBase64: /;base64(?:;|$)/i.test(metadata),
    payload: match[2] || '',
  };
}

function addTextFile(zip, path, text) {
  const file = new ZipPassThrough(path);
  zip.add(file);
  file.push(strToU8(String(text ?? '')), true);
}

function addDataUrlFile(zip, path, dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return false;

  const file = new ZipPassThrough(path);
  zip.add(file);

  if (!parsed.isBase64) {
    let decoded = parsed.payload;
    try {
      decoded = decodeURIComponent(parsed.payload);
    } catch {
      // 非标准百分号编码时保留原始内容，避免整次导出失败。
    }
    file.push(strToU8(decoded), true);
    return true;
  }

  const chunkSize = 32768;
  if (!parsed.payload) {
    file.push(new Uint8Array(0), true);
    return true;
  }

  for (let offset = 0; offset < parsed.payload.length; offset += chunkSize) {
    const encodedChunk = parsed.payload.slice(offset, offset + chunkSize);
    const binary = atob(encodedChunk);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    file.push(bytes, offset + chunkSize >= parsed.payload.length);
  }

  return true;
}

function createZipWriter() {
  const chunks = [];
  let resolveBlob;
  let rejectBlob;
  const blobPromise = new Promise((resolve, reject) => {
    resolveBlob = resolve;
    rejectBlob = reject;
  });

  const zip = new Zip((error, data, final) => {
    if (error) {
      rejectBlob(error);
      return;
    }
    if (data?.length) chunks.push(data);
    if (final) resolveBlob(new Blob(chunks, { type: ZIP_MIME }));
  });

  return { zip, blobPromise };
}

function collectReviewState(subjects, storage) {
  if (!storage) return [];

  return subjects.map(subject => {
    const selectedRound = Number(storage.getItem(`${SELECTED_ROUND_PREFIX}${subject.id}`) || 1);
    const lastProgress = [];

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(`${LAST_PROGRESS_PREFIX}${subject.id}.`)) continue;
      try {
        lastProgress.push(JSON.parse(storage.getItem(key)));
      } catch {
        lastProgress.push({ key, rawValue: storage.getItem(key) });
      }
    }

    return {
      subjectId: subject.id,
      subjectName: subject.name,
      selectedRound: Number.isFinite(selectedRound) && selectedRound >= 1 ? selectedRound : 1,
      lastProgress,
    };
  });
}

function selectedContentLabels(options) {
  const labels = ['标题与基本索引'];
  if (options.includeQuestionImages) labels.push('题目图片');
  if (options.includeReflection) labels.push('我的复盘思路');
  if (options.includeAnalysisText) labels.push('标准解析文字');
  if (options.includeAnalysisImages) labels.push('标准解析图片');
  if (options.includeReviewInfo) labels.push('复习轮次与掌握状态');
  return labels;
}

function createMistakeRecord({ mistake, subjectName, questionFiles, analysisFiles, roundItems, options }) {
  const record = { ...mistake };
  delete record.questionImg;
  delete record.questionImages;
  delete record.analysisImg;
  delete record.analysisImages;

  if (!options.includeReflection) delete record.reflection;
  if (!options.includeAnalysisText) delete record.analysisText;
  if (!options.includeReviewInfo) {
    delete record.isMastered;
    delete record.reviewLogs;
    delete record.reviewCount;
    delete record.reviewTimes;
  }

  const result = {
    ...record,
    createdAt: toIsoString(mistake.createdAt),
    updatedAt: toIsoString(mistake.updatedAt),
    subjectName,
  };

  if (options.includeQuestionImages) result.questionImageFiles = questionFiles;
  if (options.includeAnalysisImages) result.analysisImageFiles = analysisFiles;

  if (options.includeReviewInfo) {
    const explicitRounds = roundItems
      .map(item => Number(item.roundNo))
      .filter(roundNo => Number.isFinite(roundNo) && roundNo >= 2);

    result.masteryStatus = mistake.isMastered ? '已掌握' : '仍需复习';
    result.reviewRounds = [...new Set([1, ...explicitRounds])].sort((a, b) => a - b);
    result.reviewRoundItems = roundItems.map(item => ({
      ...item,
      decidedAt: toIsoString(item.decidedAt),
    }));
  }

  return result;
}

function createMistakeMarkdown(record, options) {
  const lines = [
    `# ${oneLine(record.title, '未命名错题')}`,
    '',
    `- 错题 ID：${record.id}`,
    `- 科目：${record.subjectName}`,
    `- 创建时间：${record.createdAt || '未记录'}`,
    `- 最后修改：${record.updatedAt || '未记录'}`,
  ];

  if (options.includeReviewInfo) {
    lines.push(
      `- 掌握状态：${record.masteryStatus}`,
      `- 所在复习轮次：${record.reviewRounds.join('、')}`,
    );
  }
  lines.push('');

  if (options.includeQuestionImages) {
    lines.push('## 题目图片', '');
    if (record.questionImageFiles?.length) {
      record.questionImageFiles.forEach((path, index) => {
        lines.push(`![题目图片 ${index + 1}](${path.split('/').pop()})`, '');
      });
    } else {
      lines.push('未保存题目图片。', '');
    }
  }

  if (options.includeReflection) {
    lines.push('## 我的复盘思路', '', record.reflection || '暂无复盘记录。', '');
  }

  if (options.includeAnalysisText) {
    lines.push('## 标准解析文字', '', record.analysisText || '暂无文字解析。', '');
  }

  if (options.includeAnalysisImages) {
    lines.push('## 标准解析图片', '');
    if (record.analysisImageFiles?.length) {
      record.analysisImageFiles.forEach((path, index) => {
        lines.push(`![解析图片 ${index + 1}](${path.split('/').pop()})`, '');
      });
    } else {
      lines.push('未保存解析图片。', '');
    }
  }

  if (options.includeReviewInfo) {
    lines.push('## 结构化复习记录', '', '```json', JSON.stringify(record.reviewRoundItems, null, 2), '```', '');
  }

  return lines.join('\n');
}

function createReadme(summary, options) {
  const reviewStats = options.includeReviewInfo
    ? `\n- 已掌握：${summary.counts.mastered}\n- 仍需复习：${summary.counts.needsReview}`
    : '';
  const reviewInstruction = options.includeReviewInfo
    ? '\n4. 复习轮次越高，通常表示重复出错或仍未真正掌握。'
    : '';

  return `# 错题本 AI 档案

这是从 Math-error-notebook 导出的 AI 专用档案。导出器已根据内容自动选择 ${summary.outputFormat === 'zip' ? 'ZIP（包含真实图片文件）' : 'Markdown（纯文本连续阅读）'} 格式。

## 给 AI 的读取指令

1. ${summary.outputFormat === 'zip' ? '先读取 \`summary.json\` 和 \`mistakes.jsonl\`，再按其中的路径查看每道题的 Markdown 与图片。' : '从“错题正文”开始逐题读取，不要只根据标题判断知识点。'}
2. 结合题目、我的复盘和标准解析判断错误原因；如果某项没有导出，不要自行猜测其内容。
3. 请按科目、知识点、错误原因和复习优先级总结，并引用具体错题 ID 或标题。${reviewInstruction}

## 本次导出范围

- 导出时间：${summary.exportedAt}
- 应用版本：${summary.appVersion}
- 科目：${summary.subjects.map(subject => subject.name).join('、') || '无'}
- 错题总数：${summary.counts.mistakes}${reviewStats}
- 题目图片：${summary.counts.questionImages}
- 解析图片：${summary.counts.analysisImages}
- 已选内容：${summary.includedContent.join('、')}
`;
}

function createSummary({ subjects, mistakes, reviewRoundItems, options, appVersion, outputFormat }) {
  const subjectStats = subjects.map(subject => {
    const subjectMistakes = mistakes.filter(mistake => String(mistake.subjectId) === String(subject.id));
    const stats = {
      id: subject.id,
      name: subject.name,
      mistakes: subjectMistakes.length,
    };
    if (options.includeReviewInfo) {
      stats.mastered = subjectMistakes.filter(mistake => mistake.isMastered).length;
      stats.needsReview = subjectMistakes.filter(mistake => !mistake.isMastered).length;
    }
    return stats;
  });

  const counts = {
    subjects: subjects.length,
    mistakes: mistakes.length,
    questionImages: options.includeQuestionImages
      ? mistakes.reduce((sum, mistake) => sum + getStoredImages(mistake, 'questionImages', 'questionImg').length, 0)
      : 0,
    analysisImages: options.includeAnalysisImages
      ? mistakes.reduce((sum, mistake) => sum + getStoredImages(mistake, 'analysisImages', 'analysisImg').length, 0)
      : 0,
  };

  if (options.includeReviewInfo) {
    counts.mastered = mistakes.filter(mistake => mistake.isMastered).length;
    counts.needsReview = mistakes.filter(mistake => !mistake.isMastered).length;
    counts.reviewRoundItems = reviewRoundItems.length;
  }

  return {
    format: 'MathNotebookAIArchive',
    formatVersion: 2,
    outputFormat,
    exportedAt: new Date().toISOString(),
    appVersion,
    includedContent: selectedContentLabels(options),
    counts,
    subjects: subjectStats,
  };
}

function indentHeadings(markdown) {
  return markdown
    .replace(/^## /gm, '#### ')
    .replace(/^# /gm, '### ');
}

export async function buildAiArchive({
  subjects = [],
  mistakes = [],
  reviewRoundItems = [],
  reviewState = [],
  appVersion = 'unknown',
  options: rawOptions = {},
  onProgress = () => {},
}) {
  const options = normalizeOptions(rawOptions);
  const subjectById = new Map(subjects.map(subject => [String(subject.id), subject]));
  const roundsByMistakeId = new Map();

  reviewRoundItems.forEach(item => {
    const key = String(item.mistakeId);
    if (!roundsByMistakeId.has(key)) roundsByMistakeId.set(key, []);
    roundsByMistakeId.get(key).push(item);
  });

  const provisionalSummary = createSummary({
    subjects,
    mistakes,
    reviewRoundItems,
    options,
    appVersion,
    outputFormat: 'markdown',
  });
  const hasImages = provisionalSummary.counts.questionImages + provisionalSummary.counts.analysisImages > 0;
  const outputFormat = hasImages ? 'zip' : 'markdown';
  const summary = { ...provisionalSummary, outputFormat };
  const { zip, blobPromise } = outputFormat === 'zip' ? createZipWriter() : { zip: null, blobPromise: null };
  const jsonLines = [JSON.stringify({ type: 'metadata', ...summary })];
  const indexLines = [
    '# 错题总目录',
    '',
    `共 ${mistakes.length} 道错题。`,
    '',
  ];
  const markdownRecords = [];
  const subjectIndexes = new Map();
  for (const subject of subjects) subjectIndexes.set(String(subject.id), 0);

  for (let globalIndex = 0; globalIndex < mistakes.length; globalIndex += 1) {
    const mistake = mistakes[globalIndex];
    const subject = subjectById.get(String(mistake.subjectId));
    const subjectName = subject?.name || '未分类';
    const subjectKey = String(mistake.subjectId);
    const subjectIndex = (subjectIndexes.get(subjectKey) || 0) + 1;
    subjectIndexes.set(subjectKey, subjectIndex);

    const folderName = `${String(subjectIndex).padStart(4, '0')}_${safeFileSegment(mistake.title, `错题_${mistake.id}`)}_ID-${safeFileSegment(mistake.id)}`;
    const folderPath = `错题/${safeFileSegment(subjectName)}/${folderName}`;
    const questionFiles = [];
    const analysisFiles = [];

    if (outputFormat === 'zip' && options.includeQuestionImages) {
      getStoredImages(mistake, 'questionImages', 'questionImg').forEach((dataUrl, imageIndex) => {
        const parsed = parseDataUrl(dataUrl);
        if (!parsed) return;
        const filePath = `${folderPath}/题目_${String(imageIndex + 1).padStart(2, '0')}.${imageExtension(parsed.mime)}`;
        if (addDataUrlFile(zip, filePath, dataUrl)) questionFiles.push(filePath);
      });
    }

    if (outputFormat === 'zip' && options.includeAnalysisImages) {
      getStoredImages(mistake, 'analysisImages', 'analysisImg').forEach((dataUrl, imageIndex) => {
        const parsed = parseDataUrl(dataUrl);
        if (!parsed) return;
        const filePath = `${folderPath}/解析_${String(imageIndex + 1).padStart(2, '0')}.${imageExtension(parsed.mime)}`;
        if (addDataUrlFile(zip, filePath, dataUrl)) analysisFiles.push(filePath);
      });
    }

    const record = createMistakeRecord({
      mistake,
      subjectName,
      questionFiles,
      analysisFiles,
      roundItems: roundsByMistakeId.get(String(mistake.id)) || [],
      options,
    });
    const recordMarkdown = createMistakeMarkdown(record, options);

    if (outputFormat === 'zip') {
      const markdownPath = `${folderPath}/错题详情.md`;
      addTextFile(zip, markdownPath, recordMarkdown);
      jsonLines.push(JSON.stringify({ type: 'mistake', record }));
      const status = options.includeReviewInfo ? `｜${record.masteryStatus}｜轮次 ${record.reviewRounds.join('、')}` : '';
      indexLines.push(`${globalIndex + 1}. [${oneLine(record.title, '未命名错题')}](${markdownPath}) — ${subjectName}${status}`);
    } else {
      markdownRecords.push(indentHeadings(recordMarkdown));
    }

    onProgress({
      stage: 'packing',
      completed: globalIndex + 1,
      total: mistakes.length,
      title: record.title,
    });

    if ((globalIndex + 1) % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  let blob;
  if (outputFormat === 'zip') {
    addTextFile(zip, 'README_FOR_AI.md', createReadme(summary, options));
    addTextFile(zip, 'summary.json', JSON.stringify(summary, null, 2));
    if (options.includeReviewInfo) {
      addTextFile(zip, 'review-rounds.json', JSON.stringify({ reviewRoundItems, reviewState }, null, 2));
    }
    addTextFile(zip, 'mistakes.jsonl', `${jsonLines.join('\n')}\n`);
    addTextFile(zip, '错题总目录.md', `${indexLines.join('\n')}\n`);
    zip.end();
    blob = await blobPromise;
  } else {
    const document = [
      createReadme(summary, options),
      '',
      '# 错题正文',
      '',
      ...markdownRecords,
    ].join('\n');
    blob = new Blob([document], { type: MARKDOWN_MIME });
  }

  onProgress({ stage: 'done', completed: mistakes.length, total: mistakes.length });
  return { blob, summary, outputFormat };
}

export async function exportMistakesForAI({ db, appVersion, options: rawOptions, onProgress }) {
  const options = normalizeOptions(rawOptions);
  const [allSubjects, allMistakes, allReviewRoundItems] = await Promise.all([
    db.subjects.toArray(),
    db.mistakes.orderBy('createdAt').toArray(),
    db.reviewRoundItems ? db.reviewRoundItems.toArray() : Promise.resolve([]),
  ]);

  const selectedIds = options.selectedSubjectIds
    ? new Set(options.selectedSubjectIds.map(String))
    : new Set(allSubjects.map(subject => String(subject.id)));
  const subjects = allSubjects.filter(subject => selectedIds.has(String(subject.id)));
  const mistakes = allMistakes.filter(mistake => {
    if (!selectedIds.has(String(mistake.subjectId))) return false;
    return mistake.isMastered ? options.includeMastered : options.includeNeedsReview;
  });

  if (!subjects.length) throw new Error('请至少选择一个学科');
  if (!options.includeMastered && !options.includeNeedsReview) throw new Error('请至少选择一种题目状态');
  if (!mistakes.length) throw new Error('当前选择范围内没有可以导出的错题');

  const mistakeIds = new Set(mistakes.map(mistake => String(mistake.id)));
  const reviewRoundItems = options.includeReviewInfo
    ? allReviewRoundItems.filter(item => mistakeIds.has(String(item.mistakeId)))
    : [];
  const reviewState = options.includeReviewInfo
    ? collectReviewState(subjects, typeof window !== 'undefined' ? window.localStorage : null)
    : [];

  const result = await buildAiArchive({
    subjects,
    mistakes,
    reviewRoundItems,
    reviewState,
    appVersion,
    options,
    onProgress,
  });

  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    '-',
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  const subjectLabel = subjects.length === 1 ? `_${safeFileSegment(subjects[0].name)}` : '';
  const extension = result.outputFormat === 'zip' ? 'zip' : 'md';
  const filename = `错题本${subjectLabel}_AI档案_${timestamp}.${extension}`;
  const url = URL.createObjectURL(result.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);

  return { ...result, filename };
}
