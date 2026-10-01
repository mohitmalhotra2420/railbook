package com.railbook.assist

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
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
