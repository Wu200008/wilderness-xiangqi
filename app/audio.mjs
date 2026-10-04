// All effects are synthesized locally. There are no recordings, downloads or music.
// The public events describe game actions; callers should select one event per move.
const STORAGE_KEY = 'wild-chess-sound-enabled';
const VOLUME_KEY = 'wild-chess-sound-volume';
export const SOUND_EVENTS = Object.freeze(['select', 'move', 'capture', 'reveal', 'check', 'start', 'win', 'lose', 'draw', 'click', 'invalid', 'undo']);
// Selecting a piece and choosing its destination are one gesture in the game.
// Only the completed move sounds; menu clicks and rejected moves stay quiet.
export const SILENT_EVENTS = Object.freeze(['select', 'click', 'invalid']);
const EVENTS = Object.freeze({
  click: { duration: .04, peak: 0, priority: 0, cooldown: 45 },
  select: { duration: .04, peak: 0, priority: 1, cooldown: 55 },
  invalid: { duration: .04, peak: 0, priority: 2, cooldown: 150 },
  undo: { duration: .10, peak: .20, priority: 2, cooldown: 90 },
  move: { duration: .10, peak: .43, priority: 3, cooldown: 85 },
  reveal: { duration: .19, peak: .33, priority: 4, cooldown: 100 },
  capture: { duration: .12, peak: .48, priority: 5, cooldown: 100 },
  check: { duration: .23, peak: .30, priority: 6, cooldown: 180 },
  start: { duration: .20, peak: .24, priority: 7, cooldown: 200 },
  win: { duration: .34, peak: .29, priority: 8, cooldown: 350 },
  lose: { duration: .30, peak: .27, priority: 8, cooldown: 350 },
  draw: { duration: .29, peak: .25, priority: 8, cooldown: 350 },
});

function randomGenerator(seed) {
  let n = seed >>> 0 || 1;
  return () => { n ^= n << 13; n ^= n >>> 17; n ^= n << 5; return (n >>> 0) / 2147483648 - 1; };
}

// A single soft contact, dominated by low-passed noise instead of ringing
// wooden tones. The envelope has one onset and no delayed bounce or second hit.
function contact(samples, rate, at, pitch, weight, decay, random) {
  const offset = Math.round(at * rate), length = Math.min(samples.length - offset, Math.ceil(decay * 9 * rate));
  const cutoff = pitch < 200 ? 1100 : 1500;
  const smoothing = 1 - Math.exp(-2 * Math.PI * cutoff / rate);
  const dcSmoothing = 1 - Math.exp(-2 * Math.PI * 90 / rate);
  let low1 = 0, low2 = 0, dc = 0;
  for (let i = 0; i < length; i++) {
    const t = i / rate, envelope = (1 - Math.exp(-t / .0018)) * Math.exp(-t / decay);
    low1 += smoothing * (random() - low1);
    low2 += smoothing * (low1 - low2);
    dc += dcSmoothing * (low2 - dc);
    const body = Math.sin(2 * Math.PI * pitch * t) * .025 * Math.exp(-t / .009);
    samples[offset + i] += weight * envelope * ((low2 - dc) * .94 + body);
  }
}

function brush(samples, rate, at, length, weight, random) {
  let fast = 0, slow = 0;
  const fastRate = 1 - Math.exp(-2 * Math.PI * 1400 / rate);
  const slowRate = 1 - Math.exp(-2 * Math.PI * 180 / rate);
  const offset = Math.round(at * rate), frames = Math.min(samples.length - offset, Math.round(length * rate));
  for (let i = 0; i < frames; i++) {
    const t = i / frames, noise = random();
    fast += fastRate * (noise - fast); slow += slowRate * (noise - slow);
    const envelope = Math.sin(Math.PI * t) ** 2;
    samples[offset + i] += (fast - slow) * envelope * weight;
  }
}

