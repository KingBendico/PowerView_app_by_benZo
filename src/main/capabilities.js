// Gen 3 mappings; source references and hardware limits are in docs/VALIDATION.md.
const TYPES = new Map();
for (const [capability, types] of [
  [0, [1, 4, 5, 6, 10, 19, 31, 32, 42, 49, 52, 53, 57, 84]],
  [1, [18, 23, 43, 44, 72]], [2, [51, 62]], [3, [26, 27, 28, 69, 70, 71]],
  [4, [54, 55, 56]], [5, [40, 66]], [6, [7]], [7, [8, 9, 33, 47]],
  [8, [65, 79]], [9, [38]],
]) for (const type of types) TYPES.set(type, capability);

function capabilitiesFor(raw) {
  const code = TYPES.get(Number(raw.type)) ?? (Number.isInteger(raw.capabilities) ? raw.capabilities : null);
  const axis = (key, label) => ({ key, label });
  const known = code !== null && code >= 0 && code <= 10;
  const axes = !known ? [] : code === 5 ? [axis('tilt', 'Tilt')]
    : code === 7 ? [axis('primary', 'Bottom rail'), axis('secondary', 'Top rail')]
    : code >= 8 ? [axis('primary', 'Sheer shade'), axis('secondary', 'Blackout shade')]
    : [axis('primary', code === 6 ? 'Top rail' : 'Opening')];
  if ([1, 2, 4, 9, 10].includes(code)) axes.push(axis('tilt', 'Tilt'));
  return { code, known, axes, stop: true,
    kind: code === 7 ? 'dual-rail' : code === 6 ? 'top-down' : code >= 8 ? 'overlapped'
      : code === 5 ? 'tilt' : [3, 4].includes(code) ? 'vertical' : 'standard',
    description: !known ? 'Unsupported shade type' : [
      'Roller / bottom up', 'Lift and tilt', 'Lift and tilt', 'Curtain / vertical',
      'Vertical with tilt', 'Tilt only', 'Top down', 'Top down / bottom up',
      'Sheer and blackout', 'Sheer, blackout and tilt', 'Sheer, blackout and tilt',
    ][code] };
}

function presetFor(shade, action) {
  if (!['open', 'close'].includes(action)) throw new Error('Unknown shade action.');
  const cap = capabilitiesFor(shade);
  if (!cap.known) throw new Error('This shade type is not supported yet.');
  const open = action === 'open';
  if (cap.code === 5) return { tilt: open ? 50 : 0 };
  if (cap.code === 6) return { primary: open ? 0 : 100 };
  if (cap.code === 7) return { primary: open ? 100 : 0, secondary: 0 };
  if (cap.code >= 8) return open ? { primary: 100 } : { secondary: 0 };
  if ([2, 4].includes(cap.code)) return { primary: open ? 100 : 0, tilt: 100 };
  return { primary: open ? 100 : 0 };
}

function validatePositions(shade, positions) {
  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) throw new Error('Invalid shade position.');
  const cap = capabilitiesFor(shade);
  if (!cap.known) throw new Error('This shade type is not supported yet.');
  const keys = Object.keys(positions);
  if (!keys.length || keys.some(key => !cap.axes.some(axis => axis.key === key))) throw new Error('Unsupported shade control.');
  for (const value of Object.values(positions)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw new Error('Positions must be between 0 and 100.');
  }
  // Reject crossing rails rather than silently changing the untouched axis.
  if (cap.code === 7) {
    const primary = positions.primary ?? shade.positions?.primary;
    const secondary = positions.secondary ?? shade.positions?.secondary;
    if (!Number.isFinite(primary) || !Number.isFinite(secondary)) throw new Error('Refresh both rail positions before moving this shade.');
    if (primary + secondary > 100.01) throw new Error('The rails cannot cross. Move the other rail first.');
  }
  if ([1, 9, 10].includes(cap.code) && (positions.tilt ?? 0) > 0) {
    const primary = positions.primary ?? shade.positions?.primary;
    if (!Number.isFinite(primary) || primary > 1) throw new Error('Close the shade before adjusting tilt.');
    if (cap.code >= 9 && (shade.positions?.secondary ?? 0) < 99) throw new Error('Open the blackout shade before adjusting tilt.');
  }
  return Object.fromEntries(keys.map(key => [key, Math.round(positions[key] * 100) / 10000]));
}
module.exports = { capabilitiesFor, presetFor, validatePositions };
