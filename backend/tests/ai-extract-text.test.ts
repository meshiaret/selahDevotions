import { describe, expect, test } from "bun:test";
import { extractResponseText } from "../src/services/ai-text";

describe("extractResponseText", () => {
    test("prefers response.text helper", () => {
        const text = extractResponseText({
            text: "hello from helper",
            candidates: [
                {
                    content: {
                        parts: [{ text: "ignored" }],
                    },
                },
            ],
        });
        expect(text).toBe("hello from helper");
    });

    test("skips thought parts and concatenates answer text", () => {
        const text = extractResponseText({
            candidates: [
                {
                    content: {
                        parts: [
                            { text: "reasoning...", thought: true },
                            { text: '{"days":[' },
                            { text: "]}" },
                        ],
                    },
                },
            ],
        });
        expect(text).toBe('{"days":[]}');
    });

    test("returns undefined when only thought / empty parts exist", () => {
        expect(
            extractResponseText({
                candidates: [
                    {
                        content: {
                            parts: [{ text: "thinking", thought: true }],
                        },
                    },
                ],
            })
        ).toBeUndefined();

        expect(extractResponseText({ candidates: [] })).toBeUndefined();
    });
});
