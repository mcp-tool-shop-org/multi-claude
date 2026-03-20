<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.md">English</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/multi-claude/readme.png" width="400" alt="Multi-Claude" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/actions"><img src="https://github.com/mcp-tool-shop-org/multi-claude/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/multi-claude/"><img src="https://img.shields.io/badge/docs-landing%20page-blue" alt="Landing Page" /></a>
</p>

[क्लाउड कोड](https://claude.ai/) के लिए लेन-आधारित समानांतर बिल्ड सिस्टम। यह एक ही कोडबेस पर काम करने वाले कई क्लाउड सत्रों को व्यवस्थित करता है, जिसमें निर्भरता समाधान, फ़ाइल स्वामित्व, ऑपरेटरों का हस्तक्षेप और साक्ष्य-आधारित हस्तांतरण शामिल है।

## यह क्या करता है।

मल्टी-क्लाउड एक बड़े कार्य को "पैकेट ग्राफ" में बदल देता है—छोटे, स्वतंत्र रूप से दावा किए जा सकने वाले कार्य इकाइयां, जिनमें स्पष्ट फ़ाइल स्वामित्व और निर्भरता संबंध होते हैं। कई क्लाउड कोड सत्र, इन पैकेट्स को समानांतर में चलाते हैं, जबकि एक ऑपरेटर एक एकीकृत नियंत्रण प्रणाली के माध्यम से निगरानी करता है, हस्तक्षेप करता है और अनुमोदन करता है।

**ऑपरेटर लूप:**

1. **योजना:** फिटनेस का मूल्यांकन करें, ब्लूप्रिंट तैयार करें, अनुबंध को अंतिम रूप दें।
2. **कार्यान्वयन:** श्रमिक पैकेट प्राप्त करें, उत्पाद बनाएं, आउटपुट की जांच करें।
3. **निगरानी:** लाइव 5-पैनल कंसोल रन की स्थिति, हुक और फिटनेस दिखाता है।
4. **हस्तक्षेप:** रन को रोकें, पैकेट को पुनः प्रयास करें, हुक को हल करें, गेट को स्वीकृत करें।
5. **पुनर्प्राप्ति:** 8 विफलता परिदृश्यों के लिए निर्देशित पुनर्प्राप्ति प्रक्रियाएं।
6. **समापन:** परिणाम का निर्धारण, साक्ष्य का हस्तांतरण, पदोन्नति/अनुमोदन।

## स्थापित करें।

```bash
npm install -g @multi-claude/cli
```

इसके लिए नोड.जेएस 20 या उससे ऊपर का संस्करण और [क्लाउड कोड](https://claude.ai/) का कमांड-लाइन इंटरफेस (सीएलआई) स्थापित होना आवश्यक है।

## शुरुआत कैसे करें।

```bash
# Assess whether a task fits multi-claude
multi-claude plan evaluate --work-class backend_law --packets 6 --coupling low

# Initialize a blueprint from a template
multi-claude blueprint init --template backend_law

# Validate and freeze the blueprint
multi-claude blueprint validate
multi-claude blueprint freeze

# Start a run
multi-claude run

# Watch execution in real-time
multi-claude console watch

# Check what to do next
multi-claude console next

# Generate handoff evidence when done
multi-claude console handoff

# Export for review
multi-claude console export handoff --format markdown
```

## आदेश।

### मुख्य भाग।

| आदेश। | विवरण। |
|---------|-------------|
| `multi-claude plan evaluate` | कार्य वर्ग, पैकेट की संख्या और युग्मन के आधार पर फिटनेस का मूल्यांकन करें। |
| `multi-claude blueprint init` | टेम्प्लेट से पैकेट ग्राफ उत्पन्न करें। |
| `multi-claude blueprint validate` | कानूनी पहलुओं की जांच करें (जैसे कि फ़ाइल ओवरलैप, निर्भरताएँ, और प्रतिबंध)। |
| `multi-claude blueprint freeze` | SHA-256 हैश, एक बार जब यह "फ्रीज" हो जाता है, तो इसे बदला नहीं जा सकता। |
| `multi-claude run` | कार्यान्वयन शुरू करें। |
| `multi-claude resume` | एक बार जो प्रक्रिया रुक गई है, उसे फिर से शुरू करें। |
| `multi-claude stop` | एक प्रक्रिया को रोकें। |
| `multi-claude status` | शो की वर्तमान स्थिति दिखाएं। |

### कंसोल (18 उप-कमांड)

| आदेश। | विवरण। |
|---------|-------------|
| `console show` | पूरी तरह से 5-पैनल वाला ऑपरेटर कंसोल। |
| `console overview` | दौड़ का सारांश। |
| `console packets` | पैकेट की स्थिति और प्रगति। |
| `console workers` | श्रमिकों के लिए आयोजित सत्र। |
| `console hooks` | हुक निर्णय फ़ीड। |
| `console fitness` | रन/पैकेट परिपक्वता स्कोर। |
| `console next` | अगला कानूनी कदम (10-स्तरीय प्राथमिकता)। |
| `console watch` | हर 2 सेकंड में स्वचालित रूप से रीफ्रेश करें। |
| `console actions` | उपलब्ध ऑपरेटर विकल्प। |
| `console act` | एक ऑपरेटर क्रिया को निष्पादित करें। |
| `console audit` | लेखा परीक्षा का रिकॉर्ड/अनुक्रम। |
| `console recover` | निर्देशित पुनर्प्राप्ति प्रक्रियाएं। |
| `console outcome` | चलाए गए प्रोग्राम के परिणाम का विश्लेषण। |
| `console handoff` | हैंडऑफ़ साक्ष्य का संक्षिप्त विवरण। |
| `console promote-check` | प्रमोशन के लिए पात्रता। |
| `console approve` | रिकॉर्ड की मंजूरी। |
| `console reject` | रिकॉर्ड अस्वीकार। |
| `console approval` | अनुमोदन की स्थिति। |
| `console export` | निर्यात प्रक्रिया में हैंडऑफ़, अनुमोदन या गेट को मार्कडाउन या JSON फॉर्मेट में प्रस्तुत किया जा सकता है। |

### मॉनिटर (नियंत्रण पैनल इंटरफ़ेस)

```bash
multi-claude monitor --port 3100
```

`http://localhost:3100` पर एक रिएक्ट-आधारित ऑपरेटर डैशबोर्ड खोलता है, जिसमें निम्नलिखित शामिल हैं:

- **सारांश:** सिस्टम की स्थिति, लेन का उपयोग, चल रहे परीक्षण।
- **कतार:** क्रमबद्ध करने योग्य आइटम सूची, जिसमें इनलाइन क्रियाएं शामिल हैं।
- **आइटम विवरण:** स्थिति संबंधी जानकारी (स्थिति/जोखिम/अगला कदम), निर्णय लेने का उपकरण, संक्षिप्त करने योग्य प्रमाण।
- **लेन की स्थिति:** प्रत्येक लेन के लिए आंकड़े, हस्तक्षेप, नीतिगत सुझाव।
- **गतिविधि:** वास्तविक समय में होने वाली घटनाओं का कालक्रम।

## आर्किटेक्चर।

```
┌─────────────────────────────────────────────────┐
│                   CLI (Commander)                │
├─────────────────────────────────────────────────┤
│  Planner    │  Console     │  Monitor (Express)  │
│  - rules    │  - run-model │  - queries          │
│  - blueprint│  - hook-feed │  - commands          │
│  - freeze   │  - fitness   │  - policies          │
│  - templates│  - next-act  │  - React UI          │
├─────────────────────────────────────────────────┤
│             Handoff Spine (12 Laws)             │
│  Execution → Transfer → Decision → Triage →     │
│  Supervision → Routing → Flow → Intervention →  │
│  Governance → Outcome → Calibration → Promotion │
├─────────────────────────────────────────────────┤
│          SQLite Execution Database              │
│        (19+ tables, local .multi-claude/)       │
├─────────────────────────────────────────────────┤
│         Claude Agent SDK (worker sessions)       │
└─────────────────────────────────────────────────┘
```

## मल्टी-क्लाउड का उपयोग कब करें?

"मल्टी-क्लाउड" सबसे अच्छा काम करता है जब डेटा पैकेट की संख्या इतनी अधिक हो कि समन्वय से जुड़ी अतिरिक्त लागतों को कम किया जा सके, और फ़ाइल स्वामित्व इतना स्पष्ट हो कि अर्थ संबंधी सामंजस्य को एक निश्चित सीमा के भीतर रखा जा सके।"

| कार्य वर्ग। | फिट। | ब्रेक-ईवन (ब्रेक-ईवन बिंदु) |
|------------|-----|------------|
| बैकएंड/स्टेट/डोमेन। | मजबूत। | लगभग 3 पैकेट। |
| यूआई/इंटरैक्शन/सीम-भारी (UI/Interaction/Seam-heavy) - यह वाक्यांश यूजर इंटरफेस, इंटरैक्शन और "सीम" (जो कि दो अलग-अलग तत्वों के बीच का संबंध या अंतर होता है) पर अत्यधिक जोर देने वाली डिज़ाइन या सिस्टम को दर्शाता है। | मध्यम। | लगभग 5 पैकेट। |
| कंट्रोल-प्लान/बुनियादी ढांचा। | मध्यम। | लगभग 5-6 पैकेट। |

इसका उपयोग तब करें: जब आपके पास 5 या उससे अधिक पैकेट हों, जब फ़ाइल का स्वामित्व स्पष्ट हो, जब डेटा की संरचना स्वाभाविक रूप से व्यवस्थित हो, और जब स्वतंत्र सत्यापन महत्वपूर्ण हो।

**"सिंगल-क्लाउड" मोड का उपयोग तब करें जब:** सिस्टम का आर्किटेक्चर अस्थिर हो, या उसमें 2 या उससे कम पैकेट हों, या जब महत्वपूर्ण प्रक्रियाएँ अधिकतर क्रमबद्ध हों, क्योंकि ऐसे मामलों में ऑपरेटर "बॉटलनेक" बन सकता है।

[WHEN-TO-USE-MULTI-CLAUDE.md](WHEN-TO-USE-MULTI-CLAUDE.md) पर जाएं, जहां आपको मूल्यांकन किए गए परीक्षणों से प्राप्त साक्ष्यों के साथ पूर्ण निर्णय दिशानिर्देश मिलेंगे।

## सुरक्षा

मल्टी-क्लाउड एक **स्थानीय-आधारित कमांड-लाइन टूल** है। यह एक ही डेवलपर मशीन पर क्लाउड कोड सत्रों का प्रबंधन करता है।

- **उपयोग किए जाने वाले घटक:** स्थानीय फ़ाइल सिस्टम (कार्यशील निर्देशिका + `.multi-claude/`), SQLite डेटाबेस, क्लाउड कोड सबप्रोसेस, localhost (केवल निगरानी)।
- **इन घटकों का उपयोग नहीं किया जाता:** सीधे क्लाउड एपीआई, कोई टेलीमेट्री नहीं, कोई क्रेडेंशियल भंडारण नहीं, localhost से परे कोई नेटवर्क आउटगोइंग नहीं।
- **अनुमतियाँ:** फ़ाइल संचालन परियोजना निर्देशिका तक सीमित हैं, मॉनिटर केवल localhost से जुड़ा है, हुक नीतियां केवल मौजूदा कमांड-लाइन कमांड निष्पादित करती हैं, ऑपरेटर क्रियाएं मानक कानून मॉड्यूल के माध्यम से होती हैं।

पूर्ण सुरक्षा नीति और भेद्यता रिपोर्ट के लिए [SECURITY.md](SECURITY.md) देखें।

## परीक्षण

```bash
npm test          # 1600+ tests via Vitest
npm run typecheck # TypeScript strict mode
npm run verify    # typecheck + test + build
```

## प्लेटफ़ॉर्म

- **ऑपरेटिंग सिस्टम:** विंडोज, macOS, लिनक्स
- **रनटाइम:** Node.js 20+
- **निर्भरताएँ:** क्लाउड कोड CLI, बेहतर-sqlite3, कमांडर, एक्सप्रेस

## लाइसेंस

[MIT](LICENSE)

---

यह <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> द्वारा बनाया गया है।
