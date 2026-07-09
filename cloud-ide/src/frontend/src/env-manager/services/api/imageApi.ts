// Base-image search — proxied through our backend (Docker Hub blocks browser CORS).
import { apiClient } from '@frontend/lib/apiClient';

export interface ImageResult {
  name: string; // repo ref, e.g. "python" (official) or "user/repo"
  description?: string;
  official?: boolean;
  stars?: number;
}

export const searchImages = (q: string) =>
  apiClient.get<{ results: ImageResult[] }>(`/images/search?q=${encodeURIComponent(q)}`);

export const listImageTags = (repo: string) =>
  apiClient.get<{ tags: string[] }>(`/images/tags?repo=${encodeURIComponent(repo)}`);
