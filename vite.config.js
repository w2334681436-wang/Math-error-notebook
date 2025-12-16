import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
// 1. 引入 package.json
import packageJson from './package.json'

export default defineConfig({
  // 2. 定义全局变量
  define: {
    // JSON.stringify 是必须的，因为我们要注入的是一个字符串常量
    '__APP_VERSION__': JSON.stringify(packageJson.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '错题本',
        short_name: '错题本',
        description: '全科目错题沉浸式复盘工具',
        theme_color: '#ffffff',
        background_color: "#ffffff",
        display: 'standalone',
        orientation: 'portrait',
        start_url: "/",
        icons: [
          {
            src: 'icon.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          },
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
})
