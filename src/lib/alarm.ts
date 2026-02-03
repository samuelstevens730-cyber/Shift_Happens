/**
 * Simple siren-like alarm using Web Audio API.
 * Note: browsers require a user gesture before audio can play.
 */
let lastPlayedAt = 0;

export function playAlarm(durationMs = 1500) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastPlayedAt < 500) return; // prevent rapid re-triggers
  lastPlayedAt = now;

  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  const ctx = new AudioCtx();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = "sawtooth";
  oscillator.frequency.value = 600;
  gain.gain.value = 0.0;

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  const startTime = ctx.currentTime;
  const endTime = startTime + durationMs / 1000;

  // Ramp volume up quickly then down.
  gain.gain.setValueAtTime(0.0, startTime);
  gain.gain.linearRampToValueAtTime(0.35, startTime + 0.05);

  // Siren effect: alternate frequency up/down.
  oscillator.frequency.setValueAtTime(600, startTime);
  oscillator.frequency.linearRampToValueAtTime(1100, startTime + 0.3);
  oscillator.frequency.linearRampToValueAtTime(600, startTime + 0.6);
  oscillator.frequency.linearRampToValueAtTime(1100, startTime + 0.9);
  oscillator.frequency.linearRampToValueAtTime(600, startTime + 1.2);

  gain.gain.linearRampToValueAtTime(0.0, endTime);

  oscillator.start(startTime);
  oscillator.stop(endTime + 0.05);

  oscillator.onended = () => {
    gain.disconnect();
    oscillator.disconnect();
    ctx.close();
  };
}
