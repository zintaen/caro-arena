/**
 * Caro Arena — High-Fidelity Web Audio Sound Effects Synthesizer
 * Uses Web Audio API with zero external audio assets or network latency.
 */
(function () {
  if (typeof window === "undefined" || window.CaroAudio) return;

  const SOUND_PACKS = {
    wood: { id: "wood", name: "Kaya Wood", desc: "Warm resonant wooden clack" },
    slate: { id: "slate", name: "Slate & Shell", desc: "Crisp mineral snap on stone" },
    tactile: { id: "tactile", name: "Soft Tactile", desc: "Low, muted studio thud" },
    synth: { id: "synth", name: "Clean Synth", desc: "Pure harmonic bell tone" }
  };

  class CaroAudioSynthesizer {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.soundPack = "wood";
      try {
        this.enabled = localStorage.getItem("caro_sound_enabled") !== "false";
        const savedPack = localStorage.getItem("caro_sound_pack");
        if (savedPack && SOUND_PACKS[savedPack]) {
          this.soundPack = savedPack;
        }
      } catch {}
      this.masterGain = null;
      this._initialized = false;
      this.SOUND_PACKS = SOUND_PACKS;
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

    getSoundPack() {
      return SOUND_PACKS[this.soundPack] ? this.soundPack : "wood";
    }

    setSoundPack(packId, playPreview = false) {
      if (!SOUND_PACKS[packId]) return this.getSoundPack();
      this.soundPack = packId;
      try {
        localStorage.setItem("caro_sound_pack", packId);
      } catch {}
      if (playPreview) {
        this.playStoneClick("human");
      }
      return this.soundPack;
    }

    /**
     * Tactile Go/Caro stone click sound tailored to the active soundPack.
     */
    playStoneClick(playerType = "ai") {
      if (!this.enabled) return;
      this.ensureContext();
      if (!this.ctx) return;

      const t = this.ctx.currentTime;
      const pitchMap = {
        laya: 480,
        jev: 360,
        von: 540,
        mojev: 420,
        human: 440
      };
      const baseFreq = pitchMap[playerType] || 440;
      const pack = this.getSoundPack();

      if (pack === "slate") {
        // Crisp mineral snap + tight high stone ring
        const snapOsc = this.ctx.createOscillator();
        const snapGain = this.ctx.createGain();
        snapOsc.type = "sine";
        snapOsc.frequency.setValueAtTime(baseFreq * 3.6, t);
        snapOsc.frequency.exponentialRampToValueAtTime(baseFreq * 1.1, t + 0.018);
        snapGain.gain.setValueAtTime(0.55, t);
        snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
        snapOsc.connect(snapGain);
        snapGain.connect(this.masterGain);
        snapOsc.start(t);
        snapOsc.stop(t + 0.025);

        const ringOsc = this.ctx.createOscillator();
        const ringGain = this.ctx.createGain();
        ringOsc.type = "triangle";
        ringOsc.frequency.setValueAtTime(baseFreq * 1.35, t);
        ringOsc.frequency.exponentialRampToValueAtTime(baseFreq * 0.95, t + 0.05);
        ringGain.gain.setValueAtTime(0.35, t);
        ringGain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
        ringOsc.connect(ringGain);
        ringGain.connect(this.masterGain);
        ringOsc.start(t);
        ringOsc.stop(t + 0.06);
        return;
      }

      if (pack === "tactile") {
        // Low, muted studio thud
        const thudOsc = this.ctx.createOscillator();
        const thudGain = this.ctx.createGain();
        thudOsc.type = "sine";
        thudOsc.frequency.setValueAtTime(baseFreq * 0.68, t);
        thudOsc.frequency.exponentialRampToValueAtTime(baseFreq * 0.28, t + 0.065);
        thudGain.gain.setValueAtTime(0.28, t);
        thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        thudOsc.connect(thudGain);
        thudGain.connect(this.masterGain);
        thudOsc.start(t);
        thudOsc.stop(t + 0.075);
        return;
      }

      if (pack === "synth") {
        // Clean harmonic bell fifth
        [1, 1.5].forEach((mult, idx) => {
          const osc = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(baseFreq * mult, t);
          g.gain.setValueAtTime(idx === 0 ? 0.26 : 0.14, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
          osc.connect(g);
          g.connect(this.masterGain);
          osc.start(t);
          osc.stop(t + 0.12);
        });
        return;
      }

      // Default 'wood': sharp attack burst + warm decaying wood resonance
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

    playTurnReadyChime() {
      this.playHumanTurnAlert();
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
     * Gentle two-tone notification chime when it's the human's turn
     */
    playHumanTurnAlert() {
      if (!this.enabled) return;
      this.ensureContext();
      if (!this.ctx) return;

      const t = this.ctx.currentTime;
      const notes = [587.33, 880.00]; // D5 -> A5
      notes.forEach((freq, idx) => {
        const noteTime = t + idx * 0.09;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, noteTime);

        gain.gain.setValueAtTime(0.001, noteTime);
        gain.gain.linearRampToValueAtTime(0.22, noteTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.16);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(noteTime);
        osc.stop(noteTime + 0.18);
      });
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
