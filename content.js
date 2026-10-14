"use strict";

(() => {
  if (window.__avalaBatchReaderStarted) return;
  window.__avalaBatchReaderStarted = true;

  const moneyPattern = /\$\s*([\d,]+(?:\.\d{1,2})?)/;
  const batchPattern = /\b(?:v\d+-)?batch-[a-z0-9-]+\b/i;

  let scanTimer = null;
  let lastSignature = "";

  function clean(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function parseDate(text) {
    if (!text) return "";

    const match = text.match(
      /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?\b/i
    );

    if (!match) return "";

    const value = match[0];
    const hasYear = /\b\d{4}\b/.test(value);
    const year = hasYear
      ? Number(value.match(/\b\d{4}\b/)[0])
      : new Date().getFullYear();

    const normalized = value.replace(
      /\b\d{4}\b/,
      ""
    ).replace(/,\s*$/, "").trim();

    const date = new Date(`${normalized}, ${year}`);

    if (Number.isNaN(date.getTime())) return "";

    // A date without a year may refer to the previous year.
    if (!hasYear) {
      const today = new Date();
      if (date.getTime() > today.getTime() + 86400000) {
        date.setFullYear(year - 1);
      }
    }

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function getSection() {
    const candidates = [
      ...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")
    ];

    const upcoming = candidates.find(el =>
      /^upcoming payments\b/i.test(clean(el.innerText))
    );

    const recentlyPaid = candidates.find(el =>
      /^recently paid\b/i.test(clean(el.innerText))
    );

    if (!upcoming || !recentlyPaid) return null;

    // Find a shared container for both section headings.
    let root = upcoming.parentElement;

    while (root && !root.contains(recentlyPaid)) {
      root = root.parentElement;
    }

    if (!root) return null;

    // Walk elements in document order and stop at Recently Paid.
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT
    );

    const elements = [];
    let node;

    while ((node = walker.nextNode())) {
      if (node === recentlyPaid) break;
      if (node === upcoming || upcoming.contains(node)) continue;
      elements.push(node);
    }

    // Restrict the scan to the subtree following Upcoming Payments.
    const upcomingIndex = elements.indexOf(upcoming);
    const sectionElements = upcomingIndex >= 0
      ? elements.slice(upcomingIndex + 1)
      : elements.filter(el => {
          const position = upcoming.compareDocumentPosition(el);
          return position & Node.DOCUMENT_POSITION_FOLLOWING;
        });

    return { root, upcoming, recentlyPaid, sectionElements };
  }

  function getCardElements(sectionElements) {
    const candidates = sectionElements.filter(el => {
      const text = clean(el.innerText);
      return batchPattern.test(text) &&
        moneyPattern.test(text) &&
        /\bCompleted\s*:/i.test(text) &&
        /\bDelivered\s*:/i.test(text);
    });

    // Prefer the smallest complete element, not its ancestors.
    return candidates.filter(el =>
      !candidates.some(other =>
        other !== el && el.contains(other)
      )
    );
  }

  function extractBatch(card) {
    const text = clean(card.innerText);

    const idMatch = text.match(batchPattern);
    const amountMatch = text.match(moneyPattern);
    const completedMatch = text.match(
      /\bCompleted\s*:\s*(.*?)(?=\s*(?:→|->|›)\s*Delivered\s*:)/i
    );
    const deliveredMatch = text.match(
      /\bDelivered\s*:\s*(.*?)(?=\s*(?:→|->|›)\s*Pay\s+by\s*:)/i
    );
    const payByMatch = text.match(
      /\bPay\s+by\s*:\s*([A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?)/i
    );

    if (!idMatch || !amountMatch) return null;

    const completedText = completedMatch?.[1] || "";
    const deliveredText = deliveredMatch?.[1] || "";

    const completedDate = parseDate(completedText);
    const deliveredDate = parseDate(deliveredText);
    const payByDate = parseDate(payByMatch?.[1] || "");

    return {
      id: idMatch[0],
      amount: Number(amountMatch[1].replace(/,/g, "")),
      completedDate,
      deliveredDate,
      payByDate,
      rawCompleted: clean(completedText),
      rawDelivered: clean(deliveredText)
    };
  }

  function scan() {
    const section = getSection();

    if (!section) {
      console.warn(
        "[Avala Report] Could not locate both section headings. " +
        "Keep Upcoming Payments and Recently Paid visible on the page."
      );
      return;
    }

    const cards = getCardElements(section.sectionElements);
    const batches = cards
      .map(extractBatch)
      .filter(Boolean);

    // Deduplicate IDs in case the dashboard uses nested card elements.
    const unique = [...new Map(
      batches.map(batch => [batch.id, batch])
    ).values()];

    const signature = JSON.stringify(unique);

    if (signature === lastSignature) return;
    lastSignature = signature;

    chrome.runtime.sendMessage({
      type: "AVALA_BATCH_UPDATE",
      batches: unique
    }, response => {
      if (chrome.runtime.lastError) {
        console.debug(
          "[Avala Report] Waiting for extension connection."
        );
        return;
      }

      if (!response?.ok) {
        console.warn("[Avala Report] Could not save scan.");
      }
    });

    console.info(
      `[Avala Report] Scanned ${unique.length} upcoming batches.`
    );
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 500);
  }

  // Initial scan and automatic updates when the dashboard changes.
  scan();

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true
  });

  // Also rescan periodically in case the site updates data silently.
  setInterval(scan, 15000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleScan();
  });
})();
