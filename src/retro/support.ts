export interface SupportReport {
  webgl2: boolean;
  audioWorklet: boolean;
}

export function checkSupport(win: Window): SupportReport {
  let webgl2 = false;
  try {
    webgl2 = !!win.document.createElement('canvas').getContext('webgl2');
  } catch {
    webgl2 = false;
  }
  const audioWorklet = typeof (win as Window & { AudioWorkletNode?: unknown }).AudioWorkletNode === 'function';
  return { webgl2, audioWorklet };
}
