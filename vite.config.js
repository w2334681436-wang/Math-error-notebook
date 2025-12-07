import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // 核心：检测到新代码自动更新
      manifest: {
        name: '数学复盘',
        short_name: '数学复盘',
        description: '考研数学错题沉浸式复习',
        theme_color: '#ffffff',
        background_color: "#ffffff",
        display: 'standalone', // 核心：这会让它像 App 一样没有地址栏
        orientation: 'portrait',
        start_url: "/",
        icons: [
          {
            src: 'icon.svg',
            sizes: '192x192', // SVG 可以自适应所有尺寸
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
