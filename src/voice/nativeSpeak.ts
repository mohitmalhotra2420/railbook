/* ══ NATIVE TTS BRIDGE (ADDITIVE, Round-63-fix) ═══════════════════════════════════════════════════════
 * User (30 Sep, screenshot): "background AI voice bhi nhi aa rhi jaise chatgpt ke voice mein aati hai".
 *
 * Wajah: Android **WebView** me `window.speechSynthesis` hota hai lekin uske paas aksar koi voice nahi
 * hoti — matlab `speak()` chupchaap kuch nahi bolta (isi liye app ke andar AI ki awaaz kabhi nahi
 * aayi). Wahi problem Round-27 me mic ke saath thi, jiska hal native bridge tha.
 *
 * Ab app (naya APK) apna native TextToSpeech bhi deta hai:
 *   • page → app : window.RailBookVoice.speak(text, "hi-IN") · .stopSpeaking() · .ttsAvailable()
 *   • Bridge na ho (browser / purana APK) → yahan se `false` milta hai aur maujooda browser TTS
 *     (`speakGuide`) hi chalta rehta hai — kuch tootta nahi.
 *
 * Koi network, koi key, koi data bahar nahi — device ka apna TTS engine (jo Android me pehle se hai).
 * ══════════════════════════════════════════════════════════════════════════════════════════════════ */

type NativeSpeakBridge = {
  speak?: (text: string, lang?: string) => void;
  stopSpeaking?: () => void;
  ttsAvailable?: () => boolean;
  /* Round-66 (user: "tts ki voice nahi aa rahi"): server TTS ka MP3 WebView me autoplay-policy se
   * block ho jaata tha — ab app wahi MP3 native MediaPlayer se bajaata hai (base64 me bheja jaata hai,
   * sab memory me, koi temp file nahi). Bridge na ho to purane raste waisa hi chalte hain. */
  playAudioBase64?: (data: string, mime?: string) => boolean;
  stopAudio?: () => void;
  audioAvailable?: () => boolean;
};

function bridge(): NativeSpeakBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { RailBookVoice?: NativeSpeakBridge }).RailBookVoice;
  if (!b || typeof b.speak !== "function") return null;
  try {
    if (typeof b.ttsAvailable === "function" && b.ttsAvailable() === false) return null;
  } catch {
    /* bridge error → try anyway */
  }
  return b;
}

/** App (native TTS) available? Browser me hamesha false. */
export function hasNativeSpeak(): boolean {
  return bridge() !== null;
}

/** Native engine ko bolne do. true = haan, native ne le liya (browser TTS ki zaroorat nahi). */
export function nativeSpeak(text: string, lang = "hi-IN"): boolean {
  const b = bridge();
  if (!b?.speak) return false;
  try {
    b.speak(text, lang);
    return true;
  } catch {
    return false;
  }
}

/* R67 (user screenshot: mic ne AI ki apni awaaz pakad li — "20986 … 11906 … ट्रेन लेनी है" transcript
 * me aa gaya): native TTS/player khatam hone par app JS ko batata hai, isliye mic sach me tab khulta
 * hai jab bolna poora khatam ho chuka ho (pehle sirf text-length ka andaza tha). */
type SpokenEndedFn = () => void;
let spokenEndedCb: SpokenEndedFn | null = null;

/** App → page: "bolna/playback poora khatam" signal (bridge na ho to kuch nahi hota). */
export function onNativeSpokenEnded(cb: SpokenEndedFn): void {
  spokenEndedCb = cb;
  if (typeof window === "undefined") return;
  (window as unknown as { __railbookTtsEnded?: SpokenEndedFn }).__railbookTtsEnded = () => {
    try {
      spokenEndedCb?.();
    } catch {
      /* ignore */
    }
  };
}

export function hasNativeSpokenEndedSignal(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as unknown as { __railbookTtsEnded?: unknown }).__railbookTtsEnded === "function";
}

export function nativeStopSpeaking(): void {
  const b = bridge();
  if (!b?.stopSpeaking) return;
  try {
    b.stopSpeaking();
  } catch {
    /* ignore */
  }
}

/* ══ R66: server TTS ka MP3 native se bajaao (WebView autoplay policy bypass) ══════════════════════ */

function bridgeAny(): NativeSpeakBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { RailBookVoice?: NativeSpeakBridge }).RailBookVoice;
  return b && typeof b === "object" ? b : null;
}

/** App (native audio playback) available? Browser me false. */
export function hasNativeAudio(): boolean {
  const b = bridgeAny();
  if (!b || typeof b.playAudioBase64 !== "function") return false;
  try {
    if (typeof b.audioAvailable === "function" && b.audioAvailable() === false) return false;
  } catch {
    /* bridge error → try anyway */
  }
  return true;
}

/** MP3 (base64) ko app ke native player se bajaao. true = app ne le liya. */
export function nativePlayAudioBase64(dataBase64: string, mime = "audio/mpeg"): boolean {
  const b = bridgeAny();
  if (!b?.playAudioBase64) return false;
  try {
    return b.playAudioBase64(dataBase64, mime) !== false;
  } catch {
    return false;
  }
}

export function nativeStopAudio(): void {
  const b = bridgeAny();
  if (!b?.stopAudio) return;
  try {
    b.stopAudio();
  } catch {
    /* ignore */
  }
}
