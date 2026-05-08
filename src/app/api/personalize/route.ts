import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import OpenAI from 'openai';

// Initialize OpenAI SDK pointed at NVIDIA's API
const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

/**
 * Converts an image URL to a base64 data URI by fetching it server-side.
 * NVIDIA vision API only accepts base64, not external URLs.
 * 
 * Handles anti-bot protections (Amazon, etc.) with multiple retry strategies.
 */
async function urlToBase64(imageUrl: string): Promise<string> {
  // Strategy 1: Try with standard browser headers first
  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/png,image/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.amazon.com/',
  };

  let res = await fetch(imageUrl, { headers: browserHeaders });
  
  // If 403, try curl-based fallback (Node.js exec)
  if (!res.ok && res.status === 403) {
    console.log('[Engine] 403 on fetch, trying curl fallback...');
    const { execSync } = await import('child_process');
    
    try {
      // Use curl with cookie jar and better simulation
      const curlCmd = [
        'curl',
        '-s',
        '-L',
        '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-H', 'Accept: image/png,image/webp,image/*;q=0.8',
        '-H', 'Accept-Language: en-US,en;q=0.9',
        '-H', 'Referer: https://www.amazon.com/',
        '-H', 'Sec-Fetch-Dest: image',
        '-H', 'Sec-Fetch-Mode: no-cors',
        '-H', 'Sec-Fetch-Site: same-origin',
        imageUrl
      ].join(' ');
      
      const buffer = execSync(curlCmd, { encoding: null, maxBuffer: 10 * 1024 * 1024 }); // 10MB max
      
      if (buffer && buffer.length > 0) {
        // Detect content type from curl output
        let contentType = 'image/png';
        if (buffer[0] === 0xFF && buffer[1] === 0xD8) contentType = 'image/jpeg';
        else if (buffer[0] === 0x89 && buffer[1] === 0x50) contentType = 'image/png';
        else if (buffer[0] === 0x47 && buffer[1] === 0x49) contentType = 'image/gif';
        else if (buffer[0] === 0x52 && buffer[1] === 0x49) contentType = 'image/webp';
        
        const base64 = Buffer.from(buffer).toString('base64');
        console.log('[Engine] curl fallback succeeded, got', buffer.length, 'bytes');
        return `data:${contentType};base64,${base64}`;
      }
    } catch (curlErr: any) {
      console.error('[Engine] curl fallback failed:', curlErr.message);
    }
  }
  
  if (!res.ok) {
    throw new Error(`Failed to fetch ad creative image (status ${res.status}). The image host may be blocking automated requests. Try downloading the image manually and uploading it instead.`);
  }
  
  const contentType = res.headers.get('content-type') || 'image/png';
  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return `data:${contentType};base64,${base64}`;
}

/**
 * Uses NVIDIA vision model to extract the ad hook / headline from a creative image.
 */
