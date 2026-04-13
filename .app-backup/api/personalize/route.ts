import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import OpenAI from 'openai';

// Initialize OpenAI SDK to use NVIDIA's API
const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

export async function POST(req: Request) {
  try {
    const { url, adCopy } = await req.json();

    if (!url || !adCopy) {
      return NextResponse.json(
        { error: 'Missing url or adCopy' },
        { status: 400 }
      );
    }

    // 1. Fetch the target landing page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI-Personalization-Bot',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch the target URL' },
        { status: 500 }
      );
    }

    const html = await response.text();

    // 2. Parse HTML with cheerio
    const $ = cheerio.load(html);

    // 3. Extract text elements (h1, h2, h3, title)
    // We assign a data attribute to keep track of them
    const extractedElements: Record<string, string> = {};
    const tagsToTarget = ['h1', 'h2', 'h3', 'title'];
    
    let idCounter = 1;

    tagsToTarget.forEach(tag => {
      $(tag).each((_, element) => {
        const text = $(element).text().trim();
        // Only target elements that have meaningful text (longer than 5 chars, less than 200)
        if (text && text.length > 5 && text.length < 200) {
          const id = `engine-id-${idCounter++}`;
          $(element).attr('data-personalize-id', id);
          extractedElements[id] = text;
        }
      });
    });

    // If nothing found to personalize
    if (Object.keys(extractedElements).length === 0) {
      // Just return the original HTML with a base tag so it renders properly
      $('head').prepend(`<base href="${new URL(url).origin}">`);
      return NextResponse.json({
        html: $.html(),
        message: 'No suitable text elements found to personalize.',
      });
    }

    // 4. Send to NVIDIA LLM for personalization
    // Limit to meta/llama-3.1-8b-instruct or 70b-instruct
    const prompt = `You are an expert copywriter specializing in Conversion Rate Optimization (CRO) and Message Match. 
    
Ad Hook / Creative Copy: "${adCopy}"

Your task is to take the following text elements from a landing page and rewrite them to perfectly match the Ad Hook provided above. Keep the original formatting intent and roughly the same length. Keep the tone professional but persuasive. Provide your output STRICTLY as a JSON object where keys are the specific IDs and values are your rewritten texts.

Original Elements (JSON format):
${JSON.stringify(extractedElements, null, 2)}

Return ONLY valid JSON. No markdown, no explanations.`;

    const completion = await openai.chat.completions.create({
      model: "meta/llama-3.1-8b-instruct",
      temperature: 0.2,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const outputContent = completion.choices[0]?.message?.content || '{}';
    
    // Parse the JSON safely (accounting for possible markdown wrappers if the model hallucinates them)
    let parsedData = {};
    try {
      const cleanJsonStr = outputContent.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsedData = JSON.parse(cleanJsonStr);
    } catch (e) {
      console.error('Failed to parse LLM JSON output:', outputContent);
      // Fallback: return un-personalized if parsing fails
      parsedData = {};
    }

    // 5. Re-inject modified texts
    for (const [id, originalText] of Object.entries(extractedElements)) {
      const personalizedText = (parsedData as Record<string, string>)[id];
      if (personalizedText) {
        $(`[data-personalize-id="${id}"]`).text(personalizedText);
      }
      // Remove the marker attribute to keep HTML clean
      $(`[data-personalize-id="${id}"]`).removeAttr('data-personalize-id');
    }

    // 6. Inject base href so relative links don't break
    const baseUrl = new URL(url);
    const baseHref = `\${baseUrl.protocol}//\${baseUrl.host}`;
    $('head').prepend(`<base href="\${baseHref}">`);

    // Add a small script to override any navigation so it stays inside iframe nicely (optional, but good for demo)
    $('body').append(`
      <script>
        document.querySelectorAll('a').forEach(a => {
          if(!a.getAttribute('target')) {
            a.setAttribute('target', '_top');
          }
        });
      </script>
    `);

    // 7. Return modified HTML
    return NextResponse.json({
      html: $.html(),
      message: 'Personalization successful',
    });

  } catch (error: any) {
    console.error('Error during personalization:', error);
    return NextResponse.json(
      { error: error?.message || 'An internal error occurred.' },
      { status: 500 }
    );
  }
}
