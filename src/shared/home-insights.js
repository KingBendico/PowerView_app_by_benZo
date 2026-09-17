(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.homeInsightsFormat = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const powerNames = { 0: 'Battery', 1: 'Wired', 2: 'Rechargeable', 11: 'Rechargeable', 12: 'Wired' };
  const isWired = value => value === 1 || value === 12;
  const firmware = value => typeof value === 'string' ? value.slice(0, 80)
    : value && ['revision', 'subRevision', 'build'].every(key => Number.isInteger(value[key]) && value[key] >= 0)
      ? [value.revision, value.subRevision, value.build].join('.') : null;
  function normalizeHealth(shade) {
    const powerType = Number.isInteger(shade.powerType) ? shade.powerType : null;
    const batteryStatus = Number.isInteger(shade.batteryStatus) && shade.batteryStatus >= 0 && shade.batteryStatus <= 3 ? shade.batteryStatus : null;
    const batteryPercent = typeof shade.batteryPercent === 'number' && Number.isFinite(shade.batteryPercent)
      && shade.batteryPercent >= 0 && shade.batteryPercent <= 100 ? Math.round(shade.batteryPercent) : null;
    return { powerType, batteryStatus, batteryPercent,
      batteryLow: !isWired(powerType) && (batteryStatus !== null && batteryStatus <= 1 || batteryPercent !== null && batteryPercent <= 20),
      signalStrength: typeof shade.signalStrength === 'number' && Number.isFinite(shade.signalStrength)
        && shade.signalStrength < 0 && shade.signalStrength >= -200 ? Math.round(shade.signalStrength) : null,
      firmware: firmware(shade.firmware) };
  }
  function healthSummary(shade) {
    const issues = [];
    if (!shade.available) issues.push('Offline');
    if (shade.batteryLow) issues.push(shade.batteryStatus === 0 ? 'Battery depleted' : 'Low battery');
    if (!shade.controls?.known) issues.push('Unsupported controls');
    else if (shade.available && shade.controls.axes.some(axis => !Number.isFinite(shade.positions?.[axis.key]))) issues.push('Position not reported');
    const battery = isWired(shade.powerType) ? 'Wired power'
      : shade.batteryLow && (shade.batteryStatus == null || shade.batteryStatus > 1) && (shade.batteryPercent == null || shade.batteryPercent > 20) ? 'Low battery reported'
      : shade.batteryPercent != null ? `${shade.batteryPercent}%`
      : ['Depleted', '20% or less', '21–50%', '51–100%'][shade.batteryStatus] || 'Not reported';
    return { issues, battery, power: powerNames[shade.powerType] || 'Not reported',
      priority: !shade.available ? 0 : shade.batteryLow ? 1 : issues.length ? 2 : 3 };
  }
  function normalizeAutomations(raw) {
    if (!Array.isArray(raw) || raw.length > 10000) throw new Error('The gateway returned an invalid schedule list.');
    const seen = new Set();
    const identifier = value => ['string', 'number'].includes(typeof value) && /^\d+$/.test(String(value)) ? String(value) : null;
    return raw.map(item => {
      const id = identifier(item?.id);
      if (!id || seen.has(id)) throw new Error('The gateway returned an invalid schedule identifier.');
      seen.add(id);
      const type = Number.isInteger(item.type) ? item.type : null;
      const hour = Number.isInteger(item.hour) && item.hour >= 0 && item.hour <= 23 ? item.hour : null;
      const minute = Number.isInteger(item.min) && item.min >= 0 && item.min <= 59 ? item.min : null;
      return { id, sceneId: identifier(item.sceneId), type, hour, minute,
        enabled: typeof item.enabled === 'boolean' ? item.enabled : null,
        days: Number.isInteger(item.days) && item.days >= 0 && item.days <= 127 ? item.days : null,
        errorShadeIds: [...new Set((Array.isArray(item.errorShd_Ids) ? item.errorShd_Ids : []).map(identifier).filter(Boolean))],
        timingKnown: [0, 2, 6, 10, 14].includes(type) && hour !== null && minute !== null };
    });
  }
  function scheduleTime(item) {
    if (!item.timingKnown) return { group: 'Other schedules', text: 'Time not reported', order: 0 };
    const minutes = item.hour * 60 + item.minute;
    if (item.type === 0) return { group: 'Clock times', text: `${String(item.hour).padStart(2, '0')}:${String(item.minute).padStart(2, '0')}`, order: minutes };
    const sunrise = [2, 10].includes(item.type), before = [2, 6].includes(item.type);
    const sun = sunrise ? 'sunrise' : 'sunset';
    const duration = [item.hour ? `${item.hour}h` : '', item.minute ? `${item.minute}m` : ''].filter(Boolean).join(' ');
    return { group: sunrise ? 'Around sunrise' : 'Around sunset',
      text: minutes ? `${duration} ${before ? 'before' : 'after'} ${sun}` : `At ${sun}`, order: before ? -minutes : minutes };
  }
  function scheduleDays(mask) {
    if (mask === null) return 'Days not reported';
    if (mask === 0) return 'No days selected';
    if (mask === 127) return 'Every day';
    if (mask === 31) return 'Weekdays';
    if (mask === 96) return 'Weekends';
    return days.filter((_day, i) => mask & (1 << i)).map(day => day.slice(0, 3)).join(', ');
  }
  function positionText(shade, positions) {
    const round = key => Math.round(positions[key]);
    if (shade?.controls?.kind === 'dual-rail') return [
      Number.isFinite(positions.secondary) ? `Top edge ${round('secondary')}% from top` : '',
      Number.isFinite(positions.primary) ? `bottom edge ${100 - round('primary')}% from top` : '',
    ].filter(Boolean).join(' · ');
    return Object.entries(positions || {}).filter(([, value]) => Number.isFinite(value)).map(([axis, value]) =>
      axis === 'primary' && ['standard', 'vertical', 'top-down'].includes(shade?.controls?.kind)
        ? `${Math.round(shade.controls.kind === 'top-down' ? value : 100 - value)}% closed`
        : `${shade?.controls?.axes?.find(item => item.key === axis)?.label || axis} ${Math.round(value)}%`).join(' · ');
  }
  return { days, firmware, normalizeHealth, healthSummary, normalizeAutomations, scheduleTime, scheduleDays, positionText };
});
