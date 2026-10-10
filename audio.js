/* ==========================================================================
   MANU PROTOCOL — CONTROL ROOM AUDIO SYNTHESIZER
   Web Audio API Sound Effects (Zero External Asset Dependencies)
   ========================================================================== */

(function(window) {
    'use strict';

    class ControlRoomAudio {
        constructor() {
            this.ctx = null;
            this.enabled = true;
            this.ambientOsc = null;
            this.ambientGain = null;
            this.initListener();
        }

        init() {
            if (this.ctx) return;
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();

            // Low frequency control room drone
            this.ambientOsc = this.ctx.createOscillator();
            this.ambientGain = this.ctx.createGain();
            this.ambientOsc.type = 'sawtooth';
            this.ambientOsc.frequency.setValueAtTime(55, this.ctx.currentTime); // 55Hz (A1 drone)

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(140, this.ctx.currentTime);

            this.ambientGain.gain.setValueAtTime(0.015, this.ctx.currentTime);
            this.ambientOsc.connect(filter);
            filter.connect(this.ambientGain);
            this.ambientGain.connect(this.ctx.destination);
            this.ambientOsc.start();
        }

        initListener() {
            const trigger = () => {
                if (!this.ctx) this.init();
                if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
                window.removeEventListener('pointerdown', trigger);
                window.removeEventListener('keydown', trigger);
            };
            window.addEventListener('pointerdown', trigger);
            window.addEventListener('keydown', trigger);
        }

        toggleAudio() {
            this.enabled = !this.enabled;
            if (this.ambientGain && this.ctx) {
                this.ambientGain.gain.setTargetAtTime(this.enabled ? 0.015 : 0, this.ctx.currentTime, 0.1);
            }
            return this.enabled;
        }

        playKeyClick() {
            if (!this.ctx || !this.enabled) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1200 + Math.random() * 400, this.ctx.currentTime);
            gain.gain.setValueAtTime(0.03, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.04);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.04);
        }

        playButtonHover() {
            if (!this.ctx || !this.enabled) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(750, this.ctx.currentTime);
            gain.gain.setValueAtTime(0.015, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.05);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.05);
        }

        playAccessGranted() {
            if (!this.ctx || !this.enabled) return;
            const notes = [587.33, 880, 1174.66]; // D5, A5, D6
            notes.forEach((freq, idx) => {
                setTimeout(() => {
                    if (!this.ctx) return;
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
                    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start();
                    osc.stop(this.ctx.currentTime + 0.25);
                }, idx * 70);
            });
        }

        playAccessDenied() {
            if (!this.ctx || !this.enabled) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(140, this.ctx.currentTime);
            osc.frequency.setValueAtTime(95, this.ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.35);
        }

        playSectorUnlock() {
            if (!this.ctx || !this.enabled) return;
            // Metallic resonance + fanfare
            const notes = [329.63, 493.88, 659.25, 987.77, 1318.51];
            notes.forEach((freq, idx) => {
                setTimeout(() => {
                    if (!this.ctx) return;
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
                    gain.gain.setValueAtTime(0.14, this.ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start();
                    osc.stop(this.ctx.currentTime + 0.5);
                }, idx * 90);
            });
        }

        playKlaxonAlarm() {
            if (!this.ctx || !this.enabled) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            const now = this.ctx.currentTime;
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.linearRampToValueAtTime(850, now + 0.3);
            osc.frequency.linearRampToValueAtTime(600, now + 0.6);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(now + 0.65);
        }
    }

    window.MANU_AUDIO = new ControlRoomAudio();

})(window);
