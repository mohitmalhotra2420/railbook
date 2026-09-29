# RailBook ke liye AI model — recommendation (Round-53, 29 Sep 2026)

> **Ek line me:** aapki nayi key lagane ke liye code chhedna nahi padega — sirf 3 environment variables.
> Best value combo: **Groq (free tier) primary + OpenRouter fallback**, ya quality-first ke liye
> **Claude Sonnet 4.6 / GLM-5**.

## 1. Aaj kya lagaa hua hai (truth)

| Layer | Kya laga hai | Haal |
|---|---|---|
| Agentic brain (jo query samajhta hai, tools chunta hai) | NVIDIA NIM → `openai/gpt-oss-20b`, fallback `meta/muse-glimmer-30b` | Prod par NIM **queue** me atak jaata hai (30-60s+, kai baar timeout) — isliye jawab 170-185s leta hai |
| HF (GLM) fallback | `router.huggingface.co` | **Credits khatam** ("included credits depleted") — dead |
| Isliye asli fix | **naya provider + key** | yeh doc |

## 2. Naya provider lagane ka tarika (3 env vars, code zero)

Render → Environment me ye set kar do aur deploy:

```
AI_LLM_BASE_URL = <provider ka OpenAI-compatible base URL>
AI_LLM_API_KEY  = <aapki key>
AI_LLM_MODELS   = <primary model>,<fallback model>     # comma se chain
```

Bas. Ye teen set hote hi **poora AI stack** (agentic brain + NLU/extraction + journey decisions) usi
endpoint par chala jaata hai; teen set na hone par purana NVIDIA path bilkul waisa hi chalta rahega
(default safe hai — aadhi config se kuch nahi tootta).

## 3. Provider ke base URLs (copy-paste)

| Provider | `AI_LLM_BASE_URL` | Free tier | Card? | Notes |
|---|---|---|---|---|
| **Groq** | `https://api.groq.com/openai/v1` | 30 RPM · 1,000 req/day · 8K TPM · 200K tokens/day (gpt-oss) | Nahi | ~500 tok/s; prompt-caching se bada system prompt quota se bahar rah jaata hai |
| **Cerebras** | `https://api.cerebras.ai/v1` | ~5 RPM · 1M tokens/day | Nahi | sabse tez (2,000+ tok/s), daily reset |
| **OpenRouter** (ek key, 300+ models) | `https://openrouter.ai/api/v1` | 20 RPM, 50 req/day free models (`:free`) | Nahi (paid tier ke liye $5) | fallback chain ke liye best — ek hi key se kai provider |
| **Google AI Studio (Gemini)** | `https://generativelanguage.googleapis.com/v1beta/openai/` | Gemini Flash free tier (10-15 RPM) | Nahi | Indic/Hinglish samajh me sabse aage |
| **OpenAI** | `https://api.openai.com/v1` | Paid | Haan | GPT-5.x gpt-oss se mehnga |
| **xAI (Grok)** | `https://api.x.ai/v1` | $25 free credits | Haan | Grok 4.1 Fast sabse sasta frontier |
| **Anthropic (Claude)** | `https://api.anthropic.com/v1` (OpenAI-compat layer) | Paid | Haan | quality-first leader (τ-bench multi-turn agentic #1) |
| **Sarvam AI** (India) | `https://api.sarvam.ai/v1` | free credits | — | 22 Indian languages + **code-mixed Hinglish** ke liye purpose-built; tokenizer Indic me ~80% kam tokens (tool-calling benchmark kamzor) |
| **NVIDIA NIM** (aaj wala) | `https://integrate.api.nvidia.com/v1` | free | Nahi | **abhi queue-stuck** — primary ke liye theek nahi |

## 4. Model IDs (jo `AI_LLM_MODELS` me daal sakte hain)

| Model | Kyun | Keval | Kahan |
|---|---|---|---|
| `openai/gpt-oss-120b` | yahi model hamein chahiye (aaj 20b) — sirf **fast provider** chahiye | Groq free | Groq |
| `openai/gpt-oss-20b` | halka + tez, aaj bhi prod me chalta hai | Groq free | Groq |
| `qwen/qwen3.8-27b` / `qwen/qwen3-32b` | 500K tokens/day, strong mid-size | Groq free | Groq |
| `zai-glm-4.7` / GLM-5 | **tool-calling ke champion** (BFCL v4: GLM-4.5 70.9%, τ-bench: GLM-5 82-83%) | Cerebras free / paid | Cerebras, OpenRouter (`z-ai/glm-5`) |
| `meta/llama-3.3-70b-versatile` | purana prod-proven | — | **Groq se 16 Aug 2026 ko retire** — Groq par mat chuno |
| `claude-sonnet-4.6` | multi-turn agentic quality #1 (τ-bench 87.5%) — is app ka sabse bhaari sawaal isi par sahi hota hai | paid $3/$15 | Anthropic/OpenRouter |
| `gemini-2.5-flash` / `gemini-3-flash` | Hinglish/Indic + free tier | free (flash) | Google AI Studio |
| `sarvam-105b` | Hinglish code-mixed samajh me purpose-built | — | Sarvam |

## 5. Meri recommendation (priority ke hisaab se)

1. **Turant + muft (aaj hi achha jawab):** Groq key → `AI_LLM_MODELS=openai/gpt-oss-120b,openai/gpt-oss-20b`.
   gpt-oss hi aaj ka model hai, par NVIDIA ke bajaye **is provider par 1-2 second** me jawab. Hinglish
   samajh bhi achhi hai (is model par prompt-cache lagta hai, to bhaari system prompt free ho jaata hai).
2. **Quality-first (aap ne kaha: latency se zyada quality):** OpenRouter key →
   `AI_LLM_MODELS=anthropic/claude-sonnet-4.6,z-ai/glm-5,openai/gpt-oss-120b`.
   Claude τ-bench par #1 (multi-turn agentic task completion), GLM-5 tool-calling me sabse balanced;
   chain me fallback bhi same key se chal jaata hai (ek hi key, kai provider).
3. **India/Hinglish special:** Sarvam key ko **NLU layer** par lagao (NLU_MODEL path) — Hinglish
   wording ka token kharch kam, samajh better; bhaari jawab wahi Claude/GLM de.
4. **Free fallback (bekaar na ho):** Cerebras key (`zai-glm-4.7`, 1M tokens/day) — chain ke aakhir me
   rakho; Groq/Gemini ki limit khatam hone par bhi jawab aata rahe.

**Mera pehla kadam aapke liye:** Groq ya OpenRouter ki ek key le lijiye (dono card ke bina). Key milte
hi main usi din chain set karke prod par live kar dunga — code ready hai (Round-53 me `AI_LLM_*`
override add ho gaya hai), sirf environment variables daalne hain.

## 6. Sabak jo aaj ke prod se mila

- Sirf **benchmark score** par na jayein — proxy/CDN ke peeche provider ka **queue** asli dushman hai
  (NVIDIA NIM prod par 30-60s leta hai, wahi call sandbox se 2.4s).
- Isliye chain hamesha **do alag provider** ki rakhein (Groq + OpenRouter), warna ek provider ka
  rate-limit poora app rok deta hai.
- "Monthly included credits" wale routes (HF) ek din khatam hote hain — production me un par bharosa na karein.
