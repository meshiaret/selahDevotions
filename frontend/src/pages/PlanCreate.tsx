import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../api";
import type { Plan } from "../types/types";

const PlanCreate = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);

    const [title, setTitle] = useState("");
    const [initialSentiment, setInitialSentiment] = useState("");
    const [intention, setIntention] = useState("");
    const [duration, setDuration] = useState(7);

    const isValid =
        title.trim().length > 0 &&
        initialSentiment.trim().length > 0 &&
        intention.trim().length > 0 &&
        duration >= 3 &&
        duration <= 90;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValid || loading) return;
        setLoading(true);

        try {
            const response = await api.post<{ success: boolean; plan: Plan }>(
                "/api/plans",
                {
                    title: title.trim(),
                    initial_sentiment: initialSentiment.trim(),
                    intention: intention.trim(),
                    duration,
                },
            );

            if (response?.plan?.id) {
                navigate(`/plans/${response.plan.id}`, { replace: true });
            } else {
                console.error("Plan create returned unexpected payload", response);
                toast.error("Plan was created but the response was incomplete.");
            }
        } catch (err) {
            const message =
                err instanceof Error && err.message
                    ? err.message
                    : "Oops, that didn't work.";
            console.error("Failed to create plan:", {
                message,
                status: (err as { status?: number })?.status,
                body: (err as { body?: unknown })?.body,
                err,
            });
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex-1 overflow-y-auto bg-stone-50 dark:bg-stone-950 pb-28 md:pb-12 p-6 md:p-14">
            <div className="max-w-2xl mx-auto space-y-8">
                {/* Back link */}
                <button
                    onClick={() => navigate("/plans")}
                    className="flex items-center gap-2 text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 transition text-sm font-medium"
                >
                    <ArrowLeft size={16} strokeWidth={1.5} />
                    Back to Plans
                </button>

                {/* Header */}
                <div className="border-b border-stone-200 dark:border-stone-800 pb-8">
                    <h1 className="text-4xl font-serif text-stone-800 dark:text-stone-100">
                        New Plan
                    </h1>
                    <p className="text-stone-500 dark:text-stone-400 mt-2">
                        Tell us where you are and where you want to go. Selah
                        will prepare the path.
                    </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Title */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                            Plan title
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. Finding peace in uncertainty"
                            maxLength={255}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            disabled={loading}
                            className="w-full px-4 py-3 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-lg focus:ring-2 focus:ring-stone-300 dark:focus:ring-stone-600 outline-none transition text-sm placeholder:text-stone-400 dark:placeholder:text-stone-500 disabled:opacity-50"
                        />
                    </div>

                    {/* How are you feeling */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                            How are you feeling right now?
                        </label>
                        <textarea
                            placeholder="Share what's on your heart — your struggles, joys, or questions..."
                            maxLength={1000}
                            rows={4}
                            value={initialSentiment}
                            onChange={(e) => setInitialSentiment(e.target.value)}
                            disabled={loading}
                            className="w-full px-4 py-3 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-lg focus:ring-2 focus:ring-stone-300 dark:focus:ring-stone-600 outline-none transition text-sm placeholder:text-stone-400 dark:placeholder:text-stone-500 resize-none disabled:opacity-50 font-serif leading-relaxed"
                        />
                        <p className="text-xs text-stone-400 dark:text-stone-500 text-right">
                            {initialSentiment.length}/1000
                        </p>
                    </div>

                    {/* Intention */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                            What do you hope to achieve?
                        </label>
                        <textarea
                            placeholder="e.g. Draw closer to God, find comfort in scripture, grow in faith..."
                            maxLength={1000}
                            rows={3}
                            value={intention}
                            onChange={(e) => setIntention(e.target.value)}
                            disabled={loading}
                            className="w-full px-4 py-3 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-lg focus:ring-2 focus:ring-stone-300 dark:focus:ring-stone-600 outline-none transition text-sm placeholder:text-stone-400 dark:placeholder:text-stone-500 resize-none disabled:opacity-50 font-serif leading-relaxed"
                        />
                        <p className="text-xs text-stone-400 dark:text-stone-500 text-right">
                            {intention.length}/1000
                        </p>
                    </div>

                    {/* Duration */}
                    <div className="space-y-3">
                        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                            Duration
                        </label>
                        <div className="flex items-center gap-4">
                            <input
                                type="range"
                                min={3}
                                max={90}
                                step={1}
                                value={duration}
                                onChange={(e) =>
                                    setDuration(Number(e.target.value))
                                }
                                disabled={loading}
                                className="flex-1 accent-stone-700 dark:accent-stone-300 disabled:opacity-50"
                            />
                            <div className="shrink-0 w-24 text-center">
                                <span className="text-2xl font-serif font-bold text-stone-800 dark:text-stone-100">
                                    {duration}
                                </span>
                                <span className="text-sm text-stone-500 dark:text-stone-400 ml-1">
                                    days
                                </span>
                            </div>
                        </div>
                        <p className="text-xs text-stone-400 dark:text-stone-500">
                            Choose between 3 and 90 days.
                        </p>
                    </div>

                    {/* Submit */}
                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={!isValid || loading}
                            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-[#3B4737] dark:bg-[#E6E0D4] text-white dark:text-[#3B4737] font-medium rounded-lg hover:bg-[#2E3A2B] dark:hover:bg-[#D4CBBA] disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg shadow-[#3B4737]/10 dark:shadow-stone-950/30 text-base"
                        >
                            {loading ? (
                                <>
                                    <svg
                                        className="animate-spin h-4 w-4"
                                        xmlns="http://www.w3.org/2000/svg"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                    >
                                        <circle
                                            className="opacity-25"
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="currentColor"
                                            strokeWidth="4"
                                        />
                                        <path
                                            className="opacity-75"
                                            fill="currentColor"
                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                        />
                                    </svg>
                                    <span className="font-serif italic">
                                        Preparing your path...
                                    </span>
                                </>
                            ) : (
                                <>
                                    Generate My Plan
                                </>
                            )}
                        </button>
                        {loading && (
                            <p className="text-xs text-stone-400 dark:text-stone-500 text-center mt-3 font-serif italic">
                                Selah is crafting your devotional journey. This
                                may take a moment.
                            </p>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PlanCreate;
