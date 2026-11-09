import { supabase, clearSupabaseAuth } from "./auth/supabase";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

// Debouncing flag for 429 errors to prevent spam
let rateToastShown = false;

// A generic wrapper for fetch
async function request<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    // 1. Get the current session token
    const {
        data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token) {
        // Redirect to login if no token
        window.location.href = "/auth?mode=login";
        throw new Error("Not authenticated");
    }

    // 2. Add headers
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
    };

    // 3. Fire request
    const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
    });

    // 4. Handle errors
    if (!response.ok) {
        // Handle 401 Unauthorized (token expired or invalid)
        if (response.status === 401 || response.status === 403) {
            console.error("Authentication failed - redirecting to login");
            toast.error("Your session has expired. Please log in again.", {
                duration: 3000,
            });
            
            // Nuke the session from orbit to prevent loops
            clearSupabaseAuth();
            
            setTimeout(() => {
                window.location.href = "/auth?mode=login";
            }, 500);
            throw new Error("Unauthorized");
        }

        // Special handling for 429 rate limit errors
        if (response.status === 429) {
            if (!rateToastShown) {
                toast.error(
                    "We have run out of fish and bread. Please return later.",
                    {
                        duration: 6000,
                    }
                );
                rateToastShown = true;
                // Reset flag after 10 seconds
                setTimeout(() => {
                    rateToastShown = false;
                }, 10000);
            }
            throw new Error("Rate limit exceeded");
        }

        // Handle other errors
        const errorBody = await response.json().catch(() => ({}));
        const message =
            (typeof errorBody?.error === "string" && errorBody.error) ||
            "Something went wrong";
        const err = new Error(message) as Error & {
            status?: number;
            body?: unknown;
        };
        err.status = response.status;
        err.body = errorBody;
        console.error("API request failed", {
            endpoint,
            status: response.status,
            body: errorBody,
        });
        throw err;
    }

    return response.json();
}

// The clean interface you will use in your components
export const api = {
    get: <T>(endpoint: string) => request<T>(endpoint, { method: "GET" }),
    post: <T>(endpoint: string, body: any) =>
        request<T>(endpoint, {
            method: "POST",
            body: JSON.stringify(body),
        }),
    put: <T>(endpoint: string, body: any) =>
        request<T>(endpoint, {
            method: "PUT",
            body: JSON.stringify(body),
        }),
    patch: <T>(endpoint: string, body: any) =>
        request<T>(endpoint, {
            method: "PATCH",
            body: JSON.stringify(body),
        }),
    delete: <T>(endpoint: string) => request<T>(endpoint, { method: "DELETE" }),
};
