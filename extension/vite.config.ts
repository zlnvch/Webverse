import { defineConfig, UserConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from 'fs';

const path = (p: string) => resolve(__dirname, p);

const sharedAliases = {
  '@shared': path('shared'),
  '@stores/user': path('popup/src/stores/user'),
  '@stores/webverse': path('popup/src/stores/webverse'),
  '@stores/toolbar': path('toolbar/src/stores/toolbar')
};

const contentConfig: UserConfig = {
  build: {
    lib: {
      entry: path('content/src/index.ts'),
      name: 'ContentScript',
      fileName: () => 'content.js.iife.js',
      formats: ['iife']
    },
    outDir: 'dist/content',
    emptyOutDir: false,
    minify: 'esbuild'
  },
  resolve: {
    alias: {
      '@shared': path('shared')
    }
  }
};

const backgroundConfig: UserConfig = {
  build: {
    lib: {
      entry: path('background/index.ts'),
      name: 'Background',
      fileName: () => 'background.js',
      formats: ['iife']
    },
    outDir: 'dist/background',
    emptyOutDir: false,
    minify: 'esbuild'
  },
  resolve: {
    alias: {
      '@shared': path('shared')
    }
  }
};

const vueConfig = (mode: string, env: Record<string, string>): UserConfig => ({
  plugins: [
    vue(),
    {
      name: 'copy-manifest',
      closeBundle() {
        // Read and process manifest.json
        const manifest = JSON.parse(readFileSync(path('manifest.json'), 'utf-8'));

        // Add key only in dev mode
        if (mode === 'dev') {
          manifest.key = env.VITE_MANIFEST_KEY || undefined;
        }

        // Write modified manifest
        writeFileSync(path('dist/manifest.json'), JSON.stringify(manifest, null, 2));

        // Copy icons
        const iconFiles = readdirSync(path('icons'));
        iconFiles.forEach(file => {
          copyFileSync(path(`icons/${file}`), path(`dist/${file}`));
        });

        console.log('✅ Extension built successfully in dist/ folder');
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        popup: path('popup/index.html'),
        toolbar: path('toolbar/src/main.ts')
      },
      output: {
        entryFileNames: chunk => (chunk.name === 'popup' ? 'popup/index.js' : 'toolbar/index.js'),
        chunkFileNames: chunk =>
          chunk.name?.includes('plugin-vue_export-helper')
            ? 'vendor/plugin-vue-export-helper.js'
            : 'vendor/[name]-[hash].js',
        assetFileNames: asset => {
          const name = asset.name ?? '';
          if (name === 'style.css') return 'popup/popup.css';
          if (name.includes('toolbar')) return 'toolbar/toolbar.css';
          return '[name]/[name].[ext]';
        }
      }
    },
    outDir: 'dist',
    emptyOutDir: false,
    minify: 'esbuild'
  },
  resolve: {
    alias: sharedAliases
  }
});

// Test configuration (Vitest)
const testConfig: UserConfig = {
  test: {
    globals: true,
    environment: 'happy-dom',
    testTimeout: 30000, // Increase timeout for slow Argon2id operations, especially with coverage
    include: ['**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/types.ts',
        'vite.config.ts',
        'background/index.ts',
        'content/src/index.ts',
        'toolbar/src/main.ts'
      ]
    }
  },
  resolve: {
    alias: sharedAliases
  }
};

// Export a single config that switches based on the npm script
export default defineConfig(({ command, mode }) => {
  // Load environment variables based on mode
  const env = loadEnv(mode, __dirname, '');

  // Test configuration (Vitest)
  if (command === 'serve' && process.env.VITEST) {
    return testConfig;
  }

  // Use environment variable to determine build target
  if (process.env.BUILD_TARGET === 'content') {
    return contentConfig;
  }
  if (process.env.BUILD_TARGET === 'background') {
    return backgroundConfig;
  }

  return vueConfig(mode, env);
});