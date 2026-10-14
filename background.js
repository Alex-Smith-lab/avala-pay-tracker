"use strict";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Avala Batch Payment Report installed.");
});

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("index.html");

  const existing = await chrome.tabs.query({ url });

  if (existing.length && existing[0].id !== undefined) {
    await chrome.tabs.update(existing[0].id, {
      active: true
    });
    return;
  }

  await chrome.tabs.create({ url });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "AVALA_BATCH_UPDATE") {
    const batches = Array.isArray(message.batches)
      ? message.batches
      : [];

    chrome.storage.local.set({
      avalaBatchReport: {
        batches,
        updatedAt: new Date().toISOString(),
        sourceUrl: sender.tab?.url || "",
        sourceTabId: sender.tab?.id ?? null,
        scanStatus: message.scanStatus || "success",
        scanMessage: message.scanMessage || ""
      }
    }).then(() => {
      sendResponse({ ok: true });
    }).catch(error => {
      sendResponse({
        ok: false,
        error: error.message
      });
    });

    return true;
  }

  if (message?.type === "GET_AVALA_BATCHES") {
    chrome.storage.local.get("avalaBatchReport")
      .then(data => sendResponse({
        ok: true,
        report: data.avalaBatchReport || null
      }))
      .catch(error => sendResponse({
        ok: false,
        error: error.message
      }));

    return true;
  }

  if (message?.type === "RESCAN_AVALA") {
    chrome.tabs.query({
      url: "https://pay.avala.ai/*"
    }).then(tabs => {
      const tab = tabs.find(item => item.id !== undefined);

      if (!tab || tab.id === undefined) {
        sendResponse({
          ok: false,
          error: "Open the Avala dashboard and sign in first."
        });
        return;
      }

      chrome.tabs.sendMessage(
        tab.id,
        { type: "AVALA_RESCAN" },
        response => {
          if (chrome.runtime.lastError) {
            sendResponse({
              ok: false,
              error: "Reload the Avala dashboard and try again."
            });
            return;
          }

          sendResponse(response || { ok: true });
        }
      );
    });

    return true;
  }

  if (message?.type === "CLOSE_REPORT_TAB") {
    if (!sender.tab?.id) {
      sendResponse({ ok: false });
      return;
    }

    chrome.tabs.remove(sender.tab.id)
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({
        ok: false,
        error: error.message
      }));

    return true;
  }
});
