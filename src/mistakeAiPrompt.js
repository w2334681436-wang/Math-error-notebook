// AI 生成错题包：与 src/mistakePack.js 解析器保持一致。
export const MISTAKE_AI_PROMPT = `你是我的考研错题整理与打包助手。请把本次我指定的真题及对应讲解逐题整理为一个可导入 Math-error-notebook「错题本」的单文件 .merror 错题包，提供实际创建的下载链接。不能只把JSON贴在聊天里。

【内容与排版要求】
1. 每题必须单独成一条错题，文件 items 数组严格按用户提供顺序从前到后排列：第1题先导入、创建时间最早、显示在默认倒序列表下方；最后1题后导入、创建时间最新、显示在列表最上方。示例：items依次为第17、18、19、20、21、22题，则错题列表从上到下显示第22、21、20、19、18、17题。严禁为了适配列表自行倒排 items。标题采用“年份+数学一+题号+考点”，题干及小问放 questionMarkdown，解析放 analysisMarkdown，错因/个人复盘放 reflectionMarkdown；不能把多个题目合并。
2. 题干忠实原文；不清楚的原题条件必须说明，不能编造。解析严格考研数学一大纲，优先核对真题标准解析，纠正用户过程中的错误。
3. 解析必须具有：**具体考点、正确答案、我的过程批改、第一眼识别—动机—依据、考场最快手写步骤、易错点、固定套路**；分级标题、分段、加粗、编号，不能把内容挤一行。完整保留每一步关键计算，复杂题允许图文穿插，不因内容多而省略。
4. 公式用 Markdown+LaTeX（行内 $...$，独立 $$...$$），表格用 Markdown 表格，禁止将所有公式转成图片。不要输出 React、JSX、DIL、HTML、Mermaid 等界面代码。
5. 如果有真正生成的 UI/图解，将其制成真实 PNG/JPEG/WebP/GIF 图片、转 base64 嵌入 analysisAssets 或 questionAssets，并在 Markdown 原位置以 ![说明](note-asset:fig1) 引用；资源ID必须对应。若无法实际获得图片，请用 Markdown 表格/文字图解，不得伪造 base64 或无效图片。
6. 不要把全篇解析放到 reflectionMarkdown，也不要仅输出答案。解析导入后由App默认隐藏，用户点击“查看解析”再显示。
7. 重复导入防重：sourceId 为稳定唯一ID（例如 math1-2023-17），同题再次导入要使用相同sourceId。使用相同sourceId判断当前数据库中仍存在的原题。若原题仍属于其他轮次但不在第一轮，重新导入只创建第一轮成员记录，保留原有编辑与复盘；若这道题已从所有轮次永久移出且原题底稿被清理，则当作新题完整导入；若已在第一轮则只调整排序。有真实截图且旧题尚未附图时可补图。字段不包含本地数据库id。

【唯一支持的文件格式】
UTF-8 JSON文件，扩展名 .merror；顶层格式：
{
 "format":"MathNotebookMistakePack",
 "version":1,
 "subject":"数学",
 "items":[
   {
     "sourceId":"math1-2023-17",
     "title":"2023年数学一第17题｜切线截距与微分方程",
     "tags":["数学一","高等数学","常微分方程"],
     "questionMarkdown":"## 原题\\n\\n严格原题与小问，可以包含$...$公式",
     "questionThumbnailAssetId":"",
     "analysisMarkdown":"## 具体考点\\n\\n...完整分级解析...",
     "reflectionMarkdown":"## 我的错因\\n\\n...",
     "questionAssets":[],
     "analysisAssets":[
       {"id":"fig1","mime":"image/png","base64":"真实PNG内容的base64，不带data:前缀"}
     ]
   }
 ]
}
没有插图时写空数组[]，questionThumbnailAssetId写空字符串或省略。如果确有真实原题截图，必须把截图写入 questionAssets，例如 id 为 original，再填写 questionThumbnailAssetId 为 original。不得引用不存在的图片ID。

【导入限制和验收】
1. format和version必须精确匹配；items数组1~120条，标题不超过120字符，sourceId唯一且不超过160字符；每题题干和解析不能为空。
2. 整体文件不超过24MB，每题每区最多18张图，每张图不超过8MB，mime仅允许 image/png/image/jpeg/image/webp/image/gif；必须是真实有效的图片base64。
3. JSON里换行、反斜杠必须正确转义，LaTeX反斜杠要按JSON语法双重转义。校验文件能用标准JSON解析。
4. 本格式增量创建错题，重复导入会恢复相同sourceId题目的第一轮隐藏状态并校正排序时间，不含成绩、复盘次数或数据库内部ID。不能清空或覆盖已有错题和用户改动。
5. 交付前逐题检查 items 的排列顺序与用户提交的题目顺序一致，列表按默认“最新优先”显示时必须是最后一题在上、第一题在下。输出真实创建的 .merror 文件和可点击下载链接；若无法创建，要说明实际障碍，不准虚构文件。

现在按本次会话我指定的题号顺序，完整整理题干、本人作答批改和解析并生成文件。`;
