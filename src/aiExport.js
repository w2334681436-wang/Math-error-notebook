import { Zip, ZipPassThrough, strToU8 } from 'fflate';

const TEXT_MIME = 'text/plain;charset=utf-8';
const ZIP_MIME = 'application/zip';
const SELECTED_ROUND_PREFIX = 'mathNotebook.selectedReviewRound.';
const LAST_PROGRESS_PREFIX = 'mathNotebook.lastReviewProgress.';

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
    if (typeof value !== 'string' || !value) return false;
    if (seen.has(value)) return false;
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

  // 按 32KB Base64 块解码，避免一张大图产生一个超大的临时 Uint8Array。
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

function createMistakeRecord({ mistake, subjectName, questionFiles, analysisFiles, roundItems }) {
  const record = { ...mistake };
  delete record.questionImg;
  delete record.questionImages;
  delete record.analysisImg;
  delete record.analysisImages;

  const explicitRounds = roundItems
    .map(item => Number(item.roundNo))
    .filter(roundNo => Number.isFinite(roundNo) && roundNo >= 2);

  return {
    ...record,
    createdAt: toIsoString(mistake.createdAt),
    updatedAt: toIsoString(mistake.updatedAt),
    subjectName,
    masteryStatus: mistake.isMastered ? '已掌握' : '仍需复习',
    reviewRounds: [...new Set([1, ...explicitRounds])].sort((a, b) => a - b),
    reviewRoundItems: roundItems.map(item => ({
      ...item,
      decidedAt: toIsoString(item.decidedAt),
    })),
    questionImageFiles: questionFiles,
    analysisImageFiles: analysisFiles,
  };
}

function createMistakeMarkdown(record) {
  const lines = [
    `# ${oneLine(record.title, '未命名错题')}`,
    '',
    `- 错题 ID：${record.id}`,
    `- 科目：${record.subjectName}`,
    `- 掌握状态：${record.masteryStatus}`,
    `- 所在复习轮次：${record.reviewRounds.join('、')}`,
    `- 创建时间：${record.createdAt || '未记录'}`,
    `- 最后修改：${record.updatedAt || '未记录'}`,
    '',
    '## 题目图片',
    '',
  ];

  if (record.questionImageFiles.length) {
    record.questionImageFiles.forEach((path, index) => {
      lines.push(`![题目图片 ${index + 1}](${path.split('/').pop()})`, '');
    });
  } else {
    lines.push('未保存题目图片。', '');
  }

  lines.push('## 我的复盘思路', '', record.reflection || '暂无复盘记录。', '');
  lines.push('## 标准解析文字', '', record.analysisText || '暂无文字解析。', '');
  lines.push('## 标准解析图片', '');

  if (record.analysisImageFiles.length) {
    record.analysisImageFiles.forEach((path, index) => {
      lines.push(`![解析图片 ${index + 1}](${path.split('/').pop()})`, '');
    });
  } else {
    lines.push('未保存解析图片。', '');
  }

  lines.push('## 结构化复习记录', '', '```json', JSON.stringify(record.reviewRoundItems, null, 2), '```', '');
  return lines.join('\n');
}

function createReadme(summary) {
  return `# 错题本 AI 完整档案

这是从 Math-error-notebook 一键导出的 AI 专用档案。请将这个 ZIP 文件直接上传给支持文件分析的 AI。

## 给 AI 的读取指令

1. 先读取 \`summary.json\`，了解科目、数量和掌握情况。
2. 读取 \`mistakes.jsonl\`，它逐行保存全部错题的结构化信息，适合统计和批量分析。
3. 读取 \`错题/\` 下每道题的 Markdown 和相邻图片，结合题目图、解析图、我的复盘和标准解析判断薄弱点。
4. 不要只看标题。图片通常包含完整题目，\`reflection\` 是我的思路，\`analysisText\` 和解析图片是参考答案。
5. 分析时请区分“仍需复习”和“已掌握”，并参考 \`reviewRounds\`：轮次越高，通常表示重复出错或尚未真正掌握。
6. 如果需要制定计划，请按科目、知识点、错误原因和复习优先级总结，并引用具体错题 ID 或标题。

## 本次档案概览

- 导出时间：${summary.exportedAt}
- 应用版本：${summary.appVersion}
- 科目数：${summary.counts.subjects}
- 错题总数：${summary.counts.mistakes}
- 已掌握：${summary.counts.mastered}
- 仍需复习：${summary.counts.needsReview}
- 题目图片：${summary.counts.questionImages}
- 解析图片：${summary.counts.analysisImages}

## 文件说明

- \`summary.json\`：全局统计和各科目统计。
- \`mistakes.jsonl\`：每行一道错题，保留所有非图片字段，并把图片改为 ZIP 内文件路径。
- \`review-rounds.json\`：复习轮次成员、当前选中轮次和各轮上次进度。
- \`错题总目录.md\`：所有错题的人类可读目录。
- \`错题/<科目>/<编号_标题>/\`：单题 Markdown、题目图片和解析图片。
`;
}

