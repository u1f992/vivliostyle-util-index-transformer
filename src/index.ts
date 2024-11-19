import crypto, { UUID } from "node:crypto";
import path from "node:path";

import { Element } from "hast";
import { toString } from "hast-util-to-string";
import { visit } from "unist-util-visit";
import { VFile } from "vfile";

function stableStringify(obj: any): string {
  return typeof obj === "string"
    ? obj
    : JSON.stringify(
        typeof obj !== "object" || obj === null
          ? obj
          : Array.isArray(obj)
          ? obj.map((item) => stableStringify(item))
          : Object.keys(obj)
              .sort()
              .reduce((acc: any, key) => {
                acc[key] = stableStringify(obj[key]);
                return acc;
              }, {})
      );
}

type IndexEntry = { term: string; reading: string };
type IndexEntryString = string & { _indexEntryString: never };
function indexEntryStringify(indexEntry: IndexEntry): IndexEntryString {
  return stableStringify(indexEntry) as IndexEntryString;
}
function indexEntryParse(indexEntryString: IndexEntryString): IndexEntry {
  return JSON.parse(indexEntryString) as IndexEntry;
}

type IndexID = `-${string}-${UUID}` & { _indexUUID: never };
function generateUniqueID(prefix: string, assigned: Set<IndexID>): IndexID {
  let id = `-${prefix}-${crypto.randomUUID()}` as IndexID;
  while (assigned.has(id)) {
    id = `-${prefix}-${crypto.randomUUID()}` as IndexID;
  }
  assigned.add(id);
  return id;
}

type HrefIdentifier = { path: string; id: IndexID };
type HrefIdentifierString = string & { _hrefIdentifierString: never };
function hrefIdentifierStringify(
  hrefIdentifier: HrefIdentifier
): HrefIdentifierString {
  return stableStringify(hrefIdentifier) as HrefIdentifierString;
}
function hrefIdentifierParse(
  hrefIdentifierString: HrefIdentifierString
): HrefIdentifier {
  return JSON.parse(hrefIdentifierString) as HrefIdentifier;
}

export class IndexStore<
  TName extends string,
  TGroups extends readonly string[]
