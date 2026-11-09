import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { extractResponseText, summarizeAiResponse } from "./ai-text";

export { extractResponseText } from "./ai-text";

// ============================================
// Constants
// ============================================
export const AI_CONFIG = {
    LOCATION: "global",
    MODEL: "gemini-3.1-flash-lite",
    MAX_TOKENS: 2048,
    TEMPERATURE: 0.7,
} as const;

export const SYSTEM_PROMPT = `
You are a warm, wise, and bible-literate companion named "Selah AI".
Your goal is to help the user process their thoughts through the lens of scripture.
- Use the NIV or NLT translation.
- Keep responses pastoral, gentle, and concise (under 150 words).
- If the user is anxious, provide comforting Psalms.
- If the user is happy, provide verses of praise.
- Always end with a short, one-sentence prayer.
`.trim();

export const PLAN_SYSTEM_PROMPT = `
You are a warm, wise, and bible-literate companion named "Selah AI".
Your goal is to create a personalized daily devotional plan based on the user's intention and emotional state.

CRITICAL: Return ONLY valid JSON matching the required schema. No markdown, no backticks, no explanation, no preamble.

Rules:
- Use the NIV or NLT translation.
- Each day should build on the previous — the plan should feel like a journey, not random verses.
- The encouragement should be pastoral, gentle, and directly tied to the verse.
- The plan should be sensitive to the user's initial sentiment and gently guide them toward their intention.
- Encouragement should be concise (under 100 words per day).
- day_number must be sequential starting at 1.
- Return exactly {duration} days in the "days" array.
`.trim();

// ============================================
// Plan Schemas
// ============================================
export const PlanDaySchema = z.object({
    day_number: z.number().int().positive(),
    bible_verse: z.string().min(1),
    verse_content: z.string().min(1),
    encouragement_from_verse: z.string().min(1),
});

export const PlanDaysResponseSchema = z.object({
    days: z.array(PlanDaySchema).min(1),
});

export const PlanSchema = z.array(PlanDaySchema);
export type PlanDay = z.infer<typeof PlanDaySchema>;

function buildPlanResponseJsonSchema(duration: number) {
    return {
        type: "object",
        properties: {
            days: {
                type: "array",
                minItems: duration,
                maxItems: duration,
                items: {
                    type: "object",
                    properties: {
                        day_number: { type: "integer" },
                        bible_verse: { type: "string" },
                        verse_content: { type: "string" },
                        encouragement_from_verse: { type: "string" },
                    },
                    required: [
                        "day_number",
                        "bible_verse",
                        "verse_content",
                        "encouragement_from_verse",
                    ],
                },
            },
        },
        required: ["days"],
    };
}

// ============================================
// Custom Errors
// ============================================
export class AIServiceError extends Error {
    constructor(message: string, public cause?: Error) {
        super(message);
        this.name = "AIServiceError";
    }
}

export class AIQuotaExceededError extends Error {
    constructor() {
        super("AI service quota exceeded");
        this.name = "AIQuotaExceededError";
    }
}

// ============================================
// Service Class
// ============================================
class AIService {
    private client: GoogleGenAI | null = null;

    /**
     * Get or initialize the AI client (singleton pattern)
     */
    private getClient(): GoogleGenAI {
        if (!this.client) {
            logger.info("Initializing Google AI Studio client", {
                model: AI_CONFIG.MODEL,
            });

            this.client = new GoogleGenAI({
                apiKey: env.GEMINI_API_KEY,
            });
        }

        return this.client;
    }

