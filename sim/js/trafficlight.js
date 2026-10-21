/* ============================================================================
   TRAFFIC LIGHT — cycles the intersection through NS / EW phases.
   Provides per-approach vehicle signals and per-crosswalk pedestrian signals.
   Pedestrian WALK runs concurrent with the parallel green; turning vehicles
   must yield to those pedestrians (handled by the reasoning layer).
   ============================================================================ */

class TrafficLight {
  constructor() {
    this.phases = [
      { name: 'NS_GREEN',  dur: LIGHT.nsGreen,  ns: 'green',  ew: 'red' },
      { name: 'NS_YELLOW', dur: LIGHT.nsYellow, ns: 'yellow', ew: 'red' },
      { name: 'ALL_RED_1', dur: LIGHT.allRed1,  ns: 'red',    ew: 'red' },
      { name: 'EW_GREEN',  dur: LIGHT.ewGreen,  ns: 'red',    ew: 'green' },
      { name: 'EW_YELLOW', dur: LIGHT.ewYellow, ns: 'red',    ew: 'yellow' },
      { name: 'ALL_RED_2', dur: LIGHT.allRed2,  ns: 'red',    ew: 'red' },
    ];
    this.i = 0;
    this.t = 0;
  }

  reset() { this.i = 0; this.t = 0; }

  update(dt) {
    this.t += dt;
    while (this.t >= this.phases[this.i].dur) {
      this.t -= this.phases[this.i].dur;
      this.i = (this.i + 1) % this.phases.length;
    }
  }

  get phase() { return this.phases[this.i]; }
  get timeLeft() { return this.phases[this.i].dur - this.t; }

  vehicle(approach) {
    const p = this.phase;
    return (approach === 'N' || approach === 'S') ? p.ns : p.ew;
  }

  /* A crosswalk is safe to walk when the ROAD it crosses has a red signal.
     The S/N crosswalks cross the N-S road; the E/W crosswalks cross the E-W road. */
  pedestrian(cwId) {
    const p = this.phase;
    const roadSignal = (cwId === 'S' || cwId === 'N') ? p.ns : p.ew;
    if (roadSignal === 'red') return 'walk';
    if (roadSignal === 'yellow') return 'flash';   // finish crossing, don't start
    return 'dont';
  }
}
