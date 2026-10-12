/**
 * Caro Arena — High-Fidelity Web Audio Sound Effects Synthesizer
 * Uses Web Audio API with zero external audio assets or network latency.
 */
class CaroAudio {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem("caro_sound_enabled") !== "false";
    this.masterGain = null;
    this._initialized = false;
  }

  init() {
    if (this._initialized && this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
      this._initialized = true;
    } catch (e) {
      console.warn("Web Audio not supported or blocked", e);
    }
  }

  ensureContext() {
    if (!this._initialized) this.init();
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem("caro_sound_enabled", this.enabled ? "true" : "false");
    return this.enabled;
  }

  /**
   * Tactile wooden Go/Caro stone click sound.
   * Sharp attack transient + short acoustic board resonance.
   */
  playStoneClick(playerType = "ai") {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Base resonance frequencies per player
    let baseFreq = 850;
    if (playerType === "human") baseFreq = 1050;
    else if (playerType === "jev") baseFreq = 780;
    else if (playerType === "laya") baseFreq = 880;
    else if (playerType === "von") baseFreq = 820;
    else if (playerType === "mojev") baseFreq = 930;

    // Add slight random pitch variation (+- 4%)
    const pitchJitter = 1 + (Math.random() - 0.5) * 0.08;
    const freq = baseFreq * pitchJitter;

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.45, t + 0.045);

    // Filtered noise click for tactile snap
    const bufferSize = this.ctx.sampleRate * 0.015;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    }
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1600;
    noiseFilter.Q.value = 2.0;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.015);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    // Resonant body envelope
    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    noiseSource.start(t);
    osc.stop(t + 0.07);
    noiseSource.stop(t + 0.02);
  }

  /**
   * Resonant multi-harmonic chord for winning 5-in-a-row alignment.
   */
  playWinChime(rank = 1) {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    let notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 (1st Place Gold)
    if (rank === 2) notes = [587.33, 739.99, 880.00, 1174.66]; // D5, F#5, A5, D6 (2nd Place Silver)
    else if (rank === 3) notes = [392.00, 493.88, 587.33, 783.99]; // G4, B4, D5, G5 (3rd Place Bronze)
    else if (rank >= 4) notes = [349.23, 440.00, 523.25]; // F4, A4, C5

    notes.forEach((freq, idx) => {
      const noteTime = t + idx * 0.06;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = idx % 2 === 0 ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.001, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.28 / (idx + 1), noteTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.7);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(noteTime);
      osc.stop(noteTime + 0.75);
    });
  }

  /**
   * Sci-fi energetic beam whoosh for laser strike.
   */
  playLaserSweep() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.exponentialRampToValueAtTime(1400, t + 0.22);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.45);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800, t);

    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.5);
  }

  /**
   * Prominent chime notification when Human's turn arrives.
   */
  playHumanTurnAlert() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const freqs = [659.25, 880.00]; // E5 -> A5
    freqs.forEach((freq, idx) => {
      const noteTime = t + idx * 0.12;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.001, noteTime);
      gain.gain.linearRampToValueAtTime(0.3, noteTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.4);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(noteTime);
      osc.stop(noteTime + 0.45);
    });
  }

  /**
   * Tournament Victory Fanfare (Trophy winner celebration).
   */
  playChampionshipFanfare() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const melody = [
      { f: 523.25, d: 0.12 }, // C5
      { f: 659.25, d: 0.12 }, // E5
      { f: 783.99, d: 0.12 }, // G5
      { f: 1046.50, d: 0.40 } // C6
    ];

    let cur = t;
    melody.forEach((m) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(m.f, cur);

      gain.gain.setValueAtTime(0.001, cur);
      gain.gain.linearRampToValueAtTime(0.35, cur + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, cur + m.d + 0.2);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(cur);
      osc.stop(cur + m.d + 0.25);
      cur += m.d;
    });
  }
}

window.CaroAudio = new CaroAudio();
