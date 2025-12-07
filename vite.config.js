import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true
      },
     manifest: {
        name: '数学复盘', // 修改这里
        short_name: '复盘', // 修改这里，短名称用于主屏幕
        description: '考研数学错题复盘与精进',
        theme_color: '#2563eb', // 改成更专业的蓝色
        background_color: "#f3f4f6",
        display: 'standalone',
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png"
          }
        ]
      }
    })
  ],
})
