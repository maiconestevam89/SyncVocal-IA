import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { styleSelection, voiceTranscription } = body;

    const input = voiceTranscription || styleSelection;
    if (!input || !input.trim()) {
      return Response.json({ error: "Seleção de estilo é obrigatória" }, { status: 400 });
    }

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are a music production expert. Convert the following musical style description into a technical prompt optimized for the Suno AI music generation API, written in English.

CRITICAL RULE: NEVER include BPM values or numeric tempo indicators (e.g., never write "120 BPM", "140 BPM", "BPM: 90", "tempo: 100"). Describe tempo and rhythm exclusively with musical adjectives and terms (e.g., "fast-paced acoustic guitar", "slow emotional ballad", "driving rhythm", "upbeat dance tempo", "gentle swaying pace").

Input: "${input}"

Generate a detailed, professional music production prompt in English that describes:
- Genre and subgenre
- Key instruments and instrumentation
- Mood and emotional quality
- Rhythm and tempo (using descriptive adjectives, NEVER BPM numbers)
- Production quality and style
- Vocal characteristics if applicable

Return ONLY the prompt text, no additional commentary.`,
      response_json_schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
        },
        required: ["prompt"],
      },
    });

    return Response.json({ prompt: result.prompt });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
