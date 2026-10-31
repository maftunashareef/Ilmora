import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ILMORA',
    short_name: 'ILMORA',
    description: 'Turli öquv markazlari. Bitta abonement.',
    start_url: '/uz',
    display: 'standalone',
    background_color: '#F7F5F0',
    theme_color: '#163C35',
    icons: [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' }],
  }
}
