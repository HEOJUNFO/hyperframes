import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ID_PATH = join(".hyperframes", "history-id");
/** The only shape minted here; the id is project content and becomes a path, so nothing else is trusted. */
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function readId(projectDir: string): string | null {
  try {
    const id = readFileSync(join(projectDir, ID_PATH), "utf-8").trim();
    return ID_SHAPE.test(id) ? id : null;
  } catch {
    return null;
  }
}

type Recorded = { dir?: string; dev?: number; ino?: number };

function recorded(historyDir: string): Recorded | null {
  try {
    return JSON.parse(readFileSync(join(historyDir, "project.json"), "utf-8"));
  } catch {
    return null;
  }
}

function isCopy(
  was: Recorded,
  id: string,
  dir: string,
  folder: { dev: number; ino: number },
): boolean {
  if (!was.dir || (was.ino === folder.ino && was.dev === folder.dev)) return false;
  return was.dir === dir ? was.ino !== undefined : existsSync(was.dir) && readId(was.dir) === id;
}

/**
 * The project's history id, kept in the project so a rename or move keeps its history. A folder carrying the id of
 * a recorded folder that still has it, or standing where another recorded folder was, is a copy: it gets its own id.
 */
export function projectHistoryId(projectDir: string, historyRoot: string): string {
  const dir = resolve(projectDir);
  const { dev, ino } = statSync(dir);
  let id = readId(dir);
  const was = id && recorded(join(historyRoot, id));
  if (!id || (was && isCopy(was, id, dir, { dev, ino }))) {
    id = randomUUID();
    mkdirSync(join(dir, ".hyperframes"), { recursive: true });
    writeFileSync(join(dir, ID_PATH), `${id}\n`);
  }
  mkdirSync(join(historyRoot, id), { recursive: true });
  writeFileSync(join(historyRoot, id, "project.json"), JSON.stringify({ dir, dev, ino }));
  return id;
}
