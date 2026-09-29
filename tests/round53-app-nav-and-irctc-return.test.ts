/* ══ ROUND-53 — Android app: back button + IRCTC se wapas RailBook home ═══════════════════════════════
 * User: *"meri railbook app mein back buttons nahi hai"* aur *"agar ek baar IRCTC pe autofill hogya to
 * reopen pe bhi RailBook directly IRCTC se open hoti hai, not from starting"*.
 *
 * Ye source-level guard hai (APK build isi tree se hota hai) — jab tak nav bar + back/return logic
 * maujood hai, koi bhi future change chup-chaap in features ko hataye, ye test fail kare.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ANDROID = "/home/user/work/app/android-app";
const activity = fs.readFileSync(path.join(ANDROID, "app/src/main/java/com/railbook/assist/MainActivity.kt"), "utf8");
const layout = fs.readFileSync(path.join(ANDROID, "app/src/main/res/layout/activity_main.xml"), "utf8");
const gradle = fs.readFileSync(path.join(ANDROID, "app/build.gradle.kts"), "utf8");

describe("Round-53 · APK me back navigation", () => {
  it("nav bar visible hai (Back · RailBook home · Reload) — WebView uske neeche", () => {
    expect(layout).toContain('android:id="@+id/navBar"');
    expect(layout).toContain('android:id="@+id/btnBack"');
    expect(layout).toContain('android:id="@+id/btnHome"');
    expect(layout).toContain('android:id="@+id/btnReload"');
    expect(layout).toContain('app:layout_constraintTop_toBottomOf="@id/navBar"');
    /* purana chhupa hua header waisa hi gone rehta hai */
    expect(layout).toMatch(/android:id="@\+id\/topBar"[\s\S]{0,400}android:visibility="gone"/);
  });

  it("back ka matlab: IRCTC par → RailBook home; warna WebView history; khatam par double-back exit", () => {
    expect(activity).toContain("private fun goBackSmart()");
    expect(activity).toContain("isIrctcUrl(url) -> {");
    expect(activity).toContain("binding.webView.canGoBack() -> binding.webView.goBack()");
    expect(activity).toContain("override fun onBackPressed() {\n        goBackSmart()");
    expect(activity).toContain("app band karne ke liye dobara back dabayein");
    expect(activity).toContain("binding.btnBack.setOnClickListener { goBackSmart() }");
  });

  it("IRCTC se wapas: resume/reopen par RailBook home (IRCTC page sticky nahi rehta)", () => {
    expect(activity).toContain("override fun onResume()");
    expect(activity).toMatch(/onResume[\s\S]{0,900}isIrctcUrl\(binding\.webView\.url\)/);
    expect(activity).toContain("RailBook khol diya (aapki pichhli chat wahin hai)");
    expect(activity).toMatch(/private fun openRailbook\(\)[\s\S]{0,400}updateWhereLabel/);
  });

  it("nav bar label batata hai kaun sa page khula hai (RailBook / IRCTC)", () => {
    expect(activity).toContain("private fun updateWhereLabel(url: String?)");
    expect(activity).toContain("R.string.nav_where_irctc");
    expect(activity).toContain("binding.navWhere.text =");
  });

  it("version 1.5.0 (nav+quality) — APK se pata chale ki naya build hai", () => {
    expect(gradle).toMatch(/versionName = "1\.5\.0/);
    expect(gradle).toMatch(/versionCode = 33/);
  });
});
