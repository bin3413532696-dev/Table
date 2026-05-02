import { pipeline, env } from '@huggingface/transformers';

env.useBrowserCache = true;
env.allowRemoteModels = true;

let extractor: any = null;
let initPromise: Promise<void> | null = null;

export interface EmbedderStatus {
  loaded: boolean;
  loading: boolean;
  progress: number | null;
}

type ProgressCallback = (status: EmbedderStatus) => void;

let progressCallback: ProgressCallback | null = null;

const defaultProgressCallback: ProgressCallback = (status) => {
  console.log(`[Embedder] ${status.loaded ? 'Loaded' : status.loading ? `Loading... ${status.progress}%` : 'Not started'}`);
};

export async function initEmbedder(onProgress?: ProgressCallback): Promise<void> {
  if (extractor) return;

  if (initPromise) return initPromise;

  progressCallback = onProgress || defaultProgressCallback;
  progressCallback({ loaded: false, loading: true, progress: 0 });

  initPromise = (async () => {
    try {
      console.log('[Embedder] Creating pipeline...');

      extractor = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        {
          device: 'wasm',
          progress_callback: (progress: any) => {
            console.log('[Embedder] Progress:', progress);
            if (progress.status === 'progress' && progress.progress) {
              const percent = Math.round(progress.progress);
              progressCallback?.({ loaded: false, loading: true, progress: percent });
            }
          },
        }
      );

      console.log('[Embedder] Pipeline ready');
      progressCallback?.({ loaded: true, loading: false, progress: 100 });
    } catch (error) {
      console.error('[Embedder] Init failed:', error);
      progressCallback?.({ loaded: false, loading: false, progress: null });
      throw error;
    }
  })();

  return initPromise;
}

export async function embedText(text: string): Promise<Float32Array> {
  if (!extractor) await initEmbedder();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return output.data;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function isLoaded(): boolean {
  return extractor !== null;
}