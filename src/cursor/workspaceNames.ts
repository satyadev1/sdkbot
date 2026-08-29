import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolves Cursor workspace ids to the workspace's folder name.
 *
 * Cursor records the authoritative path in
 * `workspaceStorage/<workspaceId>/workspace.json` as a file URI, so there is no
 * need to un-mangle the `Users-me-...` project directory names (which is
 * lossy — `/` and `.` both become `-`).
 */
export function defaultWorkspaceStorageDir(): string {
  return join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage');
}

export async function workspaceFolderName(
  workspaceId: string,
  storageDir: string = defaultWorkspaceStorageDir(),
): Promise<string> {
  if (workspaceId === '') return 'unknown';

  try {
    const raw = await readFile(join(storageDir, workspaceId, 'workspace.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const folder =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { folder?: unknown }).folder
        : undefined;
    if (typeof folder !== 'string' || folder === '') return workspaceId.slice(0, 8);

    const path = folder.startsWith('file://') ? decodeURIComponent(folder.slice('file://'.length)) : folder;
    const name = path.replace(/\/+$/, '').split('/').pop();
    return name === undefined || name === '' ? workspaceId.slice(0, 8) : name;
  } catch {
    // Workspace removed, or a window with no folder open.
    return workspaceId.slice(0, 8);
  }
}

/** Caching resolver, so repeated polls don't re-read the same files. */
export function createWorkspaceNameResolver(storageDir: string = defaultWorkspaceStorageDir()) {
  const cache = new Map<string, string>();
  return async (workspaceId: string): Promise<string> => {
    const cached = cache.get(workspaceId);
    if (cached !== undefined) return cached;
    const name = await workspaceFolderName(workspaceId, storageDir);
    cache.set(workspaceId, name);
    return name;
  };
}
