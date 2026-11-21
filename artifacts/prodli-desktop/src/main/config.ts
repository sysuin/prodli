// Build-time settings (scripts/build.mjs defines these with esbuild).
import { app } from "electron";
import path from "node:path";

declare const __PRODLI_API__: string;
declare const __PRODLI_DEV__: boolean;
declare const __PRODLI_UPDATE_URL__: string;

/** ProdLi's server (https://app.prodli.com unless built with PRODLI_API). */
export const API_BASE: string = typeof __PRODLI_API__ === "string" && __PRODLI_API__ ? __PRODLI_API__ : "https://app.prodli.com";
/** Development build: dev tools, reload menu items. */
export const IS_DEV: boolean = typeof __PRODLI_DEV__ === "boolean" ? __PRODLI_DEV__ : false;

/** Where updates are published (PRODLI_UPDATE_URL at build time); empty = no automatic updates. */
export const UPDATE_URL: string = typeof __PRODLI_UPDATE_URL__ === "string" ? __PRODLI_UPDATE_URL__ : "";

/** dist/renderer next to dist/main (also inside the packaged app.asar). */
export const rendererDir = () => path.join(app.getAppPath(), "dist", "renderer");
export const preloadPath = () => path.join(app.getAppPath(), "dist", "preload", "index.cjs");
/** Icons used at runtime (tray, window on Windows/Linux); shipped via electron-builder `extraResources`. */
export const resourcePath = (...p: string[]) => (app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(app.getAppPath(), "build", ...p));
