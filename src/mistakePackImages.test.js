import test from 'node:test';
import assert from 'node:assert/strict';
import { getImportedQuestionImages } from './mistakePackImages.js';

test('all cross-page screenshots import in question order instead of just the thumbnail', () => {
  const item = {
    questionThumbnailAssetId: 'original',
    questionMarkdown: '![正页](note-asset:original)\n![续页](note-asset:page2)\n![表](note-asset:table)',
    questionAssets: { table: 'url-table', original: 'url-1', page2: 'url-2' }
  };
  assert.deepEqual(getImportedQuestionImages(item), ['url-1', 'url-2', 'url-table']);
});

test('when thumbnail is blank, embedded images remain importable in Markdown order', () => {
  const item = { questionThumbnailAssetId: '', questionMarkdown: '![二](note-asset:b)\n![一](note-asset:a)', questionAssets: { a: 'url-a', b: 'url-b' } };
  assert.deepEqual(getImportedQuestionImages(item), ['url-b', 'url-a']);
});

test('unreferenced attachments are appended once and identical image data is deduplicated', () => {
  const item = { questionMarkdown: '![一](note-asset:a)', questionAssets: { a: 'url-a', duplicate: 'url-a', c: 'url-c' } };
  assert.deepEqual(getImportedQuestionImages(item), ['url-a', 'url-c']);
});

test('no screenshots produces an empty list without affecting text-only questions', () => {
  assert.deepEqual(getImportedQuestionImages({ questionMarkdown: '普通文字', questionAssets: {} }), []);
});