    /**
     * Generate a pastoral response to user message
     */
    async generateResponse(userMessage: string): Promise<string> {
        const client = this.getClient();

        try {
            logger.debug("Generating AI response", {
                messageLength: userMessage.length,
                model: AI_CONFIG.MODEL,
            });

            const response = await client.models.generateContent({
                model: AI_CONFIG.MODEL,
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: SYSTEM_PROMPT },
                            { text: `User's message: ${userMessage}` },
                        ],
                    },
                ],
                config: {
                    maxOutputTokens: AI_CONFIG.MAX_TOKENS,
                    temperature: AI_CONFIG.TEMPERATURE,
                    // Keep chat snappy; thinking eats the output budget on 3.x
                    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
                },
            });

            const text = extractResponseText(response);

            if (!text) {
                logger.error(
                    "AI chat response contained no usable text",
                    new Error("Empty AI response"),
                    {
                        model: AI_CONFIG.MODEL,
                        ...summarizeAiResponse(response),
                    }
                );
                throw new Error("No response text from AI model");
            }

            logger.info("AI response generated successfully", {
                responseLength: text.length,
                finishReason: response.candidates?.[0]?.finishReason,
            });

            return text;
        } catch (error: any) {
            // Log error details for debugging
            logger.error("Google AI Studio request failed", error, {
                model: AI_CONFIG.MODEL,
                messageLength: userMessage.length,
                errorCode: error?.code,
                errorMessage: error?.message,
                errorStatus: error?.status,
            });

            // Check for quota errors
            if (
                error.code === 429 ||
                error.code === "429" ||
                error.status === 429 ||
                error.message?.toLowerCase().includes("quota") ||
                error.message?.toLowerCase().includes("rate limit")
            ) {
                throw new AIQuotaExceededError();
            }

            // Re-throw with generic message
            throw new AIServiceError("Failed to generate response", error);
        }
    }

    /**
     * Generate a structured devotional plan as a JSON array
     */
    async generatePlan(
        sentiment: string,
        intention: string,
        duration: number
    ): Promise<PlanDay[]> {
        const client = this.getClient();

        const prompt = PLAN_SYSTEM_PROMPT.replace(
            "{duration}",
            String(duration)
        );
        const userMessage = `Sentiment: ${sentiment}\nIntention: ${intention}\nDuration: ${duration} days`;
        // Leave headroom for structured JSON; thinking still consumes budget on 3.x
        const maxOutputTokens = Math.min(Math.max(duration * 450, 4096), 16384);

        try {
            logger.info("Generating devotional plan", {
                duration,
                model: AI_CONFIG.MODEL,
                maxOutputTokens,
                sentimentLength: sentiment.length,
                intentionLength: intention.length,
            });

            const response = await client.models.generateContent({
                model: AI_CONFIG.MODEL,
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: prompt },
                            { text: userMessage },
                        ],
                    },
                ],
                config: {
                    maxOutputTokens,
                    temperature: 0.7,
                    responseMimeType: "application/json",
                    responseJsonSchema: buildPlanResponseJsonSchema(duration),
                    // Structured plan generation should not spend the token
                    // budget on thinking summaries.
                    thinkingConfig: {
                        thinkingLevel: ThinkingLevel.MINIMAL,
                    },
                },
            });

            const summary = summarizeAiResponse(response);
            const text = extractResponseText(response);

            if (!text) {
                logger.error(
                    "AI plan response contained no usable text",
                    new Error("Empty AI plan response"),
                    {
                        model: AI_CONFIG.MODEL,
                        duration,
                        ...summary,
                    }
                );
                throw new AIServiceError("No response text from AI model");
            }

            if (summary.finishReason === "MAX_TOKENS") {
                logger.error(
                    "AI plan response truncated by maxOutputTokens",
                    new Error("MAX_TOKENS"),
                    {
                        model: AI_CONFIG.MODEL,
                        duration,
                        maxOutputTokens,
                        ...summary,
                    }
                );
                throw new AIServiceError(
                    "AI plan response was truncated — try a shorter duration"
                );
            }

            // Strip markdown code fences if the model ignores mime type
            const cleanedText = text
                .replace(/^```json\s*/i, "")
                .replace(/^```\s*/i, "")
                .replace(/\s*```$/i, "")
                .trim();

            let parsed: unknown;
            try {
                parsed = JSON.parse(cleanedText);
            } catch (parseError) {
                logger.error(
                    "Failed to parse AI plan response as JSON",
                    parseError,
                    {
                        model: AI_CONFIG.MODEL,
                        duration,
                        ...summary,
                        preview: cleanedText.slice(0, 500),
                    }
                );
                throw new AIServiceError("AI returned invalid plan format");
            }

            const result = PlanDaysResponseSchema.safeParse(parsed);
            if (!result.success) {
                logger.error(
                    "AI plan response failed schema validation",
                    result.error,
                    {
                        model: AI_CONFIG.MODEL,
                        duration,
                        issues: result.error.issues,
                        preview: cleanedText.slice(0, 500),
                    }
                );
                throw new AIServiceError("AI returned invalid plan structure");
            }

            const days = result.data.days;
            if (days.length !== duration) {
                logger.error(
                    "AI plan day count mismatch",
                    new Error(
                        `Expected ${duration} days, got ${days.length}`
                    ),
                    {
                        model: AI_CONFIG.MODEL,
                        duration,
                        daysGenerated: days.length,
                    }
                );
                throw new AIServiceError(
                    `AI returned ${days.length} days instead of ${duration}`
                );
            }

            logger.info("Devotional plan generated successfully", {
                duration,
                daysGenerated: days.length,
                finishReason: summary.finishReason,
                usageMetadata: summary.usageMetadata,
            });

            return days;
        } catch (error: any) {
            // Re-throw our own typed errors without wrapping
            if (
                error instanceof AIServiceError ||
                error instanceof AIQuotaExceededError
            ) {
                throw error;
            }

            logger.error(
                "Google AI Studio plan generation failed",
                error,
                {
                    model: AI_CONFIG.MODEL,
                    duration,
                    errorCode: error?.code,
                    errorMessage: error?.message,
                    errorStatus: error?.status,
                    errorDetails: error?.details,
                }
            );

            if (
                error.code === 429 ||
                error.code === "429" ||
                error.status === 429 ||
                error.message?.toLowerCase().includes("quota") ||
                error.message?.toLowerCase().includes("rate limit")
            ) {
                throw new AIQuotaExceededError();
            }

            throw new AIServiceError("Failed to generate plan", error);
        }
    }

    /**
     * Health check - verify AI service is reachable
     */
    async healthCheck(): Promise<boolean> {
        try {
            const response = await this.generateResponse("Hello");
            return response.length > 0;
        } catch (error) {
            logger.warn("AI service health check failed", { error });
            return false;
        }
    }

    /**
     * Reset client (useful for testing)
     */
    resetClient(): void {
        this.client = null;
    }
}

// ============================================
// Singleton Export
// ============================================
export const aiService = new AIService();
