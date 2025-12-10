import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '错题本',      // [修改] 名称改为通用
        short_name: '错题本', // [修改]
        description: '全科目错题沉浸式复盘工具', // [修改]
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
