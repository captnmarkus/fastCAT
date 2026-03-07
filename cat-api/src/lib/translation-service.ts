import {
  callGatewayChatCompletion,
  normalizeGatewayMessageContent,
  resolveEnabledGatewayProvider
} from "./llm-gateway.js";
import { formatLanguageNameForPrompt } from "./translation-prompt.js";

export class TranslationServiceError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export async function translateSnippetWithService(params: {
  text: string;
  sourceLang?: string;
  targetLang: string;
  tone?: string;
  traceId?: string;
}): Promise<{
  translation: string;
  detectedLang?: string | null;
  notes?: string | null;
}> {
  const text = String(params.text || "").trim();
  const targetLang = String(params.targetLang || "").trim();
  const sourceLang = params.sourceLang ? String(params.sourceLang).trim() : "";
  const tone = params.tone ? String(params.tone).trim() : "";
  const sourceLanguageName = sourceLang ? formatLanguageNameForPrompt(sourceLang) || sourceLang : "";
  const targetLanguageName = formatLanguageNameForPrompt(targetLang) || targetLang;

  if (!text) {
    throw new TranslationServiceError("Translation text is required.");
  }
  if (!targetLang) {
    throw new TranslationServiceError("Target language is required.");
  }

  const provider = await resolveEnabledGatewayProvider();
  if (!provider) {
    throw new TranslationServiceError(
      "Translation service is not configured yet. Configure an enabled provider first."
    );
  }

  const stylePrompt = tone ? `Keep tone: ${tone}.` : "Keep the original tone.";
  const sourceHint = sourceLang ? `Source language: ${sourceLanguageName}.` : "Detect the source language.";
  const userPrompt = [
    sourceHint,
    `Target language: ${targetLanguageName}.`,
    stylePrompt,
    "Return only the translated text.",
    `Text: """${text}"""`
  ].join("\n");

  const message = await callGatewayChatCompletion({
    provider,
    messages: [
      {
        role: "system",
        content: "You are a translation engine."
      },
      {
        role: "user",
        content: userPrompt
      }
    ],
    temperature: 0.2,
    maxTokens: 800,
    traceId: params.traceId
  });

  const translation = normalizeGatewayMessageContent(message?.content).trim();
  if (!translation) {
    throw new TranslationServiceError("Translation service returned an empty result.");
  }

  return {
    translation,
    detectedLang: sourceLang || null,
    notes: tone ? `tone=${tone}` : null
  };
}
