/* Round-21 verification (25 Sep 2026) — asli Android autofill engine (fieldmap.js + irctc-passenger.js)
 * ko jsdom me ek IRCTC-jaisa passenger page par chalata hai aur dekhta hai ki food / dono checkbox /
 * mobile / email sach me bharte hain ya nahi.
 *
 *   node tools/round21-autofill-engine-check.mjs
 *
 * Ye script app ke assets ko hi load karta hai (copy nahi) — isliye jo APK me jaata hai wahi test hota hai.
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ASSETS = path.resolve(process.argv[2] ?? "../app/android-app/app/src/main/assets/autofill");
const fieldmapSrc = fs.readFileSync(path.join(ASSETS, "fieldmap.js"), "utf8");
const engineSrc = fs.readFileSync(path.join(ASSETS, "irctc-passenger.js"), "utf8");

const FOOT = (rows) => `
<!doctype html><html><body>
  <form>
    <table>
      ${rows}
    </table>
    <div class="contact">
      <label for="mob">Mobile Number</label>
      <input id="mob" formcontrolname="mobileNumber" type="tel" placeholder="Mobile Number">
      <label for="mail">Email</label>
      <input id="mail" formcontrolname="email" type="email" placeholder="Email">
    </div>
  </form>
</body></html>`;

const ROW = (i, extra = {}) => `
  <tr class="pax-row" id="row${i}">
    <td><input formcontrolname="passengerName" id="pn${i}" value=""></td>
    <td><input formcontrolname="passengerAge" id="pa${i}" value=""></td>
    <td>
      <select formcontrolname="passengerGender" id="pg${i}">
        <option value="">Select</option><option value="M">Male</option><option value="F">Female</option><option value="T">Transgender</option>
      </select>
    </td>
    <td>
      <select formcontrolname="passengerBerthChoice" id="pb${i}">
        <option value="NP">No Preference</option><option value="LB">Lower</option><option value="MB">Middle</option>
        <option value="UB">Upper</option><option value="SL">Side Lower</option><option value="SU">Side Upper</option>
      </select>
    </td>
    <td>
      <select formcontrolname="passengerFoodChoice" id="pf${i}">
        <option value="D">Catering Service Option</option>
        <option value="V">Veg</option>
        <option value="N">Non Veg</option>
        <option value="NF">No Food</option>
      </select>
    </td>
    <td>
      <input type="checkbox" id="cb${i}" formcontrolname="confirmBerths" ${extra.confirm ? "checked" : ""}>
      <label for="cb${i}">Book only if confirm berths are allotted</label>
      <input type="checkbox" id="au${i}" formcontrolname="autoUpgradation">
      <label for="au${i}">Consider for auto up-gradation</label>
    </td>
  </tr>`;

function payload(over = {}) {
  return {
    kind: "railbook-autofill-test",
    version: 2,
    test: true,
    createdAt: new Date().toISOString(),
    journey: { from: "Amritsar Jn", fromCode: "ASR", to: "New Delhi", toCode: "NDLS", date: "2026-09-26", trainNumber: "12014", classCode: "CC" },
    contact: { mobile: "9876543210", email: "asha@example.com" },
    passengers: [
      { name: "Asha Kaur", age: 28, gender: "female", berth: "Lower", food: "Veg", bookOnlyIfConfirm: true, autoUpgrade: true },
    ],
    ...over,
  };
}

function boot(html) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.eval(fieldmapSrc);
  w.eval(engineSrc);
  return w;
}

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} · ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  /* ── 1. payload validation (naya V2 + purana V1) ── */
  let w = boot(FOOT(ROW(0)));
  let fm = w.RailBookPocFieldMap;
  const v2 = fm.validatePayload(payload());
  check("V2 payload (contact + dono flags) validate hota hai", v2.ok, v2.errors.join(", "));
  const v1 = fm.validatePayload(payload({ version: 1, contact: undefined, passengers: [{ name: "Asha Kaur", age: 28, gender: "female", berth: "Lower", food: "Veg" }] }));
  check("purana V1 payload bilkul waisa hi chalta hai", v1.ok && v1.payload.version === 1 && !("contact" in v1.payload));
  const badMob = fm.validatePayload(payload({ contact: { mobile: "12345" } }));
  check("galat mobile par payload reject", !badMob.ok && /mobile/.test(badMob.errors.join(" ")), badMob.errors.join(" "));
  const badKey = fm.validatePayload(payload({ passengers: [{ name: "A", age: 20, gender: "male", berth: "Lower", food: "", secretOtp: "1234" }] }));
  check("unknown passenger key reject (sensitive/extra keys kabhi nahi)", !badKey.ok, badKey.errors.join(" "));

  /* ── 2. REAL IRCTC engine (PrimeNG-style formcontrolname anchors) ── */
  w = boot(FOOT(ROW(0) + ROW(1, { confirm: true })));
  const doc = w.document;
  const res = await w.RailBookPocIrctc.fillIrctc(doc, payload({
    passengers: [
      { name: "Asha Kaur", age: 28, gender: "female", berth: "Lower", food: "Veg", bookOnlyIfConfirm: true, autoUpgrade: true },
      { name: "Ravi Sharma", age: 35, gender: "male", berth: "No Preference", food: "No Food" },
    ],
  }));
  check("row 1: food = Veg", doc.getElementById("pf0").value === "V" && res.filled.includes("passengers.0.food"), doc.getElementById("pf0").value);
  check("row 2: food = No Food (site ke apne option text se)", doc.getElementById("pf1").value === "NF" && res.filled.includes("passengers.1.food"), doc.getElementById("pf1").value);
  check("row 1: 'Book only if confirm berths' check hua", doc.getElementById("cb0").checked, String(res.filled.includes("passengers.0.bookOnlyIfConfirm")));
  check("row 1: 'Consider for auto up-gradation' check hua", doc.getElementById("au0").checked, String(res.filled.includes("passengers.0.autoUpgrade")));
  check("row 2 ke checkboxes nahi chhue (user ne tick nahi kiya — site default waisa hi)", doc.getElementById("au1").checked === false);
  check("mobile autofill hua", doc.getElementById("mob").value === "9876543210", doc.getElementById("mob").value);
  check("email autofill hua", doc.getElementById("mail").value === "asha@example.com", doc.getElementById("mail").value);
  check("report me contact/food/flags dikhte hain", ["contact.mobile", "contact.email", "passengers.0.food", "passengers.0.bookOnlyIfConfirm"].every((p) => res.filled.includes(p)), res.filled.join(", "));
  check("koi result path chhupa nahi (notFound/failed jaan-boojh kar list hote hain)", Array.isArray(res.notFound) && Array.isArray(res.failed), `notFound=${res.notFound.length} failed=${res.failed.length}`);
  check("sensitive guard ne kuch nahi chhua (clicks sirf allowed)", res.forbiddenClicks.length === 0, JSON.stringify(res.forbiddenClicks));

  /* ── 3. flags/payload na hone par kuch nahi chhua jaata ── */
  w = boot(FOOT(ROW(0)));
  const doc2 = w.document;
  const res2 = await w.RailBookPocIrctc.fillIrctc(doc2, payload({
    contact: {},
    passengers: [{ name: "Asha Kaur", age: 28, gender: "female", berth: "Lower", food: "" }],
  }));
  check("blank food → site ka default (Catering Service Option) waisa hi", doc2.getElementById("pf0").value === "D");
  check("blank contact → mobile/email waisa hi", doc2.getElementById("mob").value === "" && doc2.getElementById("mail").value === "");
  check("flags absent → checkbox untouched", doc2.getElementById("cb0").checked === false && doc2.getElementById("au0").checked === false);
  check("report saaf: kuch filled nahi (sirf name/age/gender/berth)", res2.filled.length === 4, res2.filled.join(", "));

  /* ── 4. generic (mock) path: fieldmap.fillFields wahi cheezein bharta hai ── */
  w = boot(`<!doctype html><html><body>
    <section data-rb-group="passenger-1">
      <input data-rb="passengers.0.name" id="n1">
      <input data-rb="passengers.0.age" id="a1">
      <select data-rb="passengers.0.gender" id="g1"><option value="">-</option><option value="female">Female</option></select>
      <select data-rb="passengers.0.berth" id="b1"><option value="">-</option><option value="Lower">Lower</option></select>
      <select data-rb="passengers.0.food" id="f1"><option value="D">Catering Service Option</option><option value="V">Veg</option><option value="NF">No Food</option></select>
      <input type="checkbox" id="c1" data-rb-flag="bookOnlyIfConfirm"><label for="c1">Book only if confirm berths are allotted</label>
      <input type="checkbox" id="c2"><label for="c2">Consider for auto up-gradation</label>
    </section>
    <label for="m1">Mobile</label><input id="m1" name="mobile">
    <label for="e1">Email</label><input id="e1" name="email">
  </body></html>`);
  const doc3 = w.document;
  const g = w.RailBookPocFieldMap.fillFields(doc3, payload({
    passengers: [{ name: "Asha Kaur", age: 28, gender: "female", berth: "Lower", food: "Veg", bookOnlyIfConfirm: true, autoUpgrade: true }],
  }));
  check("generic path: food bhara", doc3.getElementById("f1").value === "V" && g.filled.includes("passengers.0.food"), doc3.getElementById("f1").value);
  check("generic path: 'book only if confirm' checkbox bhara", doc3.getElementById("c1").checked && g.filled.includes("passengers.0.bookOnlyIfConfirm"));
  check("generic path: mobile + email bhare", doc3.getElementById("m1").value === "9876543210" && doc3.getElementById("e1").value === "asha@example.com");
  check("generic path: expectedPaths me naye paths", w.RailBookPocFieldMap.expectedPaths(payload()).includes("contact.mobile"));

  const failedCount = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failedCount}/${checks.length} checks PASS`);
  process.exit(failedCount ? 1 : 0);
}

main().catch((e) => {
  console.error("check crashed:", e);
  process.exit(2);
});
