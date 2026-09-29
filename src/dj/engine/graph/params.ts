/** Smoothly moves an AudioParam to `value` (≈10 ms), click-free for knob/fader moves. */
export function smooth(param: AudioParam, value: number, ctx: BaseAudioContext, timeConstant = 0.01): void {
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setTargetAtTime(value, t, timeConstant);
}

/**
 * Schedules a short value curve with linear ramps (unlike setValueCurveAtTime,
 * this never throws when a previous fade is still running).
 */
export function rampCurve(param: AudioParam, values: Float32Array, startTime: number, duration: number): void {
  param.cancelScheduledValues(startTime);
  param.setValueAtTime(values[0]!, startTime);
  const n = values.length;
  for (let i = 1; i < n; i++) param.linearRampToValueAtTime(values[i]!, startTime + (duration * i) / (n - 1));
}
