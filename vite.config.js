import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
export default defineConfig({
    plugins: [react()],
    build: {
        rollupOptions: {
            input: {
                popup: resolve(__dirname, 'index.html'),
                background: resolve(__dirname, 'src/background/service-worker.ts'),
                content: resolve(__dirname, 'src/content/content-script.ts'),
            },
            output: {
                entryFileNames: (chunkInfo) => {
                    if (chunkInfo.name === 'background') {
                        return 'src/background/service-worker.js';
                    }
                    if (chunkInfo.name === 'content') {
                        return 'src/content/content-script.js';
                    }
                    return 'assets/[name].js';
                },
                chunkFileNames: 'assets/[name].js',
                assetFileNames: 'assets/[name].[ext]',
            },
        },
    },
});
