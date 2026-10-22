import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import fs from "node:fs/promises";
import { createApp } from "./app.js";
import {checkForUpdates} from '../distribution/manager.mjs';
import {extensionFolderInfo} from '../distribution/extension-folder.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT || 4317);
const { app } = await createApp({
  dataDir: path.join(root, "data"),
  bridgeDevicesFile: path.join(root, ".runtime", "studio-devices.json"),
  demoDir: path.join(root, "fixtures"),
  codexDeliveryOptions: {baseUrl:`http://127.0.0.1:${port}`},
  segmentationOptions: {deliveryOptions:{baseUrl:`http://127.0.0.1:${port}`}},
  distribution:{...await extensionFolderInfo(process.env.FITA_INSTALL_ROOT||root,root),check:()=>checkForUpdates(process.env.FITA_INSTALL_ROOT||root)},
});
const dev = process.argv.includes("--dev");
if (dev) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  await fs.access(path.join(root, "dist/index.html"));
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (req, res) =>
    res.sendFile(path.join(root, "dist/index.html")),
  );
}
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`FITA ready: http://127.0.0.1:${port}`),
);
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE"
      ? `Port ${port} is occupied. Close the other FITA installation or change PORT.`
      : "The local server could not start.",
  );
  process.exitCode = 1;
});
