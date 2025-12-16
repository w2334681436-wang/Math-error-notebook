import fs from 'fs';

// 1. 找到 service-worker.js 文件的位置
const swPath = './public/service-worker.js';

try {
  // 2. 读取文件内容
  let content = fs.readFileSync(swPath, 'utf-8');

  // 3. 生成一个新的版本号 (用当前时间戳，保证唯一)
  const newVersion = 'v' + Date.now();

  // 4. 用正则表达式找到旧的版本号，并替换成新的
  // 这一行会寻找类似 const CACHE_NAME = 'math-notebook-cache-v...'; 的代码
  const regex = /const\s+CACHE_NAME\s*=\s*['"]math-notebook-cache-v\d+['"];/;
  
  if (regex.test(content)) {
    content = content.replace(regex, `const CACHE_NAME = 'math-notebook-cache-${newVersion}';`);
    
    // 5. 把修改后的内容写回文件
    fs.writeFileSync(swPath, content);
    console.log(`✅ Service Worker 版本已自动更新为: math-notebook-cache-${newVersion}`);
  } else {
    console.warn('⚠️ 未找到 CACHE_NAME 定义，跳过自动更新。请检查 public/service-worker.js 文件格式。');
  }

} catch (error) {
  console.error('❌ 自动更新失败:', error);
  process.exit(1);
}
