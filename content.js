
(() => {
  "use strict";

  if (window.__avalaPayTrackerInstalled) return;
  window.__avalaPayTrackerInstalled = true;

  const STORAGE_KEY = "avalaPayTrackerData";
  const SCAN_INTERVAL = 15000;

  const BATCH_RE =
    /\b(?:v\d+-)?batch-[a-z0-9-]+\b/i;

  const AMOUNT_RE =
    /\$\s*[\d,]+(?:\.\d{1,2})?/;

  let scanTimer = null;
  let lastSignature = "";

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseDate(text, label) {
    const escaped = label.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    const re = new RegExp(
      escaped +
      "\\s*:?\\s*" +
      "([A-Za-z]{3,9}\\s+\\d{1,2}(?:,?\\s+\\d{4})?)",
      "i"
    );

    const match = text.match(re);

    if (!match) return "";

    const dateText = match[1].replace(
      /([A-Za-z]{3,9}\s+\d{1,2})(\s+\d{4})$/,
      "$1,$2"
    );

    const hasYear = /\b\d{4}\b/.test(dateText);

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    let date = new Date(
      hasYear
        ? dateText
        : `${dateText}, ${now.getFullYear()}`
    );

    if (Number.isNaN(date.getTime())) return "";

    date.setHours(0, 0, 0, 0);

    // If a year is not shown, infer the previous year
    // when a completion or delivery date appears in the future.
    if (
      !hasYear &&
      label.toLowerCase() !== "pay by" &&
      date > now
    ) {
      date.setFullYear(date.getFullYear() - 1);
    }

    // Return a stable local calendar date: YYYY-MM-DD.
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function findSectionBoundary() {
    const elements = Array.from(
      document.querySelectorAll("body *")
    );

    let upcomingIndex = -1;
    let paidIndex = elements.length;

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];

      if (el.children.length > 3) continue;

      const text = cleanText(
        el.innerText || el.textContent
      );

      if (/^Upcoming Payments$/i.test(text)) {
        upcomingIndex = i;
      }

      if (
        upcomingIndex >= 0 &&
        /^Recently Paid$/i.test(text)
      ) {
        paidIndex = i;
        break;
      }
    }

    if (upcomingIndex < 0) return null;

    return {
      elements,
      upcomingIndex,
      paidIndex
    };
  }

  function getCandidates() {
    const section = findSectionBoundary();

    if (!section) return [];

    const {
      elements,
      upcomingIndex,
      paidIndex
    } = section;

    const candidates = [];

    for (
      let i = upcomingIndex + 1;
      i < paidIndex;
      i++
    ) {
      const el = elements[i];

      if (!el || !el.isConnected) continue;

      const text = cleanText(
        el.innerText || el.textContent
      );

      if (
        !BATCH_RE.test(text) ||
        !AMOUNT_RE.test(text) ||
        !/Completed\s*:/i.test(text) ||
        !/Delivered\s*:/i.test(text)
      ) {
        continue;
      }

      if (text.length > 1800) continue;

      candidates.push({
        element: el,
        text
      });
    }

    return candidates;
  }

  function extractBatches() {
    const candidates = getCandidates();
    const bestByBatch = new Map();

    for (const candidate of candidates) {
      const text = candidate.text;
      const batchMatch = text.match(BATCH_RE);
      const amountMatch = text.match(AMOUNT_RE);

      if (!batchMatch || !amountMatch) continue;

      const batch = batchMatch[0];

      const amount = Number(
        amountMatch[0]
          .replace("$", "")
          .replace(/,/g, "")
          .trim()
      );

      const completedDate = parseDate(
        text,
        "Completed"
      );

      const deliveredDate = parseDate(
        text,
        "Delivered"
      );

      const payByDate = parseDate(
        text,
        "Pay by"
      );

      if (
        !Number.isFinite(amount) ||
        !deliveredDate
      ) {
        continue;
      }

      const record = {
        batch,
        amount,
        completedDate,
        deliveredDate,
        payByDate,
        scannedAt: new Date().toISOString()
      };

      const previous = bestByBatch.get(batch);

      // Keep the smallest matching text containing
      // a complete batch record.
      if (
        !previous ||
        text.length < previous._textLength
      ) {
        bestByBatch.set(batch, {
          ...record,
          _textLength: text.length
        });
      }
    }

    return Array.from(bestByBatch.values()).map(
      record => {
        delete record._textLength;
        return record;
      }
    );
  }

  async function scan() {
    try {
      const batches = extractBatches();

      // Do not erase previously saved data when the page
      // is loading or its payment section is temporarily absent.
      if (!batches.length) return;

      const signature = JSON.stringify(
        batches
          .map(batch => ({
            batch: batch.batch,
            amount: batch.amount,
            completedDate: batch.completedDate,
            deliveredDate: batch.deliveredDate,
            payByDate: batch.payByDate
          }))
          .sort((a, b) =>
            a.batch.localeCompare(b.batch)
          )
      );

      if (signature === lastSignature) return;

      lastSignature = signature;

      const payload = {
        batches,
        source: location.href,
        updatedAt: new Date().toISOString()
      };

      await chrome.storage.local.set({
        [STORAGE_KEY]: payload
      });

      console.info(
        "[Avala Pay Tracker] Updated:",
        batches.length,
        "upcoming batches"
      );
    } catch (error) {
      console.error(
        "[Avala Pay Tracker] Scan failed:",
        error
      );
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 700);
  }

  const observer = new MutationObserver(() => {
    scheduleScan();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  setInterval(scan, SCAN_INTERVAL);

  scan();

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) scan();
    }
  );
})();
