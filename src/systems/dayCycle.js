export const MATCH_DURATION = 180;
export const RESPAWN_DELAY = 8;

// Match runs from pre-dawn through mid-morning.
export const PHASE_START = 0.205;
export const PHASE_END = 0.38;

export class DayCycle {
  constructor() {
    this.phase = PHASE_START;
    this.paused = false;
  }

  /** Map elapsed match seconds to sky phase. */
  static phaseFromMatchTime(matchTime) {
    const u = Math.min(1, Math.max(0, matchTime / MATCH_DURATION));
    return PHASE_START + u * (PHASE_END - PHASE_START);
  }

  setFromMatchTime(matchTime) {
    this.phase = DayCycle.phaseFromMatchTime(matchTime);
    return this.phase;
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }

  static daylight(phase) {
    const t = phase * Math.PI * 2;
    const elev = -Math.cos(t) * 48 + 4;
    return Math.max(0, Math.min(1, (elev + 8) / 44));
  }

  static sunAngles(phase) {
    const t = phase * Math.PI * 2;
    const elevation = Math.max(-12, Math.min(52, -Math.cos(t) * 48 + 4));
    const azimuth = 55 + phase * 280;
    return { elevation, azimuth };
  }
}
