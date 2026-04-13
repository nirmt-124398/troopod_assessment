"use client";

import { useState, useRef } from "react";

/**
 * Compresses an image File to a JPEG data URI, scaled so neither dimension
 * exceeds `maxPx` pixels. NVIDIA vision API struggles with large payloads.
 */
async function compressImage(file: File, maxPx = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        const scale = Math.min(maxPx / width, maxPx / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not supported")); return; }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Failed to load image")); };
    img.src = objectUrl;
  });
}

type InputMode = "link" | "upload";

export default function Home() {
  const [inputMode, setInputMode] = useState<InputMode>("link");
  const [adCreativeUrl, setAdCreativeUrl] = useState("");
  const [adCreativeFile, setAdCreativeFile] = useState<File | null>(null);
  const [adPreview, setAdPreview] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAdCreativeFile(file);
      const reader = new FileReader();
      reader.onload = () => setAdPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleLinkBlur = () => {
    if (adCreativeUrl) {
      setAdPreview(adCreativeUrl);
    }
  };

  const clearFile = () => {
    setAdCreativeFile(null);
    setAdPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isReady = () => {
    if (!url) return false;
    if (inputMode === "link" && !adCreativeUrl) return false;
    if (inputMode === "upload" && !adCreativeFile) return false;
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isReady()) return;

    setLoading(true);
    setError(null);
    setHtmlContent(null);

    try {
      let body: any = { url };

      if (inputMode === "link") {
        body.adCreativeUrl = adCreativeUrl;
      } else if (inputMode === "upload" && adCreativeFile) {
        // Guard: reject obviously huge source files (> 15 MB) before compression
        if (adCreativeFile.size > 15 * 1024 * 1024) {
          throw new Error("Image is too large (max 15 MB). Please use a smaller file.");
        }
        // Compress image to max 1024px / JPEG 80% — keeps base64 payload manageable
        const compressed = await compressImage(adCreativeFile, 1024, 0.8);
        body.adCreativeBase64 = compressed;
      }

      const res = await fetch("/api/personalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to personalize the page.");
      }

      setHtmlContent(data.html);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-gray-50 flex-col md:flex-row overflow-hidden">
      {/* Sidebar for Inputs */}
      <div className="w-full md:w-[380px] xl:w-[420px] bg-white shadow-xl flex flex-col p-8 z-10 overflow-y-auto shrink-0">
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">
            AI Ad <span className="text-blue-600">Match</span>
          </h1>
          <p className="text-gray-500 text-sm mt-2">
            Upload or link an ad creative and a landing page URL — the AI will personalize the page to match the ad.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-grow space-y-5">
          {/* Ad Creative Input */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-gray-700">Ad Creative</label>

            {/* Toggle: Link / Upload */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                type="button"
                onClick={() => { setInputMode("link"); clearFile(); }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                  inputMode === "link"
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                🔗 Link
              </button>
              <button
                type="button"
                onClick={() => { setInputMode("upload"); setAdCreativeUrl(""); setAdPreview(null); }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                  inputMode === "upload"
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                📁 Upload
              </button>
            </div>

            {/* Link Input */}
            {inputMode === "link" && (
              <input
                type="url"
                placeholder="https://example.com/ad-image.png"
                value={adCreativeUrl}
                onChange={(e) => setAdCreativeUrl(e.target.value)}
                onBlur={handleLinkBlur}
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none text-sm text-black"
                required
              />
            )}

            {/* Upload Input */}
            {inputMode === "upload" && (
              <div className="relative">
                {!adCreativeFile ? (
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all">
                    <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm text-gray-500">Click to upload ad image</span>
                    <span className="text-xs text-gray-400 mt-1">PNG, JPG, WEBP up to 15 MB (auto-compressed)</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                ) : (
                  <div className="relative border border-gray-200 rounded-lg p-2">
                    <button
                      type="button"
                      onClick={clearFile}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600 transition-colors shadow-md z-10"
                    >
                      ✕
                    </button>
                    <p className="text-xs text-gray-500 truncate">{adCreativeFile.name}</p>
                  </div>
                )}
              </div>
            )}

            {/* Ad Preview Thumbnail */}
            {adPreview && (
              <div className="rounded-lg overflow-hidden border border-gray-100 shadow-sm">
                <img
                  src={adPreview}
                  alt="Ad Creative Preview"
                  className="w-full h-36 object-contain bg-gray-50"
                  onError={() => setAdPreview(null)}
                />
              </div>
            )}
          </div>

          {/* Landing Page URL */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700">Target Landing Page URL</label>
            <input
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none text-sm text-black"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm border border-red-200 space-y-1">
              <p className="font-semibold">⚠ Error</p>
              <p>{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !isReady()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold py-4 rounded-lg shadow-md transition-all hover:shadow-lg focus:ring-4 focus:ring-blue-100 flex justify-center items-center mt-auto"
          >
            {loading ? (
              <span className="flex items-center space-x-2">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Personalizing...
              </span>
            ) : (
              "Generate Personalized Page"
            )}
          </button>
        </form>
      </div>

      {/* Main Content Area for Demo */}
      <div className="flex-grow bg-[#E5E7EB] relative flex flex-col items-center justify-center overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center space-y-4 animate-pulse duration-1000">
            <div className="h-16 w-16 bg-blue-500 rounded-full flex items-center justify-center animate-bounce">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            </div>
            <p className="text-gray-500 font-medium tracking-wide">Analyzing ad creative & rewriting page...</p>
          </div>
        ) : htmlContent ? (
          <div className="w-full h-full bg-white shadow-2xl relative">
            <div className="absolute top-0 w-full h-10 bg-gray-100 border-b flex items-center px-4 rounded-t-lg z-20">
              <div className="flex space-x-2">
                <div className="w-3 h-3 rounded-full bg-red-400"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                <div className="w-3 h-3 rounded-full bg-green-400"></div>
              </div>
              <div className="mx-auto flex items-center bg-white px-3 py-1 rounded-md border text-xs text-gray-500 w-1/2 justify-center shadow-sm truncate">
                <span className="text-green-600 mr-2 opacity-80">🔒</span> {url} <span className="ml-2 text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">Personalized</span>
              </div>
            </div>
            <iframe
              title="Personalized Output"
              srcDoc={htmlContent}
              className="w-full h-full pt-10 border-none bg-white block"
              sandbox="allow-same-origin allow-scripts allow-popups"
            />
          </div>
        ) : (
          <div className="text-center max-w-sm px-6">
            <div className="w-20 h-20 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center mx-auto mb-6 transform -rotate-6 transition-transform hover:rotate-0">
              <span className="text-4xl text-blue-500">✨</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Live Preview</h2>
            <p className="text-gray-500">Your personalized landing page will appear here. Provide an ad creative and target URL to begin.</p>
          </div>
        )}
      </div>
    </div>
  );
}
