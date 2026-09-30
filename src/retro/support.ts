export interface SupportReport {
  webgl2: boolean;
  audioWorklet: boolean;
}

export function checkSupport(win: Window): SupportReport {
  let webgl2 = false;
  try {
    const gl = win.document.createElement('canvas').getContext('webgl2');
    webgl2 = !!gl;
    // Release the probe's context now rather than at GC: browsers cap live WebGL contexts (~16).
    gl?.getExtension?.('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl2 = false;
  }
  const audioWorklet = typeof (win as Window & { AudioWorkletNode?: unknown }).AudioWorkletNode === 'function';
  return { webgl2, audioWorklet };
}
