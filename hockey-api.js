/**
 * Shared Google Apps Script client for Thunder13A.
 *
 * If you redeploy the Apps Script web app and Google gives you a NEW /exec URL,
 * paste that URL into HOCKEY_API_URL below (keep the /exec ending).
 */
const HOCKEY_API_URL = "https://script.google.com/macros/s/AKfycbyi04VRkZt27UmlfJKFQ9i2t7LvDuWl4-AWEB-hDuzVeQ4X-GYtZ7wk6NFYUG-_mTuj/exec";
const HOCKEY_SCRIPT_EDITOR_URL = "https://script.google.com/d/1lG-r_fq7YlakbjqSREBVHDGUHgEzF2YFrOLPOb7kP4xtkhChMYQJ72Q3/edit";

function describeHockeyApiFailure(err, status, bodyText) {
    const body = (bodyText || "").toString();
    const lower = body.toLowerCase();
    const looksLikeGoogleHtml = body.trim().startsWith("<") || lower.includes("<!doctype html");
    const accessDenied = lower.includes("access denied") || lower.includes("you need access");
    const networkFail = err && /failed to fetch|networkerror|load failed/i.test(String(err.message || err));

    if (accessDenied || (looksLikeGoogleHtml && status === 403) || (networkFail && !status)) {
        return {
            title: "Google Sheet backend is blocked",
            detail: "The training portal page is fine. Google is refusing the Apps Script web app that reads your sheet. Browsers report that as a CORS error because Google's Access Denied page has no CORS headers.",
            steps: [
                "Open the Apps Script project (use the button below) while signed into the Google account that owns the hockey spreadsheet.",
                "Click Deploy → Manage deployments.",
                "Click the pencil next to the Web app. Set Execute as: Me. Set Who has access: Anyone.",
                "Click Deploy. If Google asks you to authorize, click Allow.",
                "If the Web app URL changes, paste the new /exec URL into hockey-api.js (HOCKEY_API_URL) and push/publish the site."
            ]
        };
    }

    if (looksLikeGoogleHtml) {
        return {
            title: "Google returned an error page instead of team data",
            detail: "The Apps Script did not return JSON. This usually means the web app crashed, timed out, or needs to be redeployed.",
            steps: [
                "Open the Apps Script project and check Executions for red errors.",
                "Deploy → Manage deployments → edit the Web app → Deploy again.",
                "Confirm Who has access is Anyone and Execute as is Me."
            ]
        };
    }

    return {
        title: "Could not reach the training server",
        detail: err && err.message ? String(err.message) : "Unknown network error.",
        steps: [
            "Check your internet connection.",
            "Retry. If it keeps failing, redeploy the Apps Script web app with access set to Anyone."
        ]
    };
}

function hockeyApiErrorHtml(info) {
    const steps = (info.steps || []).map((step, i) => `<li class="mb-1">${i + 1}. ${step}</li>`).join("");
    return `
        <p class="font-black uppercase tracking-wide text-rose-300 mb-1">${info.title}</p>
        <p class="text-slate-300 mb-3">${info.detail}</p>
        <ol class="text-left text-slate-400 mb-3 list-none">${steps}</ol>
        <a href="${HOCKEY_SCRIPT_EDITOR_URL}" target="_blank" rel="noopener noreferrer"
           class="inline-flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-2 rounded-xl text-xs transition shadow-lg shadow-blue-600/20">
            Open Apps Script project
        </a>
    `;
}

async function hockeyApi(action, params, method) {
    params = params || {};
    method = method || "GET";

    const url = new URL(HOCKEY_API_URL);
    url.searchParams.set("action", action);
    Object.keys(params).forEach(function (key) {
        const value = params[key];
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
        }
    });

    let response;
    try {
        response = await fetch(url.toString(), {
            method: method,
            redirect: "follow",
            credentials: "omit",
            cache: "no-store"
        });
    } catch (err) {
        const info = describeHockeyApiFailure(err);
        const wrapped = new Error(info.title);
        wrapped.hockeyApiInfo = info;
        wrapped.cause = err;
        throw wrapped;
    }

    const text = await response.text();
    const trimmed = (text || "").trim();
    const looksLikeHtml = trimmed.charAt(0) === "<";

    if (!response.ok || looksLikeHtml) {
        const info = describeHockeyApiFailure(null, response.status, trimmed);
        const wrapped = new Error(info.title);
        wrapped.hockeyApiInfo = info;
        wrapped.status = response.status;
        throw wrapped;
    }

    try {
        return JSON.parse(trimmed);
    } catch (err) {
        const info = describeHockeyApiFailure(err, response.status, trimmed);
        const wrapped = new Error("The training server returned an unreadable response.");
        wrapped.hockeyApiInfo = info;
        throw wrapped;
    }
}
