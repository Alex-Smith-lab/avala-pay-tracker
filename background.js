chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("dashboard.html");

  const tabs = await chrome.tabs.query({});

  const existing = tabs.find(
    tab => tab.url && tab.url.startsWith(url)
  );

  if (existing && existing.id) {
    await chrome.tabs.update(existing.id, {
      active: true
    });

    if (existing.windowId) {
      await chrome.windows.update(existing.windowId, {
        focused: true
      });
    }

    return;
  }

  await chrome.tabs.create({
    url,
    active: true
  });
});
