package com.railbook.assist

import android.content.Context
import org.json.JSONObject

/**
 * On-device handoff only (SharedPreferences). No network upload.
 * Written when RailBook posts railbook-autofill-test (Continue to IRCTC).
 * Cleared on user request or after passenger fields filled (bridge-driven).
 *
 * Never stores passwords, OTP, captcha, payment, cookies, or tokens.
 */
class HandoffStore(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun savePayload(payloadJson: String, source: String = "railbook-continue") {
        val now = System.currentTimeMillis()
        prefs.edit()
            .putString(KEY_PAYLOAD, payloadJson)
            .putLong(KEY_AT, now)
            .putString(KEY_SOURCE, source)
            .putBoolean(KEY_CONSUMED, false)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun hasFreshHandoff(maxAgeMs: Long = MAX_AGE_MS): Boolean {
        if (prefs.getBoolean(KEY_CONSUMED, false)) return false
        val at = prefs.getLong(KEY_AT, 0L)
        if (at <= 0L || now() - at > maxAgeMs) return false
        val p = prefs.getString(KEY_PAYLOAD, null)
        return !p.isNullOrBlank()
    }

    fun payloadJson(): String? = prefs.getString(KEY_PAYLOAD, null)

    fun markConsumed(reason: String) {
        prefs.edit()
            .putBoolean(KEY_CONSUMED, true)
            .putString(KEY_CONSUMED_REASON, reason.take(80))
            .putLong(KEY_CONSUMED_AT, now())
            .apply()
    }

    /** Build the approval object the JS bridge expects (no PII). */
    fun approvalJson(): String {
        val payload = payloadJson()
        var createdAt = ""
        try {
            if (payload != null) createdAt = JSONObject(payload).optString("createdAt", "")
        } catch (_: Exception) { /* ignore */ }
        return JSONObject()
            .put("v", 1)
            .put("at", prefs.getLong(KEY_AT, now()))
            .put("createdAt", createdAt)
            .put("source", "railbook-app-continue")
            .put("consumed", prefs.getBoolean(KEY_CONSUMED, false))
            .put("app", "railbook-android")
            .toString()
    }

    private fun now() = System.currentTimeMillis()

    companion object {
        private const val PREFS = "railbook_handoff"
        private const val KEY_PAYLOAD = "payload_json"
        private const val KEY_AT = "at_ms"
        private const val KEY_SOURCE = "source"
        private const val KEY_CONSUMED = "consumed"
        private const val KEY_CONSUMED_REASON = "consumed_reason"
        private const val KEY_CONSUMED_AT = "consumed_at"
        const val MAX_AGE_MS = 15 * 60 * 1000L

        /** Exact hosts the WebView may load (allowlist). */
        val ALLOWED_HOSTS = setOf(
            "railbook-gegs.onrender.com",
            "www.irctc.co.in",
            "irctc.co.in",
        )
    }
}
