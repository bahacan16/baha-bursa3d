/// <reference lib="webworker" />
import { buildWorld, transferables, type BuildOptions } from './build';
import type { SimpleOsm } from './simplify';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<{ data: SimpleOsm; opts: BuildOptions }>) => {
  try {
    const res = buildWorld(e.data.data, e.data.opts, (p, label) =>
      ctx.postMessage({ type: 'progress', p, label }),
    );
    ctx.postMessage({ type: 'done', res }, transferables(res));
  } catch (err) {
    ctx.postMessage({ type: 'error', message: (err as Error).message ?? String(err) });
  }
};