// A quiet, single swelling cue for check and the result, not repeated knocks.
function softCue(samples, rate, frequencies) {
  const duration = samples.length / rate;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate, envelope = Math.sin(Math.PI * t / duration) ** 2 * Math.exp(-t / (duration * .55));
    for (let j = 0; j < frequencies.length; j++) {
      samples[i] += Math.sin(2 * Math.PI * frequencies[j] * t) * envelope / (1 + j * 1.6);
    }
  }
}

// An exposed pure synthesizer makes the exact shipped waveforms measurable.
export function synthesizeSound(event, { sampleRate = 48000, seed = 0x57494c44 } = {}) {
  const spec = Object.hasOwn(EVENTS, event) ? EVENTS[event] : null;
  if (!spec) return null;
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Invalid sample rate');
  const samples = new Float32Array(Math.ceil(spec.duration * sampleRate));
  if (spec.peak === 0) return samples;
  const random = randomGenerator(seed + SOUND_EVENTS.indexOf(event) * 7919);
  const touch = (at, pitch, weight = 1, decay = .011) => contact(samples, sampleRate, at, pitch, weight, decay, random);
  switch (event) {
    case 'move': touch(0, 240); break;
    case 'capture': touch(0, 170, 1, .015); break;
    case 'reveal':
      brush(samples, sampleRate, 0, .105, .27, random); touch(.092, 250, .53, .009); break;
    case 'check': softCue(samples, sampleRate, [440, 660]); break;
    case 'start': softCue(samples, sampleRate, [330, 495]); break;
    case 'win': softCue(samples, sampleRate, [330, 412.5, 495]); break;
    case 'lose': softCue(samples, sampleRate, [246.94, 293.66]); break;
    case 'draw': softCue(samples, sampleRate, [293.66, 440]); break;
    case 'undo': brush(samples, sampleRate, 0, .085, .25, random); break;
  }
  // Remove negligible DC, taper both boundaries and normalize each cue to its
  // own comfortable level. This is offline synthesis, not a live volume boost.
  let mean = 0; for (const value of samples) mean += value;
  mean /= samples.length;
  const fade = Math.ceil(sampleRate * .004);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (samples[i] - mean) * Math.min(1, i / 12, (samples.length - 1 - i) / fade);
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak) for (let i = 0; i < samples.length; i++) samples[i] *= spec.peak / peak;
  return samples;
}

