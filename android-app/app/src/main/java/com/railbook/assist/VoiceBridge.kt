package com.railbook.assist

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import java.util.Locale
import android.media.MediaPlayer
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.io.ByteArrayInputStream
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Round-27 (26 Sep 2026, user: "mic working nahi hai").
 *
 * Wajah: Android **WebView me Web Speech API** (`webkitSpeechRecognition`) hota hi nahi — isliye
 * RailBook ka VoiceBar WebView ke andar kabhi start nahi ho paata (aur getUserMedia wala rasta bhi
 * WebView ki permission par atak jaata hai).
 *
 * Ab app apna **native SpeechRecognizer** deta hai — wahi device ka speech engine (hi-IN: Hindi /
 * Hinglish / English mix), aur transcript seedha page ko bhejta hai:
 *   • page → app : window.RailBookVoice.start("hi-IN") / .stop() / .abort() / .isAvailable()
 *   • app → page : window.__railbookVoice.dispatch('{"type":"final","text":"…"}')
 *
 * Sirf audio-capture: koi field auto-fill nahi karta, koi audio/data device se bahar nahi jaata
 * (jo Android ka apna recognizer karta hai wahi). Isi liye ye bridge safest minimum par hai.
 */
class VoiceBridge(
    private val activity: Activity,
    private val webView: WebView,
) {
    private var recognizer: SpeechRecognizer? = null
    private var listening = false

    /* Round-63-fix (user: "background AI voice bhi nahi aa rahi"): Android WebView me
     * `window.speechSynthesis` aksar hota hai lekin uske paas koi voice nahi hoti — matlab AI ka
     * jawab chup reh jaata hai. Isliye app apna native TTS deta hai (device ka apna engine,
     * koi key/network nahi):
     *   page → app : window.RailBookVoice.speak(text, "hi-IN") · .stopSpeaking() · .ttsAvailable()
     * Bridge na ho to page purane browser TTS par chala jaata hai — kuch tootta nahi. */
    private var tts: TextToSpeech? = null
    private var ttsReady = false

    /* ══ Round-66 (user: "tts ki voice nahi aa rahi") ═════════════════════════════════════════════════
     * Server TTS (openai-edge-tts) ka MP3 WebView ke <audio> se play hota tha — par Android WebView
     * default me `mediaPlaybackRequiresUserGesture = true` rakhta hai, isliye AI ke async turn ka
     * play() chup-chaap block ho jaata tha (Chrome/browser me bhi autoplay policy). Ab app apna
     * native MediaPlayer deta hai: page MP3 ko base64 me bhejta hai, app use seedha play karta hai —
     * koi autoplay policy beech me nahi aati:
     *   page → app : window.RailBookVoice.playAudioBase64(b64, "audio/mpeg") · .stopAudio() · .audioAvailable()
     * Sirf playback — koi record, koi bhejna nahi. Ye bridge na ho (purana APK) to page purane
     * raste (WebView audio → device TTS) par gir jaata hai — kuch tootta nahi. */
    private var player: MediaPlayer? = null

    @JavascriptInterface
    fun audioAvailable(): Boolean = true

    /* ══ R67 (1 Oct 2026, user screenshot: mic ne AI ki apni awaaz pakad li) ══════════════════════════
     * Page ko sach batao ki bolna/playback poora khatam ho gaya — iske bina page andaza lagata hai aur
     * mic playback ke dauran hi khul jaata hai (speaker → mic echo). Signal: window.__railbookTtsEnded. */
    private fun notifySpokenEnded() {
        try {
            /* Wahi pattern jo bridge ke baaki callbacks use karte hain (webView.post). */
            webView.post { webView.evaluateJavascript("window.__railbookTtsEnded && window.__railbookTtsEnded()", null) }
        } catch (_: Exception) {
            /* page ne callback register nahi kiya — kuch nahi */
        }
    }

    /** Server TTS MP3 (base64) ko native MediaPlayer se bajaao — WebView ki autoplay policy beech me nahi aati. */
    @JavascriptInterface
    fun playAudioBase64(data: String?, mime: String?): Boolean {
        val b64 = data?.trim().orEmpty()
        if (b64.isEmpty()) return false
        val bytes = try {
            Base64.decode(b64, Base64.DEFAULT)
        } catch (_: Exception) {
            return false
        }
        if (bytes.isEmpty()) return false
        activity.runOnUiThread {
            try {
                stopAudioInternal()
                val mp = MediaPlayer()
                mp.setAudioAttributes(
                    android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                mp.setDataSource(ByteArrayMediaSource(bytes))
                mp.setOnPreparedListener { it.start() }
                mp.setOnCompletionListener {
                    notifySpokenEnded()
                    stopAudioInternal()
                }
                mp.setOnErrorListener { _, _, _ ->
                    stopAudioInternal()
                    true
                }
                mp.prepareAsync()
                player = mp
            } catch (e: Exception) {
                Log.w("RailBookVoice", "playAudioBase64 fail: ${e.message}")
                stopAudioInternal()
            }
        }
        return true
    }

    @JavascriptInterface
    fun stopAudio() {
        activity.runOnUiThread { stopAudioInternal() }
    }

    private fun stopAudioInternal() {
        try {
            player?.let {
                if (it.isPlaying) it.stop()
                it.release()
            }
        } catch (_: Exception) {
            /* ignore */
        }
        player = null
    }

    private fun ensureTts(): TextToSpeech? {
        if (tts != null) return tts
        return try {
            tts = TextToSpeech(activity) { status ->
                ttsReady = status == TextToSpeech.SUCCESS
                if (ttsReady) {
                    try {
                        val r = tts?.setLanguage(Locale("hi", "IN"))
                        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                            tts?.setLanguage(Locale("en", "IN"))
                        }
                    } catch (_: Exception) {
                        /* language set fail → default voice hi chalega */
                    }
                }
            }
            tts
        } catch (_: Exception) {
            null
        }
    }

    @JavascriptInterface
    fun ttsAvailable(): Boolean = try {
        ensureTts() != null
    } catch (_: Exception) {
        false
    }

    @JavascriptInterface
    fun speak(text: String?, lang: String?) {
        val line = text?.trim().orEmpty()
        if (line.isEmpty()) return
        activity.runOnUiThread {
            try {
                val engine = ensureTts() ?: return@runOnUiThread
                /* R67: bolna khatam hone par page ko signal (mic tabhi khule). */
                try {
                    engine.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
                        override fun onStart(utteranceId: String?) {}

                        override fun onDone(utteranceId: String?) {
                            notifySpokenEnded()
                        }

                        @Deprecated("purane API ke liye")
                        override fun onError(utteranceId: String?) {
                            notifySpokenEnded()
                        }

                        override fun onError(utteranceId: String?, errorCode: Int) {
                            notifySpokenEnded()
                        }
                    })
                } catch (_: Exception) {
                    /* listener set na ho to page ke estimate par chalega */
                }
                if (lang != null && lang.isNotEmpty()) {
                    val parts = lang.split("-")
                    if (parts.isNotEmpty() && parts[0].isNotEmpty()) {
                        val loc = if (parts.size > 1) Locale(parts[0], parts[1]) else Locale(parts[0])
                        val r = engine.setLanguage(loc)
                        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                            engine.setLanguage(Locale("en", "IN"))
                        }
                    }
                }
                engine.speak(line, TextToSpeech.QUEUE_FLUSH, null, "railbook-ai")
            } catch (e: Exception) {
                Log.w(TAG, "TTS speak fail: ${e.message}")
            }
        }
    }

    @JavascriptInterface
    fun stopSpeaking() {
        activity.runOnUiThread {
            try {
                tts?.stop()
            } catch (_: Exception) {
                /* ignore */
            }
        }
    }

    /** Activity band ho rahi ho to engine release kar do (leak na ho). */
    fun release() {
        try {
            tts?.stop()
            tts?.shutdown()
        } catch (_: Exception) {
            /* ignore */
        }
        tts = null
        ttsReady = false
    }

    private fun granted(): Boolean =
        ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    private fun dispatch(json: String) {
        val js = "window.__railbookVoice&&window.__railbookVoice.dispatch(${JSONObject.quote(json)})"
        webView.post { webView.evaluateJavascript(js, null) }
    }

    private fun dispatchType(type: String, text: String? = null, code: String? = null) {
        val o = JSONObject()
        o.put("type", type)
        if (text != null) o.put("text", text)
        if (code != null) o.put("code", code)
        dispatch(o.toString())
    }

    @JavascriptInterface
    fun isAvailable(): Boolean = try {
        SpeechRecognizer.isRecognitionAvailable(activity)
    } catch (_: Exception) {
        false
    }

    @JavascriptInterface
    fun start(lang: String?) {
        activity.runOnUiThread { startInternal(lang) }
    }

    @JavascriptInterface
    fun stop() {
        activity.runOnUiThread { stopInternal(cancel = false) }
    }

    @JavascriptInterface
    fun abort() {
        activity.runOnUiThread { stopInternal(cancel = true) }
    }

    private fun stopInternal(cancel: Boolean) {
        listening = false
        val r = recognizer
        recognizer = null
        if (r == null) return
        try {
            if (cancel) r.cancel() else r.stopListening()
        } catch (e: Exception) {
            Log.w(TAG, "stop failed: ${e.message}")
        }
        try {
            r.destroy()
        } catch (_: Exception) {
        }
    }

    private fun startInternal(lang: String?) {
        if (!isAvailable()) {
            dispatchType("error", code = "service-not-allowed")
            return
        }
        if (!granted()) {
            /* App ke andar permission nahi hai — page ko saaf batao (client "denied" message dikhata hai). */
            dispatchType("error", code = "not-allowed")
            return
        }
        stopInternal(cancel = true)
        val language = if (lang.isNullOrBlank()) "hi-IN" else lang
        val r = try {
            SpeechRecognizer.createSpeechRecognizer(activity)
        } catch (e: Exception) {
            Log.w(TAG, "create failed: ${e.message}")
            dispatchType("error", code = "audio-capture")
            return
        }
        val intent = android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.packageName)
        }
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                listening = true
                dispatchType("start")
            }

            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit

            override fun onPartialResults(partialResults: Bundle?) {
                val text = firstResult(partialResults)
                if (!text.isNullOrBlank()) dispatchType("partial", text = text)
            }

            override fun onResults(results: Bundle?) {
                val text = firstResult(results)
                listening = false
                if (!text.isNullOrBlank()) dispatchType("final", text = text)
                dispatchType("end")
            }

            override fun onError(error: Int) {
                listening = false
                dispatchType("error", code = errorName(error))
                dispatchType("end")
            }

            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })
        recognizer = r
        try {
            r.startListening(intent)
        } catch (e: Exception) {
            Log.w(TAG, "start failed: ${e.message}")
            recognizer = null
            dispatchType("error", code = "audio-capture")
            dispatchType("end")
        }
    }

    private fun firstResult(b: Bundle?): String? {
        val list = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return null
        return list.firstOrNull { it.isNotBlank() }
    }

    /** Android ke error codes → Web Speech ke wahi naam jo client padhta hai. */
    private fun errorName(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
        SpeechRecognizer.ERROR_CLIENT -> "aborted"
        else -> "failed"
    }

    fun destroy() {
        stopInternal(cancel = true)
    }

    companion object {
        private const val TAG = "RailBookVoice"
    }
}

/**
 * Round-66: base64 MP3 ko MediaPlayer ko "file jaisa" dikhane ke liye chhota MediaDataSource —
 * koi temp file nahi likhi jaati, sab memory me.
 */
private class ByteArrayMediaSource(private val bytes: ByteArray) : android.media.MediaDataSource() {
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (position >= bytes.size) return -1
        val remaining = bytes.size - position.toInt()
        val toRead = minOf(remaining, size)
        System.arraycopy(bytes, position.toInt(), buffer, offset, toRead)
        return toRead
    }

    override fun getSize(): Long = bytes.size.toLong()

    override fun close() = Unit
}
