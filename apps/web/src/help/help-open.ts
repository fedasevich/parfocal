export const helpRequests = new EventTarget();

export const openHelp = () => helpRequests.dispatchEvent(new Event("open"));
