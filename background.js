"use strict";

chrome.action.onClicked.addListener(async () => {
  const dashboardUrl =
    chrome.runtime.getURL("dashboard.html");

  const tabs = await chrome.tabs.query({});

  const existing = tabs.find(tab =>
    tab.url && tab.url.startsWith(dashboardUrl)
  );

  if (existing && existing.id != null) {
    await chrome.tabs.update(existing.id, {
      active: true
    });

    await chrome.windows.update(existing.windowId, {
      focused: true
    });

    return;
  }

  await chrome.tabs.create({
    url: dashboardUrl,
    active: true
  });
});
