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
      extractor = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        {
          device: 'webgpu',
          dtype: 'q8',
          progress_callback: (progress: any) => {
            if (progress.status === 'progress') {
              const percent = Math.round(progress.progress * 100);
              progressCallback?.({ loaded: false, loading: true, progress: percent });
            }
          },
        }
      );
      progressCallback?.({ loaded: true, loading: false, progress: 100 });
    } catch (error) {
      console.error('[Embedder] Failed to initialize:', error);
      progressCallback?.({ loaded: false, loading: false, progress: null });
      throw error;
    }
  })();

  return initPromise;
}

export async function embedText(text: string): Promise<Float32Array> {
  if (!extractor) {
    await initEmbedder();
  }

  const output = await extractor(text, {
    pooling: 'mean',
    normalize: true,
  });

  return output.data;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function isLoaded(): boolean {
  return extractor !== null;
}