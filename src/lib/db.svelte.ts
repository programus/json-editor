import Dexie, { type EntityTable } from 'dexie'
import { stringify } from 'lossless-json'
import { Mode, isJSONContent, toJSONContent, type Content } from 'svelte-jsoneditor'

interface EditorInfo {
  title: string
  text: string
  mode: Mode
}

const db = new Dexie('EditorDatabase') as Dexie & {
  editors: EntityTable<
    EditorInfo,
    'title' // primary key "title" (for the typings only)
  >;
};

// Schema declaration:
db.version(1).stores({
  editors: 'title, text, mode' // primary key "title" (for the runtime!)
});

export function save(meta: {
  title: string
  content: Content
  mode: Mode
}) {
  return db.editors.put({
    title: meta.title,
    text: isJSONContent(meta.content)
      ? stringify(toJSONContent(meta.content).json, null, 2) || ''
      : meta.content.text || '',
    mode: meta.mode,
  })
}

export type { EditorInfo };
export { db };