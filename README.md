# AI Ad Match — Personalization Engine

An AI-driven personalization engine that bridges the gap between ad creatives and landing pages. Upload or link an ad creative image, provide a target landing page URL, and the engine dynamically rewrites the page's messaging to create perfect **message match** — increasing conversion rates through CRO principles.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![NVIDIA](https://img.shields.io/badge/NVIDIA_API-NIM-76B900?logo=nvidia)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)

---

## 🎯 Problem Statement

Users click on specific, high-intent ads but land on generic pages. This disconnect causes high bounce rates. This project solves that by:

1. **Extracting** the hook/headline from an ad creative image (using a vision model)
2. **Mapping** that hook to the landing page's text structure
3. **Injecting** personalized copy without breaking the page's design

---

## 🧠 How It Works

```
Ad Creative (Image)          Landing Page URL
        │                           │
        ▼                           ▼
┌──────────────────┐    ┌──────────────────────┐
│  NVIDIA Vision   │    │   Fetch HTML + Parse  │
│  (Llama 3.2 90B) │    │   with Cheerio        │
│  Extract ad hook │    │   Extract h1-h4, p,   │
│                  │    │   CTAs                 │
└────────┬─────────┘    └──────────┬────────────┘
         │                         │
         └──────────┬──────────────┘
                    ▼
         ┌─────────────────────┐
         │   NVIDIA Text LLM   │
         │   (Llama 3.1 8B)    │
         │   Rewrite elements  │
         │   for message match │
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │   Re-inject text    │
         │   Fix asset URLs    │
         │   Static HTML out   │
         └─────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ 
- **NVIDIA API Key** from [build.nvidia.com](https://build.nvidia.com)

### Installation

```bash
# Clone the repository
git clone https://github.com/nirmt-124398/troopod_assessment.git
cd troopod_assessment

# Install dependencies
npm install

# Set up environment variables
cp .env.local.example .env.local
```

Open `.env.local` and add your NVIDIA API key:

```env
NVIDIA_API_KEY=nvapi-your-key-here
```

### Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📖 Usage

1. **Select input mode** — Click **Link** (paste an ad image URL) or **Upload** (upload an ad image file)
2. **Enter landing page URL** — The target page you want to personalize
3. **Click "Generate Personalized Page"** — The engine will:
   - Analyze the ad creative using NVIDIA's vision model
   - Fetch and parse the landing page
   - Rewrite headings, sub-headlines, paragraphs, and CTAs
   - Render the personalized static page in the live preview

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | **Next.js 16** (App Router) | Full-stack React framework |
| Language | **TypeScript** | Type safety |
| Styling | **Tailwind CSS** | UI design |
| HTML Parsing | **Cheerio** | Server-side DOM manipulation |
| AI (Vision) | **meta/llama-3.2-90b-vision-instruct** | Extract ad hook from image |
| AI (Text) | **meta/llama-3.1-8b-instruct** | Rewrite page copy for message match |
| AI Gateway | **NVIDIA API Catalog (NIM)** | Model hosting via OpenAI-compatible SDK |

---

## 📁 Project Structure

```
ai-personalization/
├── src/
│   └── app/
│       ├── api/
│       │   └── personalize/
│       │       └── route.ts        # Backend API — fetch, parse, AI, re-inject
│       ├── page.tsx                # Frontend UI — inputs, preview iframe
│       ├── layout.tsx              # Root layout
│       └── globals.css             # Global styles
├── .env.local                      # NVIDIA API key (not committed)
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── README.md
```

---

## 🔑 Key Design Decisions

### Why Cheerio instead of a headless browser?
Cheerio parses HTML as a string on the server — lightweight, fast, and no Chrome dependency. Perfect for extracting and replacing text nodes without executing page JavaScript.

### Why strip JavaScript from the output?
The goal is a **static personalized preview**, not a fully interactive clone. Removing scripts prevents:
- Original JS from overwriting our changes
- Navigation away from the preview
- Layout shifts from dynamic rendering

### Why two separate AI models?
- **Vision model** (90B) — Needed to "read" the ad creative image and extract text
- **Text model** (8B) — Fast and reliable for CRO copywriting tasks with structured JSON output

### CRO System Prompt Principles
The text model is guided by 6 principles:
1. **Continuity** — Reinforce the ad's exact promise
2. **Subtlety** — Adjust existing copy, don't rewrite from scratch
3. **Specificity** — Use the ad's exact keywords and phrases
4. **Preserve structure** — Keep same length and format
5. **CTA alignment** — Match button text to the ad promise
6. **No hallucination** — Never invent features or claims

---

## ⚠️ Limitations & Assumptions

- Some websites with aggressive anti-bot measures may block the server-side fetch
- Highly JavaScript-dependent pages (SPAs) may not render meaningful HTML via fetch alone
- The vision model works best with clear, text-heavy ad creatives
- Image-heavy ads with minimal text may produce less useful hooks
- Output is a static preview — interactive functionality is intentionally disabled

---

## 📝 License

This project was built as an assessment project.
