/**
 * Caro Arena — High-Fidelity Web Audio Sound Effects Synthesizer
 * Uses Web Audio API with zero external audio assets or network latency.
 */
(function () {
  if (typeof window === "undefined" || window.CaroAudio) return;

  class CaroAudioSynthesizer {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      try {
        this.enabled = localStorage.getItem("caro_sound_enabled") !== "false";
      } catch {}
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
      try {
        localStorage.setItem("caro_sound_enabled", this.enabled ? "true" : "false");
      } catch {}
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

      // Base pitches for different models to give each an acoustic voice
      const pitchMap = {
        laya: 480,   // Crisp high-mid
        jev: 360,    // Solid wooden knock
        von: 540,    // Bright metallic click
        mojev: 420,  // Deep thud
        human: 440   // Warm resonant clack
      };
      const baseFreq = pitchMap[playerType] || 440;

      // 1. Sharp attack burst (high-frequency transient)
      const noiseGain = this.ctx.createGain();
      const oscAttack = this.ctx.createOscillator();
      oscAttack.type = "sine";
      oscAttack.frequency.setValueAtTime(baseFreq * 2.8, t);
      oscAttack.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, t + 0.025);

      noiseGain.gain.setValueAtTime(0.6, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

      oscAttack.connect(noiseGain);
      noiseGain.connect(this.masterGain);
      oscAttack.start(t);
      oscAttack.stop(t + 0.03);

      // 2. Body resonance (decaying wood resonance)
      const bodyOsc = this.ctx.createOscillator();
      const bodyGain = this.ctx.createGain();
      bodyOsc.type = "triangle";
      bodyOsc.frequency.setValueAtTime(baseFreq, t);
      bodyOsc.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, t + 0.08);

      bodyGain.gain.setValueAtTime(0.45, t);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);

      bodyOsc.connect(bodyGain);
      bodyGain.connect(this.masterGain);
      bodyOsc.start(t);
      bodyOsc.stop(t + 0.09);
    }

    /**
     * Triumphant chime when a player lines up 5 stones.
     * Ascending arpeggio with rich harmonics.
     */
    playWinChime(rank = 1) {
      if (!this.enabled) return;
      this.ensureContext();
      if (!this.ctx) return;

      const t = this.ctx.currentTime;
      // Musical scales based on placement:
      // Rank 1: Gold fanfare (Major triad + octave)
      // Rank 2: Silver resolution
      // Rank 3: Bronze finish
      const chords = {
        1: [523.25, 659.25, 783.99, 1046.50], // C5, E5, G5, C6 (Gold)
        2: [440.00, 554.37, 659.25, 880.00],  // A4, C#5, E5, A5 (Silver)
        3: [392.00, 493.88, 587.33, 783.99]   // G4, B4, D5, G5 (Bronze)
      };
      const notes = chords[rank] || chords[1];

      notes.forEach((freq, idx) => {
        const noteTime = t + (idx * 0.075);
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, noteTime);

        gain.gain.setValueAtTime(0.001, noteTime);
        gain.gain.linearRampToValueAtTime(0.28, noteTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(noteTime);
        osc.stop(noteTime + 0.38);
      });
    }

    /**
     * Futuristic laser-sweep sound when the winning line illuminates
     */
    playLaserSweep() {
      if (!this.enabled) return;
      this.ensureContext();
      if (!this.ctx) return;

      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(1200, t + 0.22);
      osc.frequency.exponentialRampToValueAtTime(330, t + 0.45);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.48);
    }

    /**
     * Subtle countdown beep for countdown or fast pace
     */
    playBeep(isHigh = false) {
      if (!this.enabled) return;
      this.ensureContext();
      if (!this.ctx) return;

      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(isHigh ? 880 : 440, t);

      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.07);
    }

    /**
     * Confetti burst pop sound
     */
    playConfettiPop() {
      if (!this.enabled) return;
      this.ensureContext();
      if (!this.ctx) return;

      const t = this.ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const delay = i * 0.04;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(700 + Math.random() * 300, t + delay);
        osc.frequency.exponentialRampToValueAtTime(180, t + delay + 0.05);

        gain.gain.setValueAtTime(0.2, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.06);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t + delay);
        osc.stop(t + delay + 0.07);
      }
    }

    /**
     * Grand Championship series win celebration fanfare
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

  window.CaroAudio = new CaroAudioSynthesizer();
})();
