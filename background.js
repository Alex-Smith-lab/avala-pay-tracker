"use strict";

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("index.html")
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "AVALA_BATCH_UPDATE") {
    chrome.storage.local.set({
      avalaBatchReport: {
        batches: Array.isArray(message.batches) ? message.batches : [],
        updatedAt: new Date().toISOString(),
        sourceTabId: sender.tab?.id ?? null
      }
    }).then(() => {
      sendResponse({ ok: true });
    }).catch(error => {
      sendResponse({ ok: false, error: error.message });
    });

    return true;
  }

  if (message?.type === "CLOSE_REPORT_TAB") {
    chrome.tabs.remove(sender.tab.id).then(
      () => sendResponse({ ok: true }),
      error => sendResponse({ ok: false, error: error.message })
    );

    return true;
  }
});
