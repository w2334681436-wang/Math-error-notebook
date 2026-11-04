// 按题面中出现的顺序保存全部截图；旧版的封面图继续排在第一张。
export function getImportedQuestionImages(item) {
  const assets = item?.questionAssets || {};
  const images = [];
  const seen = new Set();
  const add = id => {
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(assets, id)) return;
    const image = assets[id];
    if (typeof image !== 'string' || !image || seen.has(image)) return;
    seen.add(image);
    images.push(image);
  };

  add(item?.questionThumbnailAssetId);
  for (const match of String(item?.questionMarkdown || '').matchAll(/!\[[^\]]*\]\(note-asset:([A-Za-z0-9_-]+)\)/g)) {
    add(match[1]);
  }
  // 有些 AI 包只提供 questionAssets，没有在 Markdown 中逐张引用。
  for (const id of Object.keys(assets)) add(id);
  return images;
}