async function extractAdHook(imageDataUri: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: 'meta/llama-3.2-90b-vision-instruct',
    temperature: 0.1,
    max_tokens: 300,
    messages: [
      {
        role: 'system',
        content: `You are an expert ad-copy analyst. Your sole job is to read advertising images and extract the exact primary headline, hook, or call-to-action text from them. Be precise and literal — extract the words you SEE in the image. If there are multiple lines of text, combine them into one cohesive hook. Output nothing else.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageDataUri },
          },
          {
            type: 'text',
            text: 'Extract the primary ad hook / headline / CTA from this ad creative. Return ONLY the extracted text, nothing else.',
          },
        ],
      },
    ],
  });

  const hook = completion.choices[0]?.message?.content?.trim() || '';
  if (!hook) {
    throw new Error('Vision model returned empty result. Try a clearer ad image.');
  }
  console.log('[Engine] Vision extracted hook:', hook);
  return hook;
}

/**
 * Resolve all relative URLs to absolute using the page origin.
 * Handles img src, srcset, link href, video/source src, poster, etc.
 */
function resolveUrls($: cheerio.CheerioAPI, origin: string) {
  // Fix images
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !src.startsWith('http') && !src.startsWith('data:')) {
      $(el).attr('src', new URL(src, origin).href);
    }
    // Fix srcset
    const srcset = $(el).attr('srcset');
    if (srcset) {
      const fixed = srcset.split(',').map(entry => {
        const parts = entry.trim().split(/\s+/);
        if (parts[0] && !parts[0].startsWith('http') && !parts[0].startsWith('data:')) {
          parts[0] = new URL(parts[0], origin).href;
        }
        return parts.join(' ');
      }).join(', ');
      $(el).attr('srcset', fixed);
    }
    // Fix data-src (lazy loading)
    const dataSrc = $(el).attr('data-src');
    if (dataSrc && !dataSrc.startsWith('http') && !dataSrc.startsWith('data:')) {
      $(el).attr('data-src', new URL(dataSrc, origin).href);
      // Also set src directly so the image actually loads without JS
      if (!src || src.includes('placeholder') || src.includes('data:image/gif') || src.includes('1x1')) {
        $(el).attr('src', new URL(dataSrc, origin).href);
      }
    }
    // Ensure images don't break layout
    $(el).css('max-width', '100%');
    $(el).css('height', 'auto');
  });

  // Fix CSS link hrefs
  $('link[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && !href.startsWith('http') && !href.startsWith('data:') && !href.startsWith('//')) {
      $(el).attr('href', new URL(href, origin).href);
    }
  });

  // Fix background images in inline styles
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    if (style.includes('url(')) {
      const fixed = style.replace(/url\(['"]?(?!https?:\/\/|data:)([^'")]+)['"]?\)/g, (match, path) => {
        try {
          return `url('${new URL(path, origin).href}')`;
        } catch {
          return match;
        }
      });
      $(el).attr('style', fixed);
    }
  });

  // Fix video/source/poster
  $('video, source, audio').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !src.startsWith('http') && !src.startsWith('data:')) {
      $(el).attr('src', new URL(src, origin).href);
    }
    const poster = $(el).attr('poster');
    if (poster && !poster.startsWith('http') && !poster.startsWith('data:')) {
      $(el).attr('poster', new URL(poster, origin).href);
    }
  });

  // Fix favicon
  $('link[rel*="icon"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && !href.startsWith('http') && !href.startsWith('data:')) {
      $(el).attr('href', new URL(href, origin).href);
    }
  });
}

export async function POST(req: Request) {
  try {
    const { url, adCreativeUrl, adCreativeBase64 } = await req.json();

    if (!url) {
      return NextResponse.json(
        { error: 'Missing landing page URL.' },
        { status: 400 }
      );
    }
    if (!adCreativeUrl && !adCreativeBase64) {
      return NextResponse.json(
        { error: 'Missing ad creative. Provide a link or upload an image.' },
        { status: 400 }
      );
    }

    // --- Step 1: Get a base64 data URI for the vision model ---
    let imageDataUri: string;
    if (adCreativeBase64) {
      // Guard: NVIDIA vision API has a ~2 MB base64 payload limit
      const approxBytes = adCreativeBase64.length * 0.75; // base64 → bytes approximation
      if (approxBytes > 2 * 1024 * 1024) {
        return NextResponse.json(
          { error: 'Ad image is too large for the vision model (max ~2 MB after encoding). Please use a smaller or compressed image.' },
          { status: 400 }
        );
      }
      imageDataUri = adCreativeBase64;
    } else {
      console.log('[Engine] Fetching ad image from URL...');
      imageDataUri = await urlToBase64(adCreativeUrl);
    }

    // --- Step 2: Extract the ad hook via NVIDIA vision model ---
    console.log('[Engine] Analyzing ad creative with vision model...');
    let adCopy: string;
    try {
      adCopy = await extractAdHook(imageDataUri);
    } catch (visionErr: any) {
      const msg = visionErr?.message || String(visionErr);
      // Provide a user-friendly message for NVIDIA's opaque 400
      if (msg.includes('400') || msg.toLowerCase().includes('bad request')) {
        return NextResponse.json(
          { error: 'The vision model rejected the image (400). This usually means the image is still too large or in an unsupported format. Try a smaller JPEG image (under 1 MB).' },
          { status: 400 }
        );
      }
      throw visionErr; // Re-throw for the outer catch to handle
    }

    // --- Step 3: Fetch the target landing page ---
    console.log('[Engine] Fetching landing page:', url);
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch the landing page (status ${response.status}).` },
        { status: 500 }
      );
    }

    const html = await response.text();

    // --- Step 4: Parse HTML, fix assets, make static ---
    const $ = cheerio.load(html);
    const origin = `${new URL(url).protocol}//${new URL(url).host}`;

    // Inject base tag first
    $('base').remove(); // Remove existing base tags
    $('head').prepend(`<base href="${origin}/">`);

    // Resolve all relative URLs to absolute so images/CSS load correctly
    resolveUrls($, origin);

    // Remove scripts (static preview — no JS needed)
    $('script').remove();
    $('noscript').each((_, el) => {
      // Unwrap noscript to show lazy-loaded images that were hidden behind JS
      const content = $(el).html();
      if (content) $(el).replaceWith(content);
    });

    // Disable forms
    $('form').attr('onsubmit', 'return false;');

    // --- Step 5: Extract text elements to personalize ---
    const extractedElements: Record<string, { tag: string; text: string }> = {};
    const tagsToTarget = ['title', 'h1', 'h2', 'h3', 'h4'];
    let idCounter = 1;

    tagsToTarget.forEach((tag) => {
      $(tag).each((_, element) => {
        const text = $(element).text().trim();
        if (text && text.length > 3 && text.length < 300) {
          const id = `pe-${idCounter++}`;
          $(element).attr('data-pe-id', id);
          extractedElements[id] = { tag, text };
        }
      });
    });

    // Also extract prominent paragraph text and button/CTA text
    $('p').each((_, element) => {
      const text = $(element).text().trim();
      // Only grab short, punchy paragraphs (likely sub-headlines or value props)
      if (text && text.length > 15 && text.length < 150) {
        const id = `pe-${idCounter++}`;
        $(element).attr('data-pe-id', id);
        extractedElements[id] = { tag: 'p', text };
      }
    });

    // Extract CTA button text
    $('a, button').each((_, element) => {
      const text = $(element).text().trim();
      if (text && text.length > 2 && text.length < 40) {
        // Only grab things that look like CTAs
        const lc = text.toLowerCase();
        if (lc.includes('get') || lc.includes('start') || lc.includes('try') ||
            lc.includes('sign') || lc.includes('learn') || lc.includes('buy') ||
            lc.includes('shop') || lc.includes('free') || lc.includes('download') ||
            lc.includes('join') || lc.includes('subscribe') || lc.includes('contact') ||
            lc.includes('book') || lc.includes('demo') || lc.includes('request')) {
          const id = `pe-${idCounter++}`;
          $(element).attr('data-pe-id', id);
          extractedElements[id] = { tag: 'cta', text };
        }
      }
    });

    // Cap at 20 elements max to keep LLM response reliable
    const elementIds = Object.keys(extractedElements).slice(0, 20);
    const cappedElements: Record<string, string> = {};
    for (const id of elementIds) {
      cappedElements[id] = extractedElements[id].text;
    }

    if (elementIds.length === 0) {
      return NextResponse.json({
        html: $.html(),
        extractedHook: adCopy,
        message: 'No suitable text elements found to personalize.',
      });
    }

    console.log('[Engine] Found', elementIds.length, 'elements to personalize');

    // --- Step 6: Rewrite extracted text using NVIDIA text model ---
    const systemPrompt = `You are a world-class CRO (Conversion Rate Optimization) copywriter who specializes in "Message Match" — the practice of aligning landing page copy with the specific ad that brought the visitor there.

Your guiding principles:
1. CONTINUITY: The visitor just saw an ad with a specific promise. Your job is to reinforce that exact promise the moment they land.
2. SUBTLETY: You are NOT rewriting the entire page for a different product. You are adjusting the existing copy so it echoes the ad's language, keywords, and emotional tone.
3. SPECIFICITY: Replace generic language with specific language from the ad hook. If the ad says "for marketing agencies", use that phrase instead of "for teams".
4. PRESERVE STRUCTURE: Keep roughly the same sentence length, formatting intent, and information hierarchy. A short heading stays short. A long paragraph stays roughly the same length.
5. CTA ALIGNMENT: If there are call-to-action buttons, make them echo the ad's promise (e.g., if the ad says "Free trial", the CTA should say "Start Your Free Trial" not "Learn More").
6. NO HALLUCINATION: Do not invent features, prices, or claims that weren't implied by either the original page or the ad hook.`;

    const userPrompt = `AD HOOK (extracted from the ad creative):
"${adCopy}"

ORIGINAL PAGE ELEMENTS (JSON — keys are element IDs, values are original text):
${JSON.stringify(cappedElements, null, 2)}

Rewrite each element to create message match with the ad hook above. Return ONLY a valid JSON object with the same keys and your rewritten text values. No markdown fences, no explanations.`;

    const completion = await openai.chat.completions.create({
      model: 'meta/llama-3.1-8b-instruct',
      temperature: 0.3,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const rawOutput = completion.choices[0]?.message?.content || '{}';
    console.log('[Engine] LLM raw output:', rawOutput.substring(0, 300));

    // Parse LLM response
    let rewritten: Record<string, string> = {};
    try {
      const cleaned = rawOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
      rewritten = JSON.parse(cleaned);
    } catch (e) {
      console.error('[Engine] Failed to parse LLM JSON:', rawOutput);
      rewritten = {};
    }

    // --- Step 7: Inject rewritten text back ---
    let changesApplied = 0;
    for (const id of elementIds) {
      const newText = rewritten[id];
      if (newText && newText !== cappedElements[id]) {
        $(`[data-pe-id="${id}"]`).text(newText);
        changesApplied++;
      }
      $(`[data-pe-id="${id}"]`).removeAttr('data-pe-id');
    }
    // Clean up any remaining markers
    $('[data-pe-id]').removeAttr('data-pe-id');

    console.log('[Engine] Applied', changesApplied, '/', elementIds.length, 'text changes');

    // Make links non-navigable for static preview
    $('a').removeAttr('href');
    $('a').css('cursor', 'default');

    // Add personalization info banner
    const hookPreview = adCopy.length > 100 ? adCopy.substring(0, 100) + '...' : adCopy;
    $('body').prepend(`
      <div style="background: linear-gradient(135deg, #1e3a8a, #7c3aed); color: white; padding: 10px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 13px; text-align: center; position: sticky; top: 0; z-index: 99999; letter-spacing: 0.3px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
        ✨ <strong>AI Personalized</strong> — Ad Hook: "${hookPreview}" &nbsp;|&nbsp; ${changesApplied} element(s) rewritten for message match
      </div>
    `);

    return NextResponse.json({
      html: $.html(),
      extractedHook: adCopy,
      changesApplied,
      totalElements: elementIds.length,
      message: 'Personalization successful',
    });
  } catch (error: any) {
    const msg: string = error?.message || String(error) || 'An internal error occurred.';
    console.error('[Engine] Error:', msg);
    // Surface NVIDIA 400s as 400 to the client (not 500) so the UI shows them clearly
    const status = (msg.includes('400') || msg.toLowerCase().includes('bad request')) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