> {
  #name: TName;
  get name() {
    return this.#name;
  }
  #locale: Intl.LocalesArgument;
  #index: Map<
    TGroups[number],
    Map<IndexEntryString, Set<HrefIdentifierString>>
  >;
  #assigned: Set<IndexID>;

  constructor(name: TName, locale: Intl.LocalesArgument, groups: TGroups) {
    this.#name = name;
    this.#locale = locale;
    this.#index = new Map();
    this.#assigned = new Set();
    for (const g of groups) {
      this.#index.set(g, new Map());
    }
  }

  add(group: TGroups[number], path: string, entry: IndexEntry): IndexID {
    const g = this.#index.get(group);
    if (!g) {
      throw new Error(`Group "${group}" not found in index.`);
    }

    const id = generateUniqueID(this.#name, this.#assigned);
    const hrefIDStr = hrefIdentifierStringify({ path, id });
    const entryStr = indexEntryStringify(entry);
    if (g.has(entryStr)) {
      const hrefIDs = g.get(entryStr);
      if (!hrefIDs) {
        throw new Error("never");
      }
      hrefIDs.add(hrefIDStr);
    } else {
      g.set(entryStr, new Set([hrefIDStr]));
    }

    this.#index.set(
      group,
      new Map(
        Array.from(g.entries())
          .map(([entryStr, hrefIDs]) => ({
            entryStr,
            hrefIDs,
            entry: indexEntryParse(entryStr),
          }))
          .sort((a, b) =>
            a.entry.reading.localeCompare(b.entry.reading, this.#locale)
          )
          .map(
            ({ entryStr, hrefIDs }) =>
              [entryStr, hrefIDs] as [
                IndexEntryString,
                Set<HrefIdentifierString>
              ]
          )
      )
    );

    return id;
  }

  build(indexPath: string) {
    return {
      type: "root",
      children: Array.from(this.#index.entries())
        .filter(([_, terms]) => terms.size > 0)
        .map(([group, terms]) => ({
          type: "element",
          tagName: "section",
          children: [
            {
              type: "element",
              tagName: "h3",
              children: [{ type: "text", value: group }],
            },
            {
              type: "element",
              tagName: "ul",
              children: Array.from(terms.entries()).map(
                ([entryStr, hrefIDs]) => {
                  const entry = indexEntryParse(entryStr);

                  return {
                    type: "element",
                    tagName: "li",
                    properties: { className: `${this.#name}-entry` },
                    children: [
                      {
                        type: "element",
                        tagName: "div",
                        properties: { className: `${this.#name}-entry-inner` },
                        children: [
                          {
                            type: "element",
                            tagName: "span",
                            properties: {
                              className: `${this.#name}-entry-term`,
                            },
                            children: [{ type: "text", value: entry.term }],
                          },
                          {
                            type: "element",
                            tagName: "span",
                            properties: {
                              className: `${this.#name}-entry-dots`,
                            },
                            children: [],
                          },
                          {
                            type: "element",
                            tagName: "span",
                            properties: {
                              className: `${this.#name}-entry-pages`,
                            },
                            children: Array.from(hrefIDs).flatMap(
                              (hrefIDStr, index, array) => {
                                const { path: targetPath, id } =
                                  hrefIdentifierParse(hrefIDStr);
                                const relPath = path
                                  .relative(path.dirname(indexPath), targetPath)
                                  .split(path.sep)
                                  .join(path.posix.sep);
                                const href = `${relPath}#${id}`;

                                return [
                                  {
                                    type: "element",
                                    tagName: "a",
                                    properties: {
                                      href: href,
                                      className: `${
                                        this.#name
                                      }-entry-pages-page`,
                                    },
                                    children: [],
                                  },
                                  ...(index < array.length - 1
                                    ? [
                                        {
                                          type: "element",
                                          tagName: "span",
                                          properties: {
                                            className: `${
                                              this.#name
                                            }-entry-pages-separator`,
                                          },
                                          children: [],
                                        },
                                      ]
                                    : []),
                                ];
                              }
                            ),
                          },
                        ],
                      },
                    ],
                  };
                }
              ),
            },
          ],
        })),
    };
  }
}

function withSuffix(filePath: string, newSuffix: string) {
  return path
    .format({
      ...path.parse(filePath),
      base: undefined,
      ext: newSuffix,
    })
    .split(path.sep)
    .join(path.posix.sep);
}

function isIndexEntryNode(node: Element, indexStoreName: string): boolean {
  const className = node.properties?.className;
  // string | number | boolean | (string | number)[] | null | undefined

  if (typeof className === "string") {
    return className === indexStoreName;
  } else if (Array.isArray(className)) {
    return className
      .filter((name) => typeof name === "string")
      .includes(indexStoreName);
  }

  return false;
}

export function createIndex<
  TName extends string,
  TGroups extends readonly string[]
>(indexStore: IndexStore<TName, TGroups>) {
  return (tree: any, file: VFile) => {
    /*
     * workspaceDirを考慮するとHTMLがMarkdownと同じディレクトリに生成されるとは限らないが、
     * 必要なのは相対パスで、workspaceDirが変わっても配置関係は維持されるはずなので問題なし
     */
    if (file.history.length < 1) {
      throw new Error("File history is empty.");
    }
    const htmlPath = withSuffix(file.history.at(-1) || "", ".html");

    visit(tree, "element", (node: Element, index, parent) => {
      if (isIndexEntryNode(node, indexStore.name)) {
        const group = String(node.properties["dataGroup"]);
        const term = node.properties["dataTerm"] || toString(node);
        const reading = node.properties["dataReading"] || term;
        const id = indexStore.add(group, htmlPath, {
          term: typeof term !== "string" ? String(term) : term,
          reading: typeof reading !== "string" ? String(reading) : reading,
        });
        node.properties.id = id;
      } else if (
        node.tagName === "section" &&
        node.properties?.id === indexStore.name
      ) {
        parent.children.splice(
          index,
          1,
          ...indexStore.build(htmlPath).children
        );
      }
    });
  };
}
