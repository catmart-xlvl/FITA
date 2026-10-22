import { defineConfig } from "vite";
export default defineConfig({
  server: {watch: {ignored: ["**/data/**", "**/projects/**", "**/.runtime/**"]}},
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: [
            "three",
            "three/addons/controls/OrbitControls.js",
            "three/addons/loaders/GLTFLoader.js",
          ],
        },
      },
    },
    chunkSizeWarningLimit: 650,
  },
});
