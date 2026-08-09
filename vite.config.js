import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'

export default defineConfig({
  // 使用相对资源路径，既可部署在根域名，也可放到任意国内静态托管子目录。
  base: './',
  define: {
    '__APP_VERSION__': JSON.stringify(packageJson.version),
  },
  build: {
    // 始终从干净目录生成离线清单，避免旧哈希资源残留在发布包中。
    emptyOutDir: true,
  },
  plugins: [
    react(),
  ],
})
