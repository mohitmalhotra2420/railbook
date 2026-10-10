# BOOKKARO AI BOOKING AGENT — PROMPT 31
# AGENTIC EFFICIENCY + MULTI-STEP TURN OPTIMIZATION
# IMPORTANT: This is the next milestone after Prompt 30. Do NOT start Prompt 32 automatically.

Full specification as provided by user on 2026-10-09 — 32 sections covering:
1. Absolute project boundary
2. Goal: help LLM complete multi-step requests with fewer cycles, preserving authority
3. Architecture must not change (USER → LLM → validation → tool → result → LLM)
4. Optimize LLM tool loop (remove unnecessary clarification/reasoning cycles)
5. Tool result compression (compact but sufficient)
6. Current-turn context only (not all old turns)
7. Date-change efficiency (old facts stale, fresh search, new reference)
8. Reference + tool chain (SEARCH → resolve doosri wali → GET_FARE etc. as LLM choice)
9. Tool result follow-up decision (A-E)
10. No unnecessary second wording call
11. Acknowledgement efficiency (truthful, only after tool started)
12. Invalid tool argument recovery (INVALID_TRAIN_NUMBER → retry)
13. Same-turn duplicate optimization (suppress same logical call, allow fresh on date/route change)
14. Tool step limit MAX 8
15. Latency observability
16. Efficiency must not reduce fact safety (P25/P26/P28/P30)
17. General knowledge fast path (RAC kya hai? → 0 tools)
18. Mixed requests, 19. Comparison efficiency, 20. User correction, 21. Intent continuation
22. Voice parity, 23. TTS, 24. Booking safety (DISABLED)
25. Tests — Unit (25 cases), 26. Tests — Multi-step E2E (E1-E10), 27. Live Muse Test (3 requests mock), 28. Live-timeout rule, 29. Verification Groups G1/G2/G3, 30. Git/Security, 31. Success Criteria (21), 32. Final Stop

This file marks PROMPT 31 as READ and ACTIVE. Implementation will be audited against it. Do NOT start Prompt 32 automatically.
