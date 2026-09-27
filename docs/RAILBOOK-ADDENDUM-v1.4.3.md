

**Round-43k part 2 (live verification ke baad mile do gaps bhi band):**
- **Grounded route-fact injector** (`agentic.ts routeFactLine`): khaas train + station wale kisi bhi sawaal par ("X se chalti hai?", "Y par rukti hai?", "Z tak jaati hai?") timetable ka SACHCH model ko diya jaata hai — stop ka role (origin / stop #n / aakhri stop) + arr/dep. Isse "origin X nahi hai, isliye X se nahi chalti" jaisa galat tark band.
- **Negative claim do source se:** "ye station is train me nahi" ek NEGATIVE claim hai — isliye claim se pehle doosra (web-scrape) schedule source bhi dekha jaata hai; dono chup rahein tab hi fail. (Wajah: ek provider ke stop-list me gap ho sakta hai.)
- **Shehar-sibling fact:** station route me na ho par usi SHEHAR ka koi doosra station route me ho to wahi batate hain — live: `12054 ludhiana se haridwar tak chalti hai?` → "12054 LDH par stop nahi karti; isi shehar ka **DDL (Dhandari Kalan)** route me hai — departure 09:20" (+ chip "DDL ka seat"). General hai: kisi bhi train x multi-station city par.
- **Marker scrub:** model ke control tokens (`[END]`, `(done)`) user ko kabhi nahi dikhte; `[NEXT]` chips bache rehte hain.
- Full suite **122 files / 1341 tests pass** (`/tmp/r43k-suite5.log`).
