/**
 * Gemini 3.x thinking models may return thought / signature parts first.
 * Prefer the SDK helper, then fall back to non-thought text parts.
 */
export function extractResponseText(response: {
    text?: string;
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string; thought?: boolean }>;
        };
        finishReason?: string;
    }>;
}): string | undefined {
    if (typeof response.text === "string" && response.text.trim().length > 0) {
        return response.text;
    }

    const parts = response.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts) || parts.length === 0) {
        return undefined;
    }

    const text = parts
        .filter((part) => Boolean(part.text) && part.thought !== true)
        .map((part) => part.text as string)
        .join("")
        .trim();

    return text.length > 0 ? text : undefined;
}

export function summarizeAiResponse(response: {
    text?: string;
    candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        finishReason?: string;
    }>;
    usageMetadata?: Record<string, unknown>;
}) {
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    return {
        finishReason: response.candidates?.[0]?.finishReason,
        partCount: parts.length,
        thoughtPartCount: parts.filter((p) => p.thought === true).length,
        textPartCount: parts.filter((p) => Boolean(p.text) && !p.thought)
            .length,
        usageMetadata: response.usageMetadata,
        preview: extractResponseText(response)?.slice(0, 300),
    };
}
