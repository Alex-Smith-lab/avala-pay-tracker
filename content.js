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

  let timer = null;
  let lastSignature = "";
  let observerTimer = null;

  function textOf(el) {
    return String(el?.innerText || el?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findHeadingIndex(elements, heading) {
    return elements.findIndex(el => {
      if (el.children.length > 2) return false;
      return new RegExp(
        "^" + heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
        "i"
      ).test(textOf(el));
    });
  }

  function parseDate(text, label) {
    const re = new RegExp(
      label +
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

    let year = now.getFullYear();
    let date = new Date(
      hasYear ? dateText : `${dateText}, ${year}`
    );

    if (Number.isNaN(date.getTime())) return "";

    date.setHours(0, 0, 0, 0);

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    if (!hasYear) {
      const isPayBy = label.toLowerCase() === "pay by";

      if (isPayBy && date < today) {
        date.setFullYear(date.getFullYear() + 1);
      } else if (!isPayBy && date > today) {
        date.setFullYear(date.getFullYear() - 1);
      }
    }

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function findUpcomingRange() {
    const elements = Array.from(
      document.querySelectorAll("body *")
    );

    const start = findHeadingIndex(
      elements,
      "Upcoming Payments"
    );

    if (start < 0) {
      return { found: false, records: [] };
    }

    let end = elements.length;

    for (let i = start + 1; i < elements.length; i++) {
      const el = elements[i];

      if (el.children.length > 2) continue;

      if (/^Recently Paid$/i.test(textOf(el))) {
        end = i;
        break;
      }
    }

    return {
      found: true,
      elements: elements.slice(start + 1, end)
    };
  }

  function extractBatches() {
    const range = findUpcomingRange();

    if (!range.found) {
      return {
        sectionFound: false,
        batches: []
      };
    }

    const best = new Map();

    for (const el of range.elements) {
      const text = textOf(el);

      if (text.length > 2200) continue;

      const batchMatch = text.match(BATCH_RE);
      const amountMatch = text.match(AMOUNT_RE);

      if (
        !batchMatch ||
        !amountMatch ||
        !/Completed\s*:/i.test(text) ||
        !/Delivered\s*:/i.test(text)
      ) {
        continue;
      }

      const batch = batchMatch[0];
      const amount = Number(
        amountMatch[0].replace(/[$,\s]/g, "")
      );

      const completedDate = parseDate(text, "Completed");
      const deliveredDate = parseDate(text, "Delivered");
      const payByDate = parseDate(text, "Pay by");

      if (!Number.isFinite(amount) || !deliveredDate) {
        continue;
      }

      const record = {
        batch,
        amount,
        completedDate,
        deliveredDate,
        payByDate
      };

      const previous = best.get(batch);

      // Prefer the smallest matching element that contains
      // the entire batch record, reducing duplicate matches.
      if (!previous || text.length < previous.textLength) {
        best.set(batch, {
          ...record,
          textLength: text.length
        });
      }
    }

    return {
      sectionFound: true,
      batches: Array.from(best.values()).map(item => {
        delete item.textLength;
        return item;
      })
    };
  }

  async function scan() {
    try {
      const result = extractBatches();

      // Do not clear valid stored results when the section
      // cannot be located during a page transition.
      if (!result.sectionFound) return;

      const batches = result.batches;

      const signature = JSON.stringify(
        batches
          .map(b => ({
            batch: b.batch,
            amount: b.amount,
            completedDate: b.completedDate,
            deliveredDate: b.deliveredDate,
            payByDate: b.payByDate
          }))
          .sort((a, b) => a.batch.localeCompare(b.batch))
      );

      if (signature === lastSignature) return;
      lastSignature = signature;

      const payload = {
        batches,
        source: location.href,
        updatedAt: new Date().toISOString(),
        scanStatus: batches.length
          ? "success"
          : "empty"
      };

      await chrome.storage.local.set({
        [STORAGE_KEY]: payload
      });

      console.info(
        "[Avala Pay Tracker] Scan complete:",
        batches.length,
        "upcoming batches"
      );
    } catch (error) {
      console.error("[Avala Pay Tracker]", error);
    }
  }

  function scheduleScan() {
    clearTimeout(observerTimer);
    observerTimer = setTimeout(scan, 800);
  }

  const observer = new MutationObserver(scheduleScan);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  timer = setInterval(scan, SCAN_INTERVAL);

  scan();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scan();
  });

  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    clearTimeout(observerTimer);
    observer.disconnect();
  });
})();
