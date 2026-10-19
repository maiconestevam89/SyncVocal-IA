import { Buffer } from "node:buffer";
import { secrets } from "base44:runtime";

const REGISTRE_URL =
  "https://registrenablockchain.online/api/apps/695ec551ee7f7acd8a6873dc/functions/extractLyricsFromAudio";
const REGISTRE_APP_ID = "695ec551ee7f7acd8a6873dc";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GEMINI_MODEL = "google/gemini-2.5-flash";

const FALLBACK_PROMPT = `Transcreva a letra deste áudio musical com máxima fidelidade às palavras cantadas.
Organize a letra em estrofes com versos, incluindo rótulos de seção entre colchetes em português: [Verso], [Refrão], [Ponte], etc.
NÃO invente palavras ou rimas que não estejam no áudio.
Retorne APENAS a letra organizada, sem introdução ou comentários adicionais.`;

export async function transcribeAudioUrl(audioUrl: string): Promise<string> {
  // 1. Tenta transcrição via endpoint especializado MusicRegister
  try {
    const res = await fetch(REGISTRE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Id": REGISTRE_APP_ID,
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify({ audioUrl }),
      signal: AbortSignal.timeout(60000),
    });

    if (res.ok) {
      const data = await res.json();
      const lyrics = String(data.lyrics || data.text || "").trim();
      if (lyrics) return lyrics;
    }
  } catch (err: any) {
    console.warn("MusicRegister falhou, usando fallback Gemini:", err.message);
  }

  // 2. Fallback Gemini via OpenRouter
  const openRouterKey = secrets.get("OPENROUTER_API_KEY") || process.env["OPENROUTER_API_KEY"];
  if (openRouterKey) {
    try {
      const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(60000) });
      if (!audioRes.ok) throw new Error(`Falha ao baixar áudio (${audioRes.status})`);
      const arrayBuffer = await audioRes.arrayBuffer();
      const base64Data = Buffer.from(arrayBuffer).toString("base64");

      let format = "mp3";
      const lowerUrl = audioUrl.toLowerCase();
      if (lowerUrl.includes(".wav")) format = "wav";
      else if (lowerUrl.includes(".m4a")) format = "m4a";
      else if (lowerUrl.includes(".ogg")) format = "ogg";

      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: FALLBACK_PROMPT },
                {
                  type: "input_audio",
                  input_audio: {
                    data: base64Data,
                    format,
                  },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      }
    } catch (err: any) {
      console.warn("Fallback Gemini falhou:", err.message);
    }
  }

  return "Música Autoral - Letra em Produção";
}
