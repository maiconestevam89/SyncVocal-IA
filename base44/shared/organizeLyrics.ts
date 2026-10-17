export async function organizeLyricsWithLLM(base44: any, transcript: string): Promise<string> {
  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `Você é um editor profissional de letras musicais em português brasileiro.
Receba a transcrição de um áudio musical cantado e organize-a em seções musicais profissionais ([Verso], [Refrão], [Ponte], etc.), corrigindo eventuais pontuações e erros de português.

REGRAS OBRIGATÓRIAS:
1. Identifique as seções musicais e rotule-as entre colchetes em português: [Verso], [Verso 1], [Verso 2], [Refrão], [Pré-Refrão], [Ponte], [Outro].
2. Corrija a ortografia e pontuação sem alterar o sentido do que foi cantado.
3. Não invente versos que não existam na transcrição.
4. Retorne apenas a letra formatada.

Transcrição:
"""
${transcript}
"""`,
      response_json_schema: {
        type: "object",
        properties: {
          lyrics: { type: "string" },
        },
        required: ["lyrics"],
      },
    });

    return (result?.lyrics || "").trim() || transcript.trim();
  } catch (err) {
    return transcript.trim();
  }
}

export async function generateMusicalPrompt(base44: any, inputStyle: string): Promise<string> {
  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are an expert music producer. Convert the following musical style or genre into a rich, detailed English music production prompt optimized for Suno AI.

CRITICAL RULE: NEVER include BPM values, numeric tempo indicators, or numbers (e.g. NEVER write "120 BPM", "tempo: 100", "95 bpm"). Describe tempo using expressive musical words (e.g., "energetic driving rhythm", "warm acoustic groove", "slow emotional ballad", "danceable pop beat").

Input style: "${inputStyle}"

Return a prompt describing:
- Genre, instrumentation, energy, and atmosphere.
- Return ONLY the prompt text, max 190 characters.`,
      response_json_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
        },
        required: ["prompt"],
      },
    });

    return (result?.prompt || "").trim() || `${inputStyle}, professional studio production, emotional vocal, rich acoustic instruments`;
  } catch (err) {
    return `${inputStyle}, modern studio sound, acoustic instruments, radio ready`;
  }
}
