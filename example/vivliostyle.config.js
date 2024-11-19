// @ts-check
import {
  IndexStore,
  createIndex,
} from "@u1f992/vivliostyle-util-index-transformer";
import { VFM } from "@vivliostyle/vfm";

/** @type {readonly ["英数字", "あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ"]} */
const groups = [
  "英数字",
  "あ",
  "か",
  "さ",
  "た",
  "な",
  "は",
  "ま",
  "や",
  "ら",
  "わ",
];
const indexStore = new IndexStore("index", new Intl.Locale("ja-JP"), groups);

/** @type {import('@vivliostyle/cli').VivliostyleConfigSchema} */
const vivliostyleConfig = {
  title: "example",
  author: "ChatGPT",
  language: "ja",
  theme: "./css",
  image: "ghcr.io/vivliostyle/cli:8.16.2",
  entry: ["01/manuscript.md", "02/manuscript.md", "98/index.md"],
  output: ["./output.pdf"],
  workspaceDir: ".vivliostyle",
  documentProcessor: (options, config) =>
    VFM(options, config).use(createIndex, indexStore),
};

export default vivliostyleConfig;
