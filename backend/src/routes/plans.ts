import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../lib/logger";
import {
    aiService,
    AIQuotaExceededError,
    AIServiceError,
} from "../services/ai";
import { rateLimitMiddleware } from "../middleware/rate-limit";

// ============================================
// Types
// ============================================
type Variables = {
    user: { id: string };
    supabase: SupabaseClient;
};

const plans = new Hono<{ Variables: Variables }>();

// ============================================
// Rate Limiter — 3 plan generations per 24h per user
// ============================================
const planRateLimit = rateLimitMiddleware({
    maxRequests: 3,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
});

// ============================================
// Validation Schemas
// ============================================
const createPlanSchema = z.object({
    title: z.string().min(1).max(255),
    initial_sentiment: z.string().min(1).max(1000),
    intention: z.string().min(1).max(1000),
    duration: z.number().int().min(3).max(90),
});

const closingSentimentSchema = z.object({
    closing_sentiment: z.string().min(1).max(2000),
});

// ============================================
// POST /api/plans — Create a new plan
// ============================================
plans.post(
    "/",
    planRateLimit,
    zValidator("json", createPlanSchema, (result, c) => {
        if (!result.success) {
            logger.warn("Plan create validation failed", {
                issues: result.error.issues.map((issue) => ({
                    path: issue.path.join("."),
                    code: issue.code,
                    message: issue.message,
                })),
            });
            return c.json(
                {
                    error: "Invalid plan data",
                    details: result.error.flatten(),
                },
                400
            );
        }
    }),
    async (c) => {
        const user = c.get("user");
        const supabase = c.get("supabase");
        const body = c.req.valid("json");

        logger.info("Plan create requested", {
            userId: user.id,
            duration: body.duration,
            titleLength: body.title.length,
            sentimentLength: body.initial_sentiment.length,
            intentionLength: body.intention.length,
        });

        try {
            // 1. Generate all daily content via AI
            const planDays = await aiService.generatePlan(
                body.initial_sentiment,
                body.intention,
                body.duration
            );

            // 2. Insert the plan record
            const { data: plan, error: planError } = await supabase
                .from("plans")
                .insert({
                    user_id: user.id,
                    title: body.title,
                    initial_sentiment: body.initial_sentiment,
                    intention: body.intention,
                    duration: body.duration,
                })
                .select()
                .single();

            if (planError || !plan) {
                logger.error(
                    "Failed to insert plan",
                    planError ?? new Error("No plan row returned"),
                    {
                        userId: user.id,
                        duration: body.duration,
                    }
                );
                return c.json({ error: "Failed to create plan" }, 500);
            }

            // 3. Insert all timeline rows
            const timelineRows = planDays.map((day) => ({
                plan_id: plan.id,
                day_number: day.day_number,
                bible_verse: day.bible_verse,
                verse_content: day.verse_content,
                encouragement_from_verse: day.encouragement_from_verse,
            }));

            const { error: timelinesError } = await supabase
                .from("plan_timelines")
                .insert(timelineRows);

            if (timelinesError) {
                // Roll back the plan to avoid orphaned records
                const { error: rollbackError } = await supabase
                    .from("plans")
                    .delete()
                    .eq("id", plan.id);

                logger.error(
                    "Failed to insert plan timelines — plan rolled back",
                    timelinesError,
                    {
                        userId: user.id,
                        planId: plan.id,
                        timelineCount: timelineRows.length,
                        rollbackError: rollbackError ?? null,
                    }
                );
                return c.json({ error: "Failed to create plan timelines" }, 500);
            }

            // 4. Fetch timelines ordered by day_number for the response
            const { data: timelines, error: fetchError } = await supabase
                .from("plan_timelines")
                .select("*")
                .eq("plan_id", plan.id)
                .order("day_number", { ascending: true });

            if (fetchError) {
                logger.warn("Plan created but timeline fetch failed", {
                    userId: user.id,
                    planId: plan.id,
                    fetchError,
                });
            }

            logger.info("Plan created successfully", {
                userId: user.id,
                planId: plan.id,
                duration: body.duration,
                timelineCount: timelines?.length ?? timelineRows.length,
            });

            return c.json(
                {
                    success: true,
                    plan: {
                        ...plan,
                        is_complete: false,
                        current_day: 1,
                        timelines: timelines ?? [],
                    },
                },
                201
            );
        } catch (error) {
            if (error instanceof AIQuotaExceededError) {
                logger.warn("Plan create blocked by AI quota", {
                    userId: user.id,
                    duration: body.duration,
                });
                return c.json(
                    {
                        error: "We have run out of fish and bread. Please return later for more sustenance.",
                    },
                    503
                );
            }

            logger.error("Failed to create plan", error, {
                userId: user.id,
                duration: body.duration,
                errorName:
                    error instanceof Error ? error.name : typeof error,
                errorMessage:
                    error instanceof Error ? error.message : String(error),
                isAiServiceError: error instanceof AIServiceError,
            });

            const clientMessage =
                error instanceof AIServiceError
                    ? "Failed to generate plan content. Please try again."
                    : "Failed to create plan";

            return c.json({ error: clientMessage }, 500);
        }
    }
);

