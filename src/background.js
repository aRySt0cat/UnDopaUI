// Development helper: lets a content script ask the extension to reload itself,
// so edits can be picked up without visiting chrome://extensions.
// Only honoured for unpacked ("development") installs.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "undopa:dev-reload" || sender.id !== chrome.runtime.id) return;
  chrome.management.getSelf((self) => {
    if (self.installType === "development") chrome.runtime.reload();
  });
});
