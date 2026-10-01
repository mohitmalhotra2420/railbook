package com.railbook.assist

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.PackageManager.NameNotFoundException
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.CountDownTimer
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.railbook.assist.databinding.ActivityMainBinding
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.URI

/**
 * RailBook Assist — single WebView shell.
 *
 *  · RailBook (Render) for journey + passenger entry
 *  · On Continue → capture handoff payload (postMessage / localStorage bridge)
 *  · DEFAULT: IRCTC **website in the SAME WebView** → inject autofill assets
 *    (From/To/Date/Class + ALL passenger details). This is the only path where
 *    auto-fill is possible.
 *  · LONG-PRESS on the IRCTC button → open the OFFICIAL IRCTC native app (if
 *    installed) with the journey/passenger summary on the clipboard. Auto-fill is
 *    impossible there (Android OS security: no app can write into another app's fields).
 *  · NEVER auto Search / Book / Pay / login / OTP
 *
 * Passenger installs THIS app once from Play Store — not an extension.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var store: HandoffStore
    private val mainHandler = Handler(Looper.getMainLooper())

    private var lastInjectedUrl: String? = null
    private var irctcCdnBlocked = false
    private var cdnRetries = 0
    private var micGranted = false
    /* Round-27 (user: "mic working nahi hai"): WebView me Web Speech API nahi hota — isliye app ka
     * apna native speech bridge. Page window.RailBookVoice start/stop karta hai. */
    private var voice: VoiceBridge? = null

    /* ── v1.2.4 "prewarm-language" ─────────────────────────────────────────────
     * Continue-to-IRCTC tap hote hi 30-second countdown overlay chalta hai aur USI
     * WebView me (overlay ke peeche) IRCTC background me taiyaar hota hai:
     *   language pick → journey fill → auto Search → train/class select → auto Book Now
     *   → LOGIN page (yahan ruk jata hai; login/OTP/pay hard-sealed).
     * Countdown khatam + login-reached → overlay hat-ta hai → user ko seedha login page.
     * Login ke baad IRCTC khud passenger form kholta hai (journey/train pre-selected). */
    /* Round-53: back navigation + IRCTC se wapas RailBook. */
    private var lastRailbookHomeLoad = 0L
    private var resumeChecked = false
    private var exitArmedAt = 0L
    private var prewarmActive = false
    private var prewarmReady = false          /* login page aa gaya */
    private var prewarmRevealed = false
    private var countdown: CountDownTimer? = null
    private val extraWaitRunnable = Runnable { revealPrewarm(true) }

    /* Bolchaal-bhasha pref (on-device). en | hinglish | hi */
    private val langPrefs by lazy { getSharedPreferences("railbook_prefs", Context.MODE_PRIVATE) }
    private val langOrder = listOf("en", "hinglish", "hi")
    private fun currentLang(): String = langPrefs.getString("language", "hinglish") ?: "hinglish"
    private fun langLabel(l: String) = when (l) { "en" -> "English"; "hi" -> "हिंदी"; else -> "Hinglish" }
    /* Mapping: English→English · Hinglish→English · Hindi→Hindi */
    private fun irctcLangFor(l: String) = if (l == "hi") "hindi" else "english"

    /* RailBook's VoiceBar uses getUserMedia() in the WebView → needs native RECORD_AUDIO. */
    private val micPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            micGranted = granted
            Log.i(TAG, "RECORD_AUDIO granted=$granted")
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        store = HandoffStore(this)

        /* Round-23 (26 Sep, user: "screenshot abhi bhi 30 sec dikha raha hai" — asli wajah: purana APK).
         * Header ka version pehle ek hardcoded string tha ("v1.2.8"), isliye device par kaun sa build hai
         * pata hi nahi chalta tha. Ab ye ASLI versionName dikhata hai (build ke waqt jo set hota hai) +
         * versionCode — isse turant verify ho jaata hai ki naya APK install hua hai ya nahi. */
        binding.versionText.text = appVersionLabel()

        setupWebView()
        binding.btnRailbook.setOnClickListener { openRailbook() }
        /* Round-53: nav bar ke buttons (back / home / reload). */
        binding.btnBack.setOnClickListener { goBackSmart() }
        binding.btnHome.setOnClickListener {
            binding.webView.clearHistory()
            openRailbook()
        }
        binding.btnReload.setOnClickListener { binding.webView.reload() }
        /* v1.2.4: IRCTC tap = 30s prewarm countdown ke saath (background me IRCTC taiyaar). */
        binding.btnIrctc.setOnClickListener { startPrewarm() }
        /* v1.2.4: bolchaal-bhasha selector — English / Hinglish / हिंदी (cycle). */
        binding.btnLang.setOnClickListener {
            val cur = currentLang()
            val next = langOrder[(langOrder.indexOf(cur) + 1) % langOrder.size]
            langPrefs.edit().putString("language", next).apply()
            binding.btnLang.text = "Bhasha: ${langLabel(next)}"
            Toast.makeText(this, "RailBook bhasha: ${langLabel(next)} → IRCTC me ${if (next == "hi") "Hindi" else "English"} select hoga", Toast.LENGTH_SHORT).show()
        }
        binding.btnLang.text = "Bhasha: ${langLabel(currentLang())}"
        /* Long-press = explicit choice: open the OFFICIAL IRCTC app (if installed) with the
         * journey/passenger summary on the clipboard. Tap = website + auto-fill (default). */
        binding.btnIrctc.setOnLongClickListener {
            val opened = openOfficialIrctcApp()
            if (!opened) {
                Toast.makeText(
                    this,
                    "IRCTC app install nahi hai — normal tap se website khulegi (auto-fill ke saath)",
                    Toast.LENGTH_LONG
                ).show()
            }
            true
        }
        binding.btnClear.setOnClickListener {
            store.clear()
            evalJs("try{window.RailBookWebViewBridge&&RailBookWebViewBridge.clearHandoff()}catch(e){}")
            binding.statusText.text = getString(R.string.status_idle)
            Toast.makeText(this, "Handoff cleared", Toast.LENGTH_SHORT).show()
        }

        /* Ask for the mic up-front so voice booking works the moment the user needs it. */
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED
        ) {
            micGranted = true
        } else {
            micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }

        openRailbook()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val wv = binding.webView
        val s = wv.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.javaScriptCanOpenWindowsAutomatically = false
        s.setSupportMultipleWindows(false)
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        /* IRCTC's CDN (Akamai) blocks the stock Android WebView user agent — it carries the
         * " wv" WebView token that the edge treats as bot traffic ("Access Denied", ref edgesuite).
         * Strip "Version/4.0" + " wv" so the request presents as the device's normal mobile
         * Chrome (same engine, same device model in the UA string). */
        val stockUa = s.userAgentString
        s.userAgentString = stockUa
            .replace(Regex(" Version/4\\.0\\s*"), " ")
            .replace(Regex("\\s*wv(?=\\s|$)"), " ")
            .replace(Regex("  +"), " ")
            .trim()
        Log.i(TAG, "WebView UA: ${s.userAgentString}")
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            WebSettingsCompat.setSafeBrowsingEnabled(s, true)
        }

        wv.addJavascriptInterface(
            RailBookJsBridge { type, body -> runOnUiThread { handleBridgeEvent(type, body) } },
            "RailBookNative"
        )
        /* Native voice (Round-27): WebView me Web Speech API nahi hota, isliye mic ke liye ye bridge. */
        val vb = VoiceBridge(this, wv)
        voice = vb
        wv.addJavascriptInterface(vb, "RailBookVoice")

        /* WebView site asks for the mic (RailBook VoiceBar) → grant only if the user approved
         * the native RECORD_AUDIO permission. Never grants anything else. */
        wv.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val wantsMic = request.resources.any {
                    it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
                }
                if (wantsMic && micGranted) request.grant(request.resources)
                else request.deny()
            }
        }
        wv.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                /* The RailBook "Continue to IRCTC" button fires an Android intent:// URL on
                 * Android. Inside this WebView we do NOT want the official IRCTC app —
                 * auto-fill only works in OUR WebView. Swallow the intent navigation; the
                 * postMessage handoff (railbook-handoff-payload) already saved the payload
                 * and the app will load IRCTC in this WebView itself shortly. */
                if (request.url.scheme.equals("intent", ignoreCase = true)) return true
                val host = request.url.host?.lowercase() ?: return true
                if (host !in HandoffStore.ALLOWED_HOSTS && !host.endsWith(".irctc.co.in")) {
                    Toast.makeText(this@MainActivity, "Blocked host: $host", Toast.LENGTH_SHORT).show()
                    return true
                }
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                lastInjectedUrl = null
                irctcCdnBlocked = false
            }

            @Suppress("DEPRECATION")
            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame != true) return
                val host = hostOf(request.url.toString())
                if (host.endsWith("irctc.co.in")) {
                    setStatus(
                        "IRCTC ne request block kar di (CDN) — RailBook me dobara Continue to IRCTC dabayein",
                        toast = true
                    )
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                val host = hostOf(url)
                /* Round-53: home load ke thoda baad history saaf (IRCTC ki purani entry hata do). */
                if (host == "railbook-gegs.onrender.com" || host.endsWith(".onrender.com")) {
                    if (System.currentTimeMillis() - lastRailbookHomeLoad < 4000L && view.canGoBack()) view.clearHistory()
                }
                updateWhereLabel(url)
                when {
                    host == "railbook-gegs.onrender.com" -> {
                        binding.statusText.text = getString(R.string.status_idle)
                        injectRailbookCapture()
                        /* v1.2.7: seat-board LIVE patch — list wali frozen "provider se nahi
                         * aayi" rows ko site ke apne /api/availability se fresh chips milte hain
                         * (web redeploy ka wait nahi). Read-only, sirf RailBook origin par. */
                        evalJs(assetText("autofill/railbook-seatboard-live.js"))
                        evalJs("try{window.RailBookSeatboardLive&&RailBookSeatboardLive.start()}catch(e){}")
                    }
                    host == "www.irctc.co.in" || host.endsWith(".irctc.co.in") -> {
                        binding.statusText.text = getString(R.string.status_irctc)
                        injectIrctcAutofill(url)
                        /* Akamai may serve an "Access Denied" 403 page FROM irctc.co.in itself,
                         * so onPageFinished still fires and the host check passes. Detect the
                         * block from page content and, if blocked, auto-hand off to a surface
                         * where the user CAN book (official app, else external browser). */
                        detectIrctcCdnBlock()
                    }
                }
            }
        }
    }

    /**
     * Detects IRCTC's Akamai edge-block ("Access Denied" page, edgesuite reference). Returns
     * asynchronously via evaluateJavascript; on block → irctcCdnBlocked=true + handoff.
     */
    private fun detectIrctcCdnBlock() {
        val js = """
            (function(){
              try {
                var t = document.title || '';
                var b = (document.body && document.body.innerText || '').slice(0, 600);
                return (t.indexOf('Access Denied') >= 0 || b.indexOf('edgesuite') >= 0) ? 'blocked' : 'ok';
              } catch (e) { return 'unknown'; }
            })();
        """.trimIndent()
        binding.webView.evaluateJavascript(js) { value ->
            if (value == "\"blocked\"") {
                irctcCdnBlocked = true
                handleIrctcCdnBlocked()
            } else {
                cdnRetries = 0 /* website load ho gayi — retry budget reset */
            }
        }
    }

    /**
     * v1.2.7 (user feedback: "Continue pe IRCTC APP khul raha hai, wahan autofill nahi chalta").
     * Pehle CDN-block par hum official app/browser khol dete the — lekin autofill SIRF hamari
     * WebView me possible hai, official app me kabhi nahi. Ab: website me hi ruko, 2 auto-retry
     * karo; phir bhi block ho to user ko boliye IRCTC button dobara tap kare (retry) ya
     * LONG-PRESS se official app (explicit choice). Auto open-ab-app/browser BAND.
     */
    private fun handleIrctcCdnBlocked() {
        if (cdnRetries < 2) {
            cdnRetries += 1
            binding.statusText.text = "IRCTC CDN ne website roki — in-app dobara try (${cdnRetries}/2)… (autofill sirf website me hai)"
            mainHandler.postDelayed({ openIrctcWithHandoff() }, 1500)
            return
        }
        cdnRetries = 0
        binding.statusText.text =
            "IRCTC ki security ne in-app website roki. IRCTC button dobara TAP karein (retry) · LONG-PRESS = official app (wahan autofill nahi) · auto-fill ke liye website chahiye."
    }

    /** Capture Continue-to-IRCTC postMessage + localStorage on the RailBook origin. */
    private fun injectRailbookCapture() {
        val js = """
            (function(){
              if (window.__railbookAppCapture) return;
              window.__railbookAppCapture = true;
              window.addEventListener('message', function(ev){
                try {
                  if (ev.source !== window) return;
                  if (!ev.data || ev.data.kind !== 'railbook-autofill-test') return;
                  if (window.RailBookNative && RailBookNative.onBridgeEvent) {
                    RailBookNative.onBridgeEvent(JSON.stringify({
                      type: 'railbook-handoff-payload',
                      payload: ev.data
                    }));
                  }
                } catch (e) {}
              }, false);
              /* Also poll localStorage once shortly after load (storeHandoff writes there).
               * Round-21 (25 Sep 2026): app v1.4.4+ me EXTENDED payload (food + IRCTC checkboxes + mobile/email)
               * 'railbookAutofillPayloadV2' me hota hai — pehle wahi padha jaata hai; na mile to purana key
               * (puraane app/web version ke saath compatibility bani rehti hai). */
              setTimeout(function(){
                try {
                  var raw = localStorage.getItem('railbookAutofillPayloadV2') || localStorage.getItem('railbookAutofillTestPayload');
                  if (raw && window.RailBookNative) {
                    RailBookNative.onBridgeEvent(JSON.stringify({
                      type: 'railbook-handoff-payload',
                      payload: JSON.parse(raw),
                      via: 'localStorage'
                    }));
                  }
                } catch (e) {}
              }, 800);
            })();
        """.trimIndent()
        evalJs(js)
    }

    /**
     * Inject fieldmap + irctc engine + webview bridge, then push approved payload.
     * Continue tap already stored handoff on-device → that IS user approval.
     */
    private fun injectIrctcAutofill(url: String) {
        if (lastInjectedUrl == url) return
        lastInjectedUrl = url

        val fieldmap = assetText("autofill/fieldmap.js")
        val irctc = assetText("autofill/irctc-passenger.js")
        val language = assetText("autofill/irctc-language.js")
        val bridge = assetText("autofill/railbook-webview-bridge.js")
        if (fieldmap.isEmpty() || irctc.isEmpty() || bridge.isEmpty() || language.isEmpty()) {
            Log.e(TAG, "autofill assets missing")
            Toast.makeText(this, "Autofill assets missing in APK", Toast.LENGTH_LONG).show()
            return
        }

        /* Order: fieldmap → irctc → language → bridge */
        evalJs(fieldmap)
        evalJs(irctc)
        evalJs(language)
        evalJs(bridge)
        /* v1.2.4: bolchaal-bhasha pref JS side (English/Hinglish → english · Hindi → hindi). */
        evalJs("try{window.__railbookLangPref='${irctcLangFor(currentLang())}'}catch(e){}")

        val payload = store.payloadJson()
        if (payload.isNullOrBlank() || !store.hasFreshHandoff()) {
            evalJs("try{RailBookWebViewBridge.onPageReady()}catch(e){}")
            binding.statusText.text =
                "IRCTC open · koi fresh RailBook handoff nahi — pehle app me Continue dabayein"
            return
        }

        /* Escape for embedding inside a JS single-quoted JSON.parse string */
        val safePayload = JSONObject.quote(payload)
        val push = """
            (function(){
              try {
                var raw = $safePayload;
                var obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
                var r = RailBookWebViewBridge.setApprovedPayload(obj, { app: 'railbook-android' });
                if (window.RailBookNative) {
                  RailBookNative.onBridgeEvent(JSON.stringify({
                    type: 'native-push-result',
                    ok: !!(r && r.ok),
                    passengers: r && r.passengers
                  }));
                }
              } catch (e) {
                if (window.RailBookNative) {
                  RailBookNative.onBridgeEvent(JSON.stringify({
                    type: 'native-push-error',
                    err: String(e && e.message || e).slice(0, 80)
                  }));
                }
              }
            })();
        """.trimIndent()
        /* Small delay so Angular can paint first paint; bridge also retries. */
        mainHandler.postDelayed({ evalJs(push) }, 400)
    }

    /** "v1.4.7 (29)" — packageManager se asli versionName/versionCode (hardcoded string kabhi nahi). */
    private fun appVersionLabel(): String = try {
        val pm = packageManager
        val pkg = if (android.os.Build.VERSION.SDK_INT >= 33) {
            pm.getPackageInfo(packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION") pm.getPackageInfo(packageName, 0)
        }
        val name = pkg.versionName ?: "?"
        val code = if (android.os.Build.VERSION.SDK_INT >= 28) pkg.longVersionCode else @Suppress("DEPRECATION") pkg.versionCode.toLong()
        "v$name ($code)"
    } catch (e: Exception) {
        getString(R.string.app_version)
    }

    /* Round-28: user ne kaha "upar ka blue header user ko na dikhe" — header gone hai, par status
     * logic zinda rakha hai (backend). User ko sirf zaroori baatein chhote Toast se dikhati hain. */
    private fun setStatus(msg: String, toast: Boolean = false) {
        binding.statusText.text = msg
        if (toast) Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
    }

    private fun handleBridgeEvent(type: String, body: JSONObject) {
        when (type) {
            "railbook-handoff-payload" -> {
                val payload = body.optJSONObject("payload") ?: return
                /* Validate kind before store */
                if (payload.optString("kind") != "railbook-autofill-test") return
                if (payload.optBoolean("test", false) != true) return
                store.savePayload(payload.toString(), source = "railbook-continue")
                setStatus(
                    "Handoff saved · ${payload.optJSONArray("passengers")?.length() ?: 0} pax · IRCTC khol rahe hain…",
                    toast = true
                )
                /* v1.2.4: Continue tap = 30s prewarm countdown + background IRCTC tayyari. */
                mainHandler.postDelayed({ startPrewarm() }, 300)
            }
            "payload-accepted" -> {
                setStatus(
                    "Payload OK · auto-fill · pax ${body.optInt("passengers")} · date ${body.optString("journeyDate")}"
                )
            }
            /* Round-28: bridge ab page par bada black box nahi dikhata — user-facing one-liner yahan se. */
            "ui-notice" -> {
                val msg = body.optString("text")
                if (msg.isNotBlank()) setStatus(msg, toast = body.optBoolean("toast", true))
            }
            /* v1.2.8: seat-board live patch progress (list rows fresh chips me badli). */
            "seatboard-live" -> {
                val n = body.optInt("patched")
                binding.statusText.text =
                    "Seat-board live: $n row(s) fresh seat data ✓ (site API se) · Login/OTP/Pay aap karein"
            }
            /* v1.2.4 PREWARM step events (bridge → overlay). */
            "prewarm-step" -> {
                when (body.optString("step")) {
                    "language" -> {
                        val tgt = if (body.optString("target") == "hindi") "Hindi" else "English"
                        if (body.optBoolean("clicked")) appendPrewarmStep("Bhasha → $tgt select ✓")
                        else appendPrewarmStep("Bhasha screen: $tgt (click nahi: ${body.optString("reason")})")
                    }
                    "login-reached" -> {
                        prewarmReady = true
                        appendPrewarmStep("Login page ready ✓ — ab countdown ke baad login dikhega")
                        if (prewarmActive && !prewarmRevealed && countdown == null) revealPrewarm(false)
                    }
                }
            }
            "fill-result" -> {
                val n = body.optInt("filledCount")
                val stage = body.optString("fillStage")
                /* v0.7.0/v0.8.0: diagnostics — failed / not-found / site-side changes / refused clicks. */
                val detail = buildString {
                    body.optJSONArray("failed")?.let { f -> for (i in 0 until minOf(f.length(), 2)) append(" · failed: ").append(f.optString(i).take(70)) }
                    body.optJSONArray("notFound")?.let { nf -> for (i in 0 until minOf(nf.length(), 2)) append(" · notfound: ").append(nf.optString(i).take(70)) }
                    if (body.optInt("siteChanges", 0) > 0) append(" · site khud ${body.optInt("siteChanges")} field update karta raha (info)")
                    if (body.optInt("refusedClicks", 0) > 0) append(" · ${body.optInt("refusedClicks")} click guard refused (manual tap karein)")
                }
                /* v1.2.0: verified auto-advance (Search Trains → train list, Book Now → passenger form).
                 * Everything past that (login/OTP/CAPTCHA/payment) is still the user's own tap. */
                val advNote = buildString {
                    val adv = body.optJSONObject("advance")
                    val s = adv?.optJSONObject("search")
                    if (s != null && s.optBoolean("clicked")) append(" · Search khud chala ✓")
                    else if (s != null && s.has("reason")) append(" · Search auto nahi chala")
                    val r = adv?.optJSONObject("refresh")
                    if (r != null && r.optBoolean("clicked")) append(" · class chip refresh ✓")
                    val b = adv?.optJSONObject("book")
                    if (b != null && b.optBoolean("clicked") && b.optBoolean("verified", true)) {
                        append(" · Book Now khud tap ✓ → passenger form")
                    } else if (b != null && b.optBoolean("clicked")) {
                        append(" · Book Now tap hua (form confirm nahi)")
                    }
                }
                binding.statusText.text = "Filled $n fields · $stage$advNote · Login/OTP/Pay aap karein" + detail
                /* Round-28: jab passenger fields bhar gayi hon to user ko ek saaf line — dobara kuch
                 * daalne ki zaroorat nahi. */
                if (n > 0 && (stage.contains("passenger") || body.optBoolean("paxFilled"))) {
                    Toast.makeText(
                        this,
                        "✅ Aapki details IRCTC par bhar di gayi hain — yahan dobara kuch daalne ki zaroorat nahi. Sirf login/OTP/payment aap karenge.",
                        Toast.LENGTH_LONG
                    ).show()
                } else if (n > 0) {
                    Toast.makeText(this, "RailBook: $n field(s) auto-fill ho gayi — aap aage badh sakte hain.", Toast.LENGTH_SHORT).show()
                }
                if (stage.contains("passenger") || body.optBoolean("paxFilled")) {
                    /* Bridge consumes on pax; mirror on native store. */
                    store.markConsumed("passenger-fields-filled")
                }
                /* v1.2.4: prewarm overlay me live progress dikhao (journey/search/book steps). */
                if (prewarmActive) {
                    val adv = body.optJSONObject("advance")
                    val s = adv?.optJSONObject("search")
                    if (s != null && s.optBoolean("clicked")) appendPrewarmStep("Journey fill + Search ✓")
                    val r = adv?.optJSONObject("refresh")
                    if (r != null && r.optBoolean("clicked")) appendPrewarmStep("Class chip Refresh ⟳ ✓")
                    val b = adv?.optJSONObject("book")
                    if (b != null && b.optBoolean("clicked")) appendPrewarmStep("Train select + Book Now ✓")
                }
            }
            "fill-stopped-unexpected", "fill-stopped-forbidden-click" -> {
                store.markConsumed(type)
                val hard = body.optJSONArray("hard")
                val hardDetail = if (hard != null && hard.length() > 0) {
                    " · " + (0 until minOf(hard.length(), 2)).joinToString(", ") { i ->
                        val h = hard.getJSONObject(i)
                        h.optString("text").ifEmpty { h.optString("tag") }
                    }
                } else ""
                binding.statusText.text =
                    "STOP · unexpected change" + hardDetail + " · handoff cleared · RAILBOOK se dobara Continue karo"
                Toast.makeText(this, "Autofill stopped for safety — dobara Continue karo", Toast.LENGTH_LONG).show()
                abortPrewarm()
            }
            "bridge-ready" -> Log.i(TAG, "bridge ready host=${body.optBoolean("host")}")
            else -> Log.d(TAG, "event $type")
        }
    }

    /* ── v1.2.4 PREWARM ────────────────────────────────────────────────────────
     * 30-second countdown ke ANDAR background (overlay ke peeche wale usi WebView) me
     * IRCTC khud khulta hai: language pick → journey fill → Search → train/class →
     * Book Now → LOGIN page. Countdown khatam + login-reached → overlay hat-ta hai aur
     * user ko seedha login page dikhta hai; login ke baad IRCTC passenger form kholta hai.
     * Login/OTP/CAPTCHA/Payment kabhi auto nahi (hard policy, bridge-side sealed). */
    private fun startPrewarm() {
        if (prewarmActive) return
        if (!store.hasFreshHandoff()) {
            /* Pehle Continue nahi dabaya — legacy behaviour: seedha IRCTC kholo. */
            openIrctcWithHandoff()
            return
        }
        prewarmActive = true
        prewarmReady = false
        prewarmRevealed = false
        binding.prewarmSteps.text = ""
        binding.prewarmTitle.text = getString(R.string.prewarm_title)
        appendPrewarmStep("IRCTC background me khul raha hai…")
        binding.prewarmOverlay.visibility = android.view.View.VISIBLE

        countdown = object : CountDownTimer(PREWARM_COUNTDOWN_MS, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                binding.prewarmCount.text = "${millisUntilFinished / 1000}s"
            }
            override fun onFinish() {
                countdown = null
                binding.prewarmCount.text = "0s"
                if (prewarmReady) {
                    revealPrewarm(false)
                } else if (PREWARM_EXTRA_WAIT_MS > 0L) {
                    appendPrewarmStep("IRCTC thoda aur taiyaar ho raha hai (max ${PREWARM_EXTRA_WAIT_MS / 1000}s)…")
                    mainHandler.postDelayed(extraWaitRunnable, PREWARM_EXTRA_WAIT_MS)
                } else {
                    /* 30s me login page nahi aaya — seedha honest reveal (koi extra wait nahi). */
                    appendPrewarmStep("30s khatam — jo page khula hai wahan se aap continue kar sakte hain (login aap karein).")
                    revealPrewarm(true)
                }
            }
        }.start()

        /* Language pref JS side set hota hai injectIrctcAutofill me (page load ke baad). */
        openIrctcWithHandoff()
    }

    private fun appendPrewarmStep(line: String) {
        if (!prewarmActive) return
        val cur = binding.prewarmSteps.text?.toString().orEmpty()
        val lines = cur.split("\n").filter { it.isNotBlank() }
        if (lines.lastOrNull() == line) return
        binding.prewarmSteps.text = (lines + line).takeLast(7).joinToString("\n")
    }

    private fun revealPrewarm(forced: Boolean) {
        if (!prewarmActive || prewarmRevealed) return
        prewarmRevealed = true
        prewarmActive = false
        countdown?.cancel(); countdown = null
        mainHandler.removeCallbacks(extraWaitRunnable)
        binding.prewarmOverlay.visibility = android.view.View.GONE
        val revealMsg = if (prewarmReady) {
            "Prewarm done · Login page ready — login aap karein, uske baad passenger form khud bharega."
        } else if (forced) {
            "IRCTC login page 30s me nahi aaya — jo page hai wahan se aap continue kar sakte hain (login aap karein)."
        } else {
            getString(R.string.status_irctc)
        }
        setStatus(revealMsg, toast = prewarmReady)
    }

    private fun abortPrewarm() {
        if (!prewarmActive) return
        prewarmActive = false
        prewarmRevealed = true
        countdown?.cancel(); countdown = null
        mainHandler.removeCallbacks(extraWaitRunnable)
        binding.prewarmOverlay.visibility = android.view.View.GONE
    }

    private fun openRailbook() {
        /* Round-53: history saaf karke home load — IRCTC wali entry peeche na rah jaye (warna back
         * dabane par dobara IRCTC khul jaata tha). */
        lastRailbookHomeLoad = System.currentTimeMillis()
        binding.webView.loadUrl(getString(R.string.railbook_url))
        updateWhereLabel(getString(R.string.railbook_url))
    }

    /**
     * Default Continue → IRCTC path = **IRCTC website in our OWN WebView**.
     *
     * WHY the website (and not the official native IRCTC app) is the default: the autofill
     * engines (fieldmap.js + irctc-passenger.js + webview-bridge) can only inject into a
     * WebView WE control. The official IRCTC Rail Connect app is a separate NATIVE app —
     * Android OS security does NOT allow any third-party app to write into its fields
     * (From/To/Class/passengers/berth). So for "bas user Book press kare", the only path
     * where From/To/Date/Class + ALL passenger details auto-fill is this in-app website.
     *
     * Opening the official native app is available on demand (IRCTC button LONG-PRESS →
     * openOfficialIrctcApp), with the journey/passenger summary copied to the clipboard.
     */
    private fun openIrctcWithHandoff() {
        /* Browser-like first-request headers: a normal returning visitor arrives from
         * irctc.co.in's own home with an Indian-locale Accept-Language. */
        updateWhereLabel(getString(R.string.irctc_url))
        binding.webView.loadUrl(
            getString(R.string.irctc_url),
            mapOf(
                "Referer" to "https://www.irctc.co.in/",
                "Accept-Language" to "en-IN,en;q=0.9,hi;q=0.8",
            )
        )
    }

    /**
     * Explicit choice only (IRCTC button LONG-PRESS). Opens the official IRCTC Rail Connect
     * native app when installed (deep link → launcher fallback) and copies the journey +
     * passenger summary to the clipboard so the user can paste/type it fast. Auto-fill is
     * NOT possible here (OS security) — the status bar says so.
     */
    private fun openOfficialIrctcApp(): Boolean {
        if (!isPackageInstalled(IRCTC_PACKAGE)) {
            Log.i(TAG, "Official IRCTC app not installed (long-press path)")
            binding.statusText.text = getString(R.string.status_no_irctc_app)
            return false
        }
        /* 1) Deep link pinned to the IRCTC package (lands on the train-search screen). */
        val deep = Intent(Intent.ACTION_VIEW, Uri.parse(getString(R.string.irctc_url))).apply {
            setPackage(IRCTC_PACKAGE)
            addCategory(Intent.CATEGORY_BROWSABLE)
        }
        if (deep.resolveActivity(packageManager) != null) {
            try {
                copyHandoffSummaryToClipboard()
                startActivity(deep)
                binding.statusText.text = getString(R.string.status_irctc_app)
                return true
            } catch (e: Exception) {
                Log.w(TAG, "IRCTC deep link launch failed: ${e.message}")
            }
        }
        /* 2) App installed but deep link not declared → open its home screen. */
        packageManager.getLaunchIntentForPackage(IRCTC_PACKAGE)?.let { main ->
            try {
                copyHandoffSummaryToClipboard()
                startActivity(main)
                binding.statusText.text = getString(R.string.status_irctc_app)
                return true
            } catch (e: Exception) {
                Log.w(TAG, "IRCTC launcher intent failed: ${e.message}")
            }
        }
        Log.i(TAG, "IRCTC app present but no resolvable intent → WebView fallback")
        return false
    }

    private fun isPackageInstalled(packageName: String): Boolean = try {
        packageManager.getPackageInfo(packageName, 0)
        true
    } catch (e: NameNotFoundException) {
        false
    }

    /**
     * Copy the approved handoff (journey + passengers) as a clean text block so the user can
     * paste/type it quickly when booking from the official IRCTC app (which we cannot auto-fill).
     * Payload already validated by RailBook before storage; nothing sensitive is in it by contract.
     */
    private fun copyHandoffSummaryToClipboard() {
        val payload = store.payloadJson() ?: return
        try {
            val p = JSONObject(payload)
            val j = p.optJSONObject("journey") ?: return
            val sb = StringBuilder("RailBook — booking details\n")
            sb.append("From: ").append(j.optString("from"))
              .append(" (").append(j.optString("fromCode")).append(")\n")
            sb.append("To: ").append(j.optString("to"))
              .append(" (").append(j.optString("toCode")).append(")\n")
            val date = j.optString("date")
            if (date.length == 10) {
                /* YYYY-MM-DD → DD-MM-YYYY (IRCTC display format) */
                sb.append("Date: ")
                    .append(date.substring(8, 10)).append('-')
                    .append(date.substring(5, 7)).append('-')
                    .append(date).append('\n')
            }
            sb.append("Train: ").append(j.optString("trainNumber"))
              .append("  |  Class: ").append(j.optString("classCode")).append('\n')
            val pax = p.optJSONArray("passengers") ?: JSONArray()
            for (i in 0 until pax.length()) {
                val x = pax.optJSONObject(i) ?: continue
                sb.append("Pax ").append(i + 1).append(": ")
                    .append(x.optString("name")).append(", ")
                    .append(x.optInt("age")).append(", ")
                    .append(x.optString("gender").uppercase()).append(", ")
                    .append("Berth: ").append(x.optString("berth")).append('\n')
            }
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("RailBook booking details", sb.toString()))
        } catch (e: Exception) {
            Log.w(TAG, "summary clipboard copy failed: ${e.message}")
        }
    }

    private fun evalJs(script: String) {
        binding.webView.evaluateJavascript(script, null)
    }

    private fun assetText(path: String): String = try {
        assets.open(path).bufferedReader().use(BufferedReader::readText)
    } catch (e: Exception) {
        Log.e(TAG, "asset $path: ${e.message}")
        ""
    }

    private fun hostOf(url: String): String = try {
        URI(url).host?.lowercase() ?: ""
    } catch (_: Exception) {
        ""
    }

    @Deprecated("Deprecated in Java")
    override fun onDestroy() {
        try {
            voice?.destroy()
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    /* ── Round-53: BACK ka sahi matlab ─────────────────────────────────────────────────────────
     * User: *"meri railbook app mein back buttons nahi hai"*. Ab: nav bar me ‹ Back button, aur
     * hardware/gesture back bhi wahi karta hai:
     *   1) agar IRCTC par hain → seedha RailBook home (IRCTC me back ka koi matlab nahi — wahan
     *      hamara koi pichhla page nahi hota, aur user ko wapas RailBook hi chahiye),
     *   2) warna WebView history me peeche (RailBook ke andar navigation),
     *   3) history khatam aur RailBook par hain → "dobara dabao to exit" (galti se band na ho),
     *   4) kisi aur host par → RailBook home.
     */
    /* ══ R69 ═══════════════════════════════════════════════════════════════════════════════════════
     * User (1 Oct 2026): "AI booking open nhi ho rha" — jabki server par fix live tha.
     * Wajah: WebView page ko memory me zinda rakhta hai; deploy ke baad bhi PURANA JS bundle chalta
     * rehta hai, isliye naya fix dikhta hi nahi. Ab resume par page ka build tag (jo header me dikhta
     * hai) server ke /api/version commit se milta hai:
     *   • alag   → page taaza (reload). Chat/journey state web app khud wapas le aata hai.
     *   • AI Booking panel khula ho → reload nahi (user ki conversation beech me na tootei); saaf
     *     line dikhti hai ki ⟳ dabaiye.
     *   • same / network fail / 60s ke andar dobara → kuch nahi (koi chhed-chhad nahi).
     * Ye sirf app shell ka kaam hai — web ka chat/AI code jaisa tha waisa hi hai. */
    private var versionCheckedAt = 0L

    private fun checkStaleBundle() {
        val now = System.currentTimeMillis()
        if (now - versionCheckedAt < 60_000L) return
        versionCheckedAt = now
        if (prewarmActive) return
        val wv = binding.webView
        if (!isRailbookUrl(wv.url)) return
        wv.evaluateJavascript(
            "(function(){var t=(document.querySelector('.build-tag')||{}).textContent||'';" +
                "var p=document.querySelector('.aib-dock,[aria-label=\"AI Booking\"][role=\"dialog\"]');" +
                "return t.trim().split(' ')[0]+'|'+(p?'1':'0');})()"
        ) { raw ->
            val out = (raw ?: "").trim().trim('"')
            val mine = out.substringBefore('|').trim()
            val panelOpen = out.endsWith("|1")
            if (!Regex("^[0-9a-f]{7,40}$", RegexOption.IGNORE_CASE).matches(mine)) return@evaluateJavascript
            Thread {
                val remote = fetchServerCommit()
                if (remote == null) return@Thread
                if (remote.take(7).equals(mine.take(7), ignoreCase = true)) return@Thread
                runOnUiThread {
                    if (prewarmActive) return@runOnUiThread
                    if (panelOpen) {
                        setStatus(
                            "Naya version aa gaya hai — upar ⟳ dabaiye, phir AI Booking taaza chalega.",
                            toast = true
                        )
                    } else {
                        setStatus("Naya version aa gaya — page taaza kar diya.", toast = true)
                        binding.webView.reload()
                    }
                }
            }.start()
        }
    }

    /** Server ka build commit (/api/version) — 4s timeout, fail par null (kuch nahi karte). */
    private fun fetchServerCommit(): String? = try {
        val conn = (java.net.URL("https://railbook-gegs.onrender.com/api/version").openConnection()
            as java.net.HttpURLConnection)
        conn.connectTimeout = 4000
        conn.readTimeout = 4000
        conn.requestMethod = "GET"
        val body = conn.inputStream.bufferedReader().use { it.readText() }
        conn.disconnect()
        Regex("\"commit\"\\s*:\\s*\"([0-9a-fA-F]{7,40})\"").find(body)?.groupValues?.get(1)
    } catch (e: Exception) {
        Log.i(TAG, "version check skip: ${e.message}")
        null
    }

    private fun isRailbookUrl(url: String?): Boolean {
        val h = hostOf(url ?: return false)
        return h == "railbook-gegs.onrender.com" || h.endsWith(".onrender.com")
    }

    private fun isIrctcUrl(url: String?): Boolean {
        val h = hostOf(url ?: return false)
        return h.endsWith("irctc.co.in")
    }

    private fun goBackSmart() {
        val url = binding.webView.url
        when {
            isIrctcUrl(url) -> {
                binding.webView.clearHistory()
                openRailbook()
                setStatus("Wapas RailBook par (IRCTC waise hi open rehta hai jab aap wapas jaayein).", toast = true)
            }
            binding.webView.canGoBack() -> binding.webView.goBack()
            !isRailbookUrl(url) -> openRailbook()
            else -> {
                val now = System.currentTimeMillis()
                if (now - exitArmedAt < 2200L) {
                    finish()
                } else {
                    exitArmedAt = now
                    Toast.makeText(this, "Bahut peechhe ja chuke hain — app band karne ke liye dobara back dabayein", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    override fun onBackPressed() {
        goBackSmart()
    }

    /* Round-53 (user: *"ek baar IRCTC pe autofill hogya to reopen pe bhi RailBook directly IRCTC se
     * open hoti hai, not from starting"*): app background se wapas aane par (ya Android ne activity
     * restore ki ho) agar WebView IRCTC par hai to RailBook home dikhao — IRCTC page sirf booking
     * handoff ke liye tha, app ka ghar RailBook hi hai. Chat/context web app khud localStorage se
     * wapas le aata hai, isliye user ko "shuru se" hi sahi screen milti hai. Prewarm chal raha ho to
     * chhedte nahi (us waqt IRCTC jaan-boojh kar background me khul raha hota hai). */
    override fun onResume() {
        super.onResume()
        if (!resumeChecked) {
            resumeChecked = true
            mainHandler.postDelayed({
                val url = binding.webView.url
                if (!prewarmActive && url != null && isIrctcUrl(url)) {
                    binding.webView.clearHistory()
                    openRailbook()
                    setStatus("RailBook khol diya (aapki pichhli chat wahin hai) — IRCTC tabhi khulega jab aap Continue dabayein.", toast = true)
                }
                updateWhereLabel(binding.webView.url)
            }, 350)
        } else if (!prewarmActive && isIrctcUrl(binding.webView.url)) {
            /* Background se wapas aaye aur IRCTC par hain — ye tab hota hai jab user doosri app me gaya
             * tha; hamara ghar RailBook hai (IRCTC button se wapas ja sakte hain). */
            mainHandler.postDelayed({
                if (!prewarmActive && isIrctcUrl(binding.webView.url)) {
                    binding.webView.clearHistory()
                    openRailbook()
                }
            }, 250)
        }
        /* R69: page background me zinda rehta hai — deploy ke baad bhi purana JS chalta reh sakta hai
         * (user ko naya fix dikhta hi nahi). Resume par chupke se check. */
        checkStaleBundle()
    }

    /* Nav bar me kaun sa page khula hai — chhota sa label (IRCTC par hon to saaf dikhe). */
    private fun updateWhereLabel(url: String?) {
        binding.navWhere.text = when {
            isIrctcUrl(url) -> getString(R.string.nav_where_irctc)
            isRailbookUrl(url) -> getString(R.string.nav_where_railbook)
            else -> ""
        }
    }

    companion object {
        private const val TAG = "RailBookMain"

        /** Official IRCTC Rail Connect app (Play Store package). */
        const val IRCTC_PACKAGE = "cris.org.in.prs.ima"

        /* v1.2.4 prewarm timings. */
        /* Round-22 (26 Sep, user: "30 sec ke baad bhi extra 30 sec leta — countdown 45 sec ka karo"):
         * ab ek hi 30s countdown hai (Round-28: 45 → 30), aur uske baad koi extra wait nahi — jo page hai wahan se seedha
         * continue (honest status line ke saath). */
        const val PREWARM_COUNTDOWN_MS = 30_000L
        const val PREWARM_EXTRA_WAIT_MS = 0L
    }
}