// ============================================
// GET /api/plans — List user's plans (metadata only)
// ============================================
plans.get("/", async (c) => {
    const user = c.get("user");
    const supabase = c.get("supabase");

    const { data: plansData, error } = await supabase
        .from("plans")
        .select(
            `
            id, title, duration, created_at, closing_sentiment,
            plan_timelines(read)
        `
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

    if (error) {
        logger.error("Failed to fetch plans", error, { userId: user.id });
        return c.json({ error: "Failed to fetch plans" }, 500);
    }

    const result = (plansData ?? []).map((plan: any) => {
        const timelines: Array<{ read: boolean }> = plan.plan_timelines ?? [];
        const daysCompleted = timelines.filter((t) => t.read).length;
        const isComplete =
            timelines.length > 0 && daysCompleted === timelines.length;

        return {
            id: plan.id,
            title: plan.title,
            duration: plan.duration,
            created_at: plan.created_at,
            closing_sentiment: plan.closing_sentiment,
            is_complete: isComplete,
            days_completed: daysCompleted,
        };
    });

    logger.debug("Plans list retrieved", {
        userId: user.id,
        count: result.length,
    });

    return c.json({ success: true, plans: result });
});

// ============================================
// GET /api/plans/:id — Get plan with full timelines
// ============================================
plans.get("/:id", async (c) => {
    const user = c.get("user");
    const supabase = c.get("supabase");
    const id = c.req.param("id");

    const { data: plan, error } = await supabase
        .from("plans")
        .select(
            `
            *,
            plan_timelines(*)
        `
        )
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

    if (error || !plan) {
        logger.warn("Plan not found or unauthorized", {
            userId: user.id,
            planId: id,
        });
        return c.json({ error: "Plan not found" }, 404);
    }

    const timelines: any[] = (plan.plan_timelines ?? []).sort(
        (a: any, b: any) => a.day_number - b.day_number
    );

    const daysCompleted = timelines.filter((t) => t.read).length;
    const isComplete =
        timelines.length > 0 && daysCompleted === timelines.length;
    const currentDay = isComplete
        ? null
        : (timelines.find((t) => !t.read)?.day_number ?? null);

    // Destructure to remove the raw nested plan_timelines field
    const { plan_timelines: _raw, ...planMeta } = plan;

    return c.json({
        success: true,
        plan: {
            ...planMeta,
            is_complete: isComplete,
            current_day: currentDay,
            timelines,
        },
    });
});

// ============================================
// PATCH /api/plans/:id — Submit closing sentiment
// ============================================
plans.patch(
    "/:id",
    zValidator("json", closingSentimentSchema),
    async (c) => {
        const user = c.get("user");
        const supabase = c.get("supabase");
        const id = c.req.param("id");
        const body = c.req.valid("json");

        // Verify ownership and completion status
        const { data: plan, error: fetchError } = await supabase
            .from("plans")
            .select("id, plan_timelines(read)")
            .eq("id", id)
            .eq("user_id", user.id)
            .single();

        if (fetchError || !plan) {
            return c.json({ error: "Plan not found" }, 404);
        }

        const timelines: Array<{ read: boolean }> =
            (plan as any).plan_timelines ?? [];
        const isComplete =
            timelines.length > 0 && timelines.every((t) => t.read);

        if (!isComplete) {
            return c.json({ error: "Plan is not yet complete" }, 400);
        }

        const { data: updated, error: updateError } = await supabase
            .from("plans")
            .update({ closing_sentiment: body.closing_sentiment })
            .eq("id", id)
            .eq("user_id", user.id)
            .select()
            .single();

        if (updateError) {
            logger.error(
                "Failed to update closing sentiment",
                updateError,
                { userId: user.id, planId: id }
            );
            return c.json({ error: "Failed to update plan" }, 500);
        }

        logger.info("Closing sentiment submitted", {
            userId: user.id,
            planId: id,
        });

        return c.json({ success: true, plan: updated });
    }
);

// ============================================
// DELETE /api/plans/:id — Delete a plan
// ============================================
plans.delete("/:id", async (c) => {
    const user = c.get("user");
    const supabase = c.get("supabase");
    const id = c.req.param("id");

    // Verify ownership
    const { data: plan, error: fetchError } = await supabase
        .from("plans")
        .select("id")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

    if (fetchError || !plan) {
        return c.json({ error: "Plan not found" }, 404);
    }

    // Delete timelines first, then plan (handles DBs without cascade)
    await supabase.from("plan_timelines").delete().eq("plan_id", id);

    const { error: deleteError } = await supabase
        .from("plans")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);

    if (deleteError) {
        logger.error("Failed to delete plan", deleteError, {
            userId: user.id,
            planId: id,
        });
        return c.json({ error: "Failed to delete plan" }, 500);
    }

    logger.info("Plan deleted", { userId: user.id, planId: id });
    return c.json({ success: true });
});

export default plans;
