# RailBook AI BOOKING AGENT — PROMPT 32
# FULL LLM AGENT AUTHORITY + REAL RAILWAY DATA PRODUCTION HARDENING
# Date: 2026-10-02

This file is the canonical authority for Prompt 32. All future commits must respect it.

## 0. PROJECT BOUNDARY — ABSOLUTE
## 1. CORE ARCHITECTURE: LLM = FULL AGENTIC DECISION MAKER, Backend = HARD SAFETY / VALIDATION / EXECUTION BOUNDARY, RailwayProvider = AUTHORITATIVE FACT SOURCE
## 2. LLM AUTHORISED TO DECIDE: intent, general vs railway, clarification, tool(s), ordering, parallel, previous result reuse, contextual refs (doosri wali, pehli wali, 12014 wali...), class/date/route/train selection, comparison, next action, final answer, language
## 3. LLM TOOL AUTHORITY: native structured tool calling, SEARCH_TRAINS, GET_TRAIN_INFO, GET_TIMETABLE, TRACK_TRAIN, CHECK_AVAILABILITY, GET_FARE, CHECK_PNR, GET_CANCELLED_TRAINS, GENERAL_RAILWAY_ANSWER — no fake APIs/data
## 4. BACKEND: only validation, auth, session/state, date canonicalization, route validity, stale detection, provenance, entity binding, authority validation, confirmation, idempotency, booking boundary, timeout, failure normalization
## 5. NO HIDDEN DETERMINISTIC AGENT: no if message contains X -> call Y
## 6-7. REAL DATA FRESHNESS MANDATORY: every new enquiry = fresh authoritative data, no cross-turn cache reuse, A NEW USER ENQUIRY = NEW FRESH ENQUIRY
## 8. PROVIDER RESULT AUTHORITY: preserve resultId, toolName, trainNumber, etc., no cross-contamination
## 9-10. PROVIDER FAILURE HONEST + NO FAKE FALLBACK
## 11. MULTI-PROVIDER RULE: provider identity observable
## 12-13. AVAILABILITY/FARE AUTHORITY: only CHECK_AVAILABILITY / fare result is authority
## 14. CONTEXTUAL REFERENCES: doosri wali etc. via provenance
## 15. DATE/ROUTE CHANGES: old facts invalidated, LLM decides new search
## 16-18. TOOL LOOP MAX 8, same-turn dedupe, LLM may retry on failure
## 19. NATURAL ACTION CLAIMS only when tool actually started/succeeded
## 20-22. GENERAL KNOWLEDGE, MIXED QUESTIONS, COMPARISONS — LLM owns reasoning
## 23. RESPONSE GENERATION: avoid unnecessary second LLM call
## 24-25. VOICE+TEXT PARITY, BARGE-IN
## 26. SECURITY: never expose secrets to LLM
## 27. BOOKING/PAYMENT DISABLED
## 28. CONFIRMATION: only haan/yes/confirm
## 29. OBSERVABILITY: turnId, model, latency, tool counts, provenance
## 30. PERFORMANCE: compact context, parallel where safe

This commit marks PROMPT 32 as READ and ACTIVE. Next code changes will be audited against it.
