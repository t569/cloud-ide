// frontend/src/vfs/HttpFileStore.ts
//
// The FileStore backed by the backend worktree over /api/fs — exactly the calls
// VirtualFileSystem used to make inline, moved behind the port with no change in
// behaviour. This is the store for every tier where a server holds the files.
import { apiClient } from '../lib/apiClient';
import { FileStore, StoreEntry } from './FileStore';

export class HttpFileStore implements FileStore {
  constructor(private sandboxId: string) {}

  /** The sandbox id is a path segment on every route, so it is encoded once here. */
  private get base(): string {
    return `/fs/${encodeURIComponent(this.sandboxId)}`;
  }

  public list(dirPath: string): Promise<StoreEntry[]> {
    return apiClient.get<StoreEntry[]>(`${this.base}/ls?path=${encodeURIComponent(dirPath)}`);
  }

  public async read(path: string): Promise<string> {
    const { content } = await apiClient.get<{ content: string }>(
      `${this.base}/read?path=${encodeURIComponent(path)}`,
    );
    return content;
  }

  public async write(path: string, content: string): Promise<void> {
    await apiClient.post(`${this.base}/write`, { path, content });
  }

  public async remove(path: string): Promise<void> {
    await apiClient.delete(`${this.base}/delete?path=${encodeURIComponent(path)}`);
  }

  public async readExternal(path: string): Promise<string> {
    const { content } = await apiClient.get<{ content: string }>(
      `${this.base}/read-external?path=${encodeURIComponent(path)}`,
    );
    return content;
  }
}
