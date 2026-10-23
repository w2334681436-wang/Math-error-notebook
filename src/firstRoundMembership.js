// 第一轮采用真实的 reviewRoundItems 成员记录，与其他轮次一致。
// 以下函数可在 IndexedDB upgrade 或备份恢复的事务中使用，不会改写原题。
export const FIRST_ROUND = 1;

export function roundMember(mistake, roundNo = FIRST_ROUND) {
  const date = new Date(mistake.createdAt || Date.now());
  const order = Number.isFinite(date.getTime()) ? date.getTime() : Date.now();
  return {
    subjectId: mistake.subjectId,
    roundNo,
    mistakeId: mistake.id,
    order,
    decidedAt: mistake.createdAt || new Date(order),
    title: mistake.title || '未命名错题',
  };
}

// 仅用于从版本6升级、或恢复版本6及更早的备份。
// v6 第一轮 = 全部 mistakes - reviewRoundExclusions，迁移后逐一变成真实成员行。
export async function migrateLegacyFirstRoundMembership(tx) {
  const mistakes = tx.table('mistakes');
  const members = tx.table('reviewRoundItems');
  const exclusions = tx.table('reviewRoundExclusions');
  const excludedIds = new Set();
  await exclusions.each(record => {
    if (Number(record.roundNo) === FIRST_ROUND) excludedIds.add(String(record.mistakeId));
  });
  const existingIds = new Set();
  const inAnyRound = new Set();
  await members.each(record => {
    inAnyRound.add(String(record.mistakeId));
    if (Number(record.roundNo) === FIRST_ROUND) existingIds.add(String(record.mistakeId));
  });

  const rows = [];
  const orphanIds = [];
  let inserted = 0;
  // 每条记录只保留轻量成员信息，不把包含截图的原题复制到另一个大数组。
  await mistakes.each(record => {
    if (record.id === undefined || record.subjectId === undefined) return;
    const key = String(record.id);
    if (excludedIds.has(key)) {
      // 旧版“移出第一轮”但不在任何其他轮次时，永久清理历史幽灵原题。
      if (!inAnyRound.has(key)) orphanIds.push(record.id);
      return;
    }
    if (existingIds.has(key)) return;
    rows.push(roundMember(record));
  });
  for (let offset = 0; offset < rows.length; offset += 150) {
    const batch = rows.slice(offset, offset + 150);
    await members.bulkAdd(batch);
    inserted += batch.length;
  }
  const cards = tx.table('mistakeCards');
  for (let offset = 0; offset < orphanIds.length; offset += 150) {
    const batch = orphanIds.slice(offset, offset + 150);
    await mistakes.bulkDelete(batch);
    await cards.bulkDelete(batch);
  }
  // 第一轮隐藏表彻底退役；不把它当作永久删除的替代品。
  await exclusions.clear();
  return inserted;
}

export async function addFirstRoundMember(tx, mistake, shouldUpdateOrder = false) {
  const members = tx.table('reviewRoundItems');
  const key = [mistake.subjectId, FIRST_ROUND, mistake.id];
  const existing = await members.where('[subjectId+roundNo+mistakeId]').equals(key).first();
  if (existing) {
    if (shouldUpdateOrder) await members.update(existing.id, { order: roundMember(mistake).order });
    return false;
  }
  await members.add(roundMember(mistake));
  return true;
}
