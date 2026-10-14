"use strict";

(() => {
  if (window.__avalaReaderV2) return;
  window.__avalaReaderV2 = true;

  const BATCH_ID = /\b(?:v\d+-)?batch-[a-z0-9-]+\b/i;
  const AMOUNT = /\$\s*([\d,]+(?:\.\d{1,2})?)/;
  const DATE =
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i;

  let observer;
  let timer;
  let lastSignature = "";
  let lastStatus = "";

  const clean = value =>
    String(value || "").replace(/\s+/g, " ").trim();

  function visibleText(element) {
    return clean(element?.innerText || element?.textContent || "");
  }

  function parseDate(value) {
    if (!value) return "";

    const match = String(value).match(DATE);
    if (!match) return "";

    const months = {
      jan: 0, feb: 1, mar: 2, apr: 3,
      may: 4, jun: 5, jul: 6, aug: 7,
      sep: 8, oct: 9, nov: 10, dec: 11
    };

    const month = months[match[1].slice(0, 3).toLowerCase()];
    const day = Number(match[2]);
    const now = new Date();

    let year = match[3] ? Number(match[3]) : now.getFullYear();
    let date = new Date(Date.UTC(year, month, day));

    if (
      !match[3] &&
      date.getTime() >
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) +
        86400000
    ) {
      year--;
      date = new Date(Date.UTC(year, month, day));
    }

    if (
      date.getUTCMonth() !== month ||
      date.getUTCDate() !== day
    ) {
      return "";
    }

    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0")
    ].join("-");
  }

  function findHeading(pattern) {
    const elements = [
      ...document.querySelectorAll(
        "h1,h2,h3,h4,h5,h6,[role='heading'],div,section"
      )
    ];

    return elements.find(element => {
      const text = visibleText(element);
      return text.length < 100 && pattern.test(text);
    }) || null;
  }

  function isBetween(element, start, end) {
    if (!element || element === start || element === end) {
      return false;
    }

    const afterStart = Boolean(
      start.compareDocumentPosition(element) &
      Node.DOCUMENT_POSITION_FOLLOWING
    );

    const beforeEnd = Boolean(
      element.compareDocumentPosition(end) &
      Node.DOCUMENT_POSITION_FOLLOWING
    );

    return afterStart && beforeEnd;
  }

  function findSection() {
    const headings = [
      ...document.querySelectorAll(
        "h1,h2,h3,h4,h5,h6,[role='heading'],div,section"
      )
    ];

    const start = headings.find(element => {
      const text = visibleText(element);
      return text.length < 100 &&
        /^upcoming payments\b/i.test(text);
    });

    if (!start) {
      return {
        ok: false,
        message: "Upcoming Payments heading not found."
      };
    }

    const end = headings.find(element => {
      const text = visibleText(element);

      return text.length < 100 &&
        /^recently paid\b/i.test(text) &&
        Boolean(
          start.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING
        );
    });

    if (!end) {
      return {
        ok: false,
        message: "Recently Paid heading not found."
      };
    }

    return { ok: true, start, end };
  }

  function extractFields(text) {
    const id = text.match(BATCH_ID)?.[0] || "";
    const amountMatch = text.match(AMOUNT);

    const completedMatch = text.match(
      /\bCompleted\s*:\s*(.*?)(?=\s*(?:→|➜|->|›|-)\s*Delivered\s*:)/i
    );

    const deliveredMatch = text.match(
      /\bDelivered\s*:\s*(.*?)(?=\s*(?:→|➜|->|›|-)\s*Pay\s+by\s*:)/i
    );

    const payByMatch = text.match(
      /\bPay\s+by\s*:\s*(.*?)(?=\s*(?:→|➜|->|›|-)|$)/i
    );

    if (!id || !amountMatch) return null;

    return {
      id,
      amount: Number(amountMatch[1].replace(/,/g, "")),
      completedDate: parseDate(completedMatch?.[1] || ""),
      deliveredDate: parseDate(deliveredMatch?.[1] || ""),
      payByDate: parseDate(payByMatch?.[1] || ""),
      rawText: text.slice(0, 1000)
    };
  }

  function scan() {
    const section = findSection();

    if (!section.ok) {
      publish([], "waiting", section.message);
      return;
    }

    const candidates = [
      ...document.querySelectorAll("body *")
    ].filter(element => {
      if (!isBetween(element, section.start, section.end)) {
        return false;
      }

      const text = visibleText(element);

      return text.length <= 2500 &&
        BATCH_ID.test(text) &&
        AMOUNT.test(text) &&
        /\bCompleted\s*:/i.test(text) &&
        /\bDelivered\s*:/i.test(text);
    });

    // Prefer the smallest element that contains all batch details.
    candidates.sort((a, b) =>
      visibleText(a).length - visibleText(b).length
    );

    const byId = new Map();

    for (const element of candidates) {
      const batch = extractFields(visibleText(element));
      if (!batch) continue;

      if (!Number.isFinite(batch.amount)) continue;

      if (!byId.has(batch.id)) {
        byId.set(batch.id, batch);
      }
    }

    const batches = [...byId.values()];

    publish(
      batches,
      "success",
      batches.length
        ? `Successfully read ${batches.length} upcoming batches.`
        : "The headings were found, but no complete batch cards were detected."
    );
  }

  function publish(batches, scanStatus, scanMessage) {
    const signature = JSON.stringify({
      batches, scanStatus, scanMessage
    });

    if (signature === lastSignature) return;

    lastSignature = signature;
    lastStatus = scanStatus;

    chrome.runtime.sendMessage({
      type: "AVALA_BATCH_UPDATE",
      batches,
      scanStatus,
      scanMessage
    }, response => {
      if (chrome.runtime.lastError) {
        console.warn(
          "[Avala Reader] Extension connection unavailable. Reload the dashboard."
        );
        return;
      }

      if (!response?.ok) {
        console.warn("[Avala Reader] Could not save dashboard results.");
      }
    });

    console.info("[Avala Reader]", scanMessage);
  }

  function scheduleScan() {
    clearTimeout(timer);
    timer = setTimeout(scan, 700);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "AVALA_RESCAN") {
      scan();
      sendResponse({
        ok: true,
        message: lastStatus || "Scan requested."
      });
    }
  });

  function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body || document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true
    });
  }

  function init() {
    scan();
    startObserver();

    // Fallback for dashboard updates not reflected in DOM mutations.
    setInterval(scan, 15000);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleScan();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