export function createGameAudio(options = {}) {
  let storage;
  try { storage = options.storage ?? globalThis.localStorage; } catch { storage = null; }
  let enabled = true;
  try { enabled = storage?.getItem(STORAGE_KEY) !== 'false'; } catch {}
  let volume = .45;
  try { const saved = storage?.getItem(VOLUME_KEY); if (saved !== null && saved !== undefined && saved !== '' && Number.isFinite(Number(saved))) volume = Math.max(0, Math.min(1, Number(saved))); } catch {}
  let context = null, master = null, disposed = false, lastEvent = null, lastTime = -Infinity;
  let lastPriority = -1, requestId = 0, available = true, playedCount = 0;
  const voices = new Set(), buffers = new Map();
  const eventTarget = options.eventTarget ?? globalThis.document;
  const nowMs = () => globalThis.performance?.now() ?? Date.now();

  function ensureContext() {
    if (disposed || !available) return null;
    if (context) return context;
    try {
      const Factory = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      context = options.contextFactory ? options.contextFactory() : new Factory({ latencyHint: 'interactive' });
      master = context.createGain();
      // Even full volume and two simultaneous cues cannot exceed .48 * 2 * .72.
      // Individual voices are never amplified after synthesis.
      master.gain.value = .72 * volume;
      master.connect(context.destination);
      return context;
    } catch { available = false; return null; }
  }

  function removeVoice(voice) {
    voices.delete(voice);
    try { voice.source.disconnect(); voice.gain.disconnect(); } catch {}
  }
  function stopVoice(voice) {
    // Immediate stop is intentional for mute and disposal: no queued effect
    // should continue playing after the user's sound switch changes.
    try { voice.source.stop(); } catch {}
    removeVoice(voice);
  }
  function playReady(event) {
    if (!enabled || volume === 0 || disposed || !context || context.state !== 'running') return false;
    const spec = EVENTS[event], time = nowMs();
    if (event === lastEvent && time - lastTime < spec.cooldown) return false;
    if (spec.priority < lastPriority && time - lastTime < 115) return false;
    // A result/check cue replaces a still sounding lower-priority action.
    if (spec.priority >= 6) for (const voice of [...voices]) if (voice.priority < spec.priority) stopVoice(voice);
    while (voices.size >= 2) stopVoice(voices.values().next().value);
    try {
      let buffer = buffers.get(event);
      if (!buffer) {
        const samples = synthesizeSound(event, { sampleRate: context.sampleRate });
        buffer = context.createBuffer(1, samples.length, context.sampleRate);
        buffer.copyToChannel(samples, 0); buffers.set(event, buffer);
      }
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer; gain.gain.value = 1; source.connect(gain); gain.connect(master);
      const voice = { source, gain, priority: spec.priority };
      voices.add(voice); source.onended = () => removeVoice(voice); source.start();
      lastEvent = event; lastTime = time; lastPriority = spec.priority; playedCount++;
      return true;
    } catch { return false; }
  }

  async function unlock() {
    if (!enabled || disposed) return false;
    const ctx = ensureContext(); if (!ctx) return false;
    try { if (ctx.state === 'suspended') await ctx.resume(); return ctx.state === 'running'; } catch { return false; }
  }
  function play(event = 'move') {
    if (!enabled || volume === 0 || disposed || !Object.hasOwn(EVENTS, event) || EVENTS[event].peak === 0) return false;
    const ctx = ensureContext(); if (!ctx) return false;
    if (ctx.state === 'running') return playReady(event);
    const id = ++requestId, requested = nowMs();
    // Keep only the current interaction when a browser is awaiting its first
    // gesture. Never replay stale AI moves as a burst after unlocking audio.
    void unlock().then(ok => { if (ok && id === requestId && nowMs() - requested < 500) playReady(event); });
    return false;
  }
  function setEnabled(value) {
    enabled = Boolean(value); ++requestId;
    try { storage?.setItem(STORAGE_KEY, String(enabled)); } catch {}
    if (!enabled) for (const voice of [...voices]) stopVoice(voice);
    else void unlock();
    return enabled;
  }
  function setVolume(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return volume;
    volume = Math.max(0, Math.min(1, number));
    try { storage?.setItem(VOLUME_KEY, String(volume)); } catch {}
    if (master) {
      const gain = master.gain, time = context.currentTime ?? 0;
      gain.cancelScheduledValues?.(time);
      if (gain.setTargetAtTime && volume > 0) gain.setTargetAtTime(.72 * volume, time, .012);
      else gain.value = .72 * volume;
    }
    if (volume === 0) { ++requestId; for (const voice of [...voices]) stopVoice(voice); }
    return volume;
  }
  const onGesture = () => { if (enabled && context?.state !== 'running') void unlock(); };
  eventTarget?.addEventListener?.('pointerdown', onGesture, { capture: true, passive: true });
  eventTarget?.addEventListener?.('keydown', onGesture, { capture: true, passive: true });
  function dispose() {
    if (disposed) return;
    disposed = true; ++requestId;
    eventTarget?.removeEventListener?.('pointerdown', onGesture, true);
    eventTarget?.removeEventListener?.('keydown', onGesture, true);
    for (const voice of [...voices]) stopVoice(voice);
    buffers.clear();
    try { master?.disconnect(); void context?.close()?.catch?.(() => {}); } catch {}
  }
  return {
    get enabled() { return enabled; },
    get volume() { return volume; },
    setEnabled, setVolume, unlock, play, dispose,
    getState: () => ({ enabled, volume, available, contextState: context?.state ?? 'not-created', activeVoices: voices.size, lastEvent, playedCount, silentEvents: [...SILENT_EVENTS], disposed }),
  };
}
