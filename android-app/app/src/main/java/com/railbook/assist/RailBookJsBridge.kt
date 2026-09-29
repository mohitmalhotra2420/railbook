package com.railbook.assist

import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * window.RailBookNative — called FROM the injected bridge on IRCTC pages only.
 * Diagnostics metadata only; never log raw passenger PII in release builds.
 */
class RailBookJsBridge(
    private val onEvent: (type: String, body: JSONObject) -> Unit,
) {
    @JavascriptInterface
    fun onBridgeEvent(json: String?) {
        if (json.isNullOrBlank()) return
        try {
            val o = JSONObject(json)
            val type = o.optString("type", "unknown")
            /* Strip any accidental value-like keys before logging. */
            val safe = JSONObject()
            for (k in o.keys()) {
                if (k in SENSITIVE_KEYS) continue
                safe.put(k, o.get(k))
            }
            Log.i(TAG, "bridge event: $type ${safe}")
            onEvent(type, o)
        } catch (e: Exception) {
            Log.w(TAG, "bad bridge event: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "RailBookBridge"
        private val SENSITIVE_KEYS = setOf(
            "password", "otp", "pin", "captcha", "token", "cookie", "card", "upi", "name", "passengers"
        )
    }
}
