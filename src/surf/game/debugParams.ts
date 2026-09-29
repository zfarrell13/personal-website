/** Live-tunable config paths for the ?debug panel: [path, min, max, step]. */
export const DEBUG_PARAMS: ReadonlyArray<readonly [string, number, number, number]> = [
  ['wave.height', 1, 4, 0.1],
  ['wave.peelSpeed', 3, 12, 0.5],
  ['wave.tubeDepth', 2, 9, 0.5],
  ['wave.shoulderLength', 15, 70, 1],
  ['wave.hollowLength', 4, 45, 1],
  ['physics.lift', 10, 30, 0.1],
  ['physics.faceDamping', 0, 4, 0.1],
  ['physics.drive', 0, 8, 0.05],
  ['physics.drag', 0.005, 0.1, 0.001],
  ['physics.stallDragMultiplier', 1, 8, 0.5],
  ['physics.carveRate', 1, 6, 0.1],
  ['physics.carveHalfSpeed', 4, 30, 1],
  ['physics.pumpImpulse', 0, 4, 0.1],
  ['physics.pumpCost', 0, 1, 0.05],
  ['physics.launchSpeed', 1, 6, 0.1],
  ['physics.ollieImpulse', 2, 10, 0.1],
  ['physics.spinRate', 180, 900, 10],
  ['physics.landTolerance', 10, 60, 1],
  ['physics.snapTopFrac', 0.5, 1, 0.01],
  ['scoring.comboWindow', 0.5, 4, 0.1],
  ['camera.stiffness', 1, 12, 0.5],
  ['camera.lookStiffness', 1, 16, 0.5],
  ['camera.tubeBlendFloor', 0, 1, 0.05],
  ['camera.tubeBlendRate', 2, 30, 0.5],
  ['camera.tubeStiffness', 2, 40, 1],
];

type Tree = { [k: string]: unknown };

export function getConfigPath(root: object, path: string): number {
  let o: unknown = root;
  for (const k of path.split('.')) o = (o as Tree)[k];
  if (typeof o !== 'number') throw new Error(`Config path ${path} is not a number`);
  return o;
}

export function setConfigPath(root: object, path: string, value: number): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  let o = root as Tree;
  for (const k of keys) o = o[k] as Tree;
  if (typeof o[last] !== 'number') throw new Error(`Config path ${path} is not a number`);
  o[last] = value;
}
