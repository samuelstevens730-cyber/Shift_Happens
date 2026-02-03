/**
 * Simple siren-like alarm using Web Audio API.
 * Note: browsers require a user gesture before audio can play.
 */
let alarmCtx: AudioContext | null = null;
let alarmOsc: OscillatorNode | null = null;
let alarmGain: GainNode | null = null;
let sweepTimer: number | null = null;
let lastPlayedAt = 0;

function startSweep() {
  if (!alarmCtx || !alarmOsc) return;
  const now = alarmCtx.currentTime;
  // Repeat a 1.2s sweep loop.
  alarmOsc.frequency.setValueAtTime(600, now);
  alarmOsc.frequency.linearRampToValueAtTime(1100, now + 0.3);
  alarmOsc.frequency.linearRampToValueAtTime(600, now + 0.6);
  alarmOsc.frequency.linearRampToValueAtTime(1100, now + 0.9);
  alarmOsc.frequency.linearRampToValueAtTime(600, now + 1.2);
}

export function playAlarm() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastPlayedAt < 200) return;
  lastPlayedAt = now;

  if (alarmCtx) {
    startSweep();
    return;
  }

  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  alarmCtx = new AudioCtx();
  alarmOsc = alarmCtx.createOscillator();
  alarmGain = alarmCtx.createGain();

  alarmOsc.type = "sawtooth";
  alarmOsc.frequency.value = 600;
  alarmGain.gain.value = 0.0;

  alarmOsc.connect(alarmGain);
  alarmGain.connect(alarmCtx.destination);

  const startTime = alarmCtx.currentTime;
  alarmGain.gain.setValueAtTime(0.0, startTime);
  alarmGain.gain.linearRampToValueAtTime(0.35, startTime + 0.05);

  alarmOsc.start(startTime);
  startSweep();

  sweepTimer = window.setInterval(() => {
    if (!alarmCtx) return;
    startSweep();
  }, 1200);
}

export function stopAlarm() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  if (alarmGain && alarmCtx) {
    const now = alarmCtx.currentTime;
    alarmGain.gain.cancelScheduledValues(now);
    alarmGain.gain.setValueAtTime(alarmGain.gain.value, now);
    alarmGain.gain.linearRampToValueAtTime(0.0, now + 0.1);
  }
  if (alarmOsc) {
    try {
      alarmOsc.stop();
    } catch {
      // ignore
    }
    alarmOsc.disconnect();
  }
  if (alarmGain) alarmGain.disconnect();
  if (alarmCtx) {
    alarmCtx.close();
  }
  alarmCtx = null;
  alarmOsc = null;
  alarmGain = null;
}
