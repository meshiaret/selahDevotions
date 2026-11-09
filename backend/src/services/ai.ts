import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

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

CRITICAL: Return ONLY a valid JSON array. No markdown, no backticks, no explanation, no preamble. Just the raw JSON array.

Rules:
- Use the NIV or NLT translation.
- Each day should build on the previous — the plan should feel like a journey, not random verses.
- The encouragement should be pastoral, gentle, and directly tied to the verse.
- The plan should be sensitive to the user's initial sentiment and gently guide them toward their intention.
- Encouragement should be concise (under 100 words per day).

Return an array of exactly {duration} objects in this exact shape:
[
  {
    "day_number": 1,
    "bible_verse": "John 3:16",
    "verse_content": "For God so loved the world...",
    "encouragement_from_verse": "..."
  }
]
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

export const PlanSchema = z.array(PlanDaySchema);
export type PlanDay = z.infer<typeof PlanDaySchema>;

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
                },
            });

            const text = response.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!text) {
                throw new Error("No response text from AI model");
            }

            logger.info("AI response generated successfully", {
                responseLength: text.length,
            });

            return text;
        } catch (error: any) {
            // Log error details for debugging
            logger.error("Google AI Studio request failed", error, {
                model: AI_CONFIG.MODEL,
                messageLength: userMessage.length,
                errorCode: error.code,
                errorMessage: error.message,
            });

            // Check for quota errors
            if (
                error.code === 429 ||
                error.code === "429" ||
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
        const userMessage = `Sentiment: ${sentiment}\nIntention: ${intention}`;

        try {
            logger.debug("Generating devotional plan", {
                duration,
                model: AI_CONFIG.MODEL,
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
                    maxOutputTokens: Math.min(duration * 300, 8192),
                    temperature: 0.9,
                },
            });

            const text =
                response.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!text) {
                throw new Error("No response text from AI model");
            }

            // Strip markdown code fences if Gemini wraps the JSON
            const cleanedText = text
                .replace(/^```json\s*/i, "")
                .replace(/^```\s*/i, "")
                .replace(/\s*```$/i, "")
                .trim();

            let parsed: unknown;
            try {
                parsed = JSON.parse(cleanedText);
            } catch {
                logger.error(
                    "Failed to parse AI plan response as JSON",
                    new Error("JSON parse failure"),
                    { preview: cleanedText.slice(0, 200) }
                );
                throw new AIServiceError(
                    "AI returned invalid plan format"
                );
            }

            const result = PlanSchema.safeParse(parsed);
            if (!result.success) {
                logger.error(
                    "AI plan response failed schema validation",
                    new Error(String(result.error)),
                    { preview: cleanedText.slice(0, 200) }
                );
                throw new AIServiceError(
                    "AI returned invalid plan structure"
                );
            }

            logger.info("Devotional plan generated successfully", {
                duration,
                daysGenerated: result.data.length,
            });

            return result.data;
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
                    errorCode: error.code,
                    errorMessage: error.message,
                }
            );

            if (
                error.code === 429 ||
                error.code === "429" ||
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