export async function buildAiArchive({
  subjects = [],
  mistakes = [],
  reviewRoundItems = [],
  reviewState = [],
  appVersion = 'unknown',
  onProgress = () => {},
}) {
  const exportedAt = new Date().toISOString();
  const subjectById = new Map(subjects.map(subject => [String(subject.id), subject]));
  const roundsByMistakeId = new Map();

  reviewRoundItems.forEach(item => {
    const key = String(item.mistakeId);
    if (!roundsByMistakeId.has(key)) roundsByMistakeId.set(key, []);
    roundsByMistakeId.get(key).push(item);
  });

  const sourceStats = subjects.map(subject => {
    const subjectMistakes = mistakes.filter(mistake => String(mistake.subjectId) === String(subject.id));
    return {
      id: subject.id,
      name: subject.name,
      mistakes: subjectMistakes.length,
      mastered: subjectMistakes.filter(mistake => mistake.isMastered).length,
      needsReview: subjectMistakes.filter(mistake => !mistake.isMastered).length,
    };
  });

  const questionImageCount = mistakes.reduce(
    (sum, mistake) => sum + getStoredImages(mistake, 'questionImages', 'questionImg').length,
    0,
  );
  const analysisImageCount = mistakes.reduce(
    (sum, mistake) => sum + getStoredImages(mistake, 'analysisImages', 'analysisImg').length,
    0,
  );

  const summary = {
    format: 'MathNotebookAIArchive',
    formatVersion: 1,
    exportedAt,
    appVersion,
    counts: {
      subjects: subjects.length,
      mistakes: mistakes.length,
      mastered: mistakes.filter(mistake => mistake.isMastered).length,
      needsReview: mistakes.filter(mistake => !mistake.isMastered).length,
      questionImages: questionImageCount,
      analysisImages: analysisImageCount,
      reviewRoundItems: reviewRoundItems.length,
    },
    subjects: sourceStats,
  };

  const { zip, blobPromise } = createZipWriter();
  addTextFile(zip, 'README_FOR_AI.md', createReadme(summary));
  addTextFile(zip, 'summary.json', JSON.stringify(summary, null, 2));
  addTextFile(zip, 'review-rounds.json', JSON.stringify({ reviewRoundItems, reviewState }, null, 2));

  const jsonLines = [JSON.stringify({ type: 'metadata', ...summary })];
  const indexLines = [
    '# 错题总目录',
    '',
    `共 ${mistakes.length} 道错题；已掌握 ${summary.counts.mastered} 道；仍需复习 ${summary.counts.needsReview} 道。`,
    '',
  ];

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

    const questionImages = getStoredImages(mistake, 'questionImages', 'questionImg');
    questionImages.forEach((dataUrl, imageIndex) => {
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) return;
      const filePath = `${folderPath}/题目_${String(imageIndex + 1).padStart(2, '0')}.${imageExtension(parsed.mime)}`;
      if (addDataUrlFile(zip, filePath, dataUrl)) questionFiles.push(filePath);
    });

    const analysisImages = getStoredImages(mistake, 'analysisImages', 'analysisImg');
    analysisImages.forEach((dataUrl, imageIndex) => {
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) return;
      const filePath = `${folderPath}/解析_${String(imageIndex + 1).padStart(2, '0')}.${imageExtension(parsed.mime)}`;
      if (addDataUrlFile(zip, filePath, dataUrl)) analysisFiles.push(filePath);
    });

    const record = createMistakeRecord({
      mistake,
      subjectName,
      questionFiles,
      analysisFiles,
      roundItems: roundsByMistakeId.get(String(mistake.id)) || [],
    });

    const markdownPath = `${folderPath}/错题详情.md`;
    addTextFile(zip, markdownPath, createMistakeMarkdown(record));
    jsonLines.push(JSON.stringify({ type: 'mistake', record }));
    indexLines.push(
      `${globalIndex + 1}. [${oneLine(record.title, '未命名错题')}](${markdownPath}) — ${subjectName}｜${record.masteryStatus}｜轮次 ${record.reviewRounds.join('、')}`,
    );

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

  addTextFile(zip, 'mistakes.jsonl', `${jsonLines.join('\n')}\n`);
  addTextFile(zip, '错题总目录.md', `${indexLines.join('\n')}\n`);
  zip.end();

  const blob = await blobPromise;
  onProgress({ stage: 'done', completed: mistakes.length, total: mistakes.length });
  return { blob, summary };
}

export async function exportMistakesForAI({ db, appVersion, onProgress }) {
  const [subjects, mistakes, reviewRoundItems] = await Promise.all([
    db.subjects.toArray(),
    db.mistakes.orderBy('createdAt').toArray(),
    db.reviewRoundItems ? db.reviewRoundItems.toArray() : Promise.resolve([]),
  ]);

  const reviewState = collectReviewState(
    subjects,
    typeof window !== 'undefined' ? window.localStorage : null,
  );

  const result = await buildAiArchive({
    subjects,
    mistakes,
    reviewRoundItems,
    reviewState,
    appVersion,
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
  const filename = `错题本_AI完整档案_${timestamp}.zip`;
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
